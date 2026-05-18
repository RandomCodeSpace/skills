# Parallel mode — multiple workers, same loop

The driver is intentionally single-process. For embarrassingly-parallel
work (large ticket queue, mostly independent tickets), you can run
multiple drivers in parallel — each is a worker against the same
project but with its own workspace and (optionally) its own branch.

This is opt-in. The default Ralph loop is single-worker. Use parallel
mode only when you've watched a single-worker loop, understand its
behavior, and have specs/tickets that genuinely don't conflict.

## When parallel actually helps

It helps when:

- The ticket queue is **fan-out-shaped** — many independent items
  (e.g., "add type hints to module A, B, C, D, E").
- Tickets edit **disjoint files** — workers won't race on the same
  file.
- Verification can be done in parallel (independent test suites, or a
  cheap full-suite run per worker).
- The CLI you're using doesn't itself parallelize internally (in
  which case adding another layer is wasted).

It does **not** help when:

- The work is sequential by nature (build → test → deploy).
- Tickets share state (database schemas, shared interfaces, package
  manifests).
- Your message-limit headroom can't absorb 2× or 3× the LLM call
  volume.

## Topology

Each worker has its own workspace directory and (recommended) its own
git branch:

```
my-project/
├── .ralph-worker-1/
│   ├── config.json   # claims tickets matching prefix "0001-0099"
│   ├── PROMPT.md
│   ├── plan.md
│   └── ...
├── .ralph-worker-2/
│   ├── config.json   # claims tickets matching prefix "0100-0199"
│   └── ...
└── .ralph-specs/     # SHARED. specs are global.
```

Workers share the `specs/` directory because there's only one source of
truth. Everything else — plan, gotchas, library, tickets, logs — is
per-worker so workers don't race on file writes.

## Walkthrough

### 1. Bootstrap two workspaces

```bash
python ~/.claude/skills/ralph-loop/scripts/init.py \
  --workspace .ralph-worker-1 --adapter claude

python ~/.claude/skills/ralph-loop/scripts/init.py \
  --workspace .ralph-worker-2 --adapter claude
```

### 2. Share the specs

```bash
# Move the canonical specs into one place and symlink the others.
mv .ralph-worker-1/specs .ralph-specs
ln -s ../.ralph-specs .ralph-worker-1/specs
rm -rf .ralph-worker-2/specs
ln -s ../.ralph-specs .ralph-worker-2/specs
```

Or just keep two independent copies and accept that you may need to
re-sync if specs evolve mid-run.

### 3. Partition the tickets

Easiest: have one worker handle tickets `0001-0099`, the other handle
`0100-0199`. Each worker's PROMPT.md needs a one-line note:

```markdown
> WORKER NOTE: this worker is responsible only for tickets whose ID is
> in the range 0001-0099. Ignore all others; the other worker will pick
> them up.
```

You can also slice by directory or feature instead of by ticket ID,
depending on the project shape.

### 4. Run on separate branches

In each worker's `config.json`:

```json
{
  "git_branch": "ralph/worker-1",
  "auto_commit": true,
  "workspace": ".ralph-worker-1"
}
```

The driver creates the branch and commits per iteration so you can
merge or rebase between workers later.

### 5. Launch in parallel

```bash
# Two separate terminals (or use `&` / a process supervisor).
python ~/.claude/skills/ralph-loop/scripts/ralph.py \
  --config .ralph-worker-1/config.json &

python ~/.claude/skills/ralph-loop/scripts/ralph.py \
  --config .ralph-worker-2/config.json &
```

Each writes to its own logs, plan, gotchas. Each respects its own
DONE/STOP/PAUSE markers.

### 6. Merge results

When both finish (or one finishes and you `STOP` the other), merge:

```bash
git checkout main
git merge ralph/worker-1 --no-ff
git merge ralph/worker-2 --no-ff   # likely no conflicts if tickets were disjoint
```

Resolve any conflicts manually. If conflicts are non-trivial, the
ticket partitioning was wrong; learn for next time.

---

## File-level conflict avoidance

If you're worried about two workers editing the same file:

- **Partition by directory.** Worker 1 owns `src/auth/`, worker 2 owns
  `src/billing/`. Acceptance criteria stay shared.
- **Use git worktrees.** Each worker runs in its own worktree of the
  same repo, so commits land on different branches and conflicts
  surface only at merge time.

  ```bash
  git worktree add ../proj-worker-1 -b ralph/worker-1
  git worktree add ../proj-worker-2 -b ralph/worker-2
  # run each worker from its own worktree
  ```

- **Atomic claims.** If you really want workers to claim tickets
  dynamically, use a lockfile dance: worker writes
  `tickets/0017.md.claimed-by-1` first; if the rename succeeds, it
  owns the ticket. The driver does **not** provide this — wire it in
  PROMPT.md if you need it.

---

## Cost considerations

Parallel mode multiplies LLM calls by your worker count. If you're
already careful about message budget (see "Minimizing LLM-call
consumption" in SKILL.md), parallel mode may push you over.

Run the math up front: if a single-worker loop takes ~1000 messages,
two workers in parallel will take ~2000, not 1000-but-faster. The
speedup is wall-clock, not budget.

---

## Diagnostics

Each worker logs to its own `.ralph-worker-N/log/`. To watch all
workers at once:

```bash
tail -f .ralph-worker-*/log/iter-*.out  # may want to scope to last N
```

If one worker is stalled while others progress, check its
`iter-*.err`. Common cause: it grabbed a ticket that depends on
something only the other worker has produced. Fix: enforce
dependency ordering in the ticket file (`**Depends on:** 0014` is
honored by the agent; the driver doesn't enforce it).
