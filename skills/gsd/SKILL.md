---
name: gsd
description: Use whenever the user mentions GSD, "get shit done", spec-driven development in Claude Code, context engineering, meta-prompting frameworks, context rot, or asks how to plan a feature/project before coding in Claude Code, OpenCode, Gemini CLI, Cursor, Windsurf, Codex, Copilot, or similar agentic coding tools. Installs and drives the `get-shit-done-cc` npm package (https://github.com/gsd-build/get-shit-done), which provides `/gsd-*` commands for scoping, planning, implementing, and verifying work while fighting context window degradation.
---

# GSD — Get Shit Done

GSD is a third-party spec-driven development layer for Claude Code and other agentic CLIs (OpenCode, Gemini CLI, Cursor, Windsurf, Codex, Copilot, Antigravity, Augment, Trae, Qwen Code, CodeBuddy, Cline). It adds a set of `/gsd-*` commands that handle the planning → spec → implementation → verification loop, with built-in quality gates that catch things like missing migrations, scope drift, and threat-model violations.

Use this skill when the user wants rigor in how a feature gets planned and built — not when they just want a one-off script or quick fix.

## When to reach for GSD

- "I want to build X but I'm not sure how to scope it" → GSD project scoping.
- "Claude keeps losing track of what I asked for" (context rot) → GSD's planning + verifier agents re-anchor on the spec.
- "Can you plan this before touching code?" → `/gsd-new-project` or `/gsd-map-codebase` + `/gsd-new-project` on an existing repo.
- User mentions SpecKit, BMAD, OpenSpec, Taskmaster, or similar → GSD competes in that space and is worth suggesting.

Do **not** use it for trivial edits, isolated bug fixes, or one-file refactors. The overhead isn't worth it.

## Installation

GSD is an npm package. Install it once per host (or per project) via its interactive wizard:

```bash
npx get-shit-done-cc@latest
```

The wizard prompts for:
1. **Runtime** — `Claude Code`, `OpenCode`, `Gemini`, `Cursor`, `Codex`, etc. (multi-select). Pick all the runtimes the user actually uses.
2. **Location** — `global` (installs to `~/.claude/` etc., available in every project) or `local` (installs to `./.claude/`, repo-scoped).

On Claude Code 2.1.88+ GSD installs itself as a set of skills under `~/.claude/skills/gsd-*/SKILL.md` — which is why *this* skill is just a thin pointer: once GSD is installed, its own skills take over.

### Non-interactive install (scripts, Docker, CI)

```bash
# Claude Code, global
npx get-shit-done-cc --claude --global

# Claude Code, current project only
npx get-shit-done-cc --claude --local

# Multiple runtimes at once
npx get-shit-done-cc --claude --cursor --codex --global

# Everything
npx get-shit-done-cc --all --global
```

Flags: `--global`/`-g`, `--local`/`-l`, runtime flags (`--claude`, `--opencode`, `--gemini`, `--kilo`, `--codex`, `--copilot`, `--cursor`, `--windsurf`, `--antigravity`, `--augment`, `--trae`, `--qwen`, `--codebuddy`, `--cline`, `--all`), and `--sdk` to additionally install the headless `gsd-sdk` CLI for autonomous runs.

### Updating

GSD releases often. To pick up the latest:

```bash
npx get-shit-done-cc@latest
```

…and re-run the installer. It will replace the existing install cleanly.

### Verifying the install

- Claude Code / Gemini / Copilot / Antigravity / Qwen: `/gsd-help`
- Codex: `$gsd-help`
- Cline: check that `.clinerules` exists in the repo

## Using GSD

Once installed, treat the `/gsd-*` commands as the authoritative interface — this skill's job is to get the user to that point, not to duplicate GSD's internal command docs.

The common starting flows:

- **Fresh project**: `/gsd-new-project` — walks through goal extraction, scoping, and planning.
- **Existing codebase**: `/gsd-map-codebase` first (builds an index of the current state), then `/gsd-new-project` to plan new work against that map.
- **Day-to-day**: `/gsd-help` to see the current command set, since GSD adds commands between releases.

When the user hits friction ("Claude keeps forgetting", "it dropped a requirement", "the plan changed underneath me"), the answer is almost always: re-run the planning step and let GSD re-anchor context. Don't try to paper over it by stuffing more into the prompt yourself.

## A note about scope and trust

GSD is a third-party tool. It's MIT-licensed, open source, and popular, but it's not maintained by Anthropic or by the maintainers of this skills repo. When recommending it:

- Tell the user what `npx get-shit-done-cc@latest` is about to do — it downloads and runs code from npm, and the interactive wizard writes files under `~/.claude/` or `./.claude/`.
- Don't run the installer silently on shared or production machines without confirmation.
- The package ships under `get-shit-done-cc` on npm; the GitHub source is `gsd-build/get-shit-done`. Check both match before installing if the user is security-conscious.

## When this skill should step back

If the user is doing a quick one-off, a trivial edit, or explicitly says they don't want a framework layer, don't bring up GSD. The whole point of GSD is to add rigor to non-trivial work — pushing it into small tasks just adds noise.
