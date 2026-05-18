# Platform adaptation

`java-to-typescript` is a **standalone skill**. It does not depend on any other skill. It does, however, use two platform-native primitives that have different names across host environments:

1. **Interactive prompts** — to ask the user for migration mode, target framework, unmapped-library resolutions, plan approval, etc.
2. **Parallel work dispatch** — to port independent Maven/Gradle modules concurrently in Phase 3.

This reference maps both primitives across the three supported host platforms. If you are reading this file as the LLM driving the skill, pick the row matching your platform.

## Platform → primitive map

| Concern | Claude Code | Copilot CLI | Codex CLI | Fallback (no native primitive) |
|---|---|---|---|---|
| Interactive prompt | `AskUserQuestion` tool | `prompt_user` tool (per Copilot's tool surface) | `ask_user` / structured-question tool | Print question to stdout, read line from stdin, validate against expected answer set |
| Parallel module dispatch | `Agent` tool with `subagent_type` + `run_in_background` (or `superpowers:subagent-driven-development` if installed) | `worker` / `task` tool with parallel execution | `parallel_tasks` primitive | Port modules sequentially in dependency-DAG order — correctness is unaffected, only wall-clock cost |
| File I/O for migration artifacts | `Write` / `Edit` / `Read` | equivalent file tools | equivalent file tools | Standard `fs` module from the runtime |
| Shell invocation (for `tsx scripts/...`) | `Bash` tool | `shell` / `bash` tool | `shell` tool | `child_process.spawn` from Node |

## Read this if you're running on Claude Code

You have everything you need natively. The skill's `SKILL.md` mentions `AskUserQuestion` directly because that's the canonical Claude Code primitive. For Phase 3 parallelization, your `Agent` tool with `subagent_type: "general-purpose"` is the simplest dispatch; if the user has the `superpowers:subagent-driven-development` skill installed, that adds a per-task review loop on top — useful but not required.

## Read this if you're running on Copilot CLI

The skill ships as a Maven artifact (`io.github.randomcodespace.ai.skills:java-to-typescript`). Install it into your Copilot CLI plugin directory:

```bash
mvn dependency:copy \
  -Dartifact=io.github.randomcodespace.ai.skills:java-to-typescript:0.0.1 \
  -DoutputDirectory=./tmp
unzip -o tmp/java-to-typescript-0.0.1-bin.zip -d ~/.copilot/plugins/
```

Then your `skill` tool auto-discovers the SKILL.md. When you see `AskUserQuestion`, substitute Copilot's interactive-prompt tool. When Phase 3 step 6 says "parallelize independent modules", use Copilot's worker dispatch.

The companion scripts under `scripts/` are pure Node + Vitest — they run identically. No code changes needed.

## Read this if you're running on Codex CLI

Same install pattern, target dir `~/.codex/plugins/` (or wherever Codex looks for plugins on your install). Codex's tool surface is closer to Claude Code's than Copilot's; the substitutions are minor:

| Claude Code | Codex CLI |
|---|---|
| `AskUserQuestion` | structured `ask_user` |
| `Agent` + `subagent_type` | `parallel_tasks` or single-task delegation |
| `Bash` | `shell` |

The scripts and references are unchanged.

## Read this if your platform has neither primitive

The skill degrades gracefully:

- **No interactive prompt:** Print questions to stdout, accept `--answers <jsonfile>` on the command line as a non-interactive override. The user provides answers up-front in JSON; the skill never blocks.
- **No parallel dispatch:** Port modules sequentially, leaves of the dependency DAG first. The four phases and all gates still work; only wall-clock time changes.

In both fallback modes, the skill's deliverable (a working TS workspace + verify report) is identical.

## What the skill explicitly does NOT depend on

To remain standalone, the skill avoids:

- **No cross-skill invocations.** `SKILL.md` references no other skill by name. Earlier drafts mentioned `superpowers:subagent-driven-development`; that's been removed in favor of platform-agnostic guidance.
- **No platform-specific scaffolding tools.** Workspace scaffolding goes through `scripts/pom-to-workspace.ts scaffold`, which is pure Node.
- **No runtime internet calls.** The library registry is the source of truth; `context7` and the npm registry are NEVER called at skill runtime (see hard constraint 2 in `SKILL.md`).
- **No specific LLM provider for the orchestration.** The skill works with any LLM that has tool-use and structured-output capability. Only the eval harness (E2/E3 in real mode) optionally calls Anthropic — and that's opt-in via `ANTHROPIC_API_KEY`; see `evals/README.md`.

## Distribution

| Platform | Install command |
|---|---|
| **From source** | `git clone` + `cp -r skills/java-to-typescript ~/.claude/skills/` (or equivalent skill dir) |
| **Maven Central** | `mvn dependency:copy -Dartifact=io.github.randomcodespace.ai.skills:java-to-typescript:<version> -DoutputDirectory=./tmp && unzip tmp/java-to-typescript-<version>-bin.zip -d <plugin-dir>` |
| **Air-gapped enterprise** | Mirror the artifact to your internal Maven repo (Artifactory / Nexus); the skill bundle is a self-contained zip with vendored dependencies — no npm registry needed at install time |

The bundle is the same zip on every platform. Tool-name shims live in the host's adapter layer, not in the skill.
