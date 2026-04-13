# Automating GitLab via `glab` (official CLI)

`glab` is GitLab's official command-line client. It's Go-based, so it's the preferred automation path whenever Go is available on the system — it tracks platform features closely and has ergonomic commands for the everyday GitLab workflow (MRs, issues, pipelines, releases).

## Install

```bash
# Check first
go version   # need 1.21+
which glab

# Install via Go (puts binary in $(go env GOPATH)/bin)
go install gitlab.com/gitlab-org/cli/cmd/glab@latest

# Make sure it's on PATH
export PATH="$(go env GOPATH)/bin:$PATH"
glab --version
```

Other install options exist (Homebrew, apt, binary release), but when Go is already on the box, `go install` is the fewest moving parts.

## Authenticate

Interactive:

```bash
glab auth login --hostname gitlab.com
# or: glab auth login --hostname gitlab.company.internal
```

It prompts for a personal access token. Recommended scopes: `api`, `read_api`, `read_repository`, `write_repository`. For read-only automation, `read_api` alone is enough.

Non-interactive (CI, scripts):

```bash
export GITLAB_HOST=gitlab.company.internal
export GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
glab mr list
```

Config file: `~/.config/glab-cli/config.yml` — stores per-host tokens, default editor, browser, etc.

Status check: `glab auth status`

## Everyday commands

### Repo context

Most commands run inside a git clone of the project. Outside a clone, pass `-R group/project` (or the full URL).

```bash
glab repo view                      # open current project in browser
glab repo clone group/project
glab repo fork group/project
```

### Merge requests

```bash
glab mr list --state opened --assignee @me
glab mr create --fill                        # MR from current branch → default target
glab mr create --title "feat: x" --description "..." --target-branch main --draft
glab mr view 42 --comments
glab mr diff 42
glab mr checkout 42                          # fetch & checkout the MR branch locally
glab mr approve 42
glab mr merge 42 --squash --remove-source-branch
glab mr close 42
```

### Issues

```bash
glab issue list --label bug --state opened
glab issue create --title "..." --description "..." --label bug
glab issue view 17
glab issue close 17
glab issue note 17 --message "triaged — assigning to backend"
```

### CI / pipelines

```bash
glab ci list                                 # recent pipelines for this project
glab ci view                                 # latest pipeline on current branch (interactive)
glab ci status                                # short status of latest pipeline
glab ci trace <job-id>                       # stream a job's log
glab ci retry <job-id>
glab ci cancel <pipeline-id>
glab ci run --branch main                    # trigger a pipeline
glab ci lint                                 # validate .gitlab-ci.yml against the server
glab ci config compile                        # render includes/extends into one file
```

`glab ci view` is especially good for debugging: arrow keys let you navigate stages and open logs without leaving the terminal.

### Releases, variables, labels

```bash
glab release list
glab release create v1.2.3 --notes "..."
glab variable list
glab variable set DEPLOY_KEY "..." --protected --masked
glab label list
```

### Raw API passthrough

Anything the top-level commands don't cover, you can still reach via:

```bash
glab api projects/:fullpath:/pipelines
glab api -X POST projects/:fullpath:/issues -f title="..." -f description="..."
glab api --paginate groups/mygroup/projects
```

`-f` sends form fields, `-F` sends raw fields (numbers, booleans). `--paginate` walks all pages automatically.

## Safety checklist

- Confirm the active host: `glab auth status`.
- Dry-run read commands (`list`, `view`) before running writes.
- For destructive ops (`mr merge`, `issue close`, `release delete`, `variable delete`), state the target and ask the user to confirm.
- Never log tokens; `glab` won't print them, but don't `echo $GITLAB_TOKEN` in scripts either.

## When to reach for `python-gitlab` instead

- You need a Python library embedded in a larger script (data analysis, pandas, etc.).
- The user's environment has Python but not Go, and installing Go isn't an option.
- You're writing a long-running service that benefits from the SDK's typed objects and iterators.

Otherwise, `glab` is the right default.
