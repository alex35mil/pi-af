# Linear tracker

First follow `../shared.md`.

Linear mapping is exact:

| Workflow entity | Linear object | Relationship                                           | Branch                                                                          |
| --------------- | ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Epic            | Project       | configured team                                        | static format, or current Linear workspace template reconstructed for `tracker` |
| Task            | issue         | `project` equals parent Epic Project; never `parentId` | static format, or exact issue `gitBranchName` for `tracker`                     |
| Gig             | issue         | no Epic Project                                        | static format, or exact issue `gitBranchName` for `tracker`                     |

Kind remains workflow-only. Project and issue labels project native Phase in both artifact modes through the configured mutually exclusive groups; follow `../../phase.md`. Entity/kind labels are not applied.

## Setup discovery

During `/project-setup`, use `inspect_linear_workspace` to read workspace identity, authenticated viewer Full Name/Username, accessible teams, team issue statuses, Project statuses, and workspace branch template through Linear's public GraphQL API. This operation is read-only and never substitutes for MCP tracker operations. Select exact team/status names without inferring semantics. Follow `../../setup.md` for exact branch-template matching. With `tracker`, Epic initialization repeats only the read-only viewer/workspace branch query so the branch uses current Linear settings.

Read the selected Project/issue label catalog through registered `list_project_labels`/`list_issue_labels`, including groups and required pagination. Require the exact configured group scope and its active Planning, Execution, and Self-Review children. Issue groups require single-select; Project groups are mutually exclusive by Linear's documented contract. Setup stays read-only: ask the user to configure missing or incompatible groups before saving configuration.

## Provider calls

Read the selected role's local configuration through `integration_context`. The agent calls registered Linear tools directly: Project writes for Epic and issue writes for Task/Gig. Named team/state inputs resolve inside the provider. Do not rediscover workspace, teams or all statuses during ordinary work. A denied/unavailable provider call stops that operation without changing the other role.

Native priority mapping is fixed: `Urgent=1`, `High=2`, `Medium=3`, `Low=4`, `not set=0`.

## Queue intake and explicit adoption

Require the approved entity type and exact selected destination (`backlog | todo`). Create approved new Linear queue work directly without searching for an existing object.

For explicit adoption, read the selected object:

- Epic: get the explicit Project; require configured team, selected configured Project queue state, and native priority.
- Task: get the explicit issue; require configured team, selected configured issue queue status, Priority, and exact parent Epic Project ID.
- Gig: get the explicit issue; require configured team, selected configured issue queue status, Priority, and no Epic Project.

Before initialization, follow the shared discussion-reading requirement: call registered `list_comments` with the selected Project UUID as `projectId` for an Epic or the selected issue UUID as `issueId` for a Task/Gig. Read all discussion pages, following returned cursors until `hasNextPage: false`, including the returned discussion threads and inline comments. Reconcile material maintainer clarifications before adopting the request; contributor comments do not authorize scope changes.

Use `adopt` with the selected entity. Follow the explicit-selection approval in `../../artifacts.md`: reuse the selected object's title or name and description, copied Priority, and verified relationship without another intake confirmation. Ask only for missing or conflicting information; Task/Gig Kind remains workflow-only and requires a user choice when not already supplied. Deployed responses expose immutable identity as `uuid`; issue `id` is the identifier. Pass Project UUID/URL for Epic; issue UUID/identifier/URL and Task parent Project UUID for issues. With tracker naming only, reuse the returned exact `gitBranchName`, or fetch that exact issue when this required name is absent. Generated naming never requests or stores an unused provider branch.

## Initialize

Workflow `init` completes first and records `phase: planning` with intended lifecycle In Progress.

- Epic: tracker resource `project`; new starts `awaiting`, approved existing starts `bound-pending`. Static formats create the configured branch. With `tracker`, read current `organization.gitBranchFormat` and `viewer.displayName`, reconstruct the supported template with the lowercase workflow Epic ID and normalized slug, and persist a ready tracker-owned branch before Project mutation.
- Task: tracker resource `task-issue`; generated formats are ready immediately. Tracker naming retains `tracker-pending` until a name is obtained; an adopted returned name is saved as `tracker-named` before local branch creation.
- Gig: tracker resource `gig-issue`; same issue-branch behavior without Project relationship.

For new work:

1. Request `initialize` for this entity. A Task requires its identified parent Epic Project; otherwise preserve the awaiting operation and finish parent binding first. A Gig remains projectless.
2. Prepare the exact title/Request, native In Progress/Priority, configured team, Task Project when applicable, without adding a workflow ID to the description. Resolve and validate the configured Phase group through `../../phase.md`; include its Planning child in new-work labels. For existing objects read and preserve the complete applied label set, replacing only managed Phase children. Call local `resource_ids` `beginCreation`, role `tracker`, before the first registered `save_project`/`save_issue`. Do not search before the first approved create or perform blanket discovery.
3. On clear success, call local `recordCreation` with actual tool/arguments/response. Save the returned immutable UUID and Task parent relationship durably before dependent work; URL/identifier go into scoped local cache. Reuse state/Priority/relationship proof supplied by the mutation; read only required missing facts. Do not read merely to repopulate returned values.
4. Only with tracker-controlled issue naming, save a returned name in `tracker-named`; fetch the exact issue only when the name is missing, then save it there. Never duplicate it in tracker records or put it in disposable cache. `finalize_linear_branch` checkpoints the start commit and preserves existing collision/interruption checks through provisioning to immutable ready.
5. Call `confirm_tracker_initialization` with the observed outcomes under `../shared.md`. Missing evidence keeps initialization pending; the tool preserves branch provisioning. Generated names need no provider branch step.

Approved Backlog/Todo objects skip creation, keep their UUID/relationship, and apply only remaining initialization changes directly to In Progress. Adoption seeds supplied Resource IDs locally. Provider records contain semantic identity plus pending operations, not branch copies or cached lifecycle/Priority.

## Initialized-create uncertainty

After an uncertain create, read Linear. In both artifact modes, search exact approved title/name, configured team, and exact Task Project or Gig projectless relationship. Continue when one exact object is confirmed, retry only after confirmed absence, and report ambiguous or inconsistent state. Never project a temporary marker.

## Add to Backlog or Todo

Follow `../../queue.md`. Require the entity type and selected Backlog or Todo destination first; require a bound parent Epic for Task.

- Epic: `save_project` in selected configured Project Backlog or Todo state with team and priority.
- Task: `save_issue` in selected configured issue Backlog or Todo status with team/priority and `project` equal to parent Epic Project.
- Gig: `save_issue` in selected configured issue Backlog or Todo status with team/priority and no Epic Project.

Recover uncertain provider results only through read-back as defined in the shared Queue contract.

## Lifecycle, Phase, and priority

Read fresh lifecycle/Priority and the complete applied label set on resume by the durable UUID. Use `trackerMutation` for the selected lifecycle or Priority assignment and follow shared absolute-value outcome/recovery rules, with `save_project` for Epic and `save_issue` for Task/Gig. Planning, Execution, and Self-Review all remain In Progress. In Review starts only after external submission; confirmed delivery uses Done and canceled work uses the configured Canceled status. Kind transitions do not project labels or type.

Reconcile Phase through `../../phase.md`: use Project-label metadata for Epic and issue-label metadata for Task/Gig. Supply complete fresh catalog/applied-label facts to the applicable operation there. Apply its entire returned label-ID set through `save_project`/`save_issue` only when changed. Remove only managed Phase-group labels, preserve every unrelated label, and clear managed Phase outside In Progress. Never send just the desired Phase child as a replacement for the full set. Required missing outcome facts and uncertain writes use the existing read-back recovery boundary; no lifecycle or label snapshots become durable cache state.

## Artifact projection

After accepted `epic.md`/`plan.md` changes, call tracker-only `artifactProjection` and `tracker_publication prepare` with the complete approved source. Preserve the original issue/Project title/name and description. The first publication creates one document titled Plan, attached by exact Project UUID for an Epic or exact issue UUID for a Task/Gig. Use only the returned registered `save_document` call and record clear-success creation evidence. Pending creation requires recovery, never another create. Published documents require the returned exact `get_document` and parent reads, followed by `tracker_publication prepareUpdate` with complete source and actual `document`/`parent` evidence. The native parent reference may use a display identifier; the exact parent read must prove its mapping to the stored UUID. Execute the resulting complete-content update by saved document ID only; omit title and parent arguments so publication never renames or reparents the document. Missing, moved, archived or conflicting documents stop for maintainer direction.

Follow `../shared.md` for recovery: supply exact parent evidence, complete cursor-paginated `list_documents` evidence, and full `get_document` evidence for every matching-parent candidate requested by the tool. List/create content is truncated; it is not proof that the marker is absent. An issue has no native listing filter: complete the accessible document scan rather than inventing an issue filter or substituting its parent Project. After successful updates, trust clear success without routine confirmation reads. Uncertain updates require the exact full saved-document read and reconciliation before retrying confirmed non-application.

The [public API documentation](https://linear.app/developers/graphql#adding-collapsible-sections-in-markdown) explicitly supports native collapsible sections in documents. Live document UI rendering must be verified separately; local Markdown tests do not prove it. The native document title supplies Plan; content keeps the overview prose, Highlights and collapsed Full plan. Local source artifacts remain unchanged and authoritative.
