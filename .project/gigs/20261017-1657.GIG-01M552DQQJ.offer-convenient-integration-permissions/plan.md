# Plan

## Overview

Project setup will offer permission rules that reduce repeated prompts for the integration tools used throughout Epic, Task, and Gig work. Each offer will explain its access, use the selected active MCP servers, and require the user's selection and approval before changing settings.

### Plan highlights

- Recommend provider-scoped read-only access and the frequent tracker write tools: GitHub `projects_write` and `issue_write`, or Linear `save_issue` and `save_project`.
- Skip already-covered allows; preserve existing `ask` and `deny` rules and report their conflicts without weakening them.
- Merge approved allows and accepted-artifact ask gates through one shared configuration tool, preserving unrelated settings and Git safety.
- Leave merge permissions and other write tools out of the recommended set. Existing permissions are never revoked.

## Setup behavior

At the final optional-permissions stage, after provider/server selection and availability checks, offer numbered, independently selectable rules plus a decline-all choice. Do not offer rules for unselected providers, inactive servers, or unavailable tools. Reconfiguration changes only the permissions the user explicitly requests.

Use the exact selected server name, not a hard-coded `github` or `linear` name. Deduplicate a server shared by tracker and forge roles. For each selected active server, recommend `mcp(<server>, hint: readOnly)` when it advertises explicitly read-only tools. Explain that this trusts server-supplied `readOnlyHint: true`, covers all such tools on that server, and does not cover tools with missing or false hints. Do not infer read-only safety from tool names. Report required workflow read tools not covered by the hint, rather than silently claiming all reads are allowed.

For a GitHub tracker, also recommend available `mcp(<server>, projects_write)` and `mcp(<server>, issue_write)`. The former avoids prompts for recurring Project field updates such as Status and Phase; the latter avoids prompts for issue creation, plan-body publication, and label updates. For a Linear tracker, recommend available `mcp(<server>, save_issue)` and `mcp(<server>, save_project)` for issue and Epic creation, updates, Status/Phase, and plan publication. A GitHub forge without a GitHub tracker gets the read-only recommendation, not tracker writes.

Explain beside each write option that it grants the entire tool, including its mutation variants, not just the examples. MCP rules do not limit arguments, repository, Project, or individual operation: access extends to the selected server's credential scope. These permissions remove tool prompts, not the workflow's content, submission, or finish approval gates. Do not recommend whole-server write wildcards, PR merge allows, or unrelated writes.

Offer accepted-artifact ask gates independently. When any new permission rules are selected, ask once whether to store them in local `.agents/permission.settings.local.json` or committed project `.agents/permission.settings.json`. Do not infer that choice from artifact or MCP persistence. Preview the exact additions, skipped rules, conflicts, target, and applicable local exclusion in the final repository-file proposal. Declining permissions changes no permission file or permission exclusion.

## Existing-rule contract

Inspect persistent global, project, and local permission settings through the permission extension's shared loading, parsing, and matching logic. Do not implement a second MCP matcher inside setup. Read-only inspection and the configuration write both use the same analysis; recheck at write time. Invalid settings stop the permission operation without a permission-file write.

| Existing condition | Behavior |
| --- | --- |
| Equivalent allow or a broader allow covers the candidate | Report already covered and do not append it. |
| No covering allow and no matching ask/deny | Offer the candidate as a new allow; append only after approval. |
| Matching ask/deny blocks an exact-tool candidate | Report the blocking rule and source; leave it untouched and do not append a useless allow. |
| Matching ask/deny blocks only part of a read-only selector | Report affected tools and blocking rules; the user can select the read-only rule for its remaining unblocked access. |
| Every currently matched tool is blocked | Report the blockers and omit that candidate from new additions. |
| Candidate has no matching advertised tool | Report unavailable/no matching tools, without asserting access or adding the candidate. |
| Accepted ask gate already exists in the selected file | Skip that exact duplicate, preserving existing gates. |
| User declines every new rule | No permission-file or permission-exclusion change. |

Coverage must prove selector containment, not merely observe that today's tools happen to be allowed. An all-tools or all-server allow can cover a narrower selector; identical selectors with different permitted internal spacing are equivalent. A read-only hint can cover an exact tool only with its verified true annotation. Exact allows for all current read tools do not cover a read-only selector's future annotated tools. Preserve all original rule strings and ordering in existing files.

