# Workflow tool catalog

Workflow operations are native deferred tools. In Codemode, find one with `searchTools()` and read its input schema with `describeTool()` before the first call ([core tool calls](./core.md#tool-calls)). Tools are grouped under `workflows_<group>` namespaces, for example `workflows_initialization` and `workflows_pull_requests`.

**Discovery:**

- Discovering a tool grants no approval. Calls still go through validation, permission hooks, scoped rules, editor review, and cancellation.
- Coding tools stay directly available. Transitions, reload, and resume keep discovery on demand rather than loading the whole catalog.

**Codemode and permissions:**

- The permissions-decorated Codemode is required. An explicit tool allowlist or Codemode exclusion still wins; use `--tools +codemode` or a suitable allowlist when workflows are wanted.
- The package never rewrites user settings or exposes all workflows as a fallback.
- Reviewer subprocesses keep their own read-only tool set.

**Input conventions:**

- Each tool takes only its own operation's fields; no `action`, `operation`, entity, or provider selector.
- Optional fact fields may be omitted only when they were read and found empty ([Phase](./phase.md#fresh-native-facts)).

## Initialization

| Work | New | Adopt GitHub work | Adopt Linear work |
| --- | --- | --- | --- |
| Epic | `init_epic` | `adopt_github_epic` | `adopt_linear_epic` |
| Task | `init_task` | `adopt_github_task` | `adopt_linear_task` |
| Gig | `init_gig` | `adopt_github_gig` | `adopt_linear_gig` |

- Adoption tools take the verified provider IDs and addressing in `source`.
- `set_epic_task_target` records approved routing intent at Epic plan acceptance; it stays local, takes no delivery evidence, and proves no delivery.
- Only the three Task tools take `epicDelivery`, for default-target Tasks ([Epic delivery](./epic.md)).
- `finalize_linear_branch` completes a pending Linear branch.

## Integration context and state

| Purpose | Tool |
| --- | --- |
| Inspect configuration (current or workflow source) | `inspect_integrations` |
| Prepare Backlog or Todo intake | `inspect_queue_intake` |
| Prepare adoption of selected work | `inspect_adoption` |
| Start or resume an entity's integrations | `initialize_integration`, `resume_integration` |
| Prepare plan publication | `prepare_integration_projection` |
| Prepare PR submission | `prepare_integration_pull_request` |
| Prepare shipping; validate PR merge evidence | `prepare_integration_shipping`, `prepare_integration_merge` |
| Prepare a label, lifecycle, Priority, or hierarchy change | `prepare_tracker_mutation` |
| Calculate native Phase without changing metadata | `prepare_github_phase_mutation`, `prepare_linear_phase_mutation` |
| Set metadata Phase and calculate native Phase | `set_local_workflow_phase`, `set_github_workflow_phase`, `set_linear_workflow_phase` |
| Confirm a pending tracker binding | `confirm_github_tracker`, `confirm_linear_tracker` |

Context tools return configuration, addressing, evidence requirements, or native call arguments. They never call providers or grant approval.

## Resource identity and publication

- **Creation checkpoints:** `begin_resource_creation`, then `record_resource_creation` with the create's evidence.
- **Resource IDs:** `resolve_resource_ids`, `record_resource_ids`, `invalidate_resource_ids`, and `select_pull_request_resource` for an approved choice of existing PR.
- **Plans:**
  - `prepare_tracker_publication`, and `prepare_tracker_publication_update` for a published Linear document;
  - `record_tracker_publication` for a first creation;
  - `recover_tracker_publication` for pending or uncertain identity ([recovery](./integrations/recovery.md)).
- **Bodies:** `render_provider_body`, `verify_artifact_projection`.

None of these call providers or turn identity, lifecycle, or merge facts into cache.

## Setup, review, and delivery

- **Setup:** `inspect_project_setup`, `prepare_artifacts`, `configure_mcp`, `inspect_permissions`, `configure_permissions`, `inspect_linear_workspace`, `render_incoming_pr_intake`.
- **GitHub provisioning:** `inspect_github_repository_setup`, `inspect_github_project_setup`, `inspect_github_project`, `preview_github_project_setup`, `apply_github_project_setup`. Preview and apply keep the full specification, approval hash, and credential isolation.
- **Reviews:** `review_epic`, `review_task`, `review_gig`, and `record_review_response`. Omit a finding's `userDecision` only when none is needed. The reviewer uses an explicit model override or the configured startup default, not the current session's model, and loads only the selected Claude Code extension with rules and permissions.
- **Plan presentation:** `prepare_epic_plan_presentation`, `prepare_task_plan_presentation`, `prepare_gig_plan_presentation`.
- **Delivery cleanup:**
  - `cleanup_github_delivery_branch`, which takes the merged PR read as `evidence`;
  - `cleanup_ancestry_delivery_branch`, which proves delivery by Git ancestry.

  Both need `completionAuthority`, the authority whose Done was confirmed. Neither establishes Done or authorizes cleanup outside the shipping gates.

## Incoming PRs

- **Context and merge:** `inspect_incoming_pr_context`, `plan_incoming_pr_merge`.
- **Board:** `plan_incoming_pr_intake`, `plan_incoming_pr_review`, `plan_incoming_pr_shipping`, `plan_incoming_pr_cancellation`. They return scoped native calls without running them.
- **Review:** `review_pull_request`, `record_pull_request_review_response`.
- **Checkout:**
  - `prepare_incoming_pr_checkout`, `checkout_incoming_pr`, `inspect_incoming_pr_checkout`, `begin_incoming_pr_fixes`;
  - `observe_incoming_pr_target`, `rebase_incoming_pr`, `continue_incoming_pr_rebase`, `publish_incoming_pr_rebase`;
  - `commit_incoming_pr_fixes`, `publish_incoming_pr_fixes`, `cleanup_incoming_pr_checkout`.

  The incoming context's `safety.checkout.tools` map supplies these names. Checkout, execution, Git writes, publication, and merge each keep their own approval; keep these tools outside PR skill-derived allow rules.
