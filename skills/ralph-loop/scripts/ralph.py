#!/usr/bin/env python3
"""
ralph.py — host-agnostic Ralph-loop driver.

Runs an AI coding CLI (Claude Code, Codex, OpenCode, Gemini, Aider, or any
arbitrary command) in a tight loop against a single PROMPT.md, treating
files in the workspace as the agent's only persistent state. Each iteration
gets fresh context; the agent's notes survive because they live on disk.

Design constraints (do not loosen without thinking):
    - stdlib only, Python >= 3.8
    - no network calls, no subprocess to anything beyond the configured CLI and `git`
    - works on Linux, macOS, Windows (pathlib + subprocess only)
    - one process, one workspace; parallel mode = run ralph twice with different configs

See SKILL.md for the doctrine and references/cli-adapters.md for per-CLI configs.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional


# ---------- config ----------

DEFAULT_CONFIG_PATHS = [".ralph/config.json", "ralph.config.json"]
DEFAULT_PROMPT_PATH = ".ralph/PROMPT.md"
DEFAULT_LOG_DIR = ".ralph/log"
DEFAULT_WORKSPACE = ".ralph"

DONE_FILE = "DONE"     # agent writes this when the goal is met
STOP_FILE = "STOP"     # user writes this to halt at next iteration boundary
PAUSE_FILE = "PAUSE"   # user writes this to pause without exiting


@dataclass
class Config:
    command: List[str]
    prompt_file: str = DEFAULT_PROMPT_PATH
    workspace: str = DEFAULT_WORKSPACE
    log_dir: str = DEFAULT_LOG_DIR
    stdin_from_prompt: bool = False
    max_iterations: int = 20
    max_wall_seconds: int = 4 * 60 * 60
    sleep_between_seconds: float = 1.0
    exit_code_failure_threshold: int = 5
    iteration_timeout_seconds: Optional[int] = 30 * 60
    auto_commit: bool = False
    git_branch: Optional[str] = None
    env: dict = field(default_factory=dict)

    @staticmethod
    def load(path: Path) -> "Config":
        raw = json.loads(path.read_text())
        if "command" not in raw or not isinstance(raw["command"], list):
            die(f"config {path}: 'command' must be a list of args, "
                f"e.g. [\"claude\", \"-p\", \"{{prompt}}\"]")
        if not raw["command"]:
            die(f"config {path}: 'command' is empty")
        return Config(
            command=[str(a) for a in raw["command"]],
            prompt_file=raw.get("prompt_file", DEFAULT_PROMPT_PATH),
            workspace=raw.get("workspace", DEFAULT_WORKSPACE),
            log_dir=raw.get("log_dir", DEFAULT_LOG_DIR),
            stdin_from_prompt=bool(raw.get("stdin_from_prompt", False)),
            max_iterations=int(raw.get("max_iterations", 20)),
            max_wall_seconds=int(raw.get("max_wall_seconds", 4 * 60 * 60)),
            sleep_between_seconds=float(raw.get("sleep_between_seconds", 1.0)),
            exit_code_failure_threshold=int(raw.get("exit_code_failure_threshold", 5)),
            iteration_timeout_seconds=raw.get("iteration_timeout_seconds", 30 * 60),
            auto_commit=bool(raw.get("auto_commit", False)),
            git_branch=raw.get("git_branch"),
            env=dict(raw.get("env", {})),
        )


# ---------- helpers ----------

def die(msg: str, code: int = 2) -> None:
    print(f"ralph: {msg}", file=sys.stderr)
    sys.exit(code)


def log(msg: str) -> None:
    print(f"[ralph] {msg}", file=sys.stderr, flush=True)


def find_config(explicit: Optional[str]) -> Path:
    if explicit:
        p = Path(explicit)
        if not p.exists():
            die(f"config not found: {explicit}")
        return p
    for c in DEFAULT_CONFIG_PATHS:
        p = Path(c)
        if p.exists():
            return p
    die(
        "no config found. Looked at: "
        + ", ".join(DEFAULT_CONFIG_PATHS)
        + ". Run `python scripts/init.py` to bootstrap a workspace, or pass --config <path>."
    )
    raise SystemExit  # for type checker


def render_command(cmd: List[str], prompt_text: str, prompt_file: Path,
                   iteration: int, workspace: Path) -> List[str]:
    """Substitute placeholders into each argv element.

    Placeholders use brace syntax: {prompt}, {prompt_file}, {iter}, {workspace}.
    Unknown placeholders are left as-is — we never raise KeyError so users
    can pass literal braces in command args if they really need to.
    """
    subs = {
        "prompt": prompt_text,
        "prompt_file": str(prompt_file),
        "iter": str(iteration),
        "iteration": str(iteration),
        "workspace": str(workspace),
    }
    out = []
    for arg in cmd:
        rendered = arg
        for key, val in subs.items():
            rendered = rendered.replace("{" + key + "}", val)
        out.append(rendered)
    return out


def ensure_workspace(cfg: Config) -> None:
    Path(cfg.workspace).mkdir(parents=True, exist_ok=True)
    Path(cfg.log_dir).mkdir(parents=True, exist_ok=True)
    if not Path(cfg.prompt_file).exists():
        die(
            f"prompt file not found: {cfg.prompt_file}\n"
            f"Run `python scripts/init.py` first, "
            f"or point prompt_file at an existing file."
        )


def git_available() -> bool:
    try:
        r = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"],
                           capture_output=True, text=True)
        return r.returncode == 0 and r.stdout.strip() == "true"
    except FileNotFoundError:
        return False


def git_checkpoint(label: str) -> None:
    if not git_available():
        log("not a git repo — skipping checkpoint (consider `git init` for safer loops)")
        return
    subprocess.run(["git", "add", "-A"], check=False)
    msg = f"ralph: {label}"
    subprocess.run(["git", "commit", "-m", msg, "--allow-empty"],
                   check=False, capture_output=True)


def maybe_switch_branch(branch: Optional[str]) -> None:
    if not branch or not git_available():
        return
    r = subprocess.run(["git", "rev-parse", "--verify", branch],
                       capture_output=True, text=True)
    if r.returncode != 0:
        log(f"creating branch {branch}")
        subprocess.run(["git", "checkout", "-b", branch], check=False)
    else:
        cur = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                             capture_output=True, text=True).stdout.strip()
        if cur != branch:
            log(f"switching to branch {branch}")
            subprocess.run(["git", "checkout", branch], check=False)


# ---------- iteration ----------

@dataclass
class IterResult:
    iteration: int
    exit_code: int
    duration_seconds: float
    timed_out: bool
    stdout_path: Path
    stderr_path: Path


def run_one_iteration(cfg: Config, iteration: int) -> IterResult:
    prompt_path = Path(cfg.prompt_file)
    prompt_text = prompt_path.read_text()

    cmd = render_command(cfg.command, prompt_text, prompt_path, iteration,
                         Path(cfg.workspace))

    log_dir = Path(cfg.log_dir)
    out_path = log_dir / f"iter-{iteration:04d}.out"
    err_path = log_dir / f"iter-{iteration:04d}.err"
    meta_path = log_dir / f"iter-{iteration:04d}.meta.json"

    env = os.environ.copy()
    env.update({k: str(v) for k, v in cfg.env.items()})
    env["RALPH_ITERATION"] = str(iteration)
    env["RALPH_WORKSPACE"] = str(Path(cfg.workspace).resolve())

    stdin_data: Optional[bytes] = None
    if cfg.stdin_from_prompt:
        stdin_data = prompt_text.encode("utf-8")

    head = ' '.join(_shquote(a) for a in cmd[:6])
    log(f"iter {iteration}: {head}{'...' if len(cmd) > 6 else ''}")

    started = time.monotonic()
    timed_out = False
    with open(out_path, "wb") as fout, open(err_path, "wb") as ferr:
        try:
            # subprocess.run forbids passing both `stdin=` and `input=` —
            # when piping the prompt, use input= alone (it auto-pipes stdin).
            if stdin_data is not None:
                proc = subprocess.run(
                    cmd,
                    input=stdin_data,
                    stdout=fout,
                    stderr=ferr,
                    env=env,
                    timeout=cfg.iteration_timeout_seconds,
                )
            else:
                proc = subprocess.run(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=fout,
                    stderr=ferr,
                    env=env,
                    timeout=cfg.iteration_timeout_seconds,
                )
            exit_code = proc.returncode
        except subprocess.TimeoutExpired:
            timed_out = True
            exit_code = 124
            log(f"iter {iteration}: timed out after {cfg.iteration_timeout_seconds}s")
        except FileNotFoundError as e:
            die(f"command not found: {e.filename}. "
                f"Install the CLI or fix `command` in config.json.")
            raise

    duration = time.monotonic() - started
    meta_path.write_text(json.dumps({
        "iteration": iteration,
        "command": cmd,
        "exit_code": exit_code,
        "duration_seconds": round(duration, 3),
        "timed_out": timed_out,
        "stdout": str(out_path),
        "stderr": str(err_path),
    }, indent=2))

    return IterResult(
        iteration=iteration,
        exit_code=exit_code,
        duration_seconds=duration,
        timed_out=timed_out,
        stdout_path=out_path,
        stderr_path=err_path,
    )


def _shquote(s: str) -> str:
    if not s or any(c in s for c in ' \t\n"\'\\$`'):
        return "'" + s.replace("'", "'\\''") + "'"
    return s


# ---------- stop conditions ----------

def check_stop_conditions(cfg: Config, iteration: int, start_time: float,
                          consecutive_failures: int) -> Optional[str]:
    ws = Path(cfg.workspace)
    if (ws / DONE_FILE).exists():
        return f"workspace/{DONE_FILE} present — agent marked goal complete"
    if (ws / STOP_FILE).exists():
        return f"workspace/{STOP_FILE} present — user-requested stop"
    if iteration > cfg.max_iterations:
        return f"max_iterations ({cfg.max_iterations}) reached"
    if (time.monotonic() - start_time) > cfg.max_wall_seconds:
        return f"max_wall_seconds ({cfg.max_wall_seconds}s) reached"
    if consecutive_failures >= cfg.exit_code_failure_threshold:
        return (f"{consecutive_failures} consecutive non-zero exits — bailing out "
                f"(threshold={cfg.exit_code_failure_threshold}). "
                f"Inspect {cfg.log_dir}/iter-*.err.")
    return None


def wait_while_paused(cfg: Config) -> None:
    pause = Path(cfg.workspace) / PAUSE_FILE
    if not pause.exists():
        return
    log(f"PAUSED ({pause}) — remove the file to resume. Ctrl-C to exit.")
    while pause.exists():
        time.sleep(2)


# ---------- main loop ----------

def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(
        prog="ralph",
        description="Run an AI coding CLI in a tight, file-state-driven loop.",
    )
    p.add_argument("-c", "--config",
                   help="config JSON path (defaults: "
                        + ", ".join(DEFAULT_CONFIG_PATHS) + ")")
    p.add_argument("--max-iterations", type=int, help="override max_iterations")
    p.add_argument("--max-wall-seconds", type=int, help="override max_wall_seconds")
    p.add_argument("--dry-run", action="store_true",
                   help="print the rendered command and exit (no execution)")
    p.add_argument("--no-checkpoint", action="store_true",
                   help="skip the initial git checkpoint commit")
    args = p.parse_args(argv)

    cfg_path = find_config(args.config)
    cfg = Config.load(cfg_path)

    if args.max_iterations is not None:
        cfg.max_iterations = args.max_iterations
    if args.max_wall_seconds is not None:
        cfg.max_wall_seconds = args.max_wall_seconds

    ensure_workspace(cfg)
    maybe_switch_branch(cfg.git_branch)

    if args.dry_run:
        cmd = render_command(cfg.command, "<PROMPT_CONTENTS>",
                             Path(cfg.prompt_file), 1, Path(cfg.workspace))
        print(" ".join(_shquote(a) for a in cmd))
        if cfg.stdin_from_prompt:
            print(f"# stdin: contents of {cfg.prompt_file}")
        return 0

    if not args.no_checkpoint:
        git_checkpoint("checkpoint before ralph loop start")

    log(f"config={cfg_path}  prompt={cfg.prompt_file}  workspace={cfg.workspace}")
    log(f"max_iterations={cfg.max_iterations}  "
        f"max_wall_seconds={cfg.max_wall_seconds}")
    log(f"command template: {' '.join(_shquote(a) for a in cfg.command)}")
    log(f"stdin_from_prompt={cfg.stdin_from_prompt}  auto_commit={cfg.auto_commit}")

    interrupted = {"yes": False}

    def _sigint(_sig, _frame):
        if interrupted["yes"]:
            log("second SIGINT — exiting now")
            sys.exit(130)
        interrupted["yes"] = True
        log("SIGINT received — finishing current iteration then stopping. "
            "Press Ctrl-C again to abort immediately.")

    signal.signal(signal.SIGINT, _sigint)

    start = time.monotonic()
    consecutive_failures = 0
    iteration = 0
    last_reason: Optional[str] = None

    while True:
        iteration += 1

        reason = check_stop_conditions(cfg, iteration, start, consecutive_failures)
        if reason or interrupted["yes"]:
            last_reason = reason or "interrupted by user"
            break

        wait_while_paused(cfg)

        result = run_one_iteration(cfg, iteration)
        log(f"iter {iteration}: exit={result.exit_code}  "
            f"dur={result.duration_seconds:.1f}s  "
            f"out={result.stdout_path}")

        if result.exit_code != 0 and not result.timed_out:
            consecutive_failures += 1
        else:
            consecutive_failures = 0

        if cfg.auto_commit:
            git_checkpoint(f"iter {iteration} (exit={result.exit_code})")

        time.sleep(cfg.sleep_between_seconds)

    log(f"loop ended after {iteration - 1} iteration(s): {last_reason}")
    if interrupted["yes"]:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
