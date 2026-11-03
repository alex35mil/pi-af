# Session analysis

Read this when a finished workflow's `inspect_session_analysis` returns `enabled`: after a Task or Gig ships, an Epic completes, or an incoming PR ships. Look back over the session for workflow problems that pi-af should fix, and present them in chat.

## Scope

- Use only this session's conversation as it is in your context.
- Don't read session files, other sessions, or logs. Anything compaction removed is out of scope.
- Call no providers.

## Look for

- workflow tool errors and validation failures;
- rejected evidence and permission denials;
- retries and corrected re-calls;
- instructions that were unclear, contradictory, or missing;
- workarounds;
- avoidable round trips and redundant reads.

## Triage

1. Keep a candidate only when pi-af workflow instructions or tools contributed to it. Exclude user choices, project code, provider outages, and one-off agent mistakes that no instruction or tool invited.
2. When it helps, confirm the cause in the installed workflow files this session loaded. Use the `workflowProject` source only when it's configured, and say when a cause was confirmed only there, since that checkout can differ from the installed copy.
3. Keep only findings that are addressable and worth a tracker item.

## Present

For each finding, give a short title, what happened, the likely cause in workflow files or tools, and a suggested fix. When nothing qualifies, say so in one line.

Presenting findings authorizes nothing. When the user picks findings to report, handle each one as a workflow report: read [workflow report preparation](./queue.md#prepare-a-workflow-report) and follow its sanitization and approval rules.
