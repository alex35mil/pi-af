# Workflow tool discovery

Workflow operations are native deferred tools. In Codemode, use `searchTools()` to find the needed operation and `describeTool()` to read its exact input contract before calling `tools.<name>(args)`. Namespaces group initialization, integrations, setup, reviews, pull requests, and delivery under `workflows_<group>`; initialization uses `workflows_initialization` and incoming PR checkout uses `workflows_pull_requests`.

Discovery returns full typed schemas without putting the entire catalog into ordinary requests. It grants no execution, publication, lifecycle, or Git approval. Calls still pass through native validation, permission hooks, scoped rules, editor review, and cancellation. Coding tools remain directly available. Workflow transitions, reload, and resume retain on-demand discoverability rather than activating the whole catalog.

The existing permissions-decorated Codemode is required. An explicit tool allowlist or Codemode exclusion remains authoritative; use `--tools +codemode` or an appropriate explicit allowlist when workflow access is intended. The package does not rewrite user settings or silently expose all workflows as a fallback. Reviewer subprocesses retain their separate read-only tool selection.

## Initialization

| Work | New work | Adopt explicit GitHub work | Adopt explicit Linear work |
| --- | --- | --- | --- |
| Epic | `init_epic` | `adopt_github_epic` | `adopt_linear_epic` |
| Task | `init_task` | `adopt_github_task` | `adopt_linear_task` |
| Gig | `init_gig` | `adopt_github_gig` | `adopt_linear_gig` |

The operation fixes entity and source identity; do not supply those discriminators. Adopt tools take the verified provider IDs and addressing in `source`, without `mode`, `provider`, or Linear `resource`. Preserve all intake, hierarchy, branch, artifact-persistence, and approval gates. `set_epic_task_target` and all three Task initialization tools accept `epicDelivery` for default targeting: `{ kind: "git-ancestry" }` (the omitted-input behavior) or `{ kind: "github-pr", evidence }`. See [Epic delivery](./epic.md) for the shared current-revision checks, exact registered PR-get envelope, and separate Git approvals. `finalize_linear_branch` retains its focused contract.

## Integration contexts and state

| Purpose | Tool |
| --- | --- |
| Inspect current/workflow-source configuration | `inspect_integrations` |
| Prepare Backlog/Todo intake context | `inspect_queue_intake` |
| Inspect explicit adoption context | `inspect_adoption` |
| Initialize or resume an entity's integration context | `initialize_integration`, `resume_integration` |
| Prepare tracker artifact projection | `prepare_integration_projection` |
| Prepare forge PR submission context | `prepare_integration_pull_request` |
| Read finish addressing/context; validate exact PR merge evidence | `prepare_integration_finish`, `prepare_integration_merge` |
| Prepare labels/lifecycle/Priority/hierarchy context | `prepare_tracker_mutation` |
| Calculate native Phase reconciliation without setting metadata Phase | `prepare_github_phase_mutation`, `prepare_linear_phase_mutation` |
| Set metadata Phase and calculate reconciliation | `set_local_workflow_phase`, `set_github_workflow_phase`, `set_linear_workflow_phase` |
| Confirm pending initialization | `confirm_versioned_github_tracker`, `confirm_unversioned_github_tracker`, `confirm_linear_tracker` |

Supply `entityDir` for entity operations and explicit `target: current | workflow` for inspection/intake. Context tools return configuration, addressing, evidence requirements, or native operation arguments; they do not execute provider calls or grant approval. A Phase context tool fixes `change: phase` and provider identity; do not supply those discriminators. `prepare_tracker_mutation` retains only its uniform labels/lifecycle/Priority/hierarchy `change` enum.

Phase-setting tools fix authority/provider; supply fresh lifecycle and that provider's `native` facts when using a tracker. Native Phase inputs omit `provider`. Omit `current` only for an observed empty GitHub selection. In complete Linear label reads, omit only genuinely empty `team`, `parentId`, `groupType`, or `retiredAt` leaves; `catalog` and `applied` remain required. Code maps those observed empty leaves to domain nulls. Never use omission to conceal an unread value or missing evidence.

