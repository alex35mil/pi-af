# Workflow Phase

Phase describes the current activity; Status describes lifecycle. Every initialized Epic, Task, and Gig stores `phase: planning | execution | selfReview` in `metadata.json`. Tracker Status/Priority remain provider authority. Trackerless lifecycle remains in `.local/status.md` and Phase stays in metadata only.

## Transitions

| Activity/event | Status | Metadata Phase | Native Phase |
| --- | --- | --- | --- |
| Backlog/Todo queue | Backlog/Todo | no initialized entity | absent |
| Initialization, investigation, plan drafting, material replanning | In Progress | Planning | Planning |
| Plan review, corrections, presentation, waiting for plan approval | In Progress | Planning | Planning |
| Accepted implementation or implementation corrections | In Progress | Execution | Execution |
| Adversarial interim/final review of delivered work | In Progress | Self-Review | Self-Review |
| Local user review of delivered work, including waiting for approval | In Progress | Self-Review | Self-Review |
| Plan acceptance and continuation | In Progress | Execution | Execution |
| Successful submission/resubmission for external human review | In Review | retain last Phase | absent |
| Implementation corrections on submitted work | In Progress | Execution | Execution |
| Local review of implementation corrections | In Progress | Self-Review | Self-Review |
| Confirmed completion or cancellation | Done/Canceled | retain last Phase | absent |

Keep the entire planning loop in Planning: drafting, review, corrections, presentation, and waiting for plan approval. Material replanning explicitly returns to Planning. Use Execution for accepted implementation and implementation corrections. Plan acceptance, completion artifacts, and review approval remain required for the work being performed. The review tool's `phase: plan | interim | final` identifies the review category, not workflow Phase.

Use Planning for the matching `review_epic`, `review_task`, or `review_gig` tool with category `plan` and for the matching entity-specific plan-presentation tool. Enter Self-Review before interim/final review and local user review of delivered work; remain there while awaiting feedback. After corrections, repeat the required review in the Phase for that activity. Keep lifecycle In Progress throughout those local loops, including revisions to an already-open PR.

Set In Review only after work is actually submitted for external human review. First submission requires a successfully created/recovered reviewable PR; resubmission requires successful publication of approved revisions. A local commit is not submission. With no external submission route, do not set In Review. Existing delivery evidence may still allow direct completion. Epic acceptance returns to Execution and its existing explicit completion route remains In Progress to Done.

Provider automation can change native Status, including GitHub returning pushed work to In Progress. Reuse fresh provider facts and skip already-applied assignments; do not configure automation or infer workflow Phase from native Status.

## Native projection invariant

During initialized In Progress work, project exactly the authoritative Phase. Outside In Progress, clear native Phase. Queue work has no Phase. This applies equally to versioned and unversioned artifact modes; native Phase is explicitly allowed in unversioned projects while other disclosure restrictions remain.

GitHub uses the configured Project single-select Phase field. Linear Epic uses the configured Project-label group; Task/Gig use the configured issue-label group. Linear groups are mutually exclusive and only their children are applied. Preserve all unrelated labels.

## Reconcile initialized work

1. For a required lifecycle transition, use its existing authority and confirm the outcome first. Never cache tracker lifecycle in metadata or substitute local authority.
2. During In Progress work on a ready branch, call `set_local_workflow_phase`, `set_github_workflow_phase`, or `set_linear_workflow_phase` matching the metadata authority/provider, with `entityDir` and the intended `phase`. Do not pass authority/provider selectors. Tracker authority also requires fresh semantic `lifecycle` and normalized `native` facts below; reuse current-operation reads. Workflow authority uses local lifecycle and accepts no tracker facts. The tool validates before changing metadata and returns any native assignment; a matching Phase is a metadata no-op, not permission to skip native reconciliation.
3. For initialization before branch readiness, or clearing native Phase outside In Progress, retain metadata Phase and use projection-only `prepare_github_phase_mutation` or `prepare_linear_phase_mutation` with `entityDir`, fresh `lifecycle`, and provider-specific `native` facts. Do not pass operation/change/provider selectors.
4. Apply a returned changed `phaseMutation` directly through the configured MCP tool: its `value` for GitHub or entire `labels` set for Linear. Skip unchanged assignments; never replace the full Linear label set with just the Phase child. Neither local operation executes provider calls or grants approval.
5. Follow existing clear-success and uncertain-outcome rules. Read required outcome facts absent from successful responses and reconcile uncertainty before retrying. Provider failure preserves authoritative Phase; no local tracker-lifecycle substitute is created.

For a first initialized create, use the approved saved `authority.desired.lifecycle` intent and an empty initial applied-label set, with freshly validated native label metadata. Include Planning in the create request. Once an object exists, use fresh native lifecycle/applied-state facts rather than initialization intent. GitHub Phase is assigned after Project membership is established.

### Fresh native facts

For GitHub pass `{ field: { name, dataType, options }, current }`: the exact field name, native `SINGLE_SELECT` type, complete option names, and the current selected name. Omit `current` only for an observed empty selection; code converts that absence to the established domain null. The field must contain all configured Phase options; unrelated additional options are preserved.

For Linear pass `{ catalog, applied }`. `applied` is the complete list of currently applied label IDs. `catalog` contains the selected group, all its children, and any same-named group candidates needed to prove exact scope/identity; finish pagination before supplying these facts. Each entry requires `id`, `name`, and `isGroup`. Supply `team`, `parentId`, `groupType` (`singleSelect` or `multiSelect`), and `retiredAt` when present in the observed facts; omit only genuinely empty leaves. The adapter converts those observed absences to domain nulls, not to guessed values. `catalog` and `applied` remain required, including when empty. Normalize only observed read facts. Project groups are single-select by Linear's documented contract and need no issue-only `groupType` field; omit that leaf there.

The configured group must identify one active group in its exact workspace/team scope. Each configured Phase identifies one active child of that group. Issue groups require native `singleSelect`. For Projects use Project-label reads; for issues use issue-label reads. Same-named children outside the selected group are unrelated labels and must survive reconciliation. Removing or replacing Phase removes all currently applied children of the managed group, including extra children, without changing any other applied ID.

## Setup

GitHub setup provisions or validates the exact Project field/options under its existing preview/hash approval. Linear setup stays read-only: require and validate one applicable Project-label group and one applicable issue-label group, each with the three configured active children; ask the user to configure missing/incompatible metadata. No implicit native-metadata creation occurs during runtime.
