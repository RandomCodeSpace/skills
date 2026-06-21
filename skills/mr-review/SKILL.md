---
name: mr-review
description: Use when running a concise GitLab Enterprise/self-managed merge request review, especially inside a GitLab CI merge_request_event pipeline with predefined CI_* variables available. Produces a no-nonsense review focused only on changed lines and directly affected context. Uses git diff/fetch/status first, plus ripgrep (`rg`), ast-grep, and existing LSP/diagnostic tools when available. Avoids GitLab API calls except for optional posting when explicitly requested. Does not suggest code, rewrite code, nitpick style, or ramble.
---

# GitLab MR Review

This skill generates a **concise, high-signal GitLab merge request review** from inside a GitLab Enterprise / self-managed GitLab CI pipeline.

Primary environment: a `merge_request_event` pipeline with GitLab predefined variables already available. Prefer those variables and local `git` history over GitLab API calls.

The goal is not to prove you looked everywhere. The goal is to tell the MR author only what matters before merge.

Core rules:

1. Review the diff first. Changed lines are the review surface.
2. Use GitLab CI predefined variables for MR identity, target branch, source commit, and diff base.
3. Use `git` wherever possible: fetch refs, compute the diff range, list changed files, inspect hunks, and read surrounding context.
4. Use `rg`, `ast-grep`, and existing LSP/diagnostic tools as evidence gatherers on changed files only.
5. Do not call the GitLab API to discover MR metadata when predefined variables or git refs already provide it.
6. Do not suggest code. No patches, snippets, pseudo-code, or "you could rewrite this as..." advice.
7. Do not nitpick. No style, naming, formatting, or broad refactor comments unless they cause a concrete bug in the diff.
8. Keep the final review short. Default maximum: **3 findings**. Absolute maximum: **5 findings** unless the user explicitly asks for exhaustive review.

## When to use

Use when the user says things like:

- "review this MR in GitLab CI"
- "run the MR review job"
- "review only the merge request diff"
- "generate a concise GitLab MR review"
- "use the GitLab predefined variables"
- "avoid GitLab API; use git"
- "review MR !42" when a local checkout or pipeline workspace exists
- "check this diff" in a GitLab repository

Do not use for:

- Implementing fixes after the review.
- General repository audits.
- Style cleanup, refactoring proposals, or architectural brainstorming.
- Creating inline comments through GitLab API unless the user explicitly asks to post them. Generating the review text is safe; posting is a side effect.

## Review stance

Be strict about correctness and safety, but sparse in output.

Report only findings that meet at least one of these bars:

- **Blocker:** likely bug, broken contract, data loss, security issue, race/concurrency hazard, build/test regression, or production-impacting behavior tied to the diff.
- **Risk:** plausible defect in changed behavior with a clear failure mode, but not certain enough to block by itself.
- **Question:** one focused question whose answer changes whether the MR is safe to merge.

Do not report:

- Nits.
- Personal preference.
- Style-only concerns.
- "Consider adding a comment" unless missing context creates a real safety issue.
- Missing tests in the abstract. Only mention tests when a changed behavior has an untested failure mode you can name.
- Existing problems in untouched code unless the diff newly depends on them or makes them worse.

## Step 1 — confirm GitLab CI MR context

Start in the GitLab job workspace:

```bash
cd "${CI_PROJECT_DIR:-.}"
git status --short
git remote -v
git rev-parse --show-toplevel
```

Prefer these predefined variables:

| Variable | Use |
|---|---|
| `CI_PIPELINE_SOURCE` | Confirm `merge_request_event` when possible. |
| `CI_PROJECT_DIR` | Repository checkout path. |
| `CI_PROJECT_PATH` | Human-readable project path for the Checked line. |
| `CI_SERVER_URL` | GitLab Enterprise / self-managed instance URL for context only. |
| `CI_MERGE_REQUEST_IID` | MR IID for the Checked line and optional posting. |
| `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` | Target branch to fetch and compare against. |
| `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` | Source branch context only; do not require it to exist locally. |
| `CI_MERGE_REQUEST_DIFF_BASE_SHA` | Preferred exact base SHA for the MR diff. |
| `CI_MERGE_REQUEST_TARGET_BRANCH_SHA` | Useful fallback for merged-result pipelines. |
| `CI_COMMIT_SHA` | Preferred head SHA. |
| `CI_DEFAULT_BRANCH` | Fallback target branch when MR target is absent. |
| `CI_API_V4_URL` | Only for optional posting; not needed for review analysis. |

