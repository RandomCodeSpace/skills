---
name: ralph-loop
description: Use when the user wants a generic Ralph loop for an AI coding agent — primarily GitHub Copilot coding agent, and also Codex, Claude, OpenCode, Gemini, Aider, or Amp. Trigger phrases include "ralph loop", "ralph wiggum loop", "run copilot in a loop", "copilot coding agent loop", "run codex in a loop", "autonomous agent loop", "agentic while loop", "let the agent build this overnight", "spec-driven autonomous build", or any request for continuous, hands-off iteration until a goal or stop file appears. Also use for references to Geoffrey Huntley's Ralph technique or the `while :; do … ; done` pattern with an AI CLI. Produces a `.ralph/` workspace (PROMPT.md, plan.md, gotchas.md, specs/, tickets/) plus a stdlib-only Python driver (`ralph.py`) that runs the chosen command each iteration, supervises opt-in subagent workers, logs every step, and exits distinctly on DONE/STOP/max-iterations/wall-clock/failure thresholds. Standalone — no other skills, no internet.
---

# Ralph loop

This skill sets up and runs a **Ralph loop**: a tight, file-state-driven
iteration where the AI agent runs once per turn against a fixed
`PROMPT.md`, updates its own notes on disk, and is then killed and
restarted with fresh context. The filesystem is the agent's only memory.

> Coined by Geoffrey Huntley as the "Ralph Wiggum" technique — `while :;
> do cat PROMPT.md | <agent>; done`. This skill is that idea, hardened:
> host-agnostic adapter for any CLI, proper stop conditions, structured
> state files, gotchas log, ticket queue, safety rails, and optional
> supervised subagent workers.

The skill is **standalone**. It does not call other skills, does not
fetch from the internet, and depends only on Python 3.8+, `git` (optional),
and whichever AI CLI the user picks.

---

## When to use this skill

Use it when the user wants:

- A long-running, hands-off coding session that the AI drives itself.
- Spec-driven autonomous build: "here are the specs, keep going until
  they're satisfied."
- Overnight or background iteration against a well-defined goal.
- A way to use Copilot coding agent, Codex, Claude, OpenCode, Aider,
  Amp, Gemini, or any one-shot coding command in a loop that doesn't
  blow the context window.