Conflict reporting uses actual advertised MCP metadata and shared precedence (`deny` before `ask` before `allow`). Do not claim an exact tool matches a hint without its annotation. Distinguish unverified overlap when metadata is unavailable. Inspection describes persistent configuration only; session overrides and skill-derived allows do not prove durable coverage. Report that boundary rather than persisting temporary decisions.

## Implementation ownership

1. Extend `extensions/permission/index.ts` with reusable persistent-settings inspection and MCP rule coverage/conflict analysis built on its existing parser and matcher. Keep runtime permission behavior, precedence, session overrides, and skill rules unchanged. Add owning-boundary tests in `tests/permission-mcp.test.ts`.
2. Extend `workflows/extensions/project-setup/permissions.ts` to merge explicit `allow` and `ask` arrays. The strict tool input becomes `{ target: "project" | "local", allow: string[], ask: string[] }`, requiring at least one requested rule across the two arrays. Allow additions are MCP selectors; ask additions continue supporting accepted-artifact gates. Update callers directly, without an old-input fallback. Return actual added/skipped rules and conflicts; preserve unrelated settings, rule order, default mode, keybindings, and deny rules. Keep validation before mutation and reuse the existing local exclusion helper.
3. Register a read-only `inspect_permissions` tool in `workflows/extensions/project-setup/index.ts`, taking candidate MCP rules and returning coverage/conflict results with source locations and matching tool metadata. Consume the existing MCP catalog event, replace catalog snapshots on refresh, and dispose the listener at session shutdown. Use the same current catalog for allow merging. No provider calls, credential reads, tool execution, or new MCP discovery transport are introduced. Retain the existing setup snapshot contract.
4. Update `workflows/skills/project-setup/SKILL.md`, `workflows/references/setup.md`, `workflows/extensions/project-setup/README.md`, and `extensions/permission/README.md` for the read-only inspection, recommendation matrix, approved conflict policy, combined allow/ask schema, user selection/approval, persistence, and accurate access warnings. Keep accepted-artifact gate examples aligned with the new input.
5. Update setup registration harnesses and add focused setup/permission regression coverage in `tests/workflow-project-config.test.ts`, a dedicated setup-permissions test file as needed, and `tests/workflow-instructions.test.ts` for the agent-facing recommendation and approval contract.

## Evidence and complexity boundary

The existing helper only appends `ask` rules, so it cannot save the requested allows. Setup guidance only offers artifact diff gates. The permission engine already merges all three persistent tiers, matches MCP selectors and true-only hints, and enforces deny/ask precedence. Reusing that owner prevents setup from telling users that an allow removes prompts when an existing ask still wins.

A supported flow is a user rerunning setup with a global provider allow or a local explicit ask. Adding duplicate allows creates unnecessary configuration; adding a blocked exact-tool allow leaves recurring prompts while falsely suggesting convenience. These conditions arise directly from ordinary three-tier loading, require no concurrent operation or unusual timing, and justify a shared read-only coverage check plus focused tests. No new policy precedence, permission removal mechanism, telemetry, automatic prompt-history learning, or generalized permission editor is needed.

## Verification

- Run `npx tsx --test tests/permission-mcp.test.ts tests/workflow-project-config.test.ts tests/workflow-instructions.test.ts` plus the new setup-permissions tests. The existing three-file baseline passed all 46 tests before changes.
- Cover project/local writes, combined allow/ask updates, preservation of unrelated settings and Git index, exact and semantic duplicate handling across all tiers, wildcard and hint coverage, missing/false annotations, exact and partial ask/deny conflicts, malformed settings/rules, no-op writes, and local-file Git safety.
- Exercise the registered inspection/configuration tools with a live-catalog event harness: initially unavailable tools, refresh replacement, custom server names, and shutdown disposal. Confirm read-only inspection changes neither files nor Git state.
- Assert setup guidance selects only chosen active provider roles, explains frequent write scopes, permits independent choices and decline-all, preserves conflicts, and requires exact approval and one persistence choice.
- Run `npm test`, `npx tsc --noEmit`, a focused formatter check for changed files, and `git diff --check`. Record actual outcomes and any pre-existing failures in `result.md` before final review.
