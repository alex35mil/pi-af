# Project workflow Phase in GitHub and Linear

## Outcome

Show what the agent is doing without implying that work has already been submitted to another person. Phase is Planning, Execution, or Self-Review. Status remains In Progress during agent work, adversarial reviews, and local user reviews. In Review means submitted and waiting for external human review.

The same Phase contract applies to Epic, Task, and Gig, with GitHub, Linear, and trackerless workflows. Native Phase metadata is visible in both versioned and unversioned projects; artifact persistence does not change this behavior. Other unversioned disclosure restrictions remain intact.

## State and transitions

Replace authoritative `metadata.workStage` with `metadata.phase`, using `planning | execution | selfReview`. This is the current activity, not a second lifecycle or proof that implementation has started. Keep review-tool `phase: plan | interim | final` as the distinct review category used for snapshots and review rounds.

| Activity or event | Lifecycle Status | Authoritative Phase | External Phase |
| --- | --- | --- | --- |
| Backlog or Todo work not initialized | Backlog/Todo | no workflow entity | absent |
| Initialize, draft a plan, or materially replan | In Progress | Planning | Planning |
| Execute accepted work or make review corrections | In Progress | Execution | Execution |
| Any adversarial plan, interim, or final review | In Progress | Self-Review | Self-Review |
| Local user review of a plan, implementation, or completion artifact | In Progress | Self-Review | Self-Review |
| Accept plan and begin/continue its approved work | In Progress | Execution | Execution |
| Submit or resubmit approved work for external human review | In Review | retain last Phase | absent |
| Correct submitted work, including work with an open PR | In Progress | Execution | Execution |
| Review those corrections locally/adversarially | In Progress | Self-Review | Self-Review |
| Confirm delivered work or cancel work | Done/Canceled | retain last Phase | absent |

Planning corrections are edits to reviewed work and follow the correction row; material replanning explicitly enters Planning. A Phase value alone does not authorize implementation or kind reclassification. Preserve accepted-plan, execution-start, kind-transition, and review-approval gates in the owning instructions.

Enter Self-Review before starting the review, and keep it while awaiting feedback or approval. Return to Execution for corrections, then Self-Review for each next review. Material changes still require another adversarial review and updated completion artifacts. Plan acceptance starts execution only through the existing approval gate. Epic plan acceptance returns the Epic to Execution; its existing direct completion flow remains unchanged.

First PR creation enters In Review only after successful submission of a reviewable PR. A failed or uncertain submission leaves status at the last confirmed state until the existing recovery procedure establishes the outcome. Resubmission uses the existing approved push/update boundary, then enters In Review. A local commit is not submission. Without an external submission route, including commit-only/no-PR work, do not enter In Review; confirmed delivery may still complete through the existing finish route.

GitHub can change Project Status from In Review to In Progress on pushed commits, as reported by the user. Reuse the normal fresh provider-state/absolute-assignment procedure and skip already-applied changes. Do not manage or add GitHub automation. Status changes made by the provider never manufacture a workflow Phase or bypass local review gates.

## Ownership and implementation

### Shared domain and operation boundaries

- In `workflows/extensions/__lib/domain.ts`, define the single strict Phase schema/type and the shared rule: only initialized In Progress work exposes its authoritative Phase; every other lifecycle exposes no Phase.
- Update `__lib/entity.ts`, `init/entity.ts`, and all current consumers and fixtures directly to `phase`. Initialization sets Planning. Entity validation accepts the three activities and no longer requires Execution merely because lifecycle is In Review or Done. Preserve identity, branch, authority, containment, pending-work, and completion evidence invariants.
- In the integration layer, expose the authoritative Phase and the shared lifecycle-dependent projection contract through normal initialized-operation context, including a selected Phase mutation. Tracker authority still requires fresh native lifecycle evidence; local context must not invent or cache it. Configuration validation and context construction remain local, and registered MCP tools remain the provider mutation boundary.
- Add a small shared Phase projection/validation boundary used by runtime context and tests. Provider-specific representations adapt that one invariant, rather than defining separate lifecycle rules. Body-only artifact projection and forge-only operations retain their existing narrow responsibilities.
- In `review/index.ts`, require Self-Review before running every adversarial review and before presenting its reviewed plan for user review. The main agent changes metadata and reconciles tracker state before calling the tool; the tool does not perform hidden provider mutations. Preserve read-only reviewers, numbered rounds, snapshots, pending-work checks, finding rendering, and blocked-review confirmation.
- Replace the `finishMerge` execution-stage assumption with the current completion/review contract. A Phase is activity, not delivery proof: retain exact PR/head/base/SHA checks, approved completion requirements, and the existing conditional merge/cleanup boundaries.

### GitHub

