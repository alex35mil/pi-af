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

| Work | Before creating the tracker object | From a GitHub issue | From a Linear object |
| --- | --- | --- | --- |
| Epic | `preflight_epic` | `init_github_epic` | `init_linear_epic` |
| Task | none: adopts its queued issue | `init_github_task` | `init_linear_task` |
| Gig | `preflight_gig` | `init_github_gig` | `init_linear_gig` |

- Preflight runs the local checks and changes nothing. The init tools take the tracker object, newly created or selected for adoption, in `object`.
- `restore_epic` recreates a missing local Epic from its tracker read and published plan; `restore_epic_plan_source` returns an existing Epic's published plan as source without writing ([Epic restore](./epic.md#restore-an-epic)).
- `plan_epic_task_issues` reconciles an accepted Epic's Tasks with fresh child-issue facts into native steps, and `record_epic_task_issue` tags a Task with its issue's marker ([Epic Tasks](./epic-tasks.md#task-issue-processing)).

## Integration context and state

| Purpose | Tool |
| --- | --- |
| Inspect configuration (current or workflow source) | `inspect_integrations` |
| Prepare Backlog or Todo intake | `inspect_queue_intake` |
| Prepare adoption of selected work | `inspect_adoption` |
| Set up the board for a new entity, or resume one | `initialize_integration`, `resume_integration` |
| Prepare plan publication | `prepare_integration_projection` |
| Prepare PR submission | `prepare_integration_pull_request` |
| Prepare shipping; validate PR merge evidence | `prepare_integration_shipping`, `prepare_integration_merge` |
| Prepare a label, lifecycle, Priority, or hierarchy change | `prepare_tracker_mutation` |
| Calculate native Phase without changing metadata | `prepare_github_phase_mutation`, `prepare_linear_phase_mutation` |
| Set metadata Phase and calculate native Phase | `set_github_workflow_phase`, `set_linear_workflow_phase` |

Context tools return configuration, addressing, evidence requirements, or native call arguments. They never call providers or grant approval.

## Resource identity and publication

- **PR creation:** `begin_resource_creation` saves the PR intent, then `record_resource_creation` takes the PR create's evidence.
- **Resource IDs:** `resolve_resource_ids`, `record_resource_ids`, `invalidate_resource_ids`, and `select_pull_request_resource` for an approved choice of existing PR.
- **Plans:**
  - `prepare_tracker_publication`, and `prepare_tracker_publication_update` when it returns `reads-required`: always for a published plan, any entity and provider;
  - `record_tracker_publication` for a first creation, a plan update, and its announcement ([plan update announcements](./integrations/shared.md#plan-update-announcements));
  - `recover_tracker_publication` for pending or uncertain identity, or a pending announcement ([recovery](./integrations/recovery.md)).
- **Bodies:** `render_provider_body`, `verify_artifact_projection`.

None of these call providers or turn identity, lifecycle, or merge facts into cache.

## Setup, review, and delivery

- **Setup:** `inspect_project_setup`, `prepare_artifacts`, `configure_mcp`, `inspect_permissions`, `configure_permissions`, `inspect_linear_workspace`, `render_incoming_pr_intake`.
- **GitHub provisioning:** `inspect_github_repository_setup`, `inspect_github_project_setup`, `inspect_github_project`, `preview_github_project_setup`, `apply_github_project_setup`. Preview and apply keep the full specification, approval hash, and credential isolation.
- **Reviews:** `review_epic`, `review_task`, `review_gig`, and `record_review_response`. Omit a finding's `userDecision` only when none is needed. The reviewer uses an explicit model override or the configured startup default, not the current session's model, and loads only the selected Claude Code extension with rules and permissions.
- **Plan presentation:** `prepare_epic_plan_presentation`, `prepare_task_plan_presentation`, `prepare_gig_plan_presentation`.
- **Completion presentation:** `prepare_task_completion_presentation`, `prepare_gig_completion_presentation`. They present only the newest final round, and only when it approved.
- **Delivery cleanup:** `cleanup_delivery_branch` takes the merged PR read as `evidence`. It doesn't establish Done or authorize cleanup outside the shipping gates.

## Incoming PRs

- **Context and merge:** `inspect_incoming_pr_context`, `plan_incoming_pr_merge`.
- **Board:** `plan_incoming_pr_intake`, `plan_incoming_pr_review`, `plan_incoming_pr_shipping`, `plan_incoming_pr_cancellation`. They return scoped native calls without running them.
- **Review:** `review_pull_request`, `record_pull_request_review_response`.
- **Checkout:**
  - `prepare_incoming_pr_checkout`, `checkout_incoming_pr`, `inspect_incoming_pr_checkout`, `begin_incoming_pr_fixes`;
  - `observe_incoming_pr_target`, `rebase_incoming_pr`, `continue_incoming_pr_rebase`, `publish_incoming_pr_rebase`;
  - `commit_incoming_pr_fixes`, `publish_incoming_pr_fixes`, `cleanup_incoming_pr_checkout`.

  The incoming context's `safety.checkout.tools` map supplies these names. Checkout, execution, Git writes, publication, and merge each keep their own approval; keep these tools outside PR skill-derived allow rules.
