# Linear tracker

First follow `../shared.md`.

Linear mapping is exact:

| Workflow entity | Linear object | Relationship                                           | Branch                                                                          |
| --------------- | ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Epic            | Project       | configured team                                        | static format, or current Linear workspace template reconstructed for `tracker` |
| Task            | issue         | `project` equals parent Epic Project; never `parentId` | static format, or exact issue `gitBranchName` for `tracker`                     |
| Gig             | issue         | no Epic Project                                        | static format, or exact issue `gitBranchName` for `tracker`                     |

Do not create or apply entity, kind, planning, or execution labels. Kind and work stage remain workflow-only.

## Setup discovery

During `/project-setup`, use `inspect_linear_workspace` to read workspace identity, authenticated viewer Full Name/Username, accessible teams, team issue statuses, Project statuses, and workspace branch template through Linear's public GraphQL API. This operation is read-only and never substitutes for MCP tracker operations. Select exact team/status names without inferring semantics. Follow `../../setup.md` for exact branch-template matching. With `tracker`, Epic initialization repeats only the read-only viewer/workspace branch query so the branch uses current Linear settings.

## Validate before mutation

Call `integration_context` and use only enabled `roles.tracker` provider `linear`. Run returned validation steps: verify workspace, exact configured team, and every configured team issue-status name. Runtime MCP has no Project-status listing capability; use the exact API-discovered or explicitly confirmed configured names and fail clearly when Linear rejects one.

Native priority mapping is fixed: `Urgent=1`, `High=2`, `Medium=3`, `Low=4`, `not set=0`.

## Check existing Backlog or Todo work

Before adding or adopting Linear work, require the approved entity type and exact selected destination (`backlog | todo`).

- Epic: get the explicit Project; require configured team, selected configured Project queue state, and native priority.
- Task: get the explicit issue; require configured team, selected configured issue queue status, priority, exact parent Epic Project ID, and non-empty `gitBranchName`.
- Gig: get the explicit issue; require configured team, selected configured issue queue status, priority, no Epic Project, and non-empty `gitBranchName`.

Present the exact object, title, queue state, Priority, and relationship for approval. Pass Project ID/URL for Epic; issue ID/identifier/URL/`gitBranchName` plus parent Project ID for Task; issue ID/identifier/URL/`gitBranchName` for Gig.

## Initialize

Workflow `init` completes first and records `workStage: planning` with intended lifecycle In Progress.

- Epic: tracker resource `project`; new starts `awaiting`, approved existing starts `bound-pending`. Static formats create the configured branch. With `tracker`, read current `organization.gitBranchFormat` and `viewer.displayName`, reconstruct the supported template with the lowercase workflow Epic ID and normalized slug, and persist a ready tracker-owned branch before Project mutation.
- Task: tracker resource `task-issue`; static formats create a ready branch in the current clone. With `tracker`, new starts `awaiting` with `tracker-pending`; approved existing starts `bound-pending` with its exact ready `gitBranchName`.
- Gig: tracker resource `gig-issue`; same naming behavior as Task, without Project relationship.

For new Epic:

1. `save_project` with title, configured team, In Progress state, native priority, and the exact approved Request from `brief.md`. In versioned mode only, include `Internal ID: <qualified-id>`.
2. Persist Project ID/URL and remaining operations immediately.
3. Re-read Project and set tracker `bound` only after all fields are confirmed.

For new Task/Gig:

1. For Task, inspect the parent Epic tracker. A bound/bound-pending Project identity permits issue creation. Otherwise keep exact awaiting operation `wait for parent Epic Project binding, then create Linear issue`; finish parent projection first. Gig omits Project.
2. `save_issue` with title, configured team, In Progress status, native priority, exact approved Request, and Task `project` when applicable. In versioned mode only, include Internal ID.
3. As soon as issue ID/identifier/URL/Project relation are known, persist `issue-bound-pending` with remaining operation `read generated gitBranchName`. Never leave known identity only in chat.
4. With `tracker` format, `get_issue` obtains exact generated `gitBranchName`; persist complete binding before branch work.
5. Set tracker `bound` after remote fields are confirmed.
6. With `tracker` format, call `finalize_linear_branch` until ready; generated formats are already ready.

Approved Backlog or Todo objects skip creation and retain `bound-pending` for remaining In Progress/native metadata updates. They move directly to In Progress; never force Backlog through Todo.

Linear tracker checkpoints are `awaiting`/`pending` before identity, `issue-bound-pending` after issue identity but before branch identity, `bound-pending` with complete provider identity and remaining updates, and `bound` after projection is confirmed.

## Initialized-create uncertainty

After an uncertain create, read Linear. In versioned mode, search exact qualified Internal ID (`list_projects` for Epic, `list_issues` for Task/Gig). In unversioned mode, search exact title, configured team, and exact Task Project or Gig projectless relationship. Continue when one exact object is confirmed, retry only after confirmed absence, and report ambiguous or inconsistent state. Never project a temporary marker.

## Add to Backlog or Todo

Follow `../../queue.md`. Require the entity type and selected Backlog or Todo destination first; require a bound parent Epic for Task.

- Epic: `save_project` in selected configured Project Backlog or Todo state with team and priority.
- Task: `save_issue` in selected configured issue Backlog or Todo status with team/priority and `project` equal to parent Epic Project.
- Gig: `save_issue` in selected configured issue Backlog or Todo status with team/priority and no Epic Project.

Recover uncertain provider results only through read-back as defined in the shared Queue contract.

## Lifecycle, work stage, and priority

Follow the absolute update/read-back procedure in `../shared.md`, using `save_project` for Epic state/priority and `save_issue` for Task/Gig status/priority. Planning and execution both remain In Progress; `workStage` changes only workflow metadata. Final review uses In Review and confirmed delivery uses Done. Kind transitions do not project labels or type.

## Artifact projection

After accepted `epic.md`/`plan.md` changes or a tracker Links refresh, call `artifactProjection` and follow the complete projection, approval, and verification contract in `../shared.md`. Patch and re-read the bound Epic Project description or bound Task/Gig issue description.
