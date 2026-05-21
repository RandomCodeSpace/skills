# CLI adapters — wiring any AI CLI into Ralph

The driver is intentionally dumb: it builds an argv from a config,
substitutes a few placeholders, runs it, captures the output. Any CLI
that can be invoked non-interactively from a shell can drive a Ralph
loop. This file shows how to wire each one.

Keyword note for skill routing: this is a generic Ralph adapter guide,
with Copilot coding agent as the primary named target. Codex, Claude,
OpenCode, Gemini, Aider, Amp, and any one-shot coding command are also
supported.

## How the substitution works

The `command` field in `.ralph/config.json` is a list of argv strings.
Each string is scanned for these placeholders and substituted in place:

| Placeholder      | Value                                                    |
|------------------|----------------------------------------------------------|
| `{prompt}`       | full text contents of `prompt_file` (inlined as one arg) |
| `{prompt_file}`  | path to the prompt file on disk                          |
| `{iter}`         | 1-indexed iteration counter                              |
| `{iteration}`    | alias of `{iter}`                                        |
| `{workspace}`    | path to `.ralph/`                                        |

Unknown placeholders are left as literal text. The substitution is plain
string replacement — no shell escaping. Each argv element goes to
`subprocess.run([...])` directly, so spaces in the prompt are safe.

If your CLI prefers reading the prompt from stdin (the original Ralph
invocation), set `stdin_from_prompt: true` and omit `{prompt}` from
`command`.

`env`, when set, is merged on top of the inherited environment. Two env
vars are always exported automatically:

- `RALPH_ITERATION` — same as `{iter}`
- `RALPH_WORKSPACE` — absolute path to `.ralph/`

Use these if the CLI you're driving has a hook that fires on
`RALPH_ITERATION=1` or similar.

---

## Copilot coding agent

Aliases and trigger keywords: Copilot, GitHub Copilot, Copilot coding
agent, copilot agent, copilot loop, copilot ralph.

There is no universal local command for every Copilot environment. Do
not use the shell-suggestion helper as the default coding loop: it is
optimized for shell suggestions, not autonomous code edits. Point
`command` at the Copilot coding-agent entrypoint or wrapper your
environment provides.

```json
{
  "command": ["./scripts/run-copilot-agent", "{prompt_file}", "{iter}"],
  "stdin_from_prompt": false
}
```

Notes:

- Prefer `{prompt_file}` over `{prompt}` if your wrapper can read files;
  it avoids argv length limits on large prompts.
- The wrapper must run once, apply edits, write output, and exit. Ralph
  handles the loop, logs, stop files, and subagent supervision.
- Keep authentication outside `.ralph/config.json` unless the operator
  explicitly wants env overrides.

## OpenAI Codex CLI

Aliases and trigger keywords: Codex, OpenAI Codex, Codex CLI,
`codex exec`, codex loop, codex ralph.

```json
{
  "command": ["codex", "exec", "{prompt}"],
  "stdin_from_prompt": false
}
```

Notes:

- `codex exec` runs a single prompt non-interactively and exits.
- Tooling perms (file write, shell exec) follow whatever Codex is
  configured for. Confirm in `codex --help` for the version you're on.
- If you want JSON output for structured logs, add the relevant flag
  inside `command`.

## OpenCode

```json
{
  "command": ["opencode", "run", "{prompt}"],
  "stdin_from_prompt": false
}
```

Notes:

- `opencode run` accepts the prompt as a positional arg.
- For long prompts, prefer `["opencode", "run", "--prompt-file", "{prompt_file}"]`
  if your OpenCode version supports it — saves on argv length limits.

## Gemini CLI

```json
{
  "command": ["gemini", "-p", "{prompt}"],
  "stdin_from_prompt": false
}
```

Notes:

- `gemini -p` is the one-shot mode. Behavior depends on which Gemini
  CLI flavor you have installed; check `gemini --help`.

## Aider

