---
name: todo
description: "Use for /todo, ‘todo it’, or requests to report a workflow defect or friction: create ordinary Todo work in the current or workflow-source project's tracker without initializing an Epic, Task, or Gig."
allowed-tools:
    - "inspect_integrations"
    - "inspect_queue_intake"
---

# Todo

Todo is work we've committed to and can pick up next. Use destination `todo`.

- Ordinary intake uses `target: "current"`.
- An explicit request such as "Report this workflow issue" uses `target: "workflow"` and the report preparation and privacy rules in [queue](../../references/queue.md#prepare-a-workflow-report). Suggesting a report doesn't authorize sending one.

## Read first

- [Core rules](../../references/core.md)
- [Queue](../../references/queue.md)

Todo holds Epics and Gigs. Tasks come only from accepted Epic plans. The work stays uninitialized until the user starts it through `/epic`, `/task`, or `/gig`.
