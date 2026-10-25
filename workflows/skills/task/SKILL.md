---
name: task
description: "Use for Deliverable work belonging to exactly one Epic under <repo>/.project/epics/<epic>/tasks/."
allowed-tools:
    - "init_task"
    - "adopt_github_task"
    - "adopt_linear_task"
    - "review_task"
    - "prepare_task_plan_presentation"
    - "review_epic"
    - "prepare_epic_plan_presentation"
    - "prepare_artifacts"
    - "set_local_workflow_phase"
    - "set_github_workflow_phase"
    - "set_linear_workflow_phase"
    - "confirm_versioned_github_tracker"
    - "confirm_unversioned_github_tracker"
    - "confirm_linear_tracker"
    - "render_provider_body"
    - "prepare_tracker_publication"
    - "prepare_tracker_publication_update"
    - "record_tracker_publication"
    - "recover_tracker_publication"
    - "verify_artifact_projection"
    - "inspect_integrations"
    - "inspect_adoption"
    - "initialize_integration"
    - "resume_integration"
    - "prepare_integration_projection"
    - "prepare_integration_pull_request"
    - "prepare_integration_shipping"
    - "prepare_integration_merge"
    - "prepare_tracker_mutation"
    - "prepare_github_phase_mutation"
    - "prepare_linear_phase_mutation"
    - "begin_resource_creation"
    - "record_resource_creation"
    - "resolve_resource_ids"
    - "record_resource_ids"
    - "invalidate_resource_ids"
    - "select_pull_request_resource"
    - "finalize_linear_branch"
    - "cleanup_ancestry_delivery_branch"
    - "cleanup_github_delivery_branch"
    - "read(.project/*)"
    - "write(.project/*)"
    - "edit(.project/*)"
---

# Task

A Task is a Deliverable belonging to exactly one Epic.

## Read first

- [Core rules](../../references/core.md)
- [Deliverable lifecycle](../../references/deliverable.md)
- [Artifacts](../../references/artifacts.md)

The Deliverable lifecycle owns the shared flow. This file owns Task parent selection, initialization, and parent synchronization.

## Resume

Use the shared Deliverable preparation, entity-selection, and artifact-read flow for a Task under its Epic's `tasks/` directory. Then:

1. Derive the exact parent Epic from filesystem containment. Read its `brief.md`, `metadata.json`, `.local/notes.md` when present, conditional `.local/status.md` or native tracker state, and `epic.md`.
2. Verify the Task's copied branch is either the containing Epic's branch or repository-default target and `epic.md` references this Task's qualified ID exactly once. The stored Task target remains authoritative when the Epic's current `taskTarget` differs.
3. Continue through the shared Deliverable lifecycle.

## Initialize

When adopting Backlog or Todo work, first read the selected tracker reference ([GitHub](../../references/integrations/tracker/github.md#adopt-selected-queued-work) or [Linear](../../references/integrations/tracker/linear.md#queue-intake-and-explicit-adoption)) and the [discussion rules](../../references/integrations/shared.md#provider-bodies), and complete its preflight before calling the adoption tool.

Follow the approved intake in [artifacts](../../references/artifacts.md#initialization-inputs). A Task additionally requires the user to identify one initialized parent Epic under `.project/epics/` and one prospective Task by its exact bold title in the accepted `epic.md` ordered plan. Read that parent before initialization; do not infer the selection or initialize prospective work automatically. Adoption uses the selected provider's Task preflight, including exact parent Linear Project validation.

Before initializing the Task, read the parent's user-approved Task delivery strategy and rationale in accepted `epic.md`, and check its current `taskTarget`. Do not treat the initial Epic pointer as approval. When the strategy is absent or conflicts with the intended target, resolve it with the user through the Epic's planning/acceptance and routing-selection procedure before initialization. The approved routing intent is recorded before committing Epic planning; selecting default does not establish delivery. When the target is default, read [Epic delivery](../../references/epic.md) for the shared delivery checks and evidence inputs; an earlier target switch does not establish current delivery.

After these gates, call `init_task`, `adopt_github_task`, or `adopt_linear_task` as appropriate, with the exact repo-relative `parentEpicDir`, the selected `epicItemTitle`, approved metadata, the approved Request summary as `request`, slug, and verified adoption `source` facts when applicable. The Task's approved `title` may differ from the Epic item's title. The tool requires exactly one ordered Task entry with `epicItemTitle`, generates the Task ID, tags that entry as `[TASK-<raw-id>]`, and thereafter identity—not title or ordering—is the relation. It also creates the timestamp/ID directory and renders the project-wide configured branch. `tracker` format uses the exact Linear issue branch.

The Task copies the parent Epic's current `taskTarget` into its own immutable `start`/`target`: either the Epic branch or its stored repository-default target. Default targeting revalidates current delivery through local ancestry or explicit `epicDelivery: { kind: "github-pr", evidence }` from the configured forge, including squash merges. Supply that current-operation PR evidence to any new/adopted Task initialization tool when using the PR route. In versioned mode, default targeting also requires the exact working accepted parent `epic.md` blob to be reachable from default. A new Linear Task using `tracker` format initially stores `tracker-pending`; initialize its tracker projection, persist the returned `gitBranchName`, call `finalize_linear_branch`, then switch to the ready branch. Static formats create the ready branch during initialization. Follow the shared Deliverable lifecycle only after readiness.

## Parent synchronization

Remain on the exact stored Task branch for every parent-Epic artifact change made as part of this Task, including `.local/notes.md`, `.local/draft.md`, local review artifacts, and `epic.md`. Do not switch to or edit directly on the Epic branch or default branch. The Task branch's immutable target—Epic or default—keeps the contract change coupled to the implementation that required it.

At every material Task decision and before final review, compare the Task outcome with the parent Epic contract:

- **The Epic contract remains accurate:** Keep implementation details in Task artifacts and do not rewrite the Epic item after its one-time Task ID tag. Task progress comes from the child lifecycle.
- **A mismatch or domain decision is unresolved:** Explain the mismatch and ask the user before changing any Epic artifact.
- **The user approves an Epic contract change:** Update Epic working state, revise its `.local/draft.md`, run `review_epic` with `phase: "plan"`, then present the approved snapshot through the configured `epic.md` write/edit diff gate.

After accepting a parent `epic.md` change, project that exact parent's accepted source through the shared integration contract: Use `prepare_tracker_publication` with the parent `entityDir` and its saved publication state: GitHub updates that Epic's issue comment; Linear updates that Epic's Project-attached document. The Task's own document belongs to its issue, not the parent Project. Remain on the Task branch.

Do not request Task final review while an approved parent-contract change remains unsynchronized. If the user rejects or defers a needed Epic contract change, keep the unresolved divergence current in the Task and parent local notes; do not request final review or mark the Task `done` unless the user explicitly accepts completion with that divergence.

Preserve every existing `[TASK-…]` marker across approved Epic title/order edits. Follow shared delivery and cleanup; the child's authoritative `done` lifecycle makes its Epic plan item complete without another content commit.

A Task can never lose or change its parent and cannot be converted into a Gig.
