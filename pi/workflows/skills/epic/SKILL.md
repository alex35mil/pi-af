---
name: epic
description: "Use to initialize, shape, review, resume, and complete an Epic under <repo>/.project/.local/epics/. Never implements Task work."
allowed-tools:
    - "inspect_session_analysis"
    - "preflight_epic"
    - "init_github_epic"
    - "init_linear_epic"
    - "review_epic"
    - "record_review_response"
    - "accept_epic_tasks"
    - "prepare_artifacts"
    - "set_github_workflow_phase"
    - "set_linear_workflow_phase"
    - "restore_epic"
    - "restore_epic_plan_source"
    - "plan_epic_task_issues"
    - "record_epic_task_issue"
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
    - "prepare_label_mutation"
    - "prepare_github_phase_mutation"
    - "prepare_linear_phase_mutation"
    - "resolve_resource_ids"
    - "record_resource_ids"
    - "invalidate_resource_ids"
    - "select_pull_request_resource"
    - "read(.project/*)"
    - "write(.project/*)"
    - "edit(.project/*)"
---

# Epic

An Epic is an initiative and an ordered plan of Tasks. `epic.md` is its current state: the goal and the Task list, kept true as Tasks deliver. Epic work shapes and maintains that plan and keeps one tracker issue per planned Task; only separately started Tasks implement it.

## Read first

- [Core rules](../../references/core.md)
- [Artifacts](../../references/artifacts.md)
- [Planning](../../references/planning.md)

When reviewing, read [review](../../references/review.md). When writing human-facing text or prose artifacts, read [communication](../../references/communication.md).

**Commits:** use the available `commit` skill for any explicitly authorized Epic commit, such as the empty commit that lets the Epic branch open a PR.

## Start or resume

