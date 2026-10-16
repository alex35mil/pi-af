---
name: todo
description: "Use for /todo, ‘todo it’, or requests to report a workflow defect or friction: create ordinary Todo work in the current or workflow-source project's tracker without initializing an Epic, Task, or Gig."
allowed-tools:
    - "integration_context"
---

# Todo

Read and follow `../../references/queue.md` with exact destination `todo`. Ordinary intake uses `target: "current"`; an explicit request such as “Report this workflow issue” uses `target: "workflow"` and the shared report preparation/privacy rules. A reporting suggestion alone does not authorize publication.

Todo means work we have committed to doing and can pick up next. It remains uninitialized until the user starts it through `/epic`, `/task`, or `/gig`.
