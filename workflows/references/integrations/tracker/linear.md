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

## Provider calls

Read the selected role's local configuration through `integration_context`. The agent calls registered Linear tools directly: Project writes for Epic and issue writes for Task/Gig. Named team/state inputs resolve inside the provider. Do not rediscover workspace, teams or all statuses during ordinary work. A denied/unavailable provider call stops that operation without changing the other role.

Native priority mapping is fixed: `Urgent=1`, `High=2`, `Medium=3`, `Low=4`, `not set=0`.

## Queue intake and explicit adoption

Require the approved entity type and exact selected destination (`backlog | todo`). Create approved new Linear queue work directly without searching for an existing object.

For explicit adoption, read the selected object:

- Epic: get the explicit Project; require configured team, selected configured Project queue state, and native priority.
- Task: get the explicit issue; require configured team, selected configured issue queue status, Priority, and exact parent Epic Project ID.
- Gig: get the explicit issue; require configured team, selected configured issue queue status, Priority, and no Epic Project.

Use `adopt` with the selected entity. Present the synthesized Request, copied Priority, and exact relationship for approval. Deployed responses expose immutable identity as `uuid`; issue `id` is the identifier. Pass Project UUID/URL for Epic; issue UUID/identifier/URL and Task parent Project UUID for issues. With tracker naming only, reuse the returned exact `gitBranchName`, or fetch that exact issue when this required name is absent. Generated naming never requests or stores an unused provider branch.

## Initialize

Workflow `init` completes first and records `workStage: planning` with intended lifecycle In Progress.

- Epic: tracker resource `project`; new starts `awaiting`, approved existing starts `bound-pending`. Static formats create the configured branch. With `tracker`, read current `organization.gitBranchFormat` and `viewer.displayName`, reconstruct the supported template with the lowercase workflow Epic ID and normalized slug, and persist a ready tracker-owned branch before Project mutation.
- Task: tracker resource `task-issue`; generated formats are ready immediately. Tracker naming retains `tracker-pending` until a name is obtained; an adopted returned name is saved as `tracker-named` before local branch creation.
- Gig: tracker resource `gig-issue`; same issue-branch behavior without Project relationship.

For new work:

1. Request `initialize` for this entity. A Task requires its identified parent Epic Project; otherwise preserve the awaiting operation and finish parent binding first. A Gig remains projectless.
2. Prepare the exact title/Request, native In Progress/Priority, configured team, Task Project when applicable, and versioned Internal ID. Call local `resource_ids` `beginCreation`, role `tracker`, before the first registered `save_project`/`save_issue`. Do not search before the first approved create or perform blanket discovery.
3. On clear success, call local `recordCreation` with actual tool/arguments/response. Save the returned immutable UUID and Task parent relationship durably before dependent work; URL/identifier go into scoped local cache. Reuse state/Priority/relationship proof supplied by the mutation; read only required missing facts. Do not read merely to repopulate returned values.
4. Only with tracker-controlled issue naming, save a returned name in `tracker-named`; fetch the exact issue only when the name is missing, then save it there. Never duplicate it in tracker records or put it in disposable cache. `finalize_linear_branch` checkpoints the start commit and preserves existing collision/interruption checks through provisioning to immutable ready.
5. Keep remaining initialization operations and desired lifecycle/Priority until their required outcome is confirmed, then set `bound` and remove `authority.desired`. Generated names need no provider branch step.

Approved Backlog/Todo objects skip creation, keep their UUID/relationship, and apply only remaining initialization changes directly to In Progress. Adoption seeds supplied Resource IDs locally. Provider records contain semantic identity plus pending operations, not branch copies or cached lifecycle/Priority.

## Initialized-create uncertainty

After an uncertain create, read Linear. In versioned mode, search exact qualified Internal ID (`list_projects` for Epic, `list_issues` for Task/Gig). In unversioned mode, search exact title, configured team, and exact Task Project or Gig projectless relationship. Continue when one exact object is confirmed, retry only after confirmed absence, and report ambiguous or inconsistent state. Never project a temporary marker.

## Add to Backlog or Todo

Follow `../../queue.md`. Require the entity type and selected Backlog or Todo destination first; require a bound parent Epic for Task.

- Epic: `save_project` in selected configured Project Backlog or Todo state with team and priority.
- Task: `save_issue` in selected configured issue Backlog or Todo status with team/priority and `project` equal to parent Epic Project.
- Gig: `save_issue` in selected configured issue Backlog or Todo status with team/priority and no Epic Project.

Recover uncertain provider results only through read-back as defined in the shared Queue contract.

## Lifecycle, work stage, and priority

Read fresh lifecycle/Priority on resume by the durable UUID. Use `trackerMutation` for the selected lifecycle or Priority assignment and follow shared absolute-value outcome/recovery rules, with `save_project` for Epic and `save_issue` for Task/Gig. Planning and execution both remain In Progress; `workStage` changes only workflow metadata. Final review uses In Review, confirmed delivery uses Done, and canceled work uses the configured Canceled status. Kind transitions do not project labels or type.

## Artifact projection

After accepted `epic.md`/`plan.md` changes, call `artifactProjection`, render the provider body, and follow the complete-body publishing contract in `../shared.md`. Save the complete description directly by the bound Epic Project ID or Task/Gig issue ID. Call `save_project` or `save_issue` directly with that ID and complete description. Recover an uncertain outcome through an exact resource read before retrying.
