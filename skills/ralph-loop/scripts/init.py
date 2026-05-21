#!/usr/bin/env python3
"""
init.py — bootstrap a Ralph-loop workspace.

Creates `.ralph/` with:
    - config.json     (CLI command, limits — pick adapter via --adapter)
    - PROMPT.md       (the master prompt copied from assets/templates)
    - plan.md         (the agent's living plan — starts as a skeleton)
    - gotchas.md      (append-only failure log)
    - specs/          (your specs go here; one .md per feature)
    - tickets/        (one .md per work item; agent picks the next)
    - library/        (reference patterns the agent has learned)
    - log/            (per-iteration .out/.err/.meta.json files)

Idempotent: existing files are preserved unless --force is passed.
stdlib only, Python >= 3.8.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional


# Each adapter: (command argv, stdin_from_prompt). Placeholders supported:
#   {prompt}        — full prompt text inlined as a single arg
#   {prompt_file}   — path to .ralph/PROMPT.md
#   {iter}          — current 1-indexed iteration number
#   {workspace}     — path to .ralph/
ADAPTERS: Dict[str, Dict] = {
    "copilot": {
        "command": [
            sys.executable,
            "-c",
            (
                "import sys; "
                "sys.stderr.write('Edit .ralph/config.json command to your "
                "Copilot coding-agent entrypoint or wrapper.\\n'); "
                "sys.exit(1)"
            ),
        ],
        "stdin_from_prompt": False,
        "note": "Copilot coding-agent placeholder. Configure your local "
                "Copilot agent/wrapper command; this is intentionally not "
                "the shell-suggestion helper.",
    },
    "claude": {
        "command": ["claude", "-p", "{prompt}"],
        "stdin_from_prompt": False,
        "note": "Claude-compatible one-shot command. Adjust for your installed CLI.",
    },
    "codex": {
        "command": ["codex", "exec", "{prompt}"],
        "stdin_from_prompt": False,
        "note": "Codex-compatible one-shot command. Adjust for your installed CLI.",
    },
    "opencode": {
        "command": ["opencode", "run", "{prompt}"],
        "stdin_from_prompt": False,
        "note": "OpenCode CLI. `opencode run '<prompt>'` for one-shot execution.",
    },
    "gemini": {
        "command": ["gemini", "-p", "{prompt}"],
        "stdin_from_prompt": False,
        "note": "Gemini CLI. `gemini -p '<prompt>'`.",
    },
    "aider": {
        "command": ["aider", "--message-file", "{prompt_file}", "--yes-always"],
        "stdin_from_prompt": False,
        "note": "Aider. Reads prompt from a file; --yes-always auto-accepts edits.",
    },
    "amp": {
        "command": ["amp"],
        "stdin_from_prompt": True,
        "note": "Sourcegraph Amp via stdin (the original Ralph). "
                "`cat PROMPT.md | amp`.",
    },
    "generic": {
        "command": [
            sys.executable,
            "-c",
            (
                "import sys; "
                "sys.stderr.write('Edit .ralph/config.json command to point "
                "at your AI coding CLI.\\n'); "
                "sys.exit(1)"
            ),
        ],
        "stdin_from_prompt": False,
        "note": "Placeholder — edit config.json `command` to point at your CLI.",
    },
}


def script_root() -> Path:
    return Path(__file__).resolve().parent


def asset(name: str) -> Path:
    return script_root().parent / "assets" / "templates" / name


def copy_template(src_name: str, dst: Path, force: bool) -> bool:
    src = asset(src_name)
    if not src.exists():
        print(f"init: template missing: {src}", file=sys.stderr)
        return False
    if dst.exists() and not force:
        print(f"  keep    {dst} (already exists)")
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    print(f"  write   {dst}")
    return True


def write_config(workspace: Path, adapter_key: str, force: bool,
                 max_iterations: int) -> None:
    cfg_path = workspace / "config.json"
    if cfg_path.exists() and not force:
        print(f"  keep    {cfg_path} (already exists)")
        return
    adapter = ADAPTERS[adapter_key]
    config = {
        "_comment": (
            f"Ralph loop config. Adapter: {adapter_key}. "
            f"Edit `command` to point at any CLI. Placeholders: "
            f"{{prompt}}, {{prompt_file}}, {{iter}}, {{workspace}}."
        ),
        "command": adapter["command"],
        "prompt_file": str(workspace / "PROMPT.md"),
        "workspace": str(workspace),
        "log_dir": str(workspace / "log"),
        "stdin_from_prompt": adapter["stdin_from_prompt"],
        "max_iterations": max_iterations,
        "max_wall_seconds": 4 * 60 * 60,
        "sleep_between_seconds": 1.0,
        "exit_code_failure_threshold": 5,
        "iteration_timeout_seconds": 30 * 60,
        "auto_commit": False,
        "initial_checkpoint": False,
        "git_branch": None,
        "env": {},
        "subagents": {
            "count": 0,
            "workspace_root": str(workspace / "subagents"),
            "git_branch_prefix": None,
        },
    }
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    cfg_path.write_text(json.dumps(config, indent=2) + "\n")
    print(f"  write   {cfg_path}  (adapter: {adapter_key})")


def touch_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    keep = path / ".gitkeep"
    if not keep.exists():
        keep.write_text("")
    print(f"  mkdir   {path}/")


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(
        prog="init",
        description="Bootstrap a .ralph/ workspace for the Ralph loop.",
    )
    p.add_argument("--workspace", default=".ralph",
                   help="workspace directory (default: .ralph)")
    p.add_argument("--adapter", default="generic",
                   choices=sorted(ADAPTERS.keys()),
                   help="which AI CLI to invoke each iteration (default: generic)")
    p.add_argument("--max-iterations", type=int, default=20,
                   help="default max_iterations in config (default: 20 — "
                        "biased low to minimize LLM-call burn; raise if "
                        "tickets are very small)")
    p.add_argument("--force", action="store_true",
                   help="overwrite existing files (DANGEROUS — back up first)")
    args = p.parse_args(argv)

    ws = Path(args.workspace)
    print(f"init: bootstrapping {ws}/  (adapter: {args.adapter})")
    ws.mkdir(parents=True, exist_ok=True)

    write_config(ws, args.adapter, args.force, args.max_iterations)

    copy_template("PROMPT.md", ws / "PROMPT.md", args.force)
    copy_template("plan.md", ws / "plan.md", args.force)
    copy_template("gotchas.md", ws / "gotchas.md", args.force)
    copy_template("spec.md", ws / "specs" / "00-example.md", args.force)

    touch_dir(ws / "specs")
    touch_dir(ws / "tickets")
    touch_dir(ws / "library")
    touch_dir(ws / "log")

    adapter = ADAPTERS[args.adapter]
    print()
    print("init: done.")
    print()
    print(f"  Adapter:  {args.adapter} — {adapter['note']}")
    print(f"  Prompt:   {ws / 'PROMPT.md'}")
    print(f"  Config:   {ws / 'config.json'}")
    print()
    driver = script_root() / "ralph.py"
    print("Next steps:")
    print(f"  1. Write your spec(s) under {ws / 'specs'}/")
    print(f"  2. Edit {ws / 'PROMPT.md'} so the agent knows the goal "
          f"(or leave it generic and let the agent read specs/).")
    print(f"  3. Verify the CLI works:  python {driver} --config {ws / 'config.json'} --dry-run")
    print(f"  4. Start the loop:        python {driver} --config {ws / 'config.json'}")
    print()
    print("Stop conditions:")
    print(f"  - agent writes  {ws / 'DONE'}      → exit clean")
    print(f"  - you write     {ws / 'STOP'}      → exit at next iteration")
    print(f"  - you write     {ws / 'PAUSE'}     → pause; remove to resume")
    print(f"  - Ctrl-C once   → finish current iteration then exit")
    print(f"  - Ctrl-C twice  → abort immediately")
    return 0


if __name__ == "__main__":
    sys.exit(main())
