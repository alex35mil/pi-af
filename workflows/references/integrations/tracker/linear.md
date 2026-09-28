# Linear tracker

First follow `../shared.md`.

Linear mapping is exact:

| Workflow entity | Linear object | Relationship                                           | Branch                                                                          |
| --------------- | ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Epic            | Project       | configured team                                        | static format, or current Linear workspace template reconstructed for `tracker` |
| Task            | issue         | `project` equals parent Epic Project; never `parentId` | same static format, or exact issue `gitBranchName` for `tracker`                |
| Gig             | issue         | no Epic Project                                        | same static format, or exact issue `gitBranchName` for `tracker`                |

Do not create/apply entity or kind labels. Kind remains workflow-only.

## Setup discovery

During `/project-setup`, use `inspect_linear_workspace` to read workspace identity, authenticated viewer Full Name/Username, accessible teams, team issue statuses, Project statuses, and the workspace branch template through Linear's public GraphQL API. This operation is read-only and never substitutes for MCP tracker operations. Select exact team/status names from its result without inferring lifecycle semantics. Follow `../../setup.md` for exact branch-template matching. With `tracker`, Epic initialization repeats only the read-only viewer/workspace branch query so the branch uses current Linear settings.

## Validate before mutation

Call `integration_context` and use only enabled `roles.tracker` provider `linear`. Run returned validation steps: verify workspace, exact configured team, and every configured team issue-status name. Runtime MCP has no Project-status listing capability; use the exact API-discovered or explicitly confirmed configured names and fail clearly when Linear rejects one.

Native priority mapping is fixed: `Urgent=1`, `High=2`, `Medium=3`, `Low=4`, `not set=0`.

## Existing backlog preflight

Linear backlog intake and adoption require approved entity type.

- Epic: get the explicit Project; require configured team, configured Project Backlog state, and native priority.
- Task: get the explicit issue; require configured team/status/priority, exact parent Epic Project ID, and non-empty `gitBranchName`.
- Gig: get the explicit issue; require configured team/status/priority, no Epic Project, and non-empty `gitBranchName`.

Present exact object/title/Priority/relationship for approval. Pass Project ID/URL for Epic; issue ID/identifier/URL/`gitBranchName` plus parent Project ID for Task; issue ID/identifier/URL/`gitBranchName` for Gig.

## Initialize

Workflow `init` completes first.

- Epic: tracker record resource `project`; new starts `awaiting`, approved existing starts `bound-pending`. Static formats create the configured branch. With `tracker`, read current `organization.gitBranchFormat` and `viewer.displayName`, reconstruct the supported template with the lowercase workflow Epic ID and normalized slug, and persist a ready tracker-owned branch before Project mutation.
- Task: tracker resource `task-issue`; static formats create a ready branch in the current clone. With `tracker`, new starts `awaiting` with `tracker-pending`; approved existing starts `bound-pending` with its exact ready `gitBranchName`.
- Gig: tracker resource `gig-issue`; same naming behavior as Task, without Project relationship.

For new Epic:

1. `save_project` with title, configured team, Planning state, native priority, and the exact approved Request from `brief.md`. In versioned mode only, include `Internal ID: <qualified-id>`.
2. Persist Project ID/URL and remaining operations immediately.
3. Re-read Project and set tracker `bound` only after all fields are confirmed.

For new Task/Gig:

1. For Task, inspect the parent Epic tracker. A bound/bound-pending Project identity permits issue creation. Otherwise keep the Task initialized in workflow artifacts with exact awaiting operation `wait for parent Epic Project binding, then create Linear issue`; finish the parent projection first. Gig omits Project.
2. `save_issue` with title, configured team, Planning status, native priority, the exact approved Request from `brief.md`, and Task `project` when applicable. In versioned mode only, include Internal ID.
3. As soon as issue ID/identifier/URL/Project relation are known, persist `issue-bound-pending` with remaining operation `read generated gitBranchName`. Never leave known identity only in chat.
4. With `tracker` format, `get_issue` to obtain exact generated `gitBranchName`; persist the complete binding before branch work. Generated formats do not wait for this field.
5. Set tracker `bound` after remote fields are confirmed.
6. With `tracker` format, call `finalize_linear_branch` until ready; generated formats are already ready.

Approved existing objects skip creation and retain `bound-pending` for remaining Planning/native metadata updates; versioned mode also embeds Internal ID.

Linear tracker checkpoints are `awaiting`/`pending` before identity, `issue-bound-pending` after issue identity but before branch identity, `bound-pending` with complete provider identity and remaining updates, and `bound` after projection is confirmed.

## Initialized-create uncertainty

In versioned mode, search exact qualified Internal ID before retrying (`list_projects` for Epic, `list_issues` for Task/Gig). In unversioned mode, filter recent exact-title candidates by configured team and exact Task Project/Gig projectless relationship, then require user confirmation before selection or recreation. Never project a temporary workflow marker.

## ID-less backlog

Backlog creates no workflow ID/artifact/retry queue. Require entity type first; require parent Epic for Task.

- Epic: `save_project` in configured Project Backlog state/team/priority.
- Task: `save_issue` in configured issue Backlog status/team/priority with `project` equal to parent Epic Project.
- Gig: `save_issue` in configured issue Backlog status/team/priority with no Epic Project.

Unknown outcome must reconcile before recreate:

- Epic: recent exact-title Projects in configured team;
- Task: recent exact-title issues in configured team and exact parent Project;
- Gig: recent exact-title issues in configured team, then inspect candidates and retain only projectless issues.

Pass listed candidates to `reconcile_linear_backlog` with exact entity/title/team and Task parent Project. Present its filtered candidates and outcome. User confirmation is required before selecting or recreating for zero, one, or multiple matches. Once identity is known, retry only remaining updates.

## Lifecycle and priority

Follow the absolute update/read-back procedure in `../shared.md`, using `save_project` for Epic Project state/priority and `save_issue` for Task/Gig issue status/priority. Kind transitions do not project labels or type.

## Artifact projection

After accepted `epic.md`/`plan.md` changes or a tracker Links refresh, call `artifactProjection` and follow the complete projection, approval, and verification contract in `../shared.md`. Patch and re-read the bound Epic's Project description or the bound Task/Gig's issue description.
