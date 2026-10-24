# Fix Claude Code and GLM tool compatibility

## Overview

Make workflow tools usable with Claude Code and GLM without sending the full workflow catalog on every request. This combines the schema-compatibility work with the initial-context optimization requested in #70. The public API will describe real operations, keep their input contracts, and use Pi's existing discovery and execution machinery.

### Plan highlights

- Replace operation-dispatch unions with separate, concrete object-shaped tools. Fixed choices use string enums; domain validation and meaningful required fields remain intact.
- Keep workflow operations discoverable on demand instead of declaring their full schemas in ordinary coding sessions. Ordinary coding tools remain directly available.
- Load the Claude Code provider for reviewers that select it, without enabling unrelated extensions or weakening read-only isolation.
- Measure actual native request declarations before and after the changes, including discovery, workflow transitions, and resume. Keep #70 open until the combined work is delivered.

## Evidence and scope

The actual Pi 1.3.0 extension-loader inventory contains 30 package-registered tools, 18 with schema composition. The Claude Code bridge at revision `70abb65186592ca788b29b3db22c3160d629c41f` removes root `anyOf`, `oneOf`, and `allOf`: the existing `init`, `review`, and `integration_context` declarations become empty object schemas. The user reported the corresponding GLM union failure. Z.AI documents object-shaped function parameters and a maximum of 128 functions per request.

An isolated Pi 1.3.0 session using the real extensions, default tool selection plus Codemode, and a fake provider sends 32 declarations occupying 94,354 UTF-8 bytes, approximately 23,589 tokens. An exposure-only prototype using the same schemas and deferred workflow tools sends 7 declarations occupying 5,393 bytes, approximately 1,349 tokens. These are tool-definition measurements, not total context or billed usage. Token estimates use `ceil(JSON characters / 4)`. Labeling prompts with different stages did not itself exercise workflow transitions; those require dedicated integration tests.

The earlier 148-candidate schema expansion is not an API inventory and will not drive implementation. It mixes data alternatives, invalid combinations, and repeated scalar choices. The operation inventory below is the reviewable public contract; actual registrations and loadouts must be measured independently.

This work covers initialization, integrations, publication, workflow Phase and binding confirmation, setup, incoming-PR operations, reviews, plan presentation, and delivery cleanup. Preserve existing lifecycle, persistence modes, provider permissions, publication and recovery behavior, branch contracts, incoming-contributor safety, and approval boundaries. Persisted domain schemas need no migration. Do not install providers, change the user's default model, handle mid-conversation model switching, or redo the delivered native MCP migration.

## Model-facing contracts

Tool registration is the owning boundary for invocation schemas. Keep shared domain operations and their strict command/state unions authoritative. Each new entry point supplies its fixed operation/entity/provider discriminator to the shared operation; do not duplicate algorithms or retain old dispatch tools as aliases.

Every registered workflow tool has a concrete root object. Use explicit enum schemas for fixed string choices, including nested scalar choices. Keep genuine optional inputs optional; do not model mutually exclusive operations as a collection of optional/nullable fields. Descriptions retain meaningful invocation, evidence, and approval requirements.

Distinguish invocation alternatives from data alternatives: a mixed MCP registration batch or complete GitHub Project specification is one coherent operation, not one tool per possible configuration. Preserve its full nested data schema and all supported combinations. Verify that the target conversion preserves these nested contracts. A construct that loses information requires a specific, evidenced boundary redesign; do not delete constraints, serialize typed inputs into arbitrary JSON strings, or mechanically expand every data combination into tools. Opaque native provider response data remains opaque evidence validated at the existing evidence boundary.

For genuinely nullable observations and review responses that the bridge simplifies, define the equivalent explicit optional leaf input and normalize its absence to the existing domain null value. Limit this to fields whose existing null meaning is established, such as an empty native Phase selection or no unsettled review decision. Do not add fallback values or weaken validation. Maintain the distinction between absent observed values and missing required evidence.

## Public operation inventory

The following names replace the old operation-dispatch interfaces. Keep names unique and within the bridge's 50-character limit. Identical parameter shapes alone do not justify combining distinct approved actions into a new dispatcher.

