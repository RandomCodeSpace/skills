# State files — the agent's only memory

Everything the loop "remembers" lives in these files. The driver itself
is stateless across iterations. If you want behavior to persist, it has
to land on disk.

This file is the long-form reference. The short summary is in
`assets/templates/` — copies of the canonical formats.

## File map

```
.ralph/
├── config.json          # operator-owned. The agent does not edit this.
├── PROMPT.md            # the master prompt run every iteration
├── plan.md              # the agent's living plan (current state only)
├── gotchas.md           # append-only log of failures + fixes
├── specs/               # source of truth — what to build
│   ├── 01-feature-a.md
│   ├── 02-feature-b.md
│   └── ...
├── tickets/             # work queue — what to do next
│   ├── 0001-task.md
│   ├── 0002-task.md
│   └── done/            # completed tickets archived here
├── library/             # reusable patterns the agent has proven
│   ├── error-handling.md
│   └── ...
├── log/                 # per-iteration logs (driver-owned)
│   ├── iter-0001.out
│   ├── iter-0001.err
│   ├── iter-0001.meta.json
│   └── ...
├── DONE                 # absence/presence — agent writes to signal completion
├── STOP                 # absence/presence — operator writes to halt
└── PAUSE                # absence/presence — operator writes to pause
```

`config.json` and `log/` are the driver's concerns. Everything else is
the agent's.

---

## specs/

Specs are the **source of truth**. The agent reads them every iteration
and compares them against the codebase. The whole loop ends when every
acceptance criterion in every spec file is verifiably met.

### Format

One file per feature. Number the prefix so reading order is stable
(`01-`, `02-`, …). Each file should fit on one screen if possible — if
it doesn't, split it.

```markdown
# Spec: <feature name>

## Why
One paragraph on motivation. Skip if obvious.

## Behavior
Bullet points describing what the system does from the caller's POV.
Avoid implementation detail.

## Acceptance criteria
- [ ] testable item 1
- [ ] testable item 2
- [ ] ...

## Out of scope
- explicitly-not-this-feature
- not-this-either

## Open questions
(empty unless something is genuinely ambiguous)
```

### What makes a spec "good enough" for a loop

The agent does not have the operator's context. A spec that's perfectly
clear to a human teammate may be ambiguous to a fresh-context agent.
The bar is higher.

**Good:**

> POST /users with body `{name: string, email: string}` returns 201 and
> `{id: string, name: string, email: string, created_at: ISO-8601}`.
> Returns 400 with `{error: "invalid_email"}` if email fails RFC-5322
> validation. Email must be unique; returns 409 with
> `{error: "email_taken"}` otherwise.

**Bad:**

> Create a user endpoint with proper validation.

The good one is a checkbox list of verifiable behaviors. The bad one is
a wish.

### When to update a spec

- The agent finds the spec is wrong → it adds a `## QUESTION` block at
  the top and uses the most conservative interpretation. You review
  later and either fix the spec or accept the agent's reading.
- You realize mid-loop that the goal has shifted → write `STOP`, edit
  the spec, restart. **Don't** edit specs while the loop is running.

---

## tickets/

The ticket queue is how the agent breaks specs into iteration-sized
chunks. Each file is one work item.

### Format

```markdown
# 0017 — Add password hashing to user signup

**Spec:** 01-auth.md, acceptance criterion 3
**Status:** open  (or: in-progress, blocked, done)
**Depends on:** 0014 (must be done first)

## What

Hash passwords with bcrypt (cost factor 12) before storing in the
`users.password_hash` column. Reject plaintext passwords shorter than
12 characters with `{error: "password_too_short"}`.

## Verification

- unit test: signup with valid password stores a non-equal hash
- unit test: signup with 11-char password returns 400
- integration test: full signup flow + db read shows hash format `$2b$12$…`

## Notes

Use the `bcrypt` library already in dependencies (see `library/deps.md`).
```

Tickets should be sized to fit one iteration. "One iteration" doesn't
mean "one tiny change" — it means "one cohesive unit that can be
verified end-to-end in a single CLI invocation". If the agent realizes
a ticket is way too big to finish that way, its job that iteration is
to **split** it and exit.

