# Fork-only automatic Project intake

Project setup can render `.github/workflows/incoming-pr-project.yml`, which automatically adds open fork PRs to the configured GitHub Project.

- Contributors don't use pi-af or update board fields.
- The workflow is optional, and setup doesn't deploy it. The setup steps are in [incoming PR intake](../setup/incoming-pr-intake.md).

## Scope

| PR or event | Behavior |
| --- | --- |
| Opened or reopened PR whose verified head repository differs from the configured base repository | Add that PR to the configured Project. |
| Same-repository PR, including a Deliverable or manual branch | No automatic addition. |
| PR already in the Project | Reuse its membership; never write Status or any other field. |
| Closed PR, wrong repository, or unavailable identity | No addition; invalid identity or access is reported, never guessed. |

**Status and repeats:**

- The Project's native Status default puts new items in the configured Backlog option.
- `addProjectV2ItemById` returns the existing item ID on a repeat, and the workflow has no field-update mutation. Rerunning or reopening never resets an In Review, Done, or Canceled card.

**What it doesn't do:**

- Existing PRs aren't backfilled. Explicit `/pr` intake handles other or missing PRs under its own approval and membership checks, and ordinary resume keeps existing progress.
- Review, shipping, and cancellation state stays with the maintainer, never inferred from contributor activity.

## Setup and activation

1. **Enable.** Select the GitHub forge and Project configuration, then explicitly enable fork-only intake. Don't use a native all-PR auto-add filter; it would also catch same-repository Deliverable PRs.
2. **Credential.** Supply only an Actions secret name with access to the exact Project and the required PR metadata.
   - `GITHUB_TOKEN` is repository-scoped, and Git SSH access doesn't grant Project API access.
   - Setup never reads or copies token values or configures secrets.
3. **Render.** Call `render_incoming_pr_intake` with `forge`, `tracker`, and `tokenSecret`. Review its exact file candidate and prerequisites, and keep existing and unrelated files. Declining changes nothing, including an already-existing workflow.
4. **Confirm prerequisites** in GitHub:
   - the configured Status field's native Backlog default, in Project Settings;
   - the selected secret and its access;
   - the applicable event policy;
   - any overlapping auto-add or Status rules.

   Only explicitly approved changes to provider settings are allowed.
5. **Deploy** the reviewed file through the repository's normal default-branch process. Setup doesn't stage, commit, push, run a workflow, or create a probe PR. Report local preparation separately from confirmed deployment and activation.

Missing access, a blocked event policy, or an unconfirmed default is a visible prerequisite. It's never a reason to widen credentials, weaken policy, use another client, or claim the automation works.

## Security boundary

**What the workflow does:**

- The `pull_request_target` opened and reopened workflow definition comes from the trusted base or default branch.
- It validates the current PR and configured repository, then performs static metadata and API operations through a full-commit-pinned trusted action.

**What it never uses:**

- source checkout or Git transport;
- contribution scripts or configuration;
- installs, builds, tests, artifacts, or caches.

PR titles, bodies, and branch names are never interpolated into code.

**Requirements:**

- This privileged event needs an applicable GitHub event policy and a dedicated, least-privilege Project-capable secret.
- Never enable unsafe PR checkout or change event policies automatically.
- Hosted automation is configured independently; it isn't a fallback for denied agent MCP calls.

**Sources:** [Project API and idempotent addition](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects), [native field defaults](https://github.blog/changelog/2026-04-09-release-info-in-issue-sidebar-and-project-defaults/), [secure event use](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).