- A simple, auditable loop with proper logs (not a custom orchestrator
  that hides what's happening).
- Opt-in parallel "subagents" as child Ralph workers for disjoint ticket
  queues or file partitions.

Platform keyword coverage matters. Keep the skill generic, with Copilot
as the primary named target:

- **Copilot first:** `copilot`, `copilot coding agent`,
  `copilot agent`, `copilot loop`, `copilot ralph`.
- **Other supported agents:** `codex`, `codex exec`, `codex loop`,
  `claude`, `claude code`, `opencode`, `gemini`, `aider`, `amp`.
- **Upstream Ralph references:** `/ralph-loop`, `Ralph Wiggum plugin`,
  `Stop hook`, `completion promise`. Map these to this generic driver;
  do not turn the skill into a Claude-specific plugin.

**Don't use it** for:

- One-shot tasks ("fix this bug right now"). Just run the CLI once.
- Interactive pairing where the user reviews each change. Ralph is
  hands-off by design.
- Anything that requires the agent to call out to the network beyond
  what the LLM already does.

---

## Mental model

```
┌─────────────────────────────────────────────────────────────┐
│  scripts/ralph.py — the driver (Python, stdlib only)        │
│                                                             │
│   while not stop_condition:                                 │
│     iter += 1                                               │
│     run(  ai_cli  with  .ralph/PROMPT.md  )                 │
│     log to .ralph/log/iter-NNNN.{out,err,meta.json}         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
            │ each iteration starts FRESH
            ▼
┌─────────────────────────────────────────────────────────────┐
│  the AI agent (one shot per iteration)                      │
│                                                             │
│   reads:    .ralph/specs/        (source of truth)          │
│             .ralph/plan.md       (where we are)             │
│             .ralph/gotchas.md    (what already failed)      │
│             .ralph/tickets/      (next work units)          │
│             the codebase                                    │
│                                                             │
│   does:     ONE valuable thing                              │
│                                                             │
│   writes:   updated plan.md, ticket files, code,            │
│             appended gotchas.md, .ralph/DONE when done      │
│                                                             │
│   exits.    Loop restarts with fresh context.               │
└─────────────────────────────────────────────────────────────┘
```

Two ideas do most of the work:

1. **Fresh context every iteration** — the agent can't drift through a
   long conversation because there is no long conversation. Every
   iteration is iteration 1 from the agent's perspective.
2. **The filesystem is the only memory** — `plan.md`, `gotchas.md`,
   `tickets/`, `library/` are how knowledge persists. Updating them
   *is* the loop's learning mechanism.

---

## Step 1 — confirm scope before installing anything

Before scaffolding, ask the user (only what you don't know):

1. **What goal should the loop pursue?** Get a sentence. If they don't
   have a clear answer, stop and use whatever planning facility your host
   has to clarify — Ralph eats vague goals alive.
2. **Which AI command drives the loop?** Default: `generic`. For Copilot,
   use `copilot` and then point `.ralph/config.json` at the local Copilot
   coding-agent entrypoint or wrapper. Other built-in adapters:
   `codex`, `claude`, `opencode`, `gemini`, `aider`, `amp`. See
   `references/cli-adapters.md`.
3. **Where should `.ralph/` live?** Default: the current repo root.
   Confirm if the project is a monorepo or a non-repo directory.
4. **Iteration budget?** Default: 20 iterations, 4-hour wall-clock cap,
   30-min per-iteration timeout. **Defaults are tuned to minimize LLM
   message consumption** — see "Minimizing LLM-call consumption" below.
   Raise only after a short run looks healthy.
5. **Is this a git repo?** Strongly recommend `git init` first if not.
   Commits and checkpoints are operator-controlled and opt-in.

---

## Step 2 — bootstrap the workspace

From the target project's root:

```bash
# Run the installed Ralph skill script from wherever your host installs it:
python /path/to/ralph-loop/scripts/init.py --adapter generic

# For Copilot-centered usage, start with the Copilot adapter and then edit
# .ralph/config.json to point at your Copilot coding-agent entrypoint/wrapper.
python /path/to/ralph-loop/scripts/init.py --adapter copilot
# adapters: copilot | generic | codex | claude | opencode | gemini | aider | amp
```

This creates:

```
.ralph/
├── config.json          # CLI command + limits
├── PROMPT.md            # the master prompt (copy of the canonical template)
├── plan.md              # the agent's living plan (skeleton)
├── gotchas.md           # append-only failure log (empty header)
├── specs/
│   └── 00-example.md    # example spec to replace with the real one
├── tickets/             # one .md per work item; agent maintains it
├── library/             # patterns the agent has proven out
└── log/                 # iter-NNNN.out / .err / .meta.json
```

The script is idempotent — rerunning it leaves your existing files alone
unless you pass `--force`.

---

## Step 3 — write the spec(s)

This is the single most important step. **A good spec produces a good
loop; a sloppy spec produces an expensive nothing.**

Replace `.ralph/specs/00-example.md` with a real spec following the
template. If the work decomposes into multiple features, drop one file
per feature: `01-auth.md`, `02-billing.md`, …

A good spec has:

- A one-sentence **why**
- Concrete **behavior** described from the caller's perspective
- A **checked list of acceptance criteria** (testable, no hedging)
- An explicit **out of scope** section

If you're not sure how to write one, see
`references/state-files.md` for a longer treatment.

---

## Step 4 — sanity-check the CLI

Before kicking off a real loop, dry-run:

```bash
python /path/to/ralph-loop/scripts/ralph.py --dry-run
```

This prints the rendered command that *would* run on iteration 1. Make
sure it points at the right CLI binary, the prompt path is correct, and
the placeholder substitution looks sane.

If the CLI you picked needs different flags, edit `.ralph/config.json`
directly. The `command` field is a plain argv list with `{prompt}`,
`{prompt_file}`, `{iter}`, and `{workspace}` placeholders.

---

## Step 5 — run the loop

```bash
python /path/to/ralph-loop/scripts/ralph.py
```

What happens:

1. The driver adds the workspace directory (default `.ralph/`) to
   `.gitignore` before doing any loop work. This keeps logs, state files,
   and subagent workspaces out of accidental commits.
2. No git commit happens by default. Use `--checkpoint` or set
   `initial_checkpoint: true` if you explicitly want a pre-loop checkpoint.
3. Each iteration: the driver renders the command, invokes the CLI,
   captures stdout/stderr/exit-code to `.ralph/log/iter-NNNN.*`, and
   appends a structured step event to `.ralph/log/events.jsonl`.
4. Between iterations: the driver checks for `.ralph/DONE`,
   `.ralph/STOP`, `.ralph/PAUSE`, iteration cap, wall-clock cap, and
   consecutive-failure threshold.
5. The loop ends cleanly when the agent writes `.ralph/DONE` or any
   stop condition fires.

You can watch progress live:

```bash
# Latest iteration's stdout (each iteration writes a new file):
ls -t .ralph/log/iter-*.out | head -1 | xargs tail -f
```

---

## Step 6 — operator controls (while it's running)

The driver watches three marker files in the workspace:

| File           | Effect                                                       |
|----------------|--------------------------------------------------------------|
| `.ralph/PAUSE` | Loop pauses at next iteration boundary. Remove to resume.    |
| `.ralph/STOP`  | Loop exits at next iteration boundary.                       |
| `.ralph/DONE`  | Same as STOP, but signals "goal achieved" in the exit code.  |

Plus signals:

- **Ctrl-C once** — finish the current iteration, then exit.
- **Ctrl-C twice** — abort immediately.

These are deliberately blunt and file-based so any operator (or another
script) can drive them without going through Python.

Exit codes are intentionally distinct:

| Code | Meaning |
|------|---------|
| `0`  | `.ralph/DONE` / goal achieved. |
| `20` | `.ralph/STOP` / operator stop. |
| `21` | Max iterations reached. |
| `22` | Wall-clock cap reached. |
| `23` | Consecutive-failure threshold reached, including timeouts. |
| `24` | One or more supervised subagents failed. |
| `130` | Interrupted by Ctrl-C. |

---

## Step 7 — review and decide

When the loop ends, review:

1. **`.ralph/plan.md`** — the agent's last self-assessment.
2. **`.ralph/gotchas.md`** — what it learned the hard way. These often
   surface real bugs in the spec or environment.
3. **`.ralph/tickets/`** — what's left, if anything.
4. **`git diff` / `git status`** — what changed in the codebase. If you
   explicitly enabled checkpointing or `auto_commit`, also inspect
   `git log --oneline`.
5. **`.ralph/log/iter-*.err`** — if there were failed iterations,
   read the errs to see whether the CLI itself was crashing.

If the loop didn't finish the goal but made real progress: edit the
spec to reflect what's now true, write a fresh `STOP` reason, and
restart. Loops compose well — short focused loops > one giant loop.

---

## Cross-CLI notes

The driver invokes any non-interactive CLI. The built-in adapter table
in `scripts/init.py` covers:

| Adapter   | Command template                                  | Notes |
|-----------|---------------------------------------------------|-------|
| `copilot` | operator-provided Copilot coding-agent wrapper    | Primary target; not the shell-suggestion helper. |
| `generic` | placeholder                                       | Default. Edit `command` to anything. |
| `codex`   | `codex exec {prompt}`                             | Codex-compatible one-shot command. |
| `claude`  | Claude-compatible one-shot command                | Supported, not the default. |
| `opencode`| `opencode run {prompt}`                           | |
| `gemini`  | `gemini -p {prompt}`                              | |
| `aider`   | `aider --message-file {prompt_file} --yes-always` | Reads prompt from a file; auto-accepts edits. |
| `amp`     | `amp` (prompt piped on stdin)                     | The original Ralph invocation. |

For any other CLI: edit `command` in `.ralph/config.json`. The driver
substitutes `{prompt}` / `{prompt_file}` / `{iter}` / `{workspace}` into
each argv entry, and optionally pipes the prompt on stdin if
`stdin_from_prompt: true`. See `references/cli-adapters.md` for
worked examples per CLI.

---

## Subagents

Ralph subagents are supervised child Ralph workers, not host-specific
chat-tool subagents. The parent process prepares per-worker workspaces under
`.ralph/subagents/agent-N/`, writes worker configs with `subagents.count = 0`
to prevent recursion, starts each worker as a child `ralph.py --config ...`
process, and records lifecycle events in `.ralph/log/events.jsonl`.

Use them only for fan-out work where tickets or file ownership are disjoint:

```bash
python /path/to/ralph-loop/scripts/ralph.py --subagents 3
```

or configure:

```json
"subagents": {
  "count": 3,
  "workspace_root": ".ralph/subagents",
  "git_branch_prefix": "ralph/agent"
}
```

Each worker inherits the parent CLI command, prompt discipline, timeout,
iteration cap, and `auto_commit` setting. The parent supervises child exit
codes and writes `.ralph/log/subagents-summary.json` when they finish.

Subagents do not magically coordinate conflicting edits. Partition tickets,
directories, or files before launching them; use `references/parallel-mode.md`
for the full workflow.

---

## Minimizing LLM-call consumption

Every outer iteration is one full CLI invocation, which internally runs
many LLM turns (file reads, edits, shell commands — each is an LLM call
that counts against your message limit). A 50-iteration Ralph loop on
Claude Code with ~20 internal turns per iteration can easily burn
**1000+ messages** in a session. Defaults in this skill are tuned to
keep that bill manageable:

- **`max_iterations: 20`** by default (was 50 in earlier versions).
  Twenty iterations of focused work usually outperforms fifty of
  fragmented thrashing.
- **`iteration_timeout_seconds: 1800`** (30 min) by default. Each
  iteration gets generous time to do a *complete* unit of work in one
  CLI invocation rather than being forced into many tiny iterations.
- **PROMPT.md tells the agent to maximize per-iteration value** —
  "largest verifiable chunk", parallel reads, batched verification,
  combined bookkeeping + real work, no over-decomposition.

Knobs you can tune for your message budget:

| Knob                         | Save calls by …                                |
|------------------------------|------------------------------------------------|
| `max_iterations` ↓           | hard cap on outer LLM invocations              |
| `iteration_timeout_seconds` ↑| let each iteration finish a complete ticket    |
| ticket size ↑                | fewer iterations needed to cover the same work |
| spec acceptance criteria ↑   | clearer DONE signal → loop ends sooner         |
| `gotchas.md` discipline      | avoid re-hitting the same failure twice        |

Rules of thumb:

- **First short run, then scale.** Run 3–5 iterations, read the logs,
  see how much each iteration actually accomplishes. *Then* decide the
  budget for a longer run.
- **A successful Ralph loop should feel under-budget.** If you're
  watching the message counter, the spec is probably too vague or the
  tickets are too small.
- **Specs that fit on one screen and have testable acceptance criteria
  are 10× cheaper to loop on than vague ones.** The price of spec
  quality is paid up front; the price of vague specs is paid forever.

---

## Safety rails

Built in:

- **`.gitignore` protection**: the active workspace directory is added to
  `.gitignore` when the loop starts, before logs or subagent state grow.
- **No commits by default.** Use `--checkpoint`, `initial_checkpoint: true`,
  or `auto_commit: true` only when the operator explicitly wants commits.
- **Iteration cap** (default 20) so a runaway loop has a hard ceiling.
- **Wall-clock cap** (default 4 hours) so abandoned loops die.
- **Consecutive-failure threshold** (default 5) so a CLI that's broken
  doesn't waste a budget. Timeouts count as failures.
- **Per-iteration timeout** (configurable) so a hung CLI doesn't stall
  the loop.
- **Structured event log**: every driver step appends a JSON object to
  `.ralph/log/events.jsonl`.
- **No network calls in the driver itself.** Everything the agent does
  goes through its own configured tools.

Worth setting up separately:

- Run the loop on a feature branch (`git_branch` in config) so `main`
  stays clean.
- If the agent is making PRs / API calls, run on an isolated env (a
  worktree, a container) so a misfire doesn't hit production.

---

## When the loop misbehaves

See `references/anti-patterns.md` for the common failure modes and what
to change in `PROMPT.md` / `specs/` / `config.json` to fix each. Short
version:

- **Loop "finishes" but the work isn't done** — spec acceptance criteria
  are too vague; tighten them.
- **Loop oscillates / undoes its own work** — gotchas.md isn't being
  read; emphasize step 1 of PROMPT.md.
- **Iteration takes forever** — `iteration_timeout_seconds` is unset, or
  the CLI is doing one giant change; shrink tickets.
- **Loop drifts off-scope** — the "Stay in scope" section of PROMPT.md
  is being ignored; make acceptance criteria more specific.
- **Loop crashes immediately** — usually `command` typo or CLI not on
  PATH; `--dry-run` catches both.

---

## Reference files

Load these on demand:

- **`references/cli-adapters.md`** — per-CLI command templates, gotchas,
  and how to wire arbitrary tools.
- **`references/state-files.md`** — spec format, ticket format, plan
  evolution, gotcha discipline.
- **`references/anti-patterns.md`** — drift, premature DONE, runaway
  scope, CLI flakiness, prompt rot.
- **`references/parallel-mode.md`** — running multiple workers against
  disjoint ticket queues for embarrassingly-parallel work.

---

## What this skill does *not* do

- It does **not** call any other skill. The PROMPT.md template bakes in
  the brainstorm/plan/verify discipline directly so the loop benefits
  from the methodology without any cross-skill dependency.
- It does **not** make network requests. The driver is stdlib-only.
- It does **not** assume Claude. The driver works with any
  non-interactive CLI; Claude is just the default adapter.
- It does **not** auto-merge or auto-push. Commits (if enabled) stay
  local on the branch you're on.
