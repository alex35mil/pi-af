---
name: epic
description: "Use to initialize, shape, review, resume, and complete an Epic under <repo>/.project/epics/. Never implements Task work."
allowed-tools:
    - "init"
    - "review"
    - "present_plan"
    - "prepare_artifacts"
    - "set_epic_task_target"
    - "integration_context"
    - "verify_artifact_projection"
    - "read(.project/*)"
    - "write(.project/*)"
    - "edit(.project/*)"
---

# Epic

An Epic is a high-level initiative and ordered plan of prospective Tasks. Epic work shapes and maintains the initiative contract; implementation happens only through separately initialized Tasks.

Read and follow `../../references/artifacts.md` for authoritative paths and file ownership, `../../references/communication.md` for human-facing communication and prose artifacts, `../../references/review.md` for finding adjudication in every review phase, and `../../references/planning.md` for inquiry, planning review rounds, and user diff presentation shared with Deliverables.

## Start or resume

Follow the preparation and explicit entity-selection gates in `../../references/artifacts.md` for an Epic under `.project/epics/`.

For resume:

1. Read `brief.md`, `metadata.json`, accepted `epic.md`, the relevant `.local/reviews/` round when present, and applicable `.project/policies.md`. Read `.local/status.md` only for workflow authority; for tracker authority require it to be absent and refresh native lifecycle/Priority through the tracker. Read `.local/scratch/` only when temporary context is relevant.
2. Because the Epic is the primary active workflow here, switch to its exact stored branch before editing Epic artifacts. This does not apply when a Task updates its parent Epic from the Task branch.
3. Call `integration_context` with `operation: "resume"`; disabled integration is silent. For enabled roles, read `../../references/integrations/shared.md`, then the selected provider reference: `../../references/integrations/tracker/github.md`, `../../references/integrations/tracker/linear.md`, or `../../references/integrations/forge/github.md`. Update only that role's record.
4. After accepted `epic.md` changes, call `artifactProjection`, which requires only the tracker role. In versioned mode, when a containing commit and forge exist, call `artifactLinks`, which requires only the forge role, and render the shared destination-specific `## Links` section for PR or tracker content. Unversioned mode returns an explicit link skip and never exposes artifact links.
5. Summarize current state and continue without creating another Epic.

## Initialize

Follow approved intake in `../../references/artifacts.md`; an adopted Epic uses an explicit GitHub Backlog/Todo issue or Linear Backlog/Todo Project and its provider's Epic preflight. Then call `init` with `entity: "epic"`, approved values, the approved Request as `request`, slug, and matching source variant. The tool creates identity, artifacts, a repository-default start/target, and `taskTarget: epic`. Branch formats follow `../../references/setup.md`, including the read-only current Linear template/Username query for `tracker`.

Switch to the stored branch, then call `integration_context` with `operation: "initialize"`. Except for the read-only Linear branch-settings query owned by `init`, persist workflow initialization before any provider mutation. Disabled roles remain absent; a role failure changes only its own pending record and never rolls working-tree work back.

## Durable working state

Follow `../../references/artifacts.md` for resumable brief updates, local scratch, and the mutable `.local/draft.md`. Accepted `epic.md` is written only through shared planning acceptance.

When the Epic is the primary active workflow, write workflow artifacts only inside that Epic's directory and treat repository files outside it as read-only. Provider writes remain limited to the integration lifecycle above.

## Shape the Epic

After shared research and inquiry, write `.local/draft.md` directly using the shape and complete document gate below. Apply Project Policies to planning, decomposition, review expectations, and completion.

A prospective Task is only an ordered Epic plan line. It has no Task ID, directory, branch, or external issue. Never initialize Tasks automatically from the Epic workflow.

The candidate minimum shape is:

```markdown
# <Epic title>

## What we are accomplishing

<Briefly explain what the initiative is and aims to accomplish, including its user-visible or operational scope.>

<Subject-specific sections needed to carry the settled initiative contract.>

## Ordered Tasks

1. **<Task-sized unit>** — owned outcome, relevant settled behavior/constraints, and scope boundary.
2. **<Task-sized unit>** — owned outcome, relevant settled behavior/constraints, and scope boundary.
```