If `CI_PIPELINE_SOURCE` is not `merge_request_event`, continue only if the user explicitly asked to review the current branch/diff. Otherwise return a short comment that this job should run in an MR pipeline.

## Step 2 — fetch enough git history

GitLab CI often uses shallow clones. The MR review needs the diff base commit and target branch history. The preferred pipeline config is:

```yaml
variables:
  GIT_DEPTH: "0"

mr_review:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
```

Inside the job, recover gracefully if the clone is still shallow:

```bash
TARGET_BRANCH="${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-${CI_DEFAULT_BRANCH:-main}}"
HEAD_SHA="${CI_COMMIT_SHA:-HEAD}"

# Fetch target branch using git. No GitLab API needed.
git fetch origin "+refs/heads/${TARGET_BRANCH}:refs/remotes/origin/${TARGET_BRANCH}" --prune || \
  git fetch origin "${TARGET_BRANCH}" --prune

# Deepen only if needed.
if git rev-parse --is-shallow-repository 2>/dev/null | grep -q true; then
  git fetch --unshallow origin || git fetch --deepen=200 origin
fi
```

Never use the GitLab API to list changed files or retrieve diffs while the repository is available locally. `git diff` is the source of truth.

## Step 3 — compute the diff range with git

Prefer GitLab's exact diff base SHA when present and available locally:

```bash
TARGET_BRANCH="${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-${CI_DEFAULT_BRANCH:-main}}"
HEAD_SHA="${CI_COMMIT_SHA:-HEAD}"
DIFF_BASE="${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}"

if [ -n "$DIFF_BASE" ] && git cat-file -e "${DIFF_BASE}^{commit}" 2>/dev/null; then
  BASE_SHA="$DIFF_BASE"
elif [ -n "${CI_MERGE_REQUEST_TARGET_BRANCH_SHA:-}" ] && git cat-file -e "${CI_MERGE_REQUEST_TARGET_BRANCH_SHA}^{commit}" 2>/dev/null; then
  BASE_SHA=$(git merge-base "${CI_MERGE_REQUEST_TARGET_BRANCH_SHA}" "$HEAD_SHA")
else
  BASE_SHA=$(git merge-base "origin/${TARGET_BRANCH}" "$HEAD_SHA")
fi

DIFF_LABEL="${BASE_SHA}..${HEAD_SHA}"
git diff --stat "$BASE_SHA" "$HEAD_SHA"
git diff --name-only --diff-filter=ACMR "$BASE_SHA" "$HEAD_SHA"
```

If the base cannot be computed, do not call the API as a first resort. First try:

```bash
git fetch origin "+refs/heads/${TARGET_BRANCH}:refs/remotes/origin/${TARGET_BRANCH}" --depth=500
git merge-base "origin/${TARGET_BRANCH}" "$HEAD_SHA"
```

Only if local git history cannot be made available should the review return `Verdict: Comment` explaining that the CI checkout lacks the target/base history required for a reliable diff.

## Step 4 — build the changed-line map

The final review must cite changed lines or lines directly adjacent to a changed hunk.

```bash
git diff --unified=0 "$BASE_SHA" "$HEAD_SHA" > /tmp/mr-review.diff
git diff --name-only --diff-filter=ACMR "$BASE_SHA" "$HEAD_SHA" > /tmp/mr-review-files.txt
```

Use the zero-context diff to know which new-file lines are in scope. Diagnostics outside changed lines are not findings unless they are required to understand a changed line.

For deleted-line defects, cite the hunk and explain the lost behavior. Do not cite unrelated old code.

