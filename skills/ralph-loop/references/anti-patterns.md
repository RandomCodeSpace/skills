# Anti-patterns — how Ralph loops fail, and what to change

Ralph loops fail in stylized ways. Most failures aren't bugs in the
driver — they're the prompt and the specs and the operator's patience
acting in concert. Here is a tour, with concrete remedies.

## 1. Premature DONE

**Symptom:** The agent writes `.ralph/DONE`, the loop exits, but the
spec is obviously not satisfied.

**Why it happens:** The acceptance criteria are vague ("the API should
work"), or the agent's check for satisfaction is shallow (it ran one
test and assumed the rest passed).

**Fix:**

- Make acceptance criteria **mechanically verifiable**. "`pytest -k
  auth/` exits 0 and reports >= 12 passing tests" beats "auth tests
  pass".
- Add a "DONE checklist" to `PROMPT.md` that forces the agent to
  enumerate each criterion and quote evidence (e.g., the line of a
  test report) before writing DONE.
- Treat the first DONE as a draft: have the operator review before
  shipping.

## 2. Drift / scope creep

**Symptom:** The agent starts refactoring unrelated files, adding
features nobody asked for, "improving" code that wasn't in the spec.

**Why:** Either the spec doesn't have an explicit "out of scope" list,
or the agent is bored (genuinely under-specified work).

**Fix:**

- Put a tight **"out of scope"** block in every spec.
- Re-emphasize the "Stay in scope" section of PROMPT.md (it's already
  there; if the agent is ignoring it, your model is too eager — see
  CLI config).
- If drift keeps happening on the same files, add an explicit
  forbidden-paths list to PROMPT.md.

## 3. Oscillation (undoing prior work)

**Symptom:** Iteration N adds X, iteration N+2 removes X, iteration N+4
adds X again.

**Why:** The agent isn't reading `gotchas.md` and the previous
iteration's `plan.md` carefully enough; without that memory, it
relitigates decisions every iteration.

**Fix:**

- Make sure iteration logs aren't being deleted between runs.
- Tighten the gotchas discipline: every time you observe an
  oscillation, write a `## gotcha` entry explicitly stating "we chose
  X over Y because Z; do not revisit."
- Consider locking down decided architecture in a `decisions.md` file
  under `.ralph/` and add it to PROMPT.md's read list. (The default
  template does this implicitly via plan.md, but a dedicated file
  helps for long loops.)

## 4. The loop "loops" but produces no delta

**Symptom:** Each iteration exits zero, plan.md gets shuffled around,
nothing actually changes in the codebase.

**Why:** The agent is treating bookkeeping as work. Or tickets are
malformed and the agent keeps "decomposing" without ever doing.

**Fix:**

- Inspect `.ralph/log/iter-*.out` for the last few iterations. If
  every iteration ends with "I split ticket X" and no code changes,
  the prompt's "combine bookkeeping with real work" rule isn't being
  honored — make it more emphatic.
- If tickets are too granular, hand-merge a few into bigger ones.
- Lower `max_iterations` to 5–10 and force the agent to ship something
  meaningful per iteration.

## 5. Runaway LLM consumption

**Symptom:** You burn through your daily message budget and the loop
isn't done.

**Why:** Most often: tickets too small, verification done
non-batchwise, the agent reading the whole codebase each iteration.

**Fix:**

- Re-read PROMPT.md's efficiency rules — they're there, but if the
  agent ignores them, make them louder (move them to the top).
- Drop `max_iterations` and raise `iteration_timeout_seconds` so each
  iteration finishes a real chunk.
- Sanity-check that tickets are at least 20 lines of context, not
  3-word descriptions.
- For really large specs: split into multiple short loops with clean
  hand-offs between them.

## 6. CLI crashes or hangs

**Symptom:** Many iterations exit nonzero quickly (crash) or get
killed by the timeout (hang).

**Why:** Usually the CLI itself is misconfigured: wrong flags, missing
auth, wrong working directory.

**Fix:**

- `python scripts/ralph.py --dry-run` shows the exact rendered command.
  Run it manually outside the loop and confirm it does what you expect.
- If exit is fast and nonzero, the CLI likely failed argument parsing
  or auth. Inspect the first `.ralph/log/iter-*.err`.
- If iterations hang, lower `iteration_timeout_seconds` and check
  whether the CLI is waiting on interactive input.
- If only some iterations crash: check whether the prompt has grown to
  exceed an argv length limit. Switch to `stdin_from_prompt: true` or
  use `{prompt_file}` instead of `{prompt}` if so.

## 7. Spec rot

**Symptom:** After several iterations, the agent starts editing the
spec to "match" what the code happens to do, rather than the other way
around.

**Why:** The agent ran into something hard, decided the spec must be
wrong, and quietly amended it.

**Fix:**

- PROMPT.md already says "do not silently route around spec problems,
  add a `## QUESTION` block." If this is still happening, the agent
  isn't following it — make the rule more explicit and threaten loop
  exit on violation (you can add: "if you must edit a spec, append a
  `## CHANGED-BY-AGENT` block and exit so the operator can review.").
- Use git to bisect when the spec changed and revert if the change is
  bogus.

## 8. Prompt rot

**Symptom:** Late iterations behave worse than early ones — the agent
seems to be "drifting" in some hard-to-pinpoint way.

**Why:** Either PROMPT.md has been edited by earlier iterations in a
way that made it worse (the PROMPT.md template invites this; see Step
6 "House rules"), or gotchas.md has grown to hundreds of entries and
the noise drowns out the signal.

**Fix:**

- Diff `.ralph/PROMPT.md` against the original template. Revert if a
  prior iteration's "improvement" was actually a regression.
- Compact gotchas.md: keep only the entries that are still load-bearing
  for current work; move the rest to `.ralph/gotchas-archive.md`.

## 9. The loop succeeds, but the code is brittle / ugly

**Symptom:** All acceptance criteria pass, but the codebase looks like
it was written by 30 different junior devs.

**Why:** Acceptance criteria measured behavior, not maintainability.
The loop optimized for the metric it could see.

**Fix:**

- Add criteria for **code quality**, expressed mechanically: "no
  function is longer than 50 lines", "no file is longer than 400
  lines", "`golangci-lint run` exits zero", "test coverage >= 80%
  per `coverage run`".
- Add an explicit "code review" step as a final ticket: "review the
  diff vs. main and propose simplifications; remove anything not
  required by the spec."

## 10. Operator boredom

**Symptom:** You stopped watching the loop, and now hours later, you
realize it's been spinning on a stupid mistake.

**Why:** Long-running loops without operator checkpoints become
expensive failure modes.

**Fix:**

- Run with smaller `max_iterations` (e.g., 5) for first attempts; only
  unlock longer runs when you trust the loop's behavior.
- Set up a desktop notification on `.ralph/DONE` appearing, or on
  consecutive-failure threshold being hit.
- Use `auto_commit: true` for fine-grained git history and bisect
  when reviewing.

---

## When to abandon a Ralph loop entirely

Ralph isn't the right tool for every problem. Abandon it when:

- The task is small enough to one-shot the CLI directly.
- The work needs constant human judgment per change (Ralph is
  hands-off; if you'd review every iteration anyway, just pair).
- The spec is genuinely unknown — you're exploring, not building.
  Specs come first; if you don't have them, you don't have a loop.
- You're hitting the same gotcha five iterations in a row. The loop
  has nothing left to teach itself; sit down and fix the problem
  manually.
