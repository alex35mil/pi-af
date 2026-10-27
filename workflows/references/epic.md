# Epic routing and restore

The Epic skill owns the approved Task delivery strategy. This file owns how that strategy is recorded and applied, and how a clone without the Epic's local files recreates it.

## Routing

Accepted `epic.md` records routing in its `## Task delivery strategy` section, before the rationale prose:

```markdown
Task target: default
Epic branch: 21-routing
```

- `Task target:` is `default` or `epic`. It decides where Tasks started from now on begin and deliver.
- `Epic branch:` is the Epic's branch name from its metadata. Every clone reads it from the published plan.
- The reviewed lines are the approval. Changing them goes through Epic replanning and affects only Tasks started afterward. Existing Tasks keep their copied start and target.

**Starting a Task:**

- `default`: the Task starts from and targets the repository default. Nothing about the Epic branch is checked, and it may be deleted.
- `epic`: the Task starts from and targets the Epic branch, which must exist locally. When it's missing, fetch or create it with the user's approval first.

**Approvals:** strategy approval and plan acceptance don't authorize a commit, push, PR, merge, fetch, checkout, or cleanup. Never delete the Epic branch while a Task targets it.

## Restore an Epic

When a clone has no local directory for an Epic, recreate it before resuming the Epic or starting one of its Tasks:

1. Read the Epic: GitHub `issue_read` `get`, or Linear `get_project`.
2. Read its published plan with the same reads as [publication recovery](./integrations/recovery.md#pending-plan-publication): every comment page on GitHub; on Linear, the parent read, every document page, and full reads of matching candidates.
3. Call `restore_epic` with a slug and that evidence. It requires exactly one published plan, rebuilds `epic.md` from it, and writes the directory, metadata, and brief. It creates no branch.

## Compare with the published plan

The local `epic.md` stays the working copy for planning and review. Another clone may republish the plan, and a Task may change it locally. Both are normal.

Before starting a Task and on Epic or Task resume, best effort:

1. Read the published plan as in restore, and call `restore_epic_plan_source` to get it as `epic.md` source.
2. Compare its Tasks, markers, Kinds, and routing lines with the local copy.
3. When they differ, show the difference and ask the user which to keep. Write the published source with the write tool, or publish the local copy.