| Existing boundary | New operation-specific entry points |
| --- | --- |
| `init` | `init_epic`, `init_task`, `init_gig`; `adopt_github_epic`, `adopt_github_task`, `adopt_github_gig`; `adopt_linear_epic`, `adopt_linear_task`, `adopt_linear_gig` |
| `resource_ids` | `begin_resource_creation`, `record_resource_creation`, `resolve_resource_ids`, `record_resource_ids`, `invalidate_resource_ids`, `select_pull_request_resource` |
| `tracker_publication` | `prepare_tracker_publication`, `prepare_tracker_publication_update`, `record_tracker_publication`, `recover_tracker_publication` |
| `set_workflow_phase` | `set_local_workflow_phase`, `set_github_workflow_phase`, `set_linear_workflow_phase` |
| `confirm_tracker_initialization` | `confirm_versioned_github_tracker`, `confirm_unversioned_github_tracker`, `confirm_linear_tracker` |
| Ordinary `integration_context` requests | `inspect_integrations`, `inspect_queue_intake`, `inspect_adoption`, `initialize_integration`, `resume_integration`, `prepare_integration_projection`, `prepare_integration_pull_request`, `prepare_integration_finish`, `prepare_integration_merge`, `prepare_tracker_mutation`, `prepare_github_phase_mutation`, `prepare_linear_phase_mutation` |
| Incoming-PR integration requests | `inspect_incoming_pr_context`, `plan_incoming_pr_merge`, `plan_incoming_pr_intake`, `plan_incoming_pr_review`, `plan_incoming_pr_ship`, `plan_incoming_pr_cancel` |
| `incoming_pull_request_checkout` | `prepare_incoming_pr_checkout`, `checkout_incoming_pr`, `inspect_incoming_pr_checkout`, `begin_incoming_pr_fixes`, `observe_incoming_pr_target`, `publish_incoming_pr_rebase`, `publish_incoming_pr_fixes`, `rebase_incoming_pr`, `continue_incoming_pr_rebase`, `commit_incoming_pr_fixes`, `cleanup_incoming_pr_checkout` |
| `provision_github_project` | `inspect_github_repository_setup`, `inspect_github_project_setup`, `inspect_github_project`, `preview_github_project_setup`, `apply_github_project_setup` |
| `review` | `review_epic`, `review_task`, `review_gig` |
| `prepare_plan_presentation` | `prepare_epic_plan_presentation`, `prepare_task_plan_presentation`, `prepare_gig_plan_presentation` |
| `cleanup_delivery_branch` | `cleanup_ancestry_delivery_branch`, `cleanup_github_delivery_branch` |

Existing single-purpose operations retain their names: `set_epic_task_target`, `finalize_linear_branch`, `render_provider_body`, `verify_artifact_projection`, `inspect_project_setup`, `prepare_artifacts`, `configure_mcp`, `inspect_permissions`, `configure_permissions`, `inspect_linear_workspace`, `render_incoming_pr_intake`, `review_pull_request`, `record_pull_request_review_response`, and `record_review_response`.

GitHub binding confirmation separates versioned and unversioned facts because their required system metadata differs. Linear's artifact mode has one constant-shaped data contract. Provider-specific Phase operations accept only that provider's facts. Delivery cleanup separates merge-proof shapes; its required completion-authority enum maps explicitly to the existing workflow/GitHub/Linear completion evidence, without inferring remote Done from local metadata. Incoming-PR membership and cleanup evidence retain their supported structured data alternatives and exact safety checks.

`prepare_tracker_mutation` retains a labels/lifecycle/priority/hierarchy enum because it performs one uniform context-selection operation with one input shape; Phase reconciliation has its own provider-specific contracts. Review category remains a string enum within each entity tool because those categories share that entity's request shape and existing review rules.

## Discovery and context policy

Use native deferred exposure for all workflow tools, grouped into concise workflow namespaces with discovery instructions. Native Codemode's `searchTools`, `describeTool`, and `describeNamespace` provide full typed contracts when needed. Do not inline all workflow declarations into the Codemode description, build a parallel registry/search protocol, or add a generic untyped execution router.

Ensure the existing permissions-decorated Codemode tool is available at session start, reload, and resume through the shared workflow exposure owner. Preserve the user's explicit tool restrictions: do not reactivate an explicitly excluded tool, broaden a reviewer allowlist, or rewrite global/project settings. A restricted session that cannot reach workflow tools receives an actionable configuration error rather than a silent full-catalog fallback. Do not register a second Codemode implementation.

On-demand exposure is preferred over lifecycle-driven activation: it achieves the measured reduction without inferring entity state, tracking the current workflow in another store, or making tools unreachable after transitions. All registered workflow operations remain discoverable and retain ordinary execution validation, permission hooks, rule gates, file-review handling, and cancellation. Do not auto-activate the entire workflow namespace after one discovery.

Use the same policy in ordinary sessions, setup, initialization, planning, implementation, review, and resumed work. Workflow-stage integration tests verify reachability, not a new lifecycle-to-tool allowlist. The read-only reviewer subprocess does not load workflow extensions and keeps its existing explicit tool allowlist.

Acceptance budgets for the isolated default-loadout fixture: no workflow operation is directly declared or inlined initially; no more than 10 total declared tools; at most 2,500 estimated definition tokens; and at least 80% fewer definition bytes than the captured baseline. Include Codemode's complete generated description in those measurements. Keep the actual complete provider declaration count at or below GLM's 128-tool limit in tested request loadouts. These budgets cover this package's controlled fixture, not arbitrary additional user-installed packages.

## Reviewer provider loading