Follow the preparation and entity-selection gates in [artifacts](../../references/artifacts.md#initialization-inputs) for an Epic under `.project/.local/epics/`. When this clone has no local directory for the Epic, [restore it](../../references/epic.md#restore-an-epic) first.

1. **Read:**
   - `brief.md`, `metadata.json`, `notes.md` when present, and `epic.md`;
   - the relevant review round, when present;
   - applicable `.project/policies.md`;
   - `scratch/` only when that context is relevant.

   Create missing notes when continuing local work.
2. **Lifecycle:** read lifecycle and Priority fresh from the tracker. Epic artifacts live outside Git, so no branch switch is needed.
3. **Published plan:** [compare](../../references/epic.md#compare-with-the-published-plan) the local `epic.md` with it.
4. **Integrations:** reuse the `resume_integration` result from the artifact gate. Read [integration roles](../../references/integrations/shared.md), then the provider reference: [GitHub tracker](../../references/integrations/tracker/github.md) or [Linear tracker](../../references/integrations/tracker/linear.md), and [GitHub forge](../../references/integrations/forge/github.md).
5. **Task issues:** once the Task list is accepted, run [Task issue processing](../../references/epic-tasks.md#task-issue-processing) before any publication. It finishes interrupted runs and is safe to repeat.
6. **Publication:** after `epic.md` changes, call `prepare_integration_projection` and publish as described in [provider bodies](../../references/integrations/shared.md#provider-bodies). GitHub keeps one managed plan comment; Linear keeps one document attached to the Project. Every update to the published plan posts a plan-update note.
7. **Summarize** the current state and continue. Never create another Epic.

## Initialize

1. **Adoption preflight:** when adopting Backlog or Todo work, first read the tracker reference ([GitHub](../../references/integrations/tracker/github.md#adopt-selected-queued-work) or [Linear](../../references/integrations/tracker/linear.md#queue-intake-and-explicit-adoption)) and the [discussion rules](../../references/integrations/shared.md#provider-bodies). Complete its Epic preflight. An adopted Epic is a GitHub Backlog or Todo issue, or a Linear Backlog or Todo Project.
2. **Create the entity:** follow the intake in [artifacts](../../references/artifacts.md#initialization-inputs), then [initialize from the tracker object](../../references/integrations/shared.md#initialize-from-the-tracker-object).
   - New work: call `preflight_epic`, then create the GitHub issue or Linear Project as the tracker reference describes.
   - Call `init_github_epic` or `init_linear_epic` with the intake values, the Request as `request`, the slug, and the issue or Project as `object`.

   The tool names the directory and branch from the object (a Linear Epic is dated by its Project's creation) and starts from and targets the repository default.
3. **Set up the board:** call `initialize_integration` with `entityDir`, and follow the provider reference. A board failure is reconciled on resume and never rolls back working-tree work.

## Working state

[Artifacts](../../references/artifacts.md#brief-and-local-working-state) defines the brief, notes, and scratch.

When the Epic is the active workflow, write workflow artifacts only inside its directory and treat repository files outside it as read-only. Provider writes happen only through the integration steps above.

## Shape the Epic

After research and inquiry, write `epic.md` in the shape below. Apply Project Policies to planning, decomposition, review, and completion.

Each Task is a `### ` section under `## Tasks`, in the [Epic Task format](../../references/epic-tasks.md#epic-task-format). Accepting the Task list creates its tracker issue, but never a Task directory, branch, or artifact. Never initialize Tasks from the Epic workflow.

### Task delivery strategy

1. **Recommend.** Before the first Task starts, explain the tradeoff:
   - independently shippable Tasks can target the repository default branch;
   - intermediate work that needs integration can target the Epic branch.

   Recommend one from the decomposition and get explicit approval.
2. **Record.** Put the approved strategy in `epic.md`: the `Task target:` and `Epic branch:` lines and the rationale in the Task delivery strategy section, and the choice in Plan highlights. [Epic routing](../../references/epic.md#routing) owns the format and how Tasks apply it.

A strategy change needs another plan review and the user's acceptance. Never retarget existing Tasks.

Minimum shape:

```markdown
# <Epic title>

## Overview

<Briefly explain the initiative, why it matters, and its user-visible or operational scope.>

### Plan highlights

- <A few concise highlights of settled scope, behavior, and important boundaries.>

## Task delivery strategy

Task target: <default | epic>
Epic branch: <the Epic's branch name>

<Rationale from the decomposition and delivery prerequisites.>

## Tasks

### <Task-sized unit>

Kind: <feature | bugfix | refactor | research | audit | chore>
Labels: <group=value, …, only with label groups configured>

<A one-paragraph outcome: what the Task delivers and where it stops. Any Markdown.>
```

- **Goal first:** the Overview states the initiative's outcome and why it matters, so a fresh reader understands it without the conversation.
- **A map, not a contract:** detail lives in Task plans, Task results, and shipped documentation. No implementation recipes, test plans, status tracking, or empty sections.
- **Good Tasks:** each has a Kind and an outcome paragraph that stands alone; its body becomes the Task issue's description. Order them so prerequisites come first, without avoidable overlap. Never add Tasks just to lengthen the list.

## Review and acceptance

1. **Review.** Follow [Epic plans](../../references/planning.md#epic-plans) with `review_epic`. The reviewer checks the goal against the brief and user decisions, the Task decomposition, the routing lines, and that existing Task markers survive.
2. **Wait.** Summarize the plan and its Task list in chat, and wait for the user's acceptance. Phase stays Planning until then.
3. **On acceptance:**
   - call `accept_epic_tasks`;
   - set Execution ([Phase](../../references/phase.md)); lifecycle stays `inProgress`;
   - run [Task issue processing](../../references/epic-tasks.md#task-issue-processing); accepting the Task list approves its creates, cancellations, and board updates;
   - publish `epic.md` through the same integration steps as on resume.
4. **Stop** without initializing or implementing a Task.

## Ongoing synchronization and completion

### Epic branch

- The Epic's branch identity never changes, and the plan's `Epic branch:` line records it for every clone.
- It's the merge target for Epic-target Tasks. With explicit user approval, it merges into its default target through its own PR.
- Default-target Tasks never depend on it. Never delete it while a Task targets it.

### Task markers and progress

Issue processing tags each Task heading once with its issue's marker, `[#12]` on GitHub or `[ENG-12]` on Linear. The marker is the permanent relation. Every later edit keeps existing markers exactly. [Epic Tasks](../../references/epic-tasks.md#progress-and-replanning) defines progress states and how to remove a Task.

Changing the Task list needs another review and acceptance ([accepted Task list](../../references/epic-tasks.md#accepted-task-list)). Other `epic.md` edits, from the Epic or from a Task, are made in place and republished with a plan-update note.

### Completing the Epic

When the user explicitly resumes the Epic and asks to complete it:

1. Resolve every Task through its issue's lifecycle. When any Task is untagged, queued, or started but neither `done` nor `canceled`, report them and stop.
2. Set native Status straight from In Progress to the configured `done` value and clear native Phase ([Phase](../../references/phase.md)). Keep the last metadata Phase.
3. Report the completion evidence. Change no committed file; Epic completion never creates a commit, push, PR, or CI run.
4. Call `inspect_session_analysis`. When it returns `enabled`, read [session analysis](../../references/session-analysis.md).

Never implement Task work from the Epic workflow. Don't push, create a PR, merge, delete branches, or use a worktree without explicit approval of that exact operation or set.