Binding confirmation fixes provider and, for GitHub, artifact mode. Its `facts` omit `provider`; provider-specific `phase` has the same leaf conventions above. Omit `parentIssueNumber` or `projectId` only for an observed absent relationship. Versioned GitHub `systemMetadata` requires complete labels/Internal ID but omits fixed `mode`; unversioned GitHub has no `systemMetadata` input. Linear requires its `systemMetadata.mode` enum. Preserve all confirmation and freshness requirements in the provider reference.

## Resource identity and publication

- Creation checkpoints: `begin_resource_creation`, then `record_resource_creation` with actual clear-success evidence and the same tracker/forge role.
- IDs: `resolve_resource_ids`, `record_resource_ids`, `invalidate_resource_ids`, and explicit approved `select_pull_request_resource`. These tools do not call providers or turn identity/lifecycle/merge facts into disposable cache state.
- Plans: `prepare_tracker_publication`; published Linear document updates additionally use `prepare_tracker_publication_update` with exact document/parent evidence. Save first-creation evidence with `record_tracker_publication`; recover uncertain identity through `recover_tracker_publication` and complete native read pages. Pending creation never automatically retries.
- Bodies and comparison: `render_provider_body`, `verify_artifact_projection`.

Operation-specific tools take only their operation's fields, not an `action` or `operation` selector. PR selection supplies its fixed resource internally; ID resolution, recording, and invalidation retain their explicit resource enum. Respect the shared complete-body, signing, approval, and uncertainty contracts.

## Setup, review, and delivery

Setup uses `inspect_project_setup`, `prepare_artifacts`, `configure_mcp`, `inspect_permissions`, `configure_permissions`, `inspect_linear_workspace`, and `render_incoming_pr_intake`. GitHub provisioning uses `inspect_github_repository_setup`, `inspect_github_project_setup`, `inspect_github_project`, `preview_github_project_setup`, and `apply_github_project_setup`. Preview/apply preserve complete structured specifications, approval hashes, credential isolation, and provider effects; they take no operation selector.

Reviews use `review_epic`, `review_task`, or `review_gig` with the exact category/inputs. Presentation uses `prepare_epic_plan_presentation`, `prepare_task_plan_presentation`, or `prepare_gig_plan_presentation`. No entity selector is needed. `record_review_response`, `review_pull_request`, and `record_pull_request_review_response` retain their names; omit a finding's `userDecision` only when none is needed. Stored reports keep their strict existing null representation. Reviewer provider loading preserves the explicit override or configured startup default, not the parent session's current model, and loads only the selected Claude Code extension alongside rules and permissions.

Delivery cleanup uses `cleanup_ancestry_delivery_branch` or `cleanup_github_delivery_branch`, with required `completionAuthority: workflow | github | linear` identifying the authority whose Done outcome was confirmed. GitHub cleanup additionally takes its exact `merge` proof without fixed `kind`/`source`; ancestry cleanup fixes its Git-ancestry proof. Neither choice establishes remote Done or authorizes cleanup without the existing explicit finish/delivery gates.

## Incoming PRs

Use `inspect_incoming_pr_context` for configured addressing and `plan_incoming_pr_merge` for exact reviewed/fresh merge evidence. Project intents use `plan_incoming_pr_intake`, `plan_incoming_pr_review`, `plan_incoming_pr_ship`, or `plan_incoming_pr_cancel`, preserving structured membership/read evidence. They return scoped native operations without executing them.

Checkout actions are separate tools: `prepare_incoming_pr_checkout`, `checkout_incoming_pr`, `inspect_incoming_pr_checkout`, `begin_incoming_pr_fixes`, `observe_incoming_pr_target`, `rebase_incoming_pr`, `continue_incoming_pr_rebase`, `publish_incoming_pr_rebase`, `commit_incoming_pr_fixes`, `publish_incoming_pr_fixes`, and `cleanup_incoming_pr_checkout`. Do not pass an operation selector. The incoming context's `safety.checkout.tools` map supplies these exact names. Separate checkout, execution, Git-write, publication, and merge approvals still apply; keep these actions outside PR skill-derived allow rules.
