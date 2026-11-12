# Workflow reporting source

Read this when configuring the workflow source reference, or when a `target: "workflow"` inspection reports it missing or invalid.

To report workflow problems from any consuming project, set `workflowProject` in the private global `workflows.json`, in Pi's resolved `getAgentDir()` directory:

```json
{
    "workflowProject": "/absolute/path/to/piton"
}
```

**The reference:**

- It points to the workflow source repository root. It can sit alongside a global `branches.username`, and either can appear alone.
- The file stays outside Git, holds no credentials, and isn't a consuming-project setting. `.project/config.local.json` holds branch settings only and can't override it.

**Session analysis:**

- `"sessionAnalysis": true` in the same file ends every shipped Task or Gig, completed Epic, and shipped incoming PR with an in-chat analysis of the session for workflow problems ([session analysis](../session-analysis.md)).
- It's off when absent or `false`, and it costs tokens. It's global only; no project configuration can set it.
- It needs `workflowProject`: it searches that project's tracker for findings that are already reported. Without it, the analysis reports the error and ends.

**Targets:**

- `inspect_integrations` and `inspect_queue_intake` take `target: "current" | "workflow"`.
- `current` inspects the current repository and doesn't need the reference.
- `workflow` reads the source's `.project/integrations.json` and `.project/config.json` with the same tracker schema, validation, and read-only readiness checks, and returns `target` and `projectRoot`.
- The path must be the repository root; filesystem aliases resolve consistently. Consuming-project setup isn't a prerequisite.

**Errors:**

- A missing reference errors with: `Set workflowProject to the absolute workflow source repository root in <resolved-agent-dir>/workflows.json.`
- Invalid references or source configuration name where to fix them.
- Stop without setup questions, automatic repair, artifact preparation, or a fallback destination; the user leads any fix.

Use only the source tracker's MCP tools already registered in the reporting session, under normal permissions. A tracker configuration doesn't prove access. Never load or run the source project's MCP settings or credentials. The Todo intake, privacy, and approval rules are in [queue](../queue.md#prepare-a-workflow-report).
