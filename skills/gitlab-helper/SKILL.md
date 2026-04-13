---
name: gitlab-helper
description: Use whenever the user mentions GitLab, .gitlab-ci.yml, GitLab CI/CD, pipelines, runners, merge requests on GitLab, GitLab issues/epics/milestones, GitLab Pages, GitLab Container Registry, Auto DevOps, GitLab API, or any task involving a GitLab instance (self-hosted or gitlab.com). Grounds answers in the user's specific GitLab version and instance by fetching the matching official docs, and automates GitLab operations through the pip-installable `python-gitlab` CLI when credentials are available.
---

# GitLab Helper

This skill helps with anything GitLab: writing and debugging `.gitlab-ci.yml`, configuring runners, managing projects/groups/MRs/issues via API, GitLab Pages, the Container Registry, Auto DevOps, security scanning, and release workflows.

GitLab evolves quickly and features differ significantly between versions and between gitlab.com vs. self-managed instances. **Never answer from memory alone for non-trivial GitLab questions** — fetch the docs for the user's actual version first. That is the core discipline of this skill.

## Step 1 — Establish context

Before doing real work, find out (ask only what you don't already know):

1. **GitLab version** — e.g. `17.6`, `16.11`. If unknown, tell the user how to check: visit `<instance>/help` or run `curl -s <instance>/api/v4/version` (requires token for self-managed). Accept "latest" / "gitlab.com" as meaning current stable.
2. **Instance URL** — `https://gitlab.com` or their self-hosted URL. This matters for docs links, API endpoints, and CLI config.
3. **Tier** — Free, Premium, or Ultimate. Many CI/CD features (merge trains, security dashboards, compliance pipelines) are tier-gated; don't recommend what they can't use.
4. **What they're trying to accomplish** — a pipeline fix, a new feature, an audit, automation, etc.

Store these in your working memory for the rest of the conversation. If the user pivots to a different instance, re-ask.

## Step 2 — Fetch the right documentation

GitLab publishes versioned docs. Construct the URL using the user's version:

- Version-pinned docs: `https://archives.docs.gitlab.com/<version>/` (e.g. `https://archives.docs.gitlab.com/17.6/`)
- Latest docs: `https://docs.gitlab.com/`
- CI/CD reference: `https://docs.gitlab.com/ci/yaml/` (append `?version=<ver>` where relevant)
- REST API: `https://docs.gitlab.com/api/rest/`
- GraphQL API: `https://docs.gitlab.com/api/graphql/`

Fetch with whatever web-fetch tool your host provides (in VSCode GitHub Copilot that's `fetch`/`#fetch`; in Claude Code it's `WebFetch`; any MCP doc-fetcher like `context7` or `rawdoc` also works). Always cite the URL you read so the user can verify.

When the user asks an open-ended "teach me CI/CD" question, don't dump the whole reference — read the **index** pages first (`ci/`, `ci/yaml/`, `ci/pipelines/`), summarize the landscape, then drill into what they care about.

See `references/topics.md` for a curated map of which doc page answers which question.

## Step 3 — Automate with a CLI

Two CLIs are viable. **Prefer `glab` when Go is available on the system** — it's GitLab's official tool, tracks the platform most closely, and has nicer UX for MR/issue/pipeline workflows. Fall back to `python-gitlab` when Go isn't available.

### Preferred: `glab` (official, Go)

First, check: `go version` (need Go ≥1.21) and `which glab`. If Go is present but `glab` isn't installed:

```bash
go install gitlab.com/gitlab-org/cli/cmd/glab@latest
# ensure $(go env GOPATH)/bin is on PATH
```

Authenticate once per host:

```bash
glab auth login --hostname gitlab.com        # or self-managed host
# paste a personal access token with scopes: api, read_api, read_repository, write_repository
```

Everyday usage (run inside a git clone of the GitLab project, or pass `-R group/project`):

```bash
glab mr list --state opened
glab mr create --fill                         # opens MR from current branch
glab mr view 42 --comments
glab mr merge 42 --squash
glab ci list                                  # pipelines
glab ci view                                  # latest pipeline for current branch
glab ci trace <job-id>                        # stream a job's log
glab ci lint                                  # validate .gitlab-ci.yml
glab issue list --assignee=@me
glab api projects/:id/pipelines                # raw REST passthrough
```

`glab` respects `GITLAB_HOST` / `GITLAB_TOKEN` env vars for non-interactive/CI use. For multiple instances, run `glab auth login` per host; config lives at `~/.config/glab-cli/config.yml`.

### Fallback: `python-gitlab`

Use this when Go isn't installed and installing it isn't an option, or when the user explicitly wants a Python SDK they can embed in scripts:

```bash
pip install --user python-gitlab
```

Configure at `~/.python-gitlab.cfg`:

```ini
[global]
default = main
ssl_verify = true
timeout = 10

[main]
url = https://gitlab.example.com
private_token = glpat-xxxxxxxxxxxxxxxxxxxx
api_version = 4
```

Then:

```bash
gitlab project list --owned true
gitlab project-merge-request list --project-id <id> --state opened
gitlab project-pipeline list --project-id <id> --status failed
gitlab -o json project-issue list --project-id <id> --state opened
```

The Python SDK is also useful when you need to script multi-step logic — see `references/python-gitlab.md` for SDK examples.

### Safety for both CLIs

**Before running anything that writes** (creating MRs, closing issues, deleting branches, triggering pipelines), state what you're about to do and confirm — these actions are visible to the user's team. If no token is available, don't silently skip: tell the user the exact command you'd run and how to generate a token (`User Settings → Access Tokens`, scopes `api` or `read_api`).

More recipes and troubleshooting live in `references/glab.md` and `references/python-gitlab.md`.

## Step 4 — Working with `.gitlab-ci.yml`

When writing or reviewing pipelines:

- Ask which **runner types** are available (shared SaaS, group, project, Docker/shell/Kubernetes executor). This constrains `tags:`, `image:`, and `services:`.
- Prefer `rules:` over deprecated `only/except` — note the version cutoff when advising.
- Validate syntax with `glab ci lint` (preferred) or the REST endpoint `POST /api/v4/projects/:id/ci/lint`, or the UI at `<project>/-/ci/lint`.
- For failing pipelines, fetch the failing job's log via API/CLI rather than guessing, then reason from the actual error.

### Maintainability is non-negotiable

A CI/CD file that works today but nobody can touch in six months is a liability. Every pipeline you write or suggest should be something a teammate could pick up, modify, and trust. Apply these principles in order of preference:

1. **Reach for CI/CD Components first** (GitLab 17.0+, GA in 17.6). Components are the modern, versioned, parameterized way to share pipeline logic — they replace ad-hoc `include:` of random files. If the user is on a supported version, propose a component before hand-rolling jobs. A component lives in a project under `templates/`, is versioned via git tags, and is consumed like:

   ```yaml
   include:
     - component: $CI_SERVER_FQDN/my-group/ci-components/build@1.2.0
       inputs:
         stage: build
         image: node:20
   ```

   See the CI Catalog (`<instance>/explore/catalog`) for published ones before writing your own. Docs: `ci/components/`.

2. **If components aren't available, use `include:` with pinned refs.** Never include `@main` or a moving branch — pin to a tag or SHA so pipelines are reproducible:

   ```yaml
   include:
     - project: my-group/ci-templates
       ref: v2.1.0          # tag, not 'main'
       file: /jobs/build.yml
   ```

3. **Extract repeated logic with `extends:` and YAML anchors.** If three jobs share 80% of their config, factor the common parts into a hidden job (`.base_build:`) and have the real jobs `extends: .base_build`. Anchors (`&name` / `*name`) are fine for smaller reuse but `extends` composes better and is easier to read.

4. **Use `!reference` for surgical reuse** of specific keys (e.g., pulling a `before_script` from another job) instead of copy-pasting.

5. **Split large pipelines across files** with `include: local:` — one file per concern (`ci/build.yml`, `ci/test.yml`, `ci/deploy.yml`) and a thin root `.gitlab-ci.yml` that stitches them together. Easier to review, easier to own per team.

6. **Parent-child pipelines** (`trigger: include:`) for monorepos where different subtrees have independent pipelines — keeps each child small and focused.

### Every pipeline you write should have

- **Named stages** in a top-level `stages:` block, even if there are only two. Implicit stages are a trap.
- **A `default:` block** for shared `image:`, `tags:`, `interruptible:`, `retry:` — don't repeat these on every job.
- **`rules:` that are readable** — prefer one clear condition per rule entry over clever boolean soup. Comment *why* a rule exists when it's non-obvious.
- **Variables at the right scope.** Pipeline-wide in `variables:`, job-specific inside the job. Secrets via masked/protected CI variables or a secrets manager — never inline.
- **`interruptible: true`** on jobs that are safe to cancel when a newer pipeline starts (almost all build/test jobs). Saves runner minutes.
- **Caching and artifacts with explicit keys and paths.** A `cache: key: $CI_COMMIT_REF_SLUG` beats an unkeyed cache every time.
- **Short, descriptive job names** that read in the pipeline graph: `build:frontend`, `test:unit`, `deploy:staging`.
- **A comment block at the top** explaining what the pipeline does, what it assumes (runner tags, required variables), and where to find the components/includes it depends on.

### Anti-patterns to call out when reviewing

- `script:` blocks longer than ~15 lines — extract into a checked-in shell script under `ci/scripts/` and call it from the job. Shell scripts are testable; embedded YAML isn't.
- Duplicated `before_script:` across many jobs — lift to `default:` or a base job.
- `only/except` in any file the user can edit — migrate to `rules:`.
- Hardcoded image tags like `node:latest` — pin to a specific version.
- `include:` of a moving branch — pin to a tag or SHA.
- Jobs that shell out to `curl` against the GitLab API with a raw token — use `CI_JOB_TOKEN` or a properly scoped CI variable, and prefer `glab` or `python-gitlab` for anything non-trivial.

When the user asks "write me a pipeline for X," your default shape is: root `.gitlab-ci.yml` that includes components (if available) or local files, with clear stages, a `default:` block, and named jobs. If they're asking for a one-off throwaway, say so explicitly — "this is a quick version, here's what you'd change to make it maintainable" — rather than silently shipping tech debt.

## Writing style for responses

- Lead with the version-specific answer, then show the doc URL you grounded it in.
- If a feature was added/removed/renamed across versions, say so explicitly ("Added in 16.0, renamed in 17.3").
- If the user is on Free tier and asks about a Premium feature, tell them up front before walking through it.
- Prefer small, copyable snippets over long prose.

## When this skill should step back

Pure `git` questions (rebase, cherry-pick, merge conflicts) aren't GitLab-specific — handle them normally without fetching GitLab docs. Only engage this skill's doc-fetching discipline when the question actually depends on GitLab's platform behavior.