### Conventions

- 4-digit zero-padded ID prefix for natural sort.
- Done tickets move to `tickets/done/` (don't delete — they're a useful
  history).
- Blocked tickets stay in `tickets/` with a `**Status:** blocked` line
  and a reason.
- The agent maintains this directory. The operator can hand-edit
  between loops if needed.

---

## plan.md

A single-file snapshot of the loop's current state. **The agent
overwrites this entirely each iteration.** Old states are visible via
git history if you've enabled `auto_commit`.

### Format

```markdown
# Plan

## Goal
One sentence summarizing the loop's overall goal (from specs/).

## Status
- **Done so far:** bullets — what's verifiable in the codebase now.
- **In progress (this iteration):** the current ticket.
- **Up next:** 1–3 tickets queued.
- **Blocked:** anything waiting.

## Notes
Anything the next iteration needs to know that doesn't fit elsewhere.
```

Keep it short. If you find yourself reading a long plan, the loop is
losing focus — the agent should be moving detail into tickets.

---

## gotchas.md

Append-only log of mistakes the loop has already made. The agent reads
this every iteration before planning so it doesn't repeat itself.

### Format

```markdown
## gotcha: <short title>  (iter N)

**Symptom:** what went wrong (paste exact error if helpful)
**Cause:** what was actually broken
**Fix:** what worked. Or "still open — see ticket NNNN" if unresolved.
```

### Discipline

- **Append only.** Never delete or rewrite a prior entry.
- **Specific.** "Foo's API uses `bar=` not `--bar`" > "Foo is tricky".
- **Real.** Only enter gotchas you actually hit. Speculative gotchas
  rot the file.
- **Short.** A paragraph, not an essay.

Gotchas are the loop's institutional memory. Treat them with the same
care you'd give a postmortem.

---

## library/

Snippets the agent has confirmed work in this codebase. Examples:

- The project's preferred error-wrapping idiom.
- A working migration template.
- A test fixture helper that matches the codebase style.
- The exact import order the linter wants.

Each entry is a small markdown file with a one-line "when to use this"
header and a code block.

```markdown
# error-handling

When wrapping errors at a service boundary, use this idiom:

\`\`\`go
if err != nil {
    return fmt.Errorf("loading user %q: %w", id, err)
}
\`\`\`

(Verified working; the project's `errors.As` checks rely on `%w`.)
```

Library entries are how the loop avoids reinventing patterns each
iteration. The agent should grep this directory before writing new
boilerplate.

---

## DONE / STOP / PAUSE

Three marker files. The driver checks for them between iterations.

| File   | Who writes it  | Effect                                              |
|--------|----------------|-----------------------------------------------------|
| DONE   | the agent      | loop exits cleanly; signals "goal achieved"         |
| STOP   | the operator   | loop exits at next iteration boundary               |
| PAUSE  | the operator   | loop pauses; resumes when you `rm .ralph/PAUSE`     |

Contents of these files are not parsed — only their existence matters.
But it's polite to write a one-line reason inside so future readers
(including you, 6 hours later) know why the loop stopped.

```bash
echo "spec satisfied: all auth tests green" > .ralph/DONE
```

---

## log/

Per-iteration logs the driver writes:

- `iter-NNNN.out` — captured stdout of the CLI invocation.
- `iter-NNNN.err` — captured stderr.
- `iter-NNNN.meta.json` — fields:
  - `iteration` (int)
  - `command` (list[str], post-substitution)
  - `exit_code` (int; 124 on timeout)
  - `duration_seconds` (float)
  - `timed_out` (bool)
  - `stdout` (path)
  - `stderr` (path)

Useful for post-mortems. Don't have the agent read these — they're for
the operator.

---

## What the agent should *not* touch

- **`.ralph/config.json`** — operator-owned. If the agent edits this,
  it can change its own kill switch, which is bad.
- **`.ralph/log/`** — driver-owned. Reading is OK; writing breaks
  invariants.
- **`.git/`** — never. If `auto_commit` is on, the driver handles it.

These boundaries are stated in the PROMPT.md "House rules" section so
the agent sees them every iteration.
