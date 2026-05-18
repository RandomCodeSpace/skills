# Spec: <feature name>

> Specs are the **source of truth** for the loop. The agent reads this
> file every iteration. Be concrete; be testable. Vague specs produce
> drifting loops.
>
> Drop one file per feature under `.ralph/specs/`, named like
> `01-auth.md`, `02-billing.md`, etc. Number prefixes give a stable
> reading order.

## Why

(One paragraph. Why does this feature exist? What problem does it solve?
Skip if obvious from the title.)

## Behavior

(What the system should do, from the user's / caller's perspective.
Bullet points or numbered steps. Avoid implementation detail here.)

- (bullet)
- (bullet)

## Acceptance criteria

(Concrete, testable. The loop marks the spec satisfied only when every
item here is verifiable — usually via tests, a build, or a runnable
smoke check.)

- [ ] (criterion — e.g. "POST /users with valid body returns 201 and a
      JSON body containing the new user's id")
- [ ] (criterion — e.g. "passwords are never logged at any log level")
- [ ] (criterion)

## Out of scope

(Bullet anything that looks adjacent but is **not** part of this spec.
Loops drift when this list is missing.)

- (out-of-scope item)
- (out-of-scope item)

## Open questions

(Anything you're unsure about. The loop will pick the most conservative
reading and add a `## QUESTION` block here if it has to make a call.)
