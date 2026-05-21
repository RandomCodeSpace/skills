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
    - single-worker by default; subagents are supervised child Ralph workers

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
from typing import Any, Dict, List, Optional


# ---------- config ----------

DEFAULT_CONFIG_PATHS = [".ralph/config.json", "ralph.config.json"]
DEFAULT_PROMPT_PATH = ".ralph/PROMPT.md"
DEFAULT_LOG_DIR = ".ralph/log"
DEFAULT_WORKSPACE = ".ralph"
DEFAULT_ITERATION_TIMEOUT_SECONDS = 30 * 60

DONE_FILE = "DONE"     # agent writes this when the goal is met
STOP_FILE = "STOP"     # user writes this to halt at next iteration boundary
PAUSE_FILE = "PAUSE"   # user writes this to pause without exiting

EXIT_DONE = 0
EXIT_STOP = 20
EXIT_MAX_ITERATIONS = 21
EXIT_WALL_CLOCK = 22
EXIT_FAILURE_THRESHOLD = 23
EXIT_SUBAGENT_FAILURE = 24
EXIT_INTERRUPTED = 130


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
    iteration_timeout_seconds: float = DEFAULT_ITERATION_TIMEOUT_SECONDS
    auto_commit: bool = False
    initial_checkpoint: bool = False
    git_branch: Optional[str] = None
    env: dict = field(default_factory=dict)
    subagents: dict = field(default_factory=dict)

    @staticmethod
    def load(path: Path) -> "Config":
        raw = json.loads(path.read_text())
        if "command" not in raw or not isinstance(raw["command"], list):
            die(f"config {path}: 'command' must be a list of args, "
                f"e.g. [\"claude\", \"-p\", \"{{prompt}}\"]")
        if not raw["command"]:
            die(f"config {path}: 'command' is empty")
        timeout = raw.get(
            "iteration_timeout_seconds",
            DEFAULT_ITERATION_TIMEOUT_SECONDS,
        )
        if timeout is None:
            timeout = DEFAULT_ITERATION_TIMEOUT_SECONDS
        timeout = float(timeout)
        if timeout <= 0:
            die(f"config {path}: iteration_timeout_seconds must be > 0")

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
            iteration_timeout_seconds=timeout,
            auto_commit=bool(raw.get("auto_commit", False)),
            initial_checkpoint=bool(raw.get("initial_checkpoint", False)),
            git_branch=raw.get("git_branch"),
            env=dict(raw.get("env", {})),
            subagents=dict(raw.get("subagents", {})),
        )


@dataclass
class StopDecision:
    reason: str
    exit_code: int
    kind: str


# ---------- helpers ----------

def die(msg: str, code: int = 2) -> None:
    print(f"ralph: {msg}", file=sys.stderr)
    sys.exit(code)


def log(msg: str) -> None:
    print(f"[ralph] {msg}", file=sys.stderr, flush=True)


def event(cfg: Config, name: str, **fields: Any) -> None:
    log_dir = Path(cfg.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    record = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "event": name,
        **fields,
    }
    with (log_dir / "events.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")


def _workspace_gitignore_target_and_pattern(workspace: str) -> tuple:
    workspace_path = Path(workspace)
    if workspace_path.is_absolute():
        try:
            rel = workspace_path.resolve().relative_to(Path.cwd().resolve())
            gitignore = Path(".gitignore")
            pattern = rel.as_posix()
        except ValueError:
            gitignore = workspace_path.parent / ".gitignore"
            pattern = workspace_path.name
    else:
        gitignore = Path(".gitignore")
        pattern = workspace_path.as_posix()
    if not pattern or pattern == ".":
        pattern = workspace_path.name
    if not pattern.endswith("/"):
        pattern += "/"
    return gitignore, pattern


