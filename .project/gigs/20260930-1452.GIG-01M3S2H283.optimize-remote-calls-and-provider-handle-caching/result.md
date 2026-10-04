# Result

## What changed

- Queue creation and initialization use selected fields and returned IDs instead of broad configuration checks. Resume reads required live state without routine PR discovery. Generated Linear branches no longer fetch unused provider branch names.
- Added `resource_ids` and an ignored `.local/metadata.json` cache for scoped IDs and URLs. Adoption, creation responses and required reads populate it. Writes are atomic, preserve unrelated entries and reuse IDs within an operation. Missing/stale IDs and uncertain provider outcomes require agent investigation.
- Durable tracker records retain GitHub repository/issue number, Linear UUIDs and Task parent Project UUIDs. Linear-generated branch names live in the saved branch details. Unfinished initialization retains its requested Priority.
- `integration_context` returns local configuration, authority and entity facts without inspecting provider-tool schemas. Agents call registered MCP tools directly.
- Accepted tracker and PR bodies are published in full. Clear successful writes need no routine confirmation read; uncertain outcomes are checked before retrying.
- PR creation records the returned number/URL directly in the IDs cache. Explicit PR selection updates that same entry; recording requires no extra artifact or bookkeeping commit.
- Finish validates the recorded PR, repository, branches and local source commit before merging. Cleanup requires confirmed delivery, completion and an up-to-date target branch; it deletes only the local work branch. GitHub-confirmed merged state is sufficient without a merge-commit SHA. No-forge ancestry checks remain.
- Added saved-format migration entries and resume guidance for active entities. Completed entities remain unchanged. Default-branch discovery reads only recorded branch facts, so older provider bindings do not block initialization.
- Simplified the README to a user-facing overview; operational instructions remain in the references.

## Verification

- `npm test` — 158 passed, 0 failed.
- Focused integration, Resource IDs and real-Git cleanup tests — 41 passed, 0 failed.
- Affected TypeScript checks — passed.
- `oxfmt` — all 19 affected TypeScript files passed; whitespace checks passed.
- Existing live GitHub/Linear contract evidence was reused for unchanged provider behavior. Changed local storage and delivery checks are covered by automated tests.
