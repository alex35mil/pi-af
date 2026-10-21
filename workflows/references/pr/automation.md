# Fork-only automatic Project intake

Project Setup can render `.github/workflows/incoming-pr-project.yml` for automatic membership of open fork PRs in the configured GitHub Project. Contributors do not use pi-af or update board fields. The workflow is optional and is not deployed by setup.

## Scope

| PR/event                                                                                         | Behavior                                                              |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Opened/reopened PR with a verified head repository different from the configured base repository | Add that actual PR to the exact configured Project.                   |
| Same-repository PR, including a Deliverable or manual branch                                     | No automatic addition.                                                |
| PR already in the Project                                                                        | Reuse its membership; never write Status or other fields.             |
| Closed PR, wrong repository or unavailable identity                                              | No addition; invalid identity/access is reported rather than guessed. |

The Project's native Status default initializes newly added items to the configured Backlog option. `addProjectV2ItemById` returns an existing item ID on repeat, and this workflow has no field-update mutation. Rerunning or reopening therefore does not reset an existing In Review, Done or Canceled card.

Existing PRs are not bulk-backfilled. Explicit `/pr` intake handles other or missing PRs under its own approval and membership checks; ordinary resume preserves existing progress. Review/ship/cancel state remains maintainer-controlled, not inferred from contributor activity.

## Setup and activation

1. Select the GitHub forge and Project configuration, then explicitly enable fork-only intake. Do not use a native all-PR auto-add filter: it also includes same-repository Deliverable PRs.
2. Supply only an Actions secret name with access to the exact Project and required PR metadata. `GITHUB_TOKEN` is repository-scoped, and Git SSH access does not grant Project API access. Setup never reads/copies token values or configures secrets.
3. Call `render_incoming_pr_intake` with `forge`, `tracker` and `tokenSecret`. Review its exact local file candidate and prerequisites; preserve existing/unrelated files. Declining changes nothing, including an already-existing workflow.
4. Confirm the configured Status field's native Backlog default in Project Settings, the selected secret/access, applicable event policy and any overlapping auto-add/Status rules. Only explicitly approved changes to provider settings are permitted.
5. Deploy the reviewed file through the repository's normal default-branch process. Setup does not stage, commit, push, run a workflow or create a probe PR. Report local preparation separately from confirmed deployment/activation.

Missing access, a blocked event policy or an unconfirmed default is a visible prerequisite, not permission to widen credentials, weaken policy, invoke another client or claim successful automation.

## Security boundary

The `pull_request_target` opened/reopened workflow definition comes from the trusted base/default branch. It validates the current PR and configured repository, then performs static metadata/API operations through a full-commit-pinned trusted action. No source checkout, Git transport, contribution scripts/configuration, installs, builds, tests, artifacts or caches are used. PR titles, bodies and branch names are not interpolated into code.

This privileged event needs an applicable GitHub event policy and a dedicated, least-privilege Project-capable secret. Do not enable unsafe PR checkout or change event policies automatically. Hosted automation is independently configured; it is not a fallback for denied agent MCP calls.

Sources: [Project API and idempotent addition](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects), [native field defaults](https://github.blog/changelog/2026-04-09-release-info-in-issue-sidebar-and-project-defaults/), [secure event use](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).