### Canonical Epic document gate

Before review, rewrite the candidate until it satisfies all of these conditions:

- It is the durable initiative contract, not a compressed architecture summary, and stands alone without the conversation or working brief.
- It explains user, operator, or system outcomes before architecture. For infrastructure, migration, or internal work, use operational outcomes, invariants, boundaries, and observable changes rather than forcing product framing.
- It carries every material settled behavior, scope boundary, configuration/state rule, workflow, failure contract, compatibility requirement, invariant, integration boundary, and migration state.
- It includes concrete examples when they are needed to understand an agreed behavior or configuration.
- It does not hide required contract details in `brief.md`; the brief supports planning but is not a substitute for the accepted Epic.
- It keeps architecture high-level and excludes implementation recipes, detailed test plans, status tracking, risk-register boilerplate, and empty template sections.
- Each Task states its owned outcome, relevant settled contract, stopping boundary, and material prerequisites or exclusions; has enough context to understand without the planning conversation; and is ordered so prerequisites come first without avoidable overlap. Do not create Tasks merely to make the list longer.

A fresh reader must be able to identify what changes, why it matters, the material rules and boundaries, how exceptional cases behave, and how the ordered Tasks deliver the initiative.

## Review and acceptance

Follow the shared planning review with `entity: "epic"`, this Epic's `entityDir`, and `phase: "plan"`. The tool snapshots `.local/draft.md` into its local review round; `present_plan` targets `epic.md`. Do not accept or execute the Epic until the user accepts that exact reviewed diff.

On acceptance, change `workStage` from `planning` to `execution`; lifecycle remains `inProgress`. For GitHub, remove the configured Planning label through the provider's absolute label read/update/read-back procedure. Project the accepted `epic.md` and request available forge links through the same integration steps used on resume. Stop without initializing or implementing a Task.

## Ongoing synchronization and completion

The Epic's branch identity never changes. It may be merged into its stored default target before the Epic lifecycle completes when the user explicitly approves that merge—for example, to deliver Tasks behind feature flags. After Git in the current clone confirms the merge, call `set_epic_task_target` with `target: default`; only later Tasks use default. Before new unmerged Epic work, call it with `target: epic`. Existing Tasks retain their stored target. Never delete the Epic branch while an active Task still targets it.

Task initialization changes its selected item once from `1. **Title** — …` to `1. [TASK-<raw-id>] **Title** — …`. That qualified ID is the permanent relation; title text and ordering are display-only and may change. Every later Epic candidate must preserve existing `[TASK-…]` markers exactly.

Plan-item progress is derived by resolving each marker to its child Task lifecycle authority: read `.local/status.md` for workflow-authority Tasks and refresh native provider state for tracker-backed Tasks. No marker is prospective; In Progress/In Review is initialized, Done is complete, and Canceled is a distinct terminal canceled outcome. Changes to the accepted initiative contract must first enter the material-replanning transition in `../../references/planning.md`, then repeat candidate review and user acceptance; implementation detail must not rewrite it.

When the user explicitly resumes the Epic and asks to complete it:

1. Resolve every accepted Task marker through its child lifecycle authority. If any Task is neither `done` nor `canceled`, report the unfinished Tasks and stop.
2. Reconcile finished Task outcomes against the accepted Epic contract and Project Policies. If contract drift remains, present it and stop without changing Epic lifecycle; resolve it through the existing Epic planning/acceptance flow before retrying completion.
3. When every Task is `done` or `canceled` and no contract drift remains, set Epic lifecycle directly from `inProgress` to `done`: without a tracker, update local `.local/status.md`; with a tracker, set the provider's native Status to the configured `done` value.
4. Report the completion evidence. Do not modify any versioned artifact during this flow; Epic completion never creates a commit, push, PR, or CI run.

Never implement Task work from the Epic workflow. Do not push, create a PR, merge, delete branches, or use a worktree unless the user explicitly approves the exact operation or set of operations.