def ensure_gitignore(workspace: str) -> bool:
    gitignore, pattern = _workspace_gitignore_target_and_pattern(workspace)
    existing = []
    if gitignore.exists():
        existing = gitignore.read_text(encoding="utf-8").splitlines()
    normalized = {line.strip() for line in existing if line.strip()}
    if pattern in normalized or pattern.rstrip("/") in normalized:
        return False

    prefix = "\n" if existing and existing[-1].strip() else ""
    gitignore.parent.mkdir(parents=True, exist_ok=True)
    with gitignore.open("a", encoding="utf-8") as f:
        f.write(f"{prefix}{pattern}\n")
    return True


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
        checkout = subprocess.run(["git", "checkout", "-b", branch],
                                  capture_output=True, text=True)
    else:
        cur = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                             capture_output=True, text=True).stdout.strip()
        if cur != branch:
            log(f"switching to branch {branch}")
            checkout = subprocess.run(["git", "checkout", branch],
                                      capture_output=True, text=True)
        else:
            checkout = subprocess.CompletedProcess([], 0, "", "")
    if checkout.returncode != 0:
        die(f"could not switch to git_branch {branch}: "
            f"{checkout.stderr.strip() or checkout.stdout.strip()}")
    cur = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                         capture_output=True, text=True).stdout.strip()
    if cur != branch:
        die(f"expected git_branch {branch}, but current branch is {cur}")


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
    log_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.update({k: str(v) for k, v in cfg.env.items()})
    env["RALPH_ITERATION"] = str(iteration)
    env["RALPH_WORKSPACE"] = str(Path(cfg.workspace).resolve())

    stdin_data: Optional[bytes] = None
    if cfg.stdin_from_prompt:
        stdin_data = prompt_text.encode("utf-8")

    head = ' '.join(_shquote(a) for a in cmd[:6])
    log(f"iter {iteration}: {head}{'...' if len(cmd) > 6 else ''}")
    event(cfg, "iteration_start", iteration=iteration, command=cmd,
          stdout=str(out_path), stderr=str(err_path))

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
            event(cfg, "iteration_timeout", iteration=iteration,
                  timeout_seconds=cfg.iteration_timeout_seconds)
        except FileNotFoundError as e:
            event(cfg, "command_not_found", iteration=iteration,
                  executable=e.filename)
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
    event(cfg, "iteration_end", iteration=iteration, exit_code=exit_code,
          duration_seconds=round(duration, 3), timed_out=timed_out,
          meta=str(meta_path))

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
                          consecutive_failures: int) -> Optional[StopDecision]:
    ws = Path(cfg.workspace)
    if (ws / DONE_FILE).exists():
        return StopDecision(
            f"workspace/{DONE_FILE} present — agent marked goal complete",
            EXIT_DONE,
            "done",
        )
    if (ws / STOP_FILE).exists():
        return StopDecision(
            f"workspace/{STOP_FILE} present — user-requested stop",
            EXIT_STOP,
            "stop",
        )
    if iteration > cfg.max_iterations:
        return StopDecision(
            f"max_iterations ({cfg.max_iterations}) reached",
            EXIT_MAX_ITERATIONS,
            "max_iterations",
        )
    if (time.monotonic() - start_time) > cfg.max_wall_seconds:
        return StopDecision(
            f"max_wall_seconds ({cfg.max_wall_seconds}s) reached",
            EXIT_WALL_CLOCK,
            "max_wall_seconds",
        )
    if consecutive_failures >= cfg.exit_code_failure_threshold:
        return StopDecision(
            f"{consecutive_failures} consecutive non-zero exits — bailing out "
            f"(threshold={cfg.exit_code_failure_threshold}). "
            f"Inspect {cfg.log_dir}/iter-*.err.",
            EXIT_FAILURE_THRESHOLD,
            "failure_threshold",
        )
    return None


def wait_while_paused(cfg: Config, iteration: int, start_time: float,
                      consecutive_failures: int,
                      interrupted: dict) -> Optional[StopDecision]:
    pause = Path(cfg.workspace) / PAUSE_FILE
    if not pause.exists():
        return None
    log(f"PAUSED ({pause}) — remove the file to resume. Ctrl-C to exit.")
    event(cfg, "pause_enter", iteration=iteration, pause_file=str(pause))
    while pause.exists():
        if interrupted["yes"]:
            decision = StopDecision(
                "interrupted by user",
                EXIT_INTERRUPTED,
                "interrupted",
            )
            event(cfg, "pause_stop", iteration=iteration,
                  reason=decision.reason, exit_code=decision.exit_code)
            return decision
        decision = check_stop_conditions(
            cfg, iteration, start_time, consecutive_failures
        )
        if decision:
            event(cfg, "pause_stop", iteration=iteration,
                  reason=decision.reason, exit_code=decision.exit_code)
            return decision
        time.sleep(2)
    event(cfg, "pause_exit", iteration=iteration)
    return None


# ---------- subagents ----------

