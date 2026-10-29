# Linear tracker

This procedure extends [integration roles](../shared.md).

| Workflow entity | Linear object | Relationship | Branch |
| --- | --- | --- | --- |
| Epic | Project | configured team | static format; with `tracker`, the Epic's dated name |
| Task | issue | `project` equals the parent Epic's Project; never `parentId` | static format, or the issue's exact `gitBranchName` for `tracker` |
| Gig | issue | no Epic Project | static format, or the issue's exact `gitBranchName` for `tracker` |

- Kind is workflow-only; Linear gets no entity or kind labels.
- Project and issue labels carry native Phase through the configured mutually exclusive groups. When reconciling Phase, read [Phase](../../phase.md).
- Native Priority is fixed: `Urgent=1`, `High=2`, `Medium=3`, `Low=4`, `not set=0`.

## Setup discovery

**Workspace:**

- During `/project-setup`, `inspect_linear_workspace` reads the workspace identity, the viewer's name and username, teams, and issue and Project statuses through Linear's public GraphQL API. It's read-only and never replaces MCP tracker operations.
- Select exact team and status names; don't infer meaning from them. For branch naming, read [setup](../../setup.md#linear-tracker).

**Phase labels:**

- Read the Project and issue label catalogs with registered `list_project_labels` and `list_issue_labels`, including groups and full pagination.
- Require the configured group scope with active Planning, Execution, and Self-Review children. Issue groups must be single-select; Project groups are mutually exclusive by Linear's contract.
- Setup is read-only: ask the user to fix missing or incompatible groups before saving configuration.

## Provider calls

- Read configuration through the context tools, then call registered Linear tools directly: Project writes for Epics and issue writes for Tasks and Gigs. Named team and state inputs resolve inside the provider.
- Don't rediscover the workspace, teams, or all statuses during ordinary work.
- A denied or unavailable call stops that operation without affecting the other role.

## Queue intake and explicit adoption

New queue work needs the approved entity type and destination (`backlog` or `todo`). Create it directly, without searching first.

**Adoption.** Read the selected object and require:

| Entity | Read | Requirements |
| --- | --- | --- |
| Epic | the Project | configured team, a configured Project queue state, native Priority |
| Task | the issue | configured team, a configured issue queue status, Priority, the parent Epic's exact Project ID |
| Gig | the issue | configured team, a configured issue queue status, Priority, no Epic Project |

1. **Read the discussion.** Call registered `list_comments` with the Project UUID as `projectId` for an Epic, or the issue UUID as `issueId` for a Task or Gig. Follow cursors until `hasNextPage: false`, including threads and inline comments. Reconcile material maintainer clarifications before adopting; contributor comments don't authorize scope changes.
2. **Adopt.** Call `inspect_adoption`, then `init_linear_epic`, `init_linear_task`, or `init_linear_gig`.
   - Under the explicit-selection approval in [artifacts](../../artifacts.md#initialization-inputs), reuse the title or name, description, Priority, and relationship without another confirmation.
   - Ask only for missing or conflicting information. A Task's Kind comes from its plan section; a Gig's Kind needs a user choice when it isn't supplied.
3. **Identity.** Responses expose the immutable identity as `uuid`; an issue's `id` is its display identifier. Pass as `object`:
   - for an Epic, the Project UUID, URL, and creation time, which dates the Epic's name;
   - for a Task or Gig, the issue UUID, identifier, URL, and, for a Task, the parent Project UUID.
4. **Branch name.** Only with tracker naming, include the issue's `gitBranchName`, fetching the issue when it's missing.

## Initialize

Follow [initialize from the tracker object](../shared.md#initialize-from-the-tracker-object). A Linear Epic's name depends on the Project's creation date, so initialization, not preflight, catches its rare name collision.

**Create new work** (after preflight): one registered `save_project` (Epic) or `save_issue` (Task, Gig). Don't search or discover first. Include:

- the approved title and Request;
- native In Progress and Priority, the configured team, and the Task's parent Epic Project;
- the Planning label from the configured Phase group.

Pass the returned UUID, identifier, URL, and, with tracker naming, `gitBranchName` to `init_linear_<entity>` as `object`. For an Epic, pass the Project UUID, URL, and `createdAt`; when the create response lacks `createdAt`, read the Project.

**Board setup** (after initialization): for adopted objects, move to In Progress and apply Planning, reading and keeping the full applied label set and replacing only managed Phase labels. Reuse state, Priority, and relationship proof from the create response; read only missing required facts.

Tracker records hold the object's identity, never branch copies or cached lifecycle or Priority.

When a create result is uncertain, read [recovery](../recovery.md#uncertain-tracker-creation).

## Add to Backlog or Todo

Queue intake follows [queue](../../queue.md). Require the entity type and the selected destination first. Tasks are never queued.

| Entity | Call |
| --- | --- |
| Epic | `save_project` in the selected Project Backlog or Todo state, with team and Priority |
| Gig | `save_issue` in the selected issue Backlog or Todo status, with team and Priority, and no Epic Project |

## Lifecycle, Phase, and Priority

**Lifecycle and Priority:**

- On resume, read fresh lifecycle, Priority, and the complete applied label set by UUID.
- Use `prepare_tracker_mutation` for one lifecycle or Priority change, applied with `save_project` (Epic) or `save_issue` (Task, Gig).
- Planning, Execution, and Self-Review all stay In Progress. In Review starts only after external submission; confirmed delivery is Done, and canceled work uses the configured Canceled status. Kind changes project nothing.

**Phase:**

- Use Project-label metadata for Epics and issue-label metadata for Tasks and Gigs, with the full fresh catalog and applied set ([Phase](../../phase.md#fresh-native-facts)).
- Apply the returned full label-ID set only when it changed. Remove only managed Phase labels, keep every unrelated label, and clear managed Phase outside In Progress.
- Never send only the Phase label as a replacement for the full set. No lifecycle or label snapshot becomes durable cache state.

## Artifact projection

1. **Prepare.** After an accepted `epic.md` or `plan.md` change, call `prepare_integration_projection`, then `prepare_tracker_publication` with the full source. The Project or issue keeps its original title or name and description.
2. **First publication** creates one document titled Plan, attached by Project UUID for an Epic or issue UUID for a Task or Gig.
   - Run only the returned `save_document`, immediately, and record clear success with `record_tracker_publication`.
   - A pending creation needs recovery, never a create of your own.
3. **Updates to a published document:**
   - Run the returned `get_document` and parent reads, then call `prepare_tracker_publication_update` with the full source and those reads. The parent read must prove that its display identifier maps to the stored UUID.
   - Every update also posts an [announcement](../shared.md#plan-update-announcements) with `save_comment`: a Project comment for an Epic, an issue comment for a Task or Gig.
   - Run the resulting full-content update by document ID only, without title or parent arguments, so publication never renames or reparents it.
   - A missing, moved, archived, or conflicting document stops for maintainer direction.
4. **Recovery.** When creation is pending or an update is uncertain, read [recovery](../recovery.md#linear-document). An issue has no listing filter, so recovery scans every accessible document. Trust clear success after updates, without routine confirmation reads.

**Rendering:** the [API documentation](https://linear.app/developers/graphql#adding-collapsible-sections-in-markdown) supports native folded sections in documents. Verify live rendering separately; local Markdown tests don't prove it. The native title supplies Plan; the content holds the overview, Highlights, and a folded Full plan. Local source artifacts stay unchanged and authoritative.
