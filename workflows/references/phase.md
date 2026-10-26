# Phase

Phase is the current activity; Status is the lifecycle. Every initialized Epic, Task, and Gig stores `phase: planning | execution | selfReview` in `metadata.json`. Tracker Status and Priority stay with the provider. Without a tracker, lifecycle stays in `status.md` and Phase only in metadata.

## Transitions

| Activity or event | Status | Metadata Phase | Native Phase |
| --- | --- | --- | --- |
| Backlog or Todo queue | Backlog, Todo | no entity yet | absent |
| Initialization, investigation, drafting, material replanning | In Progress | Planning | Planning |
| Plan review, corrections, presentation, waiting for plan approval | In Progress | Planning | Planning |
| Plan accepted; implementation or implementation corrections | In Progress | Execution | Execution |
| Interim or final review of delivered work | In Progress | Self-Review | Self-Review |
| User review of delivered work, including waiting for approval | In Progress | Self-Review | Self-Review |
| PR created, or revisions published, for external human review | In Review | keep last | absent |
| Corrections on submitted work | In Progress | Execution | Execution |
| Local review of those corrections | In Progress | Self-Review | Self-Review |
| Confirmed completion or cancellation | Done, Canceled | keep last | absent |

- Use Planning for `review_epic`, `review_task`, or `review_gig` with category `plan`, and for the plan-presentation tool.
- Enter Self-Review before interim or final review and before user review of delivered work. Stay there while waiting for feedback.
- After corrections, repeat the required review in the Phase for that activity.
- The review tool's `plan`, `interim`, or `final` category is not a workflow Phase.
- Plan acceptance, completion artifacts, and review approval remain required for the work being done.

**In Review** starts only after real submission for external human review: a successfully created or recovered reviewable PR, or successful publication of approved revisions.

- A local commit is not submission. With no external submission route, never set In Review.
- Existing delivery evidence can still allow direct completion.
- Accepting an Epic returns it to Execution. Its explicit completion goes from In Progress straight to Done.

Provider automation can change native Status; for example, GitHub can move pushed work back to In Progress. Reuse fresh provider facts and skip assignments that are already applied. Don't configure automation or infer Phase from native Status.

## Native projection

During In Progress, native Phase equals the metadata Phase. Outside In Progress, clear it. Queued work has no Phase. Native Phase is explicitly allowed; the other [disclosure](./integrations/shared.md#disclosure) limits still apply.

- **GitHub:** the configured Project single-select Phase field.
- **Linear:** the configured label group, a Project-label group for Epics and an issue-label group for Tasks and Gigs. The groups are mutually exclusive; apply only their children and keep every unrelated label.

## Reconciling

1. **Lifecycle first.** For a required lifecycle change, use its authority and confirm the outcome. Never cache tracker lifecycle in metadata or substitute local authority.
2. **Setting Phase during In Progress on a ready branch:** call `set_local_workflow_phase`, `set_github_workflow_phase`, or `set_linear_workflow_phase` with `entityDir` and the target `phase`.
   - Tracker authority also needs fresh `lifecycle` and `native` facts (below); reuse reads from this operation. Workflow authority takes no tracker facts.
   - The tool validates before changing metadata and returns any native assignment. A matching Phase is a metadata no-op, not a reason to skip native reconciliation.
3. **Projection only:** before branch readiness, or when clearing native Phase outside In Progress, keep metadata Phase. Call `prepare_github_phase_mutation` or `prepare_linear_phase_mutation` with `entityDir`, fresh `lifecycle`, and `native` facts.
4. **Apply a changed `phaseMutation`** through the configured MCP tool. On GitHub, write its `value`. On Linear, write its entire `labels` set; never replace the full set with only the Phase label. Skip unchanged assignments.
5. Neither local tool calls providers or grants approval. Outcomes follow [core outcome rules](./core.md#outcomes-and-recovery). A provider failure keeps metadata Phase and creates no local lifecycle substitute.

**First creation:** use the saved `authority.desired.lifecycle` intent and an empty applied-label set, with freshly validated label metadata, and include Planning in the create request. Once the object exists, use fresh native facts instead of the initialization intent. GitHub Phase is assigned after Project membership exists.

### Fresh native facts

Omit an optional field only when you actually read it and it was empty. Code turns that absence into null. Never omit a value you didn't read.

**GitHub:** `{ field: { name, dataType, options }, current }`, with the exact field name, the native `SINGLE_SELECT` type, all option names, and the current selection. The field must include every configured Phase option; extra options are kept.

**Linear:** `{ catalog, applied }`, both required even when empty.

- `applied`: every currently applied label ID.
- `catalog`: the selected group, all its children, and any same-named groups needed to prove scope and identity. Finish pagination first. Each entry has `id`, `name`, and `isGroup`, plus `team`, `parentId`, `groupType`, and `retiredAt` when present.
- The configured group must resolve to one active group in its workspace or team scope, and each Phase to one active child of it. Issue groups must be `singleSelect`. Project groups are single-select by Linear's contract, so omit `groupType` there.
- Use Project-label reads for Projects and issue-label reads for issues.
- Same-named children outside the group are unrelated labels and must survive. Replacing Phase removes every applied child of the managed group, including extras, and changes no other ID.

## Setup

GitHub setup provisions or validates the Project field and options under its preview and hash approval. Linear setup is read-only: it requires one Project-label group and one issue-label group, each with the three active children, and asks the user to fix anything missing. Runtime never creates native metadata.
