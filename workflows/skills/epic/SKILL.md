---
name: epic
description: "Use to initialize, shape, review, resume, and complete an Epic under <repo>/.project/.local/epics/. Never implements Task work."
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
    - "confirm_github_tracker"
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
    - "read(.project/*)"
    - "write(.project/*)"
    - "edit(.project/*)"
---

# Epic

An Epic is an initiative and an ordered plan of prospective Tasks. Epic work shapes and maintains that plan; only separately initialized Tasks implement it.

## Read first

- [Core rules](../../references/core.md)
- [Artifacts](../../references/artifacts.md)
- [Planning](../../references/planning.md)

When reviewing, read [review](../../references/review.md). When writing human-facing text or prose artifacts, read [communication](../../references/communication.md).

**Commits:** use the available `commit` skill for any explicitly authorized Epic commit. An Epic may have several commits within its accepted scope.

## Start or resume

Follow the preparation and entity-selection gates in [artifacts](../../references/artifacts.md#initialization-inputs) for an Epic under `.project/.local/epics/`.

1. **Read:**
   - `brief.md`, `metadata.json`, `notes.md` when present, and accepted `epic.md`;
   - the relevant review round, when present;
   - applicable `.project/policies.md`;
   - `scratch/` only when that context is relevant.

   Create missing notes when continuing local work.
2. **Lifecycle:**
   - workflow authority: read `status.md`;
   - tracker authority: that file must be absent; read lifecycle and Priority fresh from the tracker.
3. **Branch:** switch to the Epic's stored branch before editing its artifacts. This doesn't apply when a Task updates its parent Epic from the Task branch.
4. **Integrations:** reuse the `resume_integration` result from the artifact gate; a disabled integration is silent. When a role is enabled, read [integration roles](../../references/integrations/shared.md), then the provider reference: [GitHub tracker](../../references/integrations/tracker/github.md), [Linear tracker](../../references/integrations/tracker/linear.md), or [GitHub forge](../../references/integrations/forge/github.md). Update only that role's record.
5. **Publication:** after accepted `epic.md` changes, call `prepare_integration_projection` and publish as described in [provider bodies](../../references/integrations/shared.md#provider-bodies). GitHub keeps one managed plan comment; Linear keeps one document attached to the Project, with document and parent verification before updates.
6. **Summarize** the current state and continue. Never create another Epic.

## Initialize

1. **Adoption preflight:** when adopting Backlog or Todo work, first read the tracker reference ([GitHub](../../references/integrations/tracker/github.md#adopt-selected-queued-work) or [Linear](../../references/integrations/tracker/linear.md#queue-intake-and-explicit-adoption)) and the [discussion rules](../../references/integrations/shared.md#provider-bodies). Complete its Epic preflight. An adopted Epic is a GitHub Backlog or Todo issue, or a Linear Backlog or Todo Project.
2. **Create the entity:** follow the approved intake in [artifacts](../../references/artifacts.md#initialization-inputs). Call `init_epic` for new work, `adopt_github_epic` for a GitHub issue, or `adopt_linear_epic` for a Linear Project, passing:
   - the approved values;
   - the Request as `request`;
   - the slug;
   - the adoption `source` facts, when adopting.

   The tool creates identity, artifacts, a repository-default start and target, and `taskTarget: epic`. With the Linear `tracker` branch format, it also reads the current template and username.
3. **Bind integrations:** switch to the stored branch and call `initialize_integration` with `entityDir`. When a role is enabled, read the integration references as on resume.
   - Workflow initialization is saved before any provider mutation, apart from the tool's read-only Linear branch-settings query.
   - Disabled roles stay absent. A role failure changes only its own pending record and never rolls back working-tree work.

## Working state

[Artifacts](../../references/artifacts.md#brief-and-local-working-state) defines the brief, notes, scratch, and `draft.md`. Accepted `epic.md` is written only through plan acceptance.

When the Epic is the active workflow, write workflow artifacts only inside its directory and treat repository files outside it as read-only. Provider writes happen only through the integration steps above.

## Shape the Epic

After research and inquiry, write `draft.md` in the shape below and check it against the document gate. Apply Project Policies to planning, decomposition, review, and completion.

A prospective Task is only an ordered plan line, with no Task ID, directory, branch, or external issue. Never initialize Tasks from the Epic workflow.

### Task delivery strategy

1. **Recommend.** Before the first Task is initialized, explain the tradeoff:
   - independently shippable Tasks can target the repository default branch;
   - intermediate work that needs integration can target the Epic branch.

   Recommend one from the decomposition and get explicit approval.
2. **Record.** Put the approved strategy and rationale in reviewed `epic.md`, both in Plan highlights and in a Task delivery strategy section. The initial `taskTarget: epic` is a provisioning value, not approval.
3. **Apply.** Call `set_epic_task_target` when the plan is accepted; when doing so, read [Epic delivery](../../references/epic.md).

**Notes:**

- `taskTarget: default` means future Tasks target default. It doesn't mean this revision is delivered; every default-target Task initialization checks delivery.
- Strategy approval doesn't authorize a commit, push, PR, merge, fetch, or cleanup.
- An existing Epic with no recorded decision must record one through plan review and acceptance before its next Task.
- Material strategy changes go through material replanning. Never retarget existing Tasks.

Minimum shape:

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

### Epic document gate

Before review, revise the draft until it meets every condition:

- **Standalone contract:** it's the durable initiative contract, not a compressed architecture summary, and stands alone without the conversation or brief. Nothing required hides in `brief.md` or notes.
- **Outcomes first:** user, operator, or system outcomes come before architecture. For infrastructure, migration, or internal work, use operational outcomes, invariants, boundaries, and observable changes instead of forcing product framing.
- **Accurate overview:** the Overview and Plan highlights represent the detailed contract and keep important boundaries visible. They're reviewed with the details, under the [document shape](../../references/artifacts.md#reviewed-document-shape).
- **Complete:** every settled behavior, scope boundary, configuration or state rule, workflow, failure contract, compatibility requirement, invariant, integration boundary, and migration state.
- **Delivery strategy:** the approved strategy and rationale are recorded, and the highlights agree with that section and the decomposition.
- **Examples:** concrete ones, where needed to understand an agreed behavior or configuration.
- **Right altitude:** architecture stays high-level. No implementation recipes, detailed test plans, status tracking, risk-register boilerplate, or empty sections.
- **Good Tasks:** each states its outcome, relevant contract, stopping boundary, and material prerequisites or exclusions, with enough context to stand alone. They're ordered so prerequisites come first, without avoidable overlap. Never add Tasks just to lengthen the list.

A fresh reader must be able to see what changes, why it matters, the rules and boundaries, how exceptional cases behave, and how the Tasks deliver the initiative.

## Review and acceptance

1. **Review.** Follow plan review in [planning](../../references/planning.md#plan-review-and-acceptance) with `review_epic`, this Epic's `entityDir`, and `phase: "plan"`. `prepare_epic_plan_presentation` returns the reviewed snapshot and the `epic.md` target for the write tool's approval diff.
2. **Wait.** Don't accept or act on the Epic until the user accepts that reviewed diff. Phase stays Planning until then.
3. **On acceptance:**
   - record the routing choice with `set_epic_task_target`;
   - set Execution ([Phase](../../references/phase.md)); lifecycle stays `inProgress`;
   - publish `epic.md` through the same integration steps as on resume.
4. **Stop** without initializing or implementing a Task.

## Ongoing synchronization and completion

### Branch and delivery

- The Epic's branch identity never changes.
- With explicit user approval, it may be merged into its default target before the Epic completes, for example to deliver planning first or to deliver Tasks behind feature flags.
- Per [Epic delivery](../../references/epic.md), record `target: default` or `target: epic` at plan acceptance, without delivery evidence. Never change the pointer after a merge just to record delivery.
- Every default-target Task initialization checks current-revision delivery itself, through local ancestry or merged GitHub PR evidence, including squash merges. Undelivered Epic work blocks those initializations without changing the approved routing.
- Only future Tasks follow a changed pointer; existing Tasks keep their start and target.
- Never delete the Epic branch while an active Task targets it.

### Task markers

- Initializing a Task changes its plan line once, from `1. **Title** — …` to `1. [TASK-<raw-id>] **Title** — …`.
- That ID is the permanent relation; title and order are display-only and may change. Every later candidate must keep existing `[TASK-…]` markers exactly.

**Progress** comes from each marker's child lifecycle: `status.md` for workflow-authority Tasks, fresh provider state for tracker-backed ones.

| Plan line | Meaning |
| --- | --- |
| No marker | prospective |
| In Progress or In Review | initialized |
| Done | complete |
| Canceled | a distinct terminal outcome |

Changes to the accepted contract go through [material replanning](../../references/planning.md#material-replanning) and another review and acceptance. Implementation detail never rewrites it.

### Completing the Epic

When the user explicitly resumes the Epic and asks to complete it:

1. Resolve every Task marker through its child lifecycle. When any Task is neither `done` nor `canceled`, report them and stop.
2. Reconcile finished Task outcomes against the Epic contract and Project Policies. When drift remains, present it and stop without changing lifecycle; resolve it through Epic planning and acceptance first.
3. Set lifecycle straight from `inProgress` to `done`:
   - without a tracker, update `status.md`;
   - with one, set native Status to the configured `done` value and clear native Phase ([Phase](../../references/phase.md)).

   Keep the last metadata Phase.
4. Report the completion evidence. Change no committed file; Epic completion never creates a commit, push, PR, or CI run.

Never implement Task work from the Epic workflow. Don't push, create a PR, merge, delete branches, or use a worktree without explicit approval of that exact operation or set.
