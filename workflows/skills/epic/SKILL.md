---
name: epic
description: "Use to initialize, shape, review, resume, and complete an Epic under <repo>/.project/epics/. Never implements Task work."
allowed-tools:
    - "init_epic"
    - "adopt_github_epic"
    - "adopt_linear_epic"
    - "review_epic"
    - "prepare_epic_plan_presentation"
    - "prepare_artifacts"
    - "set_local_workflow_phase"
    - "set_github_workflow_phase"
    - "set_linear_workflow_phase"
    - "confirm_versioned_github_tracker"
    - "confirm_unversioned_github_tracker"
    - "confirm_linear_tracker"
    - "set_epic_task_target"
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
    - "prepare_integration_finish"
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
    - "read(.project/*)"
    - "write(.project/*)"
    - "edit(.project/*)"
---

# Epic

An Epic is a high-level initiative and ordered plan of prospective Tasks. Epic work shapes and maintains the initiative contract; implementation happens only through separately initialized Tasks.

For explicitly authorized Epic commits, use the available `commit` skill and its selection and message rules.

Read and follow `../../references/artifacts.md` for authoritative paths and file ownership, `../../references/communication.md` for human-facing communication and prose artifacts, `../../references/review.md` for finding adjudication in every review phase, and `../../references/planning.md` for inquiry, planning review rounds, and user diff presentation shared with Deliverables.

## Start or resume

Follow the preparation and explicit entity-selection gates in `../../references/artifacts.md` for an Epic under `.project/epics/`.

For resume:

1. Read `brief.md`, `metadata.json`, `.local/notes.md` when present, accepted `epic.md`, the relevant `.local/reviews/` round when present, and applicable `.project/policies.md`. Create missing local notes when continuing local work. Read `.local/status.md` only for workflow authority; for tracker authority require it to be absent and refresh native lifecycle/Priority through the tracker. Read `.local/scratch/` only when temporary context is relevant.
2. Because the Epic is the primary active workflow here, switch to its exact stored branch before editing Epic artifacts. This does not apply when a Task updates its parent Epic from the Task branch.
3. Reuse the initial `resume_integration` result from the artifact gate; disabled integration is silent. For enabled roles, read `../../references/integrations/shared.md`, then the selected provider reference: `../../references/integrations/tracker/github.md`, `../../references/integrations/tracker/linear.md`, or `../../references/integrations/forge/github.md`. Update only that role's record.
4. After accepted `epic.md` changes, call tracker-only `prepare_integration_projection` and follow the shared complete-body publishing contract in `../../references/integrations/shared.md`: GitHub uses `prepare_tracker_publication` for its one managed plan comment; Linear uses the same preparation tool for its Project-attached plan document, with explicit document/parent verification before updates. Trust established clear success and reconcile uncertain outcomes before retry.
5. Summarize current state and continue without creating another Epic.

## Initialize

Follow approved intake in `../../references/artifacts.md`; an adopted Epic uses an explicit GitHub Backlog/Todo issue or Linear Backlog/Todo Project and its provider's Epic preflight. Then call `init_epic` for new work, `adopt_github_epic` for the selected GitHub issue, or `adopt_linear_epic` for the selected Linear Project, with approved values, the approved Request as `request`, slug, and verified adoption `source` facts when applicable. The tool creates identity, artifacts, a repository-default start/target, and `taskTarget: epic`. Branch formats follow `../../references/setup.md`, including the read-only current Linear template/Username query for `tracker`.

Switch to the stored branch, then call `initialize_integration` with this Epic’s `entityDir`. Except for the read-only Linear branch-settings query owned by the initialization tools, persist workflow initialization before any provider mutation. Disabled roles remain absent; a role failure changes only its own pending record and never rolls working-tree work back.

## Durable working state

Follow `../../references/artifacts.md` for the request-only brief, local notes and scratch, and the mutable `.local/draft.md`. Accepted `epic.md` is written only through shared planning acceptance.

When the Epic is the primary active workflow, write workflow artifacts only inside that Epic's directory and treat repository files outside it as read-only. Provider writes remain limited to the integration lifecycle above.

## Shape the Epic

After shared research and inquiry, write `.local/draft.md` directly using the shape and complete document gate below. Apply Project Policies to planning, decomposition, review expectations, and completion.

A prospective Task is only an ordered Epic plan line. It has no Task ID, directory, branch, or external issue. Never initialize Tasks automatically from the Epic workflow.

### Task delivery strategy

During Epic planning, explain the tradeoff before the first Task is initialized: independently shippable Tasks can target the repository default branch; intermediate work requiring integration can target the Epic branch. Recommend a strategy based on the ordered decomposition and obtain explicit user approval. Record the approved strategy and rationale in the reviewed `epic.md`, including its Plan highlights and a supporting Task delivery strategy section. The initial `taskTarget: epic` is a provisioning value, not user approval.

Apply the approved routing choice through `set_epic_task_target` before committing the accepted planning work, following `../../references/epic.md`. Deliver `epic.md` and its routing metadata together. `taskTarget: default` means future Tasks should target default, not that this Epic revision is delivered; actual delivery is required at every default-target Task initialization. Strategy approval does not authorize a commit, push, PR, merge, fetch, or cleanup. An existing Epic with no recorded decision must obtain and record one through normal plan review and acceptance before the next Task is initialized. Material strategy changes use material replanning; never retarget existing Tasks.

The candidate minimum shape is:

```markdown
# <Epic title>

## Overview

<Briefly explain the initiative, why it matters, and its user-visible or operational scope.>

### Plan highlights

- <A few concise highlights of settled scope, behavior, and important boundaries.>

## <Subject-specific contract section>

<Complete settled initiative details, with additional level-two sections as needed.>

## Task delivery strategy

<Approved Epic/default strategy, rationale from the decomposition, and delivery prerequisites.>

## Ordered Tasks

1. **<Task-sized unit>** — owned outcome, relevant settled behavior/constraints, and scope boundary.
2. **<Task-sized unit>** — owned outcome, relevant settled behavior/constraints, and scope boundary.
```

### Canonical Epic document gate

Before review, rewrite the candidate until it satisfies all of these conditions:

- It is the durable initiative contract, not a compressed architecture summary, and stands alone without the conversation or working brief.
- It explains user, operator, or system outcomes before architecture. For infrastructure, migration, or internal work, use operational outcomes, invariants, boundaries, and observable changes rather than forcing product framing.
- Its concise Overview and Plan highlights accurately represent the detailed contract and keep important boundaries visible. Both portions are reviewed together under the document shape in `../../references/artifacts.md`.
- It carries every material settled behavior, scope boundary, configuration/state rule, workflow, failure contract, compatibility requirement, invariant, integration boundary, and migration state.
- It records the user-approved Task delivery strategy and rationale; the overview highlights agree with that section and the decomposition.
- It includes concrete examples when they are needed to understand an agreed behavior or configuration.
- It does not hide required contract details in `brief.md` or local notes; the accepted Epic must stand alone.
- It keeps architecture high-level and excludes implementation recipes, detailed test plans, status tracking, risk-register boilerplate, and empty template sections.
- Each Task states its owned outcome, relevant settled contract, stopping boundary, and material prerequisites or exclusions; has enough context to understand without the planning conversation; and is ordered so prerequisites come first without avoidable overlap. Do not create Tasks merely to make the list longer.

A fresh reader must be able to identify what changes, why it matters, the material rules and boundaries, how exceptional cases behave, and how the ordered Tasks deliver the initiative.

## Review and acceptance

Follow the shared planning review using `review_epic` with this Epic's `entityDir` and `phase: "plan"`. The tool snapshots `.local/draft.md` into its local review round; `prepare_epic_plan_presentation` selects the reviewed snapshot and `epic.md` target for the write tool's approval diff. Do not accept or execute the Epic until the user accepts that exact reviewed diff.

Keep Planning during plan review, corrections, presentation, and waiting for user approval. On acceptance, record the approved routing choice through `set_epic_task_target` before any planning commit, so the accepted plan and metadata are delivered together. Then set Execution through the authority/provider-specific Phase tool and reconcile through `../../references/phase.md`; lifecycle remains `inProgress`. Render and project the accepted `epic.md` through the same integration steps used on resume. Stop without initializing or implementing a Task.

## Ongoing synchronization and completion

The Epic's branch identity never changes. It may be merged into its stored default target before the Epic lifecycle completes when the user explicitly approves that merge—for example, to deliver planning first or Tasks behind feature flags. Follow `../../references/epic.md`: record the approved `target: default` or `target: epic` before committing planning work, without delivery evidence. Deliver the plan and routing metadata together; do not change the pointer after merging merely to record delivery. Every default-target Task initialization independently verifies current-revision delivery through local ancestry or exact merged GitHub PR evidence, including squash delivery without original-head ancestry. New undelivered Epic work blocks default-target Task initialization until delivered; it does not automatically change the approved routing intent. Only future Tasks use the changed pointer; existing Tasks retain their stored start/target. Never delete the Epic branch while an active Task still targets it.

Task initialization changes its selected item once from `1. **Title** — …` to `1. [TASK-<raw-id>] **Title** — …`. That qualified ID is the permanent relation; title text and ordering are display-only and may change. Every later Epic candidate must preserve existing `[TASK-…]` markers exactly.

Plan-item progress is derived by resolving each marker to its child Task lifecycle authority: read `.local/status.md` for workflow-authority Tasks and refresh native provider state for tracker-backed Tasks. No marker is prospective; In Progress/In Review is initialized, Done is complete, and Canceled is a distinct terminal canceled outcome. Changes to the accepted initiative contract must first enter the material-replanning transition in `../../references/planning.md`, then repeat candidate review and user acceptance; implementation detail must not rewrite it.

When the user explicitly resumes the Epic and asks to complete it:

1. Resolve every accepted Task marker through its child lifecycle authority. If any Task is neither `done` nor `canceled`, report the unfinished Tasks and stop.
2. Reconcile finished Task outcomes against the accepted Epic contract and Project Policies. If contract drift remains, present it and stop without changing Epic lifecycle; resolve it through the existing Epic planning/acceptance flow before retrying completion.
3. When every Task is `done` or `canceled` and no contract drift remains, set Epic lifecycle directly from `inProgress` to `done`: without a tracker, update local `.local/status.md`; with a tracker, set the provider's native Status to the configured `done` value and clear native Phase through `../../references/phase.md`. Retain the last metadata Phase.
4. Report the completion evidence. Do not modify any versioned artifact during this flow; Epic completion never creates a commit, push, PR, or CI run.

Never implement Task work from the Epic workflow. Do not push, create a PR, merge, delete branches, or use a worktree unless the user explicitly approves the exact operation or set of operations.