- Replace `labels.planning` configuration with required `fields.phase`, containing a Project field name and distinct mappings for `planning`, `execution`, and `selfReview`. Status and Phase are always Project-scoped; Priority and Internal ID retain their existing scope choices. Include Phase in Project field-name collision validation.
- Keep existing Kind label behavior: versioned workflows reconcile their managed Kind, unversioned workflows do not expose Kind. Phase does not use a repository label.
- Extend `project-setup/github-project.ts` defaults, strict specification, preview/hash, provisioning, verification, and returned tracker configuration to include the Phase single-select field and its three options. Remove Planning from the provisioned repository-label catalog. Retain existing additive field creation, incompatible-field blockers, exact preview approval, and unrelated provider data preservation.
- Runtime initialization and resume read/reconcile the exact Phase field alongside required Status/Priority. Change Phase only when necessary, using native absolute field updates; clear it outside In Progress. Queue creation assigns no Phase.

### Linear

- Add required separate Phase label-group configuration for Projects and issues. Each selects one exact applicable group and three distinct children mapped to Planning, Execution, and Self-Review. Epic uses Project labels; Task/Gig use issue labels. Do not introduce entity or kind labels.
- Setup requires existing provider-native groups and verifies their applicability, group identity, child membership, exclusivity, and active state through registered Linear label reads. Complete pagination when resolving the selected group. Issue groups must be single-select; Project groups are mutually exclusive by Linear's documented contract. Keep setup's existing read-only Linear boundary: missing/incompatible groups require user configuration, not silent mutation.
- Require the configured label metadata during initialized runtime reconciliation. Resolve labels by the configured group and applicable scope, not an unqualified child name shared across groups. Do not cache label catalog facts as lifecycle authority or turn ordinary work into blanket workspace discovery.
- For an existing Project/issue, read its complete applied label set, remove only children belonging to the configured Phase group, append the authoritative child only while native Status is In Progress, and submit the complete replacement set through `save_project`/`save_issue`. Preserve every unrelated label, including labels with matching names outside the managed group. Clear only managed Phase labels outside In Progress. New initialized work applies Planning; queued work has no Phase.
- Follow existing clear-success, missing-outcome-fact verification, and uncertain-result recovery rules. Denied access does not permit another transport or fallback to local lifecycle authority.

### Instructions and documentation

Update the owning shared references (`artifacts.md`, `planning.md`, `review.md`, `deliverable.md`, `queue.md`, `setup.md`, and integration references), Epic/Task/Gig/setup skills as affected, and workflow/extension READMEs. Carry the full transition table into the owning lifecycle guidance, and link provider procedures to the shared invariant.

Explicitly allow native Phase metadata in unversioned projection policy and guidance while retaining restrictions on workflow IDs, artifact paths, Kind, review artifacts, and raw workflow structure. Ensure no caller still directs an early In Review transition, Planning-label projection, or Linear workflow-only Phase behavior.

## Boundaries

- Preserve unrelated working-tree changes and historical entity artifacts.
- Existing-item conversion, old In Review interpretation, compatibility heuristics, and historical-status handling are outside this work.
- Live provider setup changes require their own exact provisioning approval. Do not change this repository's tracker configuration or provider metadata merely because the implementation plan is accepted. Existing projects adopt the new required configuration through explicit setup; no implicit configuration rewriting is added.
- No change to PR identity, approval authority, submission authorization, merge method, branch contracts, Resource ID ownership, or artifact-body ownership.
- Linear label replacement follows the supported read-modify-write model; do not add speculative concurrency infrastructure.

## Verification

1. Add focused Phase boundary tests for all three entity types, all three activities, initialized lifecycle states, queue states, both artifact modes, and all tracker choices. Verify exactly one matching native Phase only during In Progress, with no external Phase for queue/terminal/external-review work.
2. Update domain/init/config/context tests to cover strict Phase configuration, required mappings, distinct options/field names, selected Phase mutation, local-only trackerless Phase, and unversioned native Phase allowance without relaxing other disclosure rules.
3. Extend GitHub provisioning tests for preview, approved creation, reuse of compatible fields, missing or incompatible Phase metadata, and returned configuration. Preserve Status/Priority/Internal ID and Kind regression coverage.
4. Add Linear group-validation and label-reconciliation tests for Project versus issue scope, child membership, single-select requirements, complete group resolution, unrelated-label preservation, same-name unrelated labels, clearing, and no-op reconciliation. Use documented native group semantics rather than inventing fallback labels.
5. Extend review/presentation and instruction tests for plan/interim/final Self-Review, local review waiting, correction/review cycles, material replanning, submission timing, no-submission routes, and resubmission. Retain finding/approval/pending gates and finish/cleanup evidence coverage with the new Phase model.
6. Run focused workflow tests during development, then `npm test`, `npx tsc --noEmit`, and `npx oxfmt --check` on changed supported files. Record observed results and any checks not run in `result.md` before final adversarial review.

Verification uses isolated repositories and provider fixtures; it does not require mutating a live Linear workspace or GitHub Project. Live deployment is not claimed by passing fixture tests.
