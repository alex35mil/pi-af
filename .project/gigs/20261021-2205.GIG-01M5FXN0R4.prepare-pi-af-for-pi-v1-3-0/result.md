# Result

## Overview

pi-af now targets Pi 1.3.0 using native MCP and codemode execution. Permission rules, publication signing, project trust, configuration precedence, and private-project scopes are preserved.

Editor-applied edits return successful outcomes without a second write. Review notes return completely to the model and stop subsequent work in that script without aborting the conversation. Scoped rules remain lazy and authorize edits only after successful model delivery. Context reporting separates current occupancy, complete session billing, and estimated tool exposure.

The settings migration intentionally breaks old filenames and MCP keys. The extension is now `permissions`, with `/permissions-*` commands and `permissions.json` / `permissions.local.json`. This checkout and five user-approved consuming repositories have been migrated. Global configuration is user-managed; live harness and Neovim checks remain the user's responsibility.

## Implementation walkthrough

- **Native MCP composition:** the thin adapter loads global, project, and private-local `mcpServers` settings, then registers every effective server through Pi. Native Pi owns connections, authentication, discovery, execution, results, and shutdown. Live catalogs preserve original server/tool identity separately from actual registered names for permission selection, publication, and workflow evidence. Configuration and live-tool helpers share one `extensions/__lib/mcp.ts` module, reused by the adapter, permissions, setup, publication, and workflow operations.
- **Edit and review handling:** native edit/write definitions and mutation queues are retained. Execution wrappers recognize editor-owned outcomes and preserve ordinary acceptance, rejection, cancellation, and permission behavior. The codemode wrapper uses script-local cancellation and a descriptor-preserving context view to return complete notes, child outcomes, partial output, and usage without repeating completed edits.
- **Lazy rules:** reads record pending delivery, not visibility. Model-facing context and successful assistant completion establish visibility. Nested reminders persist when their results were discarded; compaction and changed rule versions require fresh delivery.
- **Context accounting:** unknown occupancy stays unknown, billing includes all persisted branches and usage sources, and tool categories are disjoint. Registered, active, callable, and deferred/hidden exposure are reported separately; estimates are not presented as provider-measured context totals.
- **Configuration rollout:** settings use `<name>.json` / `<name>.local.json`, project placement stays under `.agents`, and every MCP tier uses `mcpServers`. Consumer migration changed 11 files plus five command examples in one README. Configuration values, private-file protection, existing branches, Git indexes, and unrelated change records were preserved. No application or plugin implementation changed. Manual local-file privacy uses the user's global ignore rule; automated setup retains its portable repository-local safeguards. README keeps minimum/validated Pi versions and links to the versioned migration instructions in `UPGRADING.md`.

## Verification

- `npm run typecheck` — passed against exact Pi 1.3.0 dependencies.
- `npm test` — 548/548 passed across 45 suites in the working checkout.
- Clean dependency installation and full verification — Pi host, AI, agent-core, and MCP packages resolve to exactly 1.3.0; type-checking and 548/548 tests passed in the refreshed clean source snapshot, without ignored/private files.
- Focused permission, settings, session, setup, review, and documentation suites — 172/172 passed across 19 suites after the full permissions rename; 100/100 affected MCP, settings, permission, setup, publication, and workflow cases passed after consolidating the shared MCP module.
- Maintained native-session and in-memory MCP tests — cover direct/deferred/codemode discovery and publication, signing/verbatim delivery, one connection and wire call, shutdown, editor outcomes, complete note handoff and continuation, cancellation, parallel completed edits, and lazy rule delivery across resume/tree/compaction.
- Formatting and Git whitespace checks — passed; current Git-visible source, docs, and tests have no stale extension or current-filename references outside intentional upgrade instructions.
- Upgrade documentation — after moving migration steps into `UPGRADING.md`, both the working checkout and clean snapshot type-checked and passed 13/13 documentation/link checks, including the README and upgrade guide. Runtime code is unchanged from the full 548-case verification.
- Actual settings-reader and migration checks — both shared readers recognize this checkout's new paths; all seven consuming-project permission configurations validate. Hash comparisons verify preserved permission bytes and MCP values. Private files remain ignored and untracked. All five consuming repositories retain their original branch, index contents, and unrelated worktree change records. Direct configuration and non-historical documentation references were checked after migration.

**Not run by the agent:**

- Live Neovim acceptance/modification/rejection, direct and nested note handoff, scoped-rule behavior, `/context`, MCP discovery/authentication, and representative end-to-end workflow/provider checks — the user explicitly retained responsibility; outcomes have not been reported. No live provider test posts or consumer application/plugin test suites were run for the configuration-only migrations.
