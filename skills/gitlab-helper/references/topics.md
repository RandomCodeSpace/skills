# GitLab Docs Topic Map

Quick index from "user question" → "doc page to fetch". Append `?version=<ver>` or use `archives.docs.gitlab.com/<ver>/` for version-pinned reads.

## CI/CD

| Topic | Path |
|---|---|
| `.gitlab-ci.yml` full reference | `ci/yaml/` |
| Predefined CI variables | `ci/variables/predefined_variables/` |
| `rules:` syntax and examples | `ci/yaml/#rules` |
| `needs:` and DAG pipelines | `ci/yaml/#needs` |
| Parent-child & multi-project pipelines | `ci/pipelines/downstream_pipelines/` |
| Merge request pipelines | `ci/pipelines/merge_request_pipelines/` |
| Merge trains (Premium+) | `ci/pipelines/merge_trains/` |
| Caching | `ci/caching/` |
| Artifacts | `ci/jobs/job_artifacts/` |
| Environments & deployments | `ci/environments/` |
| Review apps | `ci/review_apps/` |
| Auto DevOps | `topics/autodevops/` |
| Secrets management | `ci/secrets/` |
| CI/CD components (reusable) | `ci/components/` |
| Includes (`include:`) | `ci/yaml/includes/` |

## Runners

| Topic | Path |
|---|---|
| Runner overview | `ci/runners/` |
| Installing a self-managed runner | `runner/install/` |
| Executors (Docker, Shell, Kubernetes) | `runner/executors/` |
| Runner configuration (`config.toml`) | `runner/configuration/advanced-configuration/` |
| Autoscaling | `runner/configuration/autoscale/` |

## Projects, Groups, MRs, Issues

| Topic | Path |
|---|---|
| Merge request workflow | `user/project/merge_requests/` |
| Approvals | `user/project/merge_requests/approvals/` |
| Protected branches | `user/project/repository/branches/protected/` |
| Issues / epics / iterations | `user/project/issues/`, `user/group/epics/` |
| Labels, milestones | `user/project/labels/` |

## Registry, Pages, Packages

| Topic | Path |
|---|---|
| Container Registry | `user/packages/container_registry/` |
| Package Registry | `user/packages/package_registry/` |
| GitLab Pages | `user/project/pages/` |

## Security & Compliance

| Topic | Path |
|---|---|
| SAST | `user/application_security/sast/` |
| Dependency Scanning | `user/application_security/dependency_scanning/` |
| Secret Detection | `user/application_security/secret_detection/` |
| Container Scanning | `user/application_security/container_scanning/` |
| DAST | `user/application_security/dast/` |
| Security Dashboard (Ultimate) | `user/application_security/security_dashboard/` |
| Compliance pipelines | `user/group/compliance_pipelines/` |

## API

| Topic | Path |
|---|---|
| REST API index | `api/rest/` |
| GraphQL API | `api/graphql/` |
| Pipelines API | `api/pipelines/` |
| Jobs API | `api/jobs/` |
| Projects API | `api/projects/` |
| Merge Requests API | `api/merge_requests/` |

## Administration (self-managed)

| Topic | Path |
|---|---|
| Omnibus configuration | `administration/` |
| Backup & restore | `administration/backup_restore/` |
| Gitaly | `administration/gitaly/` |
| Monitoring (Prometheus) | `administration/monitoring/` |
| Upgrade paths | `update/` |

## Tier notes (common pitfalls)

- **Merge trains, code quality widget, security dashboards, dependency scanning, compliance pipelines** → Premium or Ultimate.
- **Epics, roadmaps, multi-level epics** → Premium/Ultimate.
- **Free tier on gitlab.com** → limited CI/CD minutes on shared runners; check current quotas in `subscriptions/gitlab_com/`.