## Step 5 — read only the necessary code

Read in this order:

1. The diff for each changed file.
2. The smallest surrounding function/class/module needed to understand the changed lines.
3. Direct callers/callees only when a changed line modifies an interface, contract, or data shape.

Avoid repository-wide exploration. If you cannot connect a file search to a changed line, do not do it.

Useful git commands:

```bash
# File-level diff.
git diff "$BASE_SHA" "$HEAD_SHA" -- path/to/file

# Show the reviewed version of a file from the MR head.
git show "${HEAD_SHA}:path/to/file"

# Show the target/base version when needed.
git show "${BASE_SHA}:path/to/file"
```

## Step 6 — run focused text scans with ripgrep

Use `rg` on changed files, not the whole repo.

```bash
CHANGED_FILES=/tmp/mr-review-files.txt

# Conflict markers and accidental debug leftovers.
xargs -r rg -n --no-heading \
  '<<<<<<<|=======|>>>>>>>|debugger|console\.log|print\(|TODO|FIXME|HACK|XXX' \
  < "$CHANGED_FILES"

# Secret-shaped additions or config leaks.
xargs -r rg -n --no-heading -i \
  'api[_-]?key|secret|password|passwd|private[_-]?key|token\s*[:=]' \
  < "$CHANGED_FILES"

# Risky dynamic execution / shell / deserialization patterns.
xargs -r rg -n --no-heading \
  'eval\(|exec\(|shell=True|os\.system\(|subprocess\.|pickle\.loads?|innerHTML|dangerouslySetInnerHTML' \
  < "$CHANGED_FILES"
```

Treat scan hits as leads, not findings. A hit becomes a finding only after reading the diff and confirming a real merge risk.

If `rg` is not installed, use `git grep` on changed paths as a fallback and say `rg` was unavailable in the "Checked" line.

## Step 7 — run ast-grep on changed files

Use `ast-grep` when available. Accept either `ast-grep` or `sg` as the binary.

```bash
AST_GREP=$(command -v ast-grep || command -v sg || true)
```

Run language-specific patterns only for changed file types. Examples:

```bash
# JavaScript / TypeScript
rg '\.(js|jsx|ts|tsx)$' /tmp/mr-review-files.txt | xargs -r "$AST_GREP" --lang ts --pattern 'eval($X)'
rg '\.(js|jsx|ts|tsx)$' /tmp/mr-review-files.txt | xargs -r "$AST_GREP" --lang ts --pattern 'new Function($$$)'
rg '\.(js|jsx|ts|tsx)$' /tmp/mr-review-files.txt | xargs -r "$AST_GREP" --lang ts --pattern '$OBJ.innerHTML = $VAL'

# Python
rg '\.py$' /tmp/mr-review-files.txt | xargs -r "$AST_GREP" --lang python --pattern 'eval($X)'
rg '\.py$' /tmp/mr-review-files.txt | xargs -r "$AST_GREP" --lang python --pattern 'exec($X)'
rg '\.py$' /tmp/mr-review-files.txt | xargs -r "$AST_GREP" --lang python --pattern 'subprocess.$F($$$, shell=True)'

# Go
rg '\.go$' /tmp/mr-review-files.txt | xargs -r "$AST_GREP" --lang go --pattern 'panic($X)'
```

Do not turn the review into an ast-grep rule dump. Use rules that match the diff's language and risk profile.

If `ast-grep` is unavailable, skip it and mention that in the "Checked" line. Do not install tools during the review job unless the pipeline already does that as part of its normal setup.

## Step 8 — use LSP / diagnostics only if already available

Use existing language diagnostics to catch type and contract errors in changed files. Do not set up a language server from scratch during review.

Examples:

```bash
# Go: file-scoped LSP diagnostics.
rg '\.go$' /tmp/mr-review-files.txt | xargs -r gopls check

# Python: file-scoped type/lint diagnostics when already installed.
rg '\.py$' /tmp/mr-review-files.txt | xargs -r pyright
rg '\.py$' /tmp/mr-review-files.txt | xargs -r ruff check

# TypeScript / JavaScript: project-scoped; keep only diagnostics that touch changed files/lines.
npx tsc --noEmit --pretty false
```