def _copy_if_exists(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")


def _share_or_copy_specs(parent_specs: Path, worker_specs: Path) -> None:
    if worker_specs.exists():
        return
    if not parent_specs.exists():
        worker_specs.mkdir(parents=True, exist_ok=True)
        return
    worker_specs.parent.mkdir(parents=True, exist_ok=True)
    try:
        worker_specs.symlink_to(parent_specs.resolve(), target_is_directory=True)
    except OSError:
        worker_specs.mkdir(parents=True, exist_ok=True)
        for child in parent_specs.iterdir():
            if child.is_file():
                _copy_if_exists(child, worker_specs / child.name)


def _subagent_prompt(parent_prompt: Path, index: int, count: int) -> str:
    base = parent_prompt.read_text(encoding="utf-8")
    note = f"""

## Subagent assignment

You are Ralph subagent {index} of {count}. Work only on the tickets or
acceptance criteria that are safe for this worker to complete independently.
Prefer disjoint files. If you cannot make progress without another subagent's
work, write the blocker into `tickets/` or `gotchas.md` and exit cleanly.
Do not write the parent `.ralph/DONE`; only mark this worker complete when
your assigned work is genuinely done and verified.
"""
    return base.rstrip() + "\n" + note.lstrip()


def _config_to_dict(cfg: Config) -> Dict[str, Any]:
    return {
        "command": cfg.command,
        "prompt_file": cfg.prompt_file,
        "workspace": cfg.workspace,
        "log_dir": cfg.log_dir,
        "stdin_from_prompt": cfg.stdin_from_prompt,
        "max_iterations": cfg.max_iterations,
        "max_wall_seconds": cfg.max_wall_seconds,
        "sleep_between_seconds": cfg.sleep_between_seconds,
        "exit_code_failure_threshold": cfg.exit_code_failure_threshold,
        "iteration_timeout_seconds": cfg.iteration_timeout_seconds,
        "auto_commit": cfg.auto_commit,
        "initial_checkpoint": False,
        "git_branch": cfg.git_branch,
        "env": cfg.env,
        "subagents": {"count": 0},
    }


def prepare_subagents(cfg: Config, count: int, cfg_path: Path) -> List[Path]:
    if count <= 0:
        return []
    parent_ws = Path(cfg.workspace)
    parent_prompt = Path(cfg.prompt_file)
    subagent_root = Path(cfg.subagents.get(
        "workspace_root",
        str(parent_ws / "subagents"),
    ))
    branch_prefix = cfg.subagents.get("git_branch_prefix")
    parent_specs = parent_ws / "specs"
    worker_configs: List[Path] = []

    for index in range(1, count + 1):
        worker_ws = subagent_root / f"agent-{index}"
        worker_ws.mkdir(parents=True, exist_ok=True)
        for child in ("tickets", "library", "log"):
            (worker_ws / child).mkdir(parents=True, exist_ok=True)
        _share_or_copy_specs(parent_specs, worker_ws / "specs")
        _copy_if_exists(parent_ws / "plan.md", worker_ws / "plan.md")
        _copy_if_exists(parent_ws / "gotchas.md", worker_ws / "gotchas.md")
        worker_prompt = worker_ws / "PROMPT.md"
        worker_prompt.write_text(
            _subagent_prompt(parent_prompt, index, count),
            encoding="utf-8",
        )

        worker = _config_to_dict(cfg)
        worker["prompt_file"] = str(worker_prompt)
        worker["workspace"] = str(worker_ws)
        worker["log_dir"] = str(worker_ws / "log")
        if branch_prefix:
            worker["git_branch"] = f"{branch_prefix}-{index}"
        else:
            worker["git_branch"] = None
        worker["subagents"] = {"count": 0, "parent_config": str(cfg_path)}

        worker_config = worker_ws / "config.json"
        worker_config.write_text(json.dumps(worker, indent=2) + "\n",
                                 encoding="utf-8")
        worker_configs.append(worker_config)
    return worker_configs


def run_subagents(cfg: Config, count: int, cfg_path: Path) -> int:
    worker_configs = prepare_subagents(cfg, count, cfg_path)
    event(cfg, "subagents_prepared", count=count,
          configs=[str(p) for p in worker_configs])
    script = Path(__file__).resolve()
    procs = []

    for index, worker_config in enumerate(worker_configs, start=1):
        out = Path(cfg.log_dir) / f"subagent-{index}.out"
        err = Path(cfg.log_dir) / f"subagent-{index}.err"
        out.parent.mkdir(parents=True, exist_ok=True)
        fout = out.open("wb")
        ferr = err.open("wb")
        cmd = [sys.executable, str(script), "--config", str(worker_config)]
        proc = subprocess.Popen(cmd, stdout=fout, stderr=ferr)
        procs.append({
            "index": index,
            "config": worker_config,
            "proc": proc,
            "stdout": out,
            "stderr": err,
            "fout": fout,
            "ferr": ferr,
        })
        event(cfg, "subagent_started", index=index, pid=proc.pid,
              config=str(worker_config), stdout=str(out), stderr=str(err))

    exit_codes: Dict[int, int] = {}
    supervisor_start = time.monotonic()
    try:
        while len(exit_codes) < len(procs):
            for item in procs:
                index = item["index"]
                proc = item["proc"]
                if index in exit_codes:
                    continue
                code = proc.poll()
                if code is not None:
                    exit_codes[index] = code
                    item["fout"].close()
                    item["ferr"].close()
                    event(cfg, "subagent_finished", index=index,
                          exit_code=code)
            if len(exit_codes) < len(procs):
                decision = check_stop_conditions(cfg, 1, supervisor_start, 0)
                if decision and decision.kind in {
                    "stop", "done", "max_wall_seconds"
                }:
                    event(cfg, "subagent_supervisor_stop",
                          reason=decision.reason, exit_code=decision.exit_code)
                    for item in procs:
                        if item["index"] not in exit_codes:
                            item["proc"].terminate()
                    return decision.exit_code
                time.sleep(1)
    except KeyboardInterrupt:
        event(cfg, "subagent_supervisor_interrupted")
        for item in procs:
            if item["index"] not in exit_codes:
                item["proc"].terminate()
        return EXIT_INTERRUPTED
    finally:
        for item in procs:
            if not item["fout"].closed:
                item["fout"].close()
            if not item["ferr"].closed:
                item["ferr"].close()

    summary = {
        "count": count,
        "exit_codes": exit_codes,
        "configs": [str(p) for p in worker_configs],
    }
    summary_path = Path(cfg.log_dir) / "subagents-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n",
                            encoding="utf-8")
    event(cfg, "subagents_complete", summary=str(summary_path),
          exit_codes=exit_codes)
    return EXIT_DONE if all(code == 0 for code in exit_codes.values()) else EXIT_SUBAGENT_FAILURE


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
    p.add_argument("--checkpoint", action="store_true",
                   help="create an explicit git checkpoint before the loop")
    p.add_argument("--no-checkpoint", action="store_true",
                   help="deprecated no-op; checkpoints are opt-in by default")
    p.add_argument("--subagents", "--spawn-subagents", type=int,
                   help="spawn N supervised Ralph worker loops and wait for them")
    args = p.parse_args(argv)

    cfg_path = find_config(args.config)
    cfg = Config.load(cfg_path)

    if args.max_iterations is not None:
        cfg.max_iterations = args.max_iterations
    if args.max_wall_seconds is not None:
        cfg.max_wall_seconds = args.max_wall_seconds

    ensure_workspace(cfg)
    maybe_switch_branch(cfg.git_branch)
    subagent_count = args.subagents
    if subagent_count is None:
        subagent_count = int(cfg.subagents.get("count", 0) or 0)

    if args.dry_run:
        cmd = render_command(cfg.command, "<PROMPT_CONTENTS>",
                             Path(cfg.prompt_file), 1, Path(cfg.workspace))
        print(" ".join(_shquote(a) for a in cmd))
        if cfg.stdin_from_prompt:
            print(f"# stdin: contents of {cfg.prompt_file}")
        if subagent_count:
            print(f"# subagents: would prepare and spawn {subagent_count} worker(s)")
        return 0

    gitignore_changed = ensure_gitignore(cfg.workspace)
    event(cfg, "loop_invoked", config=str(cfg_path), workspace=cfg.workspace,
          gitignore_changed=gitignore_changed)

    if subagent_count:
        event(cfg, "subagent_supervisor_start", count=subagent_count)
        return run_subagents(cfg, subagent_count, cfg_path)

    if args.checkpoint or cfg.initial_checkpoint:
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
    last_decision: Optional[StopDecision] = None

    while True:
        iteration += 1

        decision = check_stop_conditions(cfg, iteration, start, consecutive_failures)
        if decision or interrupted["yes"]:
            last_decision = decision or StopDecision(
                "interrupted by user",
                EXIT_INTERRUPTED,
                "interrupted",
            )
            break

        pause_decision = wait_while_paused(
            cfg, iteration, start, consecutive_failures, interrupted
        )
        if pause_decision:
            last_decision = pause_decision
            break

        result = run_one_iteration(cfg, iteration)
        log(f"iter {iteration}: exit={result.exit_code}  "
            f"dur={result.duration_seconds:.1f}s  "
            f"out={result.stdout_path}")

        if result.exit_code != 0:
            consecutive_failures += 1
        else:
            consecutive_failures = 0
        event(cfg, "failure_counter", iteration=iteration,
              consecutive_failures=consecutive_failures)

        if cfg.auto_commit:
            git_checkpoint(f"iter {iteration} (exit={result.exit_code})")

        event(cfg, "sleep", iteration=iteration,
              seconds=cfg.sleep_between_seconds)
        time.sleep(cfg.sleep_between_seconds)

    reason = last_decision.reason if last_decision else "unknown"
    exit_code = last_decision.exit_code if last_decision else EXIT_STOP
    log(f"loop ended after {iteration - 1} iteration(s): {reason}")
    event(cfg, "loop_end", iterations=iteration - 1, reason=reason,
          exit_code=exit_code,
          stop_kind=last_decision.kind if last_decision else "unknown")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