```json
{
  "command": ["aider", "--message-file", "{prompt_file}", "--yes-always"],
  "stdin_from_prompt": false
}
```

Notes:

- `--message-file` is preferred over `--message` for long prompts.
- `--yes-always` auto-accepts code suggestions. **Confirm this is what
  you want** — without it the loop will hang on the first edit prompt.
- Aider edits files in place using its own git semantics. Set the
  driver's `auto_commit: false` to avoid double-commits.

## Claude-compatible command

Aliases and trigger keywords: Claude, Claude Code, claude CLI,
Ralph Wiggum plugin, `/ralph-loop`, Stop hook, completion promise.

```json
{
  "command": ["claude", "-p", "{prompt}"],
  "stdin_from_prompt": false
}
```

Notes:

- Claude is supported as another one-shot coding command, but this skill
  should stay generic and should not assume Claude-specific hooks.
- If you are copying ideas from Anthropic's Ralph Wiggum plugin, map the
  Stop hook / completion-promise concept onto `.ralph/DONE`, `.ralph/STOP`,
  and this standalone driver.

## Sourcegraph Amp (the original Ralph)

```json
{
  "command": ["amp"],
  "stdin_from_prompt": true
}
```

Notes:

- This is the exact invocation Geoffrey Huntley's original Ralph used:
  `cat PROMPT.md | amp` in a `while :; do … ; done` loop.
- Setting `stdin_from_prompt: true` makes the driver pipe the prompt
  contents on stdin instead of as an argv element.

## Cursor

```json
{
  "command": ["cursor-agent", "--prompt", "{prompt}", "--non-interactive"],
  "stdin_from_prompt": false
}
```

Notes:

- Cursor's agent CLI flag names change frequently. Run `cursor-agent
  --help` and adapt `command` accordingly.
- Cursor needs the project open. If the loop is running headless, point
  Cursor at the project with whatever flag it requires for that.

## Arbitrary CLI / wrapper script

```json
{
  "command": ["sh", "-c", "my-cli --instructions {prompt_file} --quiet"],
  "stdin_from_prompt": false
}
```

Or with a wrapper script:

```json
{
  "command": ["./scripts/run-agent.sh", "{prompt_file}", "{iter}"]
}
```

The `sh -c "..."` form is the easiest way to handle CLIs that need
shell-style redirection or piping. Just remember the quoting:
`{prompt}` becomes a single literal string after substitution, so if
you `sh -c "echo {prompt} | foo"` the prompt will land inside the
double-quoted string without further escaping. Prefer `{prompt_file}`
when shelling out — it's safer.

---

## Forcing stdin instead of argv

Some CLIs read the prompt from stdin only. Two ways to do it:

**Option A — let the driver pipe it:**

```json
{
  "command": ["my-cli", "--read-from-stdin"],
  "stdin_from_prompt": true
}
```

**Option B — use `sh -c` and explicit `cat`:**

```json
{
  "command": ["sh", "-c", "cat {prompt_file} | my-cli"],
  "stdin_from_prompt": false
}
```

Option A is cleaner. Option B is useful if you need to also pipe in
other data (`cat {prompt_file} extra-context.md | my-cli`).

---

## Picking the iteration timeout

If the CLI hangs on any single iteration, the whole loop stalls. Set:

```json
{
  "iteration_timeout_seconds": 600
}
```

Tune this to "longer than the slowest healthy iteration, shorter than
'something is clearly wrong'". For most agent CLIs, 5–15 minutes is
right. The driver kills the subprocess on timeout (exit code 124) and
moves on.

---

## What about hosts that don't have a CLI?

If the only way to invoke the agent is through an editor IDE plugin or
an API call, write a thin wrapper script that exposes a stdin/stdout
interface and point `command` at the wrapper. The driver only cares
about an executable that takes a prompt and prints output. Anything that
fits that contract works.

The skill itself does **not** include such wrappers — adding one would
mean either an internet call (calling the API) or shelling out to
something not on the canonical CLI list. Both are user-owned choices,
not part of the standalone surface.