The shared reviewer launch boundary in `review/agent.ts` serves both entity reviews and incoming-PR reviews. Retain explicit reviewer-model override precedence and the configured startup default when no override is supplied; do not silently inherit the parent conversation's current model.

| Selected reviewer provider | Required launch behavior |
| --- | --- |
| Claude Code, selected explicitly or by configured default | Resolve the enabled, already-installed Claude Code provider entry point and include only that provider extension alongside rules and permissions. |
| Built-in provider, including GLM and the existing Codex default | Keep the current isolated launch without the Claude Code extension. |
| Explicit selection is ambiguous or its required provider is unavailable | Return an actionable selection/installation error before launching a wrongly configured reviewer; do not fall back to another provider. |

Use Pi's public settings/package/model APIs and native model-resolution behavior for qualified IDs, supported model patterns, and thinking suffixes. Respect project trust, configured resource exclusions, agent-directory overrides, and installed npm/git/local package locations. Discovery must not install missing packages, execute unrelated extension factories, copy credentials, or hard-code this machine's paths. Preserve provider environment handling through the child process.

Retain `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-session`, and `--tools read,grep,find,ls`. Provider loading must not reactivate Codemode, workflow tools, MCP servers, file writes, or shell execution in reviewers. Missing provider setup is not permission to change authentication or user settings.

## Implementation ownership and consumer updates

- Introduce one small workflow registration/exposure owner under `workflows/extensions/__lib/`, used directly by workflow registrations. It supplies native exposure/namespace metadata and the discovery-availability lifecycle behavior; it does not transform arbitrary domain schemas.
- Define operation schemas beside their current owners: `init`, `integrations` and its provider/operation modules, `project-setup`, `pr`, `review`, and `deliverable`. Keep domain functions, mutation queues, evidence checks, output renderers, and resource checkpoints shared.
- Add reviewer selection/provider resolution at the shared reviewer launch boundary, and update both review adapters directly.
- Update active workflow skills, allowed-tool lists, references, tool-generated guidance, README/upgrade guidance, permission configuration inspection, and relevant tests to use the new names and discovery contract. Preserve explicit execution/publication approvals. Do not rewrite historical completed Gig artifacts or saved review rounds.
- Remove the superseded public dispatch registrations. Internal union command types may remain where they are the owning domain model; there are no public compatibility aliases or generic schema-flattening shims.

## Verification

1. Maintain an exact registered-operation inventory with owning module and input schema. Assert expected names, unique names no longer than 50 characters, concrete object roots, fixed-choice enums, required operation-specific fields, and absence of replaced dispatch tools. Include positive/negative variant cases proving domain invariants still hold.
2. Run the representative old empty-schema reproductions against new declarations using the pinned bridge's normalization behavior. Verify required names, types, enums, nested configuration alternatives, nullable-observation meanings, and constraints survive rather than merely asserting that a request can be sent. Exercise GLM's OpenAI-compatible request conversion with object parameters and the actual projected loadout.
3. Use the real Pi 1.3.0 session machinery with a fake provider to capture declarations and generated Codemode descriptions. Test default settings with and without MCP, discovery and typed description, calling discovered operations, permitted and denied nested execution, ordinary file reviews, and explicit tool exclusions. Never bypass `ctx.executeTool` or call another tool's raw executor in production.
4. Test real workflow setup/initialization, plan-to-execution and self-review transitions, submission context, and session reopen/reload. Assert operations remain discoverable/callable when allowed, inactive workflow schemas do not accumulate in later declarations, and resumed work restores the same discovery policy without new workflow state or persisted-model changes.
5. Cover reviewer overrides/defaults for Claude Code, Codex, and GLM; qualified/pattern selections and ambiguity; installed npm/git/local provider resource lookup; absent/disabled/untrusted providers; no implicit installs; and both entity and incoming-PR review paths. Use a fake installed provider/CLI for subprocess integration, and assert the read-only tool allowlist after loading it.
6. Record before/after bytes, estimated definition tokens, declaration count, and discovery overhead for ordinary coding, setup, initialization, planning, execution, review, and resume. Separate measured native-session results from authenticated provider results and total/billed-token claims.
7. Run `npm run typecheck` and `npm test` with enough time for the approximately 203-second baseline suite. Baseline is 611 tests: 610 pass and one existing guidance assertion fails because its expected merge-contract phrase no longer matches the current reference. Update affected guidance assertions to verify the positive current contract during the required consumer changes; do not conceal other failures as baseline.
8. No configured Claude Code or GLM models were available in the evaluation session. Do not install or change credentials to obtain live verification. Record authenticated provider/Neovim checks as not run with the exact missing prerequisites unless the user supplies the setup/results. Fake-provider and serialization tests are not live compatibility claims.

Produce the synchronized result with delivered API/exposure behavior, actual inventory and measurements, verification, and limitations before final review. Submission and finishing remain separately gated by the existing workflow. Close #70 as addressed only after confirmed delivery of this combined work.
