---
name: task
description: "Use for Deliverable work belonging to exactly one Epic under <repo>/.project/epics/<epic>/tasks/."
allowed-tools:
    - "init"
    - "review"
    - "present_plan"
    - "prepare_artifacts"
    - "render_provider_body"
    - "verify_artifact_projection"
    - "integration_context"
    - "resource_ids"
    - "finalize_linear_branch"
    - "cleanup_delivery_branch"
    - "read(.project/*)"
    - "write(.project/*)"
    - "edit(.project/*)"
---

# Task

A Task is a Deliverable belonging to exactly one Epic.

First read and follow `../../references/deliverable.md` relative to this skill directory. That file owns the shared lifecycle. This file owns Task parent selection, initialization, and parent synchronization.

## Resume

Use the shared Deliverable preparation, entity-selection, and artifact-read flow for a Task under its Epic's `tasks/` directory. Then:

1. Derive the exact parent Epic from filesystem containment. Read its `brief.md`, `metadata.json`, `.local/notes.md` when present, conditional `.local/status.md` or native tracker state, and `epic.md`.
2. Verify the Task's copied branch is either the containing Epic's branch or repository-default target and `epic.md` references this Task's qualified ID exactly once. The stored Task target remains authoritative when the Epic's current `taskTarget` differs.
3. Continue through the shared Deliverable lifecycle.

## Initialize

Follow the approved intake in `../../references/artifacts.md`. A Task additionally requires the user to identify one initialized parent Epic under `.project/epics/` and one prospective Task by its exact bold title in the accepted `epic.md` ordered plan. Read that parent before `init`; do not infer the selection or initialize prospective work automatically. Adoption uses the selected provider's Task preflight, including exact parent Linear Project validation.

After these gates, call `init` with `entity: "task"`, the exact repo-relative `parentEpicDir`, the selected `epicItemTitle`, approved metadata, the approved Request summary as `request`, slug, and source variant. The Task's approved `title` may differ from the Epic item's title. The tool requires exactly one ordered Task entry with `epicItemTitle`, generates the Task ID, tags that entry as `[TASK-<raw-id>]`, and thereafter identity—not title or ordering—is the relation. It also creates the timestamp/ID directory and renders the project-wide configured branch. `tracker` format uses the exact Linear issue branch.

The Task copies the parent Epic's current `taskTarget` into its own immutable `start`/`target`: the Epic branch before an early Epic merge, or the repository default branch afterward. In versioned mode, default targeting requires the accepted parent `epic.md` to be reachable from default. A new Linear Task using `tracker` format initially stores `tracker-pending`; initialize its tracker projection, persist the returned `gitBranchName`, call `finalize_linear_branch`, then switch to the ready branch. Static formats create the ready branch during `init`. Follow the shared Deliverable lifecycle only after readiness.

## Parent synchronization

Remain on the exact stored Task branch for every parent-Epic artifact change made as part of this Task, including `.local/notes.md`, `.local/draft.md`, local review artifacts, and `epic.md`. Do not switch to or edit directly on the Epic branch or default branch. The Task branch's immutable target—Epic or default—keeps the contract change coupled to the implementation that required it.

At every material Task decision and before final review, compare the Task outcome with the parent Epic contract:

- **The Epic contract remains accurate:** Keep implementation details in Task artifacts and do not rewrite the Epic item after its one-time Task ID tag. Task progress comes from the child lifecycle.
- **A mismatch or domain decision is unresolved:** Explain the mismatch and ask the user before changing any Epic artifact.
- **The user approves an Epic contract change:** Update Epic working state, revise its `.local/draft.md`, run `review` with `entity: "epic"` and `phase: "plan"`, then present the approved snapshot through the configured `epic.md` write/edit diff gate.

Do not request Task final review while an approved parent-contract change remains unsynchronized. If the user rejects or defers a needed Epic contract change, keep the unresolved divergence current in the Task and parent local notes; do not request final review or mark the Task `done` unless the user explicitly accepts completion with that divergence.

Preserve every existing `[TASK-…]` marker across approved Epic title/order edits. Follow shared delivery and cleanup; the child's authoritative `done` lifecycle makes its Epic plan item complete without another content commit.

A Task can never lose or change its parent and cannot be converted into a Gig.
