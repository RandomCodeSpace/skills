# Automating GitLab via `python-gitlab`

`python-gitlab` is the community-maintained Python SDK + CLI for the GitLab REST API. Unlike `glab` (Go-based, not on PyPI), it's installable with pip and is the right choice when the user wants Python-driven automation.

## Install

```bash
pip install --user python-gitlab
# or in a venv
python -m venv .venv && source .venv/bin/activate && pip install python-gitlab
```

Verify: `gitlab --version`

## Configure

File: `~/.python-gitlab.cfg`

```ini
[global]
default = main
ssl_verify = true
timeout = 10

[main]
url = https://gitlab.com
private_token = glpat-xxxxxxxxxxxxxxxxxxxx
api_version = 4

[work]
url = https://gitlab.company.internal
private_token = glpat-yyyyyyyyyyyyyyyyyyyy
ssl_verify = /etc/ssl/certs/company-ca.pem
```

Switch instances with `--gitlab work` or env var `PYTHON_GITLAB_NAME=work`.

**Token scopes:** use `read_api` for read-only automation, `api` for writes. Generate at `<instance>/-/user_settings/personal_access_tokens`.

If `~/.python-gitlab.cfg` doesn't exist, the CLI also reads:
- `GITLAB_URL` / `GITLAB_PRIVATE_TOKEN` env vars (via `--gitlab-url` and `--private-token` flags, or set in shell).

## CLI basics

```bash
# list your projects
gitlab project list --owned true --per-page 100

# get a project by path (URL-encoded)
gitlab project get --id group%2Fsubgroup%2Fproject

# list opened MRs on a project
gitlab project-merge-request list --project-id 123 --state opened

# see failed pipelines
gitlab project-pipeline list --project-id 123 --status failed --per-page 20

# drill into a pipeline's jobs
gitlab project-pipeline-job list --project-id 123 --pipeline-id 9876

# fetch a job's trace (log) — useful for debugging failures
gitlab -o json project-job trace --project-id 123 --id 555666

# create an issue
gitlab project-issue create --project-id 123 --title "Bug: X" --description "Repro steps..."

# trigger a new pipeline on a branch
gitlab project-pipeline create --project-id 123 --ref main

# retry a failed job
gitlab project-job retry --project-id 123 --id 555666
```

Output formats: `-o json`, `-o yaml`, default is a human table. Use `-o json | jq ...` for scripting.

## Python SDK (when the CLI isn't enough)

```python
import gitlab

gl = gitlab.Gitlab.from_config("main")  # reads ~/.python-gitlab.cfg
gl.auth()  # optional; validates the token

project = gl.projects.get("group/subgroup/project")

# all failed pipelines in the last 7 days
from datetime import datetime, timedelta, timezone
since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
failed = project.pipelines.list(status="failed", updated_after=since, iterator=True)
for p in failed:
    print(p.id, p.ref, p.web_url)

# open an MR
mr = project.mergerequests.create({
    "source_branch": "feature/x",
    "target_branch": "main",
    "title": "Draft: feature X",
    "description": "...",
    "remove_source_branch": True,
})
```

Use `iterator=True` for large lists — it handles pagination lazily.

## CI lint

```bash
gitlab project-lint create --project-id 123 --content "$(cat .gitlab-ci.yml)"
```

(Older versions may expose this differently; fall back to the REST endpoint `POST /projects/:id/ci/lint` if the CLI verb is missing on the target version.)

## Safety checklist before writes

- Confirm you're targeting the right instance (`--gitlab <section>`).
- Dry-run with `-o json` and a `list`/`get` first to make sure IDs are right.
- For destructive ops (delete branch, close MR, delete pipeline), tell the user exactly what will happen and ask for confirmation.
- Never print the token to logs. `gitlab` CLI won't by default; your scripts shouldn't either.

## Common gotchas

- **Project IDs vs. paths:** the CLI accepts both, but paths must be URL-encoded (`group%2Fproject`).
- **Rate limits:** gitlab.com enforces API rate limits (check response headers `RateLimit-Remaining`). For bulk ops, sleep between calls or use `iterator=True` which paginates conservatively.
- **Self-signed certs:** set `ssl_verify = /path/to/ca.pem` in the config section.
- **Pagination defaults:** list calls return 20 items by default. Pass `--per-page 100` or use `--all` (SDK: `all=True`, but prefer `iterator=True` for memory).
- **Version skew:** some endpoints (e.g., new CI component APIs) require recent GitLab versions — if a call 404s, check the user's version against the doc page for that endpoint.