Filter diagnostics through the changed-line map from Step 4. A pre-existing diagnostic outside the diff is not a finding.

If diagnostics are broad or noisy, summarize them as "diagnostics checked; no changed-line findings" or "skipped because diagnostics were not file-scoped". Do not flood the review.

## Step 9 — decide what to report

Triage findings with this order:

1. Security or data exposure.
2. Incorrect behavior / broken API contract.
3. Data loss, migration, or persistence risk.
4. Concurrency, race, timeout, or resource leak.
5. Tests missing for a named risky changed path.

Keep only the highest-signal findings. If there are ten possible comments, report the three that matter most for merge safety.

A finding must include:

- Severity: `blocker`, `risk`, or `question`.
- `path:line` tied to the changed hunk.
- One sentence explaining the failure mode.
- Optional second sentence with evidence from the code or tool output.

A finding must not include:

- Code snippets.
- A proposed implementation.
- A rewrite.
- A generic "consider" suggestion.
- A long explanation of general best practices.

## Final output format

Use exactly this shape:

```text
Verdict: <Approve | Comment | Request changes>

Findings:
- <severity> <path:line> — <specific issue and impact>. <optional evidence sentence>

Checked: GitLab <CI_PROJECT_PATH>!<CI_MERGE_REQUEST_IID>, <BASE_SHA>..<HEAD_SHA>, <N> changed files; git: used; rg: <used/fallback/unavailable>; ast-grep: <used/unavailable>; diagnostics: <tool or skipped>.
```

If there are no findings:

```text
Verdict: Approve

No blocking findings.

Checked: GitLab <CI_PROJECT_PATH>!<CI_MERGE_REQUEST_IID>, <BASE_SHA>..<HEAD_SHA>, <N> changed files; git: used; rg: <used/fallback/unavailable>; ast-grep: <used/unavailable>; diagnostics: <tool or skipped>.
```

If the CI job does not have enough git history:

```text
Verdict: Comment

Findings:
- question CI checkout — This job does not have enough git history to compute the MR diff locally; run the review with `GIT_DEPTH: "0"` or fetch the target branch before reviewing.

Checked: GitLab <CI_PROJECT_PATH>!<CI_MERGE_REQUEST_IID>, diff unavailable; git: insufficient history; rg: skipped; ast-grep: skipped; diagnostics: skipped.
```

No greetings. No praise section. No "overall looks good" paragraph. No markdown table.

## Posting reviews

Generating a review is safe. Posting it to GitLab is a side effect.

Do not post comments, approve, or request changes through GitLab API unless the user or CI job explicitly asks to post the review. Git cannot post MR notes, so posting is the only valid API exception.

When asked to post, post the same concise text. Do not expand it for the platform. Prefer `CI_JOB_TOKEN` only if the GitLab instance allows it for MR notes; otherwise require a properly scoped token supplied by the pipeline. Never print tokens.

## Common pitfalls

1. **Calling GitLab API for data git already has.** Use predefined variables and local git history for metadata, changed files, and diffs.
2. **Running in branch pipelines.** MR variables may be absent unless `rules` selects `merge_request_event`.
3. **Shallow clone missing the base.** Set `GIT_DEPTH: "0"` or fetch/deepen before reviewing.
4. **Reviewing the whole repo.** This creates noise. Stay on the diff and direct context.
5. **Turning scan hits into comments.** A regex or AST hit is not a finding until confirmed against changed behavior.
6. **Suggesting code.** The review identifies problems; the author owns the fix.
7. **Listing every possible improvement.** Report only merge-relevant issues.
8. **Commenting on old code.** If it is not changed or newly relied on, leave it alone.
9. **Letting diagnostics flood the review.** Filter to changed lines and directly affected symbols.
10. **Approving with unrun tools implied.** The "Checked" line must honestly say which tools were used or skipped.
