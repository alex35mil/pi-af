# Epic Tasks

An accepted Epic owns one tracker issue for every planned Task, so the tracker's Epic progress reflects the whole plan. This file owns the Task format, Task issue processing, progress, and removing Tasks.

## Epic Task format

Accepted `epic.md` lists Tasks as `### ` sections under one `## Tasks` section. Section order is Task order.

```markdown
## Tasks

### [#12] Build the parser

Kind: feature

Owned outcome, settled contract, and stopping boundary. Any Markdown: paragraphs, lists, code blocks.

### Wire the CLI

Kind: chore

…
```

- **Heading:** `<title>` before the Task's issue exists, then `[<marker>] <title>`. Titles are unique within the Epic.
- **Kind:** the first body line, one of `feature`, `bugfix`, `refactor`, `research`, `audit`, or `chore`. A Task starts with this Kind.
- **Status:** an optional `Status: canceled` line after `Kind:`, only on a tagged Task. It removes the Task from the plan.
- **Description:** the rest of the section. It must not be empty, and becomes the issue's description.

Code rejects anything else, including a Task section outside `## Tasks`.

## Task issue processing

Run it after every accepted `epic.md` revision and on every Epic or Task resume, before any publication of the parent:

1. Read the Epic's Priority fresh, and every child issue with complete pagination: GitHub sub-issues with their configured Project Status and Priority, or Linear issues in the Epic's Project.
2. Call `plan_epic_task_issues`. It reconciles the whole plan against those facts and keeps no saved progress.
3. Apply its steps in order:
   - Run each `create`, then call `record_epic_task_issue` with that create as `evidence`.
   - For a `tag`, call `record_epic_task_issue` without evidence. A tag links an existing queued child with the same title, such as one created before an interruption.
   - Run each board repair, cancellation, and close as returned.
4. Repeat from step 1 until it returns `complete`. On `blocked`, stop and report the Task and reason.

**Rules:**

- Plan acceptance approves these creates, cancellations, and board updates, with no second confirmation. Rerunning after an interruption needs no new approval.
- Created issues are sub-issues on GitHub with the Task's Kind label, or Project issues on Linear.
- A tagged Task whose issue is In Progress, In Review, or Done has started, with or without a local Task directory; it may have started in another clone.
- A tagged Task that hasn't started must be a child of this Epic in Backlog, Todo, or Canceled. A local Task directory on a queued issue is an error.
- Processing ensures every queued Task's board state itself, whatever Project automations did first: on the Project, Status Todo (Backlog or empty becomes Todo), and the Epic's Priority when the Task has none. A Priority already set on the Task is kept, and a Canceled issue is left alone. To defer a Task, mark it `Status: canceled` or replan; a manual Backlog move is reverted.
- A Task that has already started is never canceled.
- An uncertain create needs no separate recovery: the next run's title lookup finds the issue or confirms it's absent.
- Creating issues never initializes a Task. Task issues stay unassigned until the Task starts.

## Progress and replanning

Progress comes from the plan and each tagged Task's lifecycle, read fresh from the tracker.

| Plan Task | Tracker lifecycle | State |
| --- | --- | --- |
| untagged | — | unpublished; issue processing hasn't finished |
| tagged | Backlog or Todo | queued |
| tagged | In Progress or In Review | started |
| tagged | Done | complete |
| tagged | Canceled | canceled |

**Replanning:**

- New Tasks get issues through issue processing.
- To remove a queued Task, keep its section and marker and add `Status: canceled`. Never delete a tagged section.
- A started, complete, or canceled Task can't be removed.
- To link an existing queued child issue of this Epic, add its section already tagged with that issue's marker.
- Editing a queued Task's title, description, or Kind doesn't rewrite its issue.
