---
name: task
description: "Use for Deliverable work belonging to exactly one Epic under <repo>/.project/.local/epics/<epic>/tasks/."
allowed-tools:
    - "preflight_task"
    - "init_github_task"
    - "init_linear_task"
    - "review_task"
    - "prepare_task_plan_presentation"
    - "review_epic"
    - "prepare_epic_plan_presentation"
    - "prepare_artifacts"
    - "set_github_workflow_phase"
    - "set_linear_workflow_phase"
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
    - "cleanup_delivery_branch"
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

The Deliverable lifecycle owns the shared flow. This file owns choosing the parent, initialization, and parent synchronization.

## Resume

Follow the Deliverable resume steps for a Task under its Epic's `tasks/` directory, then:

1. **Find the parent** from the directory the Task lives in. Read its `brief.md`, `metadata.json`, `notes.md` when present, its native tracker lifecycle, and `epic.md`.
2. **Verify:**
   - the Task's copied branch is the parent's Epic branch or the repository default;
   - `epic.md` carries this Task's marker (`[#N]` or `[ENG-N]`) exactly once.

   The Task's stored target wins when the Epic's current `taskTarget` differs.
3. **Continue** through the Deliverable lifecycle.

## Initialize

Initialization follows [initialize from the tracker object](../../references/integrations/shared.md#initialize-from-the-tracker-object).

1. **Adoption preflight:** when adopting Backlog or Todo work, first read the tracker reference ([GitHub](../../references/integrations/tracker/github.md#adopt-selected-queued-work) or [Linear](../../references/integrations/tracker/linear.md#queue-intake-and-explicit-adoption)) and the [discussion rules](../../references/integrations/shared.md#provider-bodies). Complete its Task preflight, including the exact parent Linear Project check.
2. **Choose the parent and item:** follow the approved intake in [artifacts](../../references/artifacts.md#initialization-inputs). The user must also name:
   - one initialized parent Epic under `.project/.local/epics/`;
   - one prospective Task, by its exact bold title in that Epic's accepted plan.

   Read the parent first. Never infer the selection or initialize prospective work on your own.
3. **Check the delivery strategy:**
   - Read the parent's approved Task delivery strategy and rationale in `epic.md`, and its current `taskTarget`. The initial Epic pointer is not approval.
   - When the strategy is missing or conflicts with the intended target, resolve it with the user through the Epic's planning, acceptance, and routing steps first.
   - Routing intent is recorded at Epic plan acceptance, and selecting default proves no delivery. When the target is default, read [Epic delivery](../../references/epic.md). An earlier target switch doesn't prove current delivery.
4. **New work:** call `preflight_task` with the values below, then create the issue in the parent's relationship as the tracker reference describes.
5. **Initialize:** call `init_github_task` or `init_linear_task` with:
   - the repo-relative `parentEpicDir`;
   - the selected `epicItemTitle`;
   - the approved metadata, the Request as `request`, and the slug;
   - the issue as `object`.

   **What the tool does:**
   - It requires exactly one plan entry with `epicItemTitle` and tags it with the issue's marker, `[#N]` or `[ENG-N]`. From then on the marker, not the title or order, is the relation. The Task's own `title` may differ from the plan line.
   - It names the directory and branch from the issue. The `tracker` format uses the Linear issue's `gitBranchName`.
6. **Targets:** the Task copies the parent's current `taskTarget` into its immutable `start` and `target`, either the Epic branch or the stored default.
   - A default target revalidates delivery through local ancestry or `epicDelivery: { kind: "github-pr", evidence }` from the configured forge, which covers squash merges. Pass current PR evidence to preflight and initialization when using that route.

Finish board setup before planning.

## Parent synchronization

Stay on the Task's stored branch for every parent Epic change made as part of this Task: its `notes.md`, `draft.md`, review files, and `epic.md`. Never switch to or edit on the Epic branch or the default branch. The Task's immutable target, Epic or default, keeps the contract change together with the implementation that needed it.

At every material Task decision, and before final review, compare the outcome with the Epic contract:

| Situation | Action |
| --- | --- |
| The Epic contract is still accurate | Keep implementation details in Task artifacts. Don't rewrite the Epic's plan line after its one-time ID tag; progress comes from the Task's lifecycle. |
| A mismatch or domain decision is unresolved | Explain it and ask before changing any Epic artifact. |
| The user approves an Epic contract change | Update the Epic's notes, revise its `draft.md`, run `review_epic` with `phase: "plan"`, then present the approved snapshot through the `epic.md` diff gate. |

**After an accepted `epic.md` change:**

- Publish that parent's accepted source by calling `prepare_tracker_publication` with the parent's `entityDir` and saved publication state. GitHub updates the Epic's issue comment; Linear updates the Epic's Project document.
- The Task's own document belongs to its issue, not the parent Project. Stay on the Task branch.

**Unsynchronized changes:**

- Don't request the Task's final review while an approved parent change is unsynchronized.
- When the user rejects or defers a needed Epic change, keep the divergence current in both the Task's and the parent's notes.
- Don't request final review or mark the Task `done` unless the user explicitly accepts completing with that divergence.

**Markers and completion:**

- Keep every Task marker (`[#N]` or `[ENG-N]`) through approved Epic title or order edits.
- Follow the shared delivery and cleanup. The Task's `done` lifecycle completes its plan line without another commit.

A Task can never lose or change its parent and cannot be converted into a Gig.
