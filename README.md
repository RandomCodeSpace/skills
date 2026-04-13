# RandomCodeSpace Claude Skills

A monorepo of [Claude Code](https://docs.claude.com/claude-code) / Agent SDK skills maintained by RandomCodeSpace, published to Maven Central as one artifact per skill.

## Installed skills

| Skill | Maven coordinates | What it does |
|---|---|---|
| [`gitlab-helper`](skills/gitlab-helper) | `io.github.randomcodespace.ai:gitlab-helper` | GitLab CI/CD, pipelines, runners, and API automation. Version-aware doc grounding + `glab`/`python-gitlab` automation. |

## Using a skill

Each skill is an ordinary Claude Code skill — markdown + optional references / scripts. Two ways to consume it:

**1. Directly from this repo (recommended for development):**
```bash
git clone https://github.com/RandomCodeSpace/skills.git
cp -r skills/skills/gitlab-helper ~/.claude/skills/
```

**2. From Maven Central (recommended for CI/air-gapped distribution):**
```bash
mvn dependency:copy \
  -Dartifact=io.github.randomcodespace.ai:gitlab-helper:0.1.0 \
  -DoutputDirectory=./tmp
unzip -o tmp/gitlab-helper-0.1.0.jar -d ~/.claude/skills/gitlab-helper
```

The `.jar` is just a zip containing `SKILL.md` and the skill's `references/` directory at the root.

## Layout

```
skills-repo/
├── pom.xml                          # parent POM — shared plugin config, release profile
├── skills/
│   └── gitlab-helper/
│       ├── pom.xml                  # module POM (groupId, artifactId, version)
│       ├── SKILL.md                 # the skill itself
│       └── references/              # progressive-disclosure files
├── .github/workflows/publish.yml    # tag-triggered Maven Central release
├── README.md
└── LICENSE
```

## Adding a new skill

1. `mkdir skills/<skill-name>` and drop `SKILL.md` + `references/` inside.
2. Copy `skills/gitlab-helper/pom.xml` and change `artifactId`, `name`, `description`, `url`, `scm`.
3. Add `<module>skills/<skill-name></module>` to the parent `pom.xml`.
4. Commit and open a PR.

## Publishing

Release is driven by git tags:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The `publish.yml` workflow sets the project version to `0.2.0` across all modules, signs artifacts with GPG, and uploads them to Maven Central via the Central Portal.

### Required GitHub Actions secrets

The workflow expects these secrets on the `maven-central` environment (or repo-level):

| Secret | What it is |
|---|---|
| `CENTRAL_USERNAME` | Central Portal user token username (generate at https://central.sonatype.com/account) |
| `CENTRAL_PASSWORD` | Central Portal user token password |
| `GPG_PRIVATE_KEY` | ASCII-armored PGP private key (`gpg --armor --export-secret-keys <key-id>`) whose public half is published on a keyserver Sonatype trusts |
| `GPG_PASSPHRASE` | Passphrase for that key |

> If your existing secret names differ, either rename them or update `.github/workflows/publish.yml` accordingly — the names are in one place.

### Namespace verification

`io.github.randomcodespace.ai` is auto-verifiable on Central Portal because it maps to the `RandomCodeSpace` GitHub organization. First publish: log in to [central.sonatype.com](https://central.sonatype.com), claim the `io.github.randomcodespace` namespace, follow the GitHub verification prompt (create a short-lived public repo with a specific name), then the `.ai` sub-namespace inherits automatically.

## Local dry-run

To validate the build + signing without publishing:

```bash
export GPG_PASSPHRASE=...
mvn -B -Prelease verify
```

You can also trigger the workflow manually with `dry_run: true` from the Actions tab.

## License

MIT — see [LICENSE](LICENSE).
