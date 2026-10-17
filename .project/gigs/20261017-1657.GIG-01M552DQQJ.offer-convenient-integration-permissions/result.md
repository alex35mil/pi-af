# Result

## Overview

Project setup now recommends provider-scoped read-only permissions and the frequent tracker writes that otherwise prompt repeatedly: GitHub `projects_write`/`issue_write` and Linear `save_issue`/`save_project`. Choices are independent, limited to selected active integrations, and explain each tool's full mutation and credential scope. PR merge allows are not recommended.

Existing allows are checked for coverage across global, project, and local settings. Existing ask/deny constraints remain untouched and their conflicts are reported. Users explicitly select rules, approve exact additions, and choose local or committed project persistence. No existing permission configuration was changed as part of this implementation.

Read-only permissions still depend on the server's true annotations. Inspection excludes temporary session overrides and skill-derived allows; workflow approval gates remain unchanged.

## Implementation walkthrough

- Shared permission loading, MCP parsing, matching, and selector coverage keep setup inspection consistent with runtime enforcement.
- New read-only `inspect_permissions` uses live MCP metadata and reports coverage, unavailable tools, and blockers with source locations.
- `configure_permissions` takes explicit `target`, `allow`, and `ask` fields, rechecks policy, preserves unrelated settings, and skips covered, fully blocked, or unavailable allows. No-op merges change neither files nor exclusions. Local-file Git safety and per-file write queuing remain enforced.
- Setup guidance and examples include provider-specific recommendations, full-tool access warnings, independent artifact diff gates, and the approved conflict policy.

## Verification

- Focused permission/setup/instruction tests — 65 passed.
- `npm test` — 279 passed; none failed or skipped.
- `npx tsc --noEmit` — passed.
- Focused `npx oxfmt --check` across all 11 changed implementation, documentation, and test files — passed.
- `git diff --check` — passed.

Tests cover three-tier coverage, wildcard/hint semantics, ask/deny precedence, malformed settings, combined allow/ask merges, no-op preservation, local-file Git safety, custom server names, and MCP catalog refresh/shutdown. Registered-tool behavior was exercised with a catalog harness; no external provider permissions were modified.
