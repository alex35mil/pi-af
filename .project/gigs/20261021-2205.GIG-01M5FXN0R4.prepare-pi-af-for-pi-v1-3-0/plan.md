# Plan

## Overview

Prepare pi-af for Pi v1.3.0 with native tool execution and an explicit breaking settings migration. Preserve permission, rule-delivery, publication, configuration scopes, and private-project boundaries. The existing development dependency resolves to 0.79.6; an isolated 1.3.0 check reproduces 21 test-context type errors despite all 502 existing runtime tests passing. Additional probes reproduce accepted nested edits reported as failures, script-only reads incorrectly unlocking scoped edits, and inaccurate context reporting. The native script-local review-note handoff is verified in an isolated probe; full-session continuation and real pi.nvim interaction remain implementation verification.

### Plan highlights

- Native Pi MCP owns connections, authentication, tool discovery, execution, and result conversion. One thin adapter owns configuration loading and registers every effective server through public `pi.registerMcpServer()`; reuse the established publication policy and tool wrapper.
- Use `mcpServers` and `<name>.json` / `<name>.local.json` as a hard break across pi-af settings. Keep project files under `.agents`, preserve global/project/local scopes and precedence, and keep private registrations private. After this checkout is migrated and compatibility-checked, migrate the user-approved consuming projects before final review and delivery; retain no old-key or old-filename fallbacks.
- Return success for editor-applied edits without executing them again. Keep permission evaluation and rules gates before any editor mutation. A thin wrapper around native codemode stops a note-bearing script with a script-local cancellation signal, preserves the child edit's outcome, and returns complete notes to the model without aborting the agent. Calls already started before the notes retain native cancellation semantics; completed effects are not rolled back.
- Keep path-scoped rules lazy. Only rules actually delivered to the model authorize subsequent edits; script-only reads do not. Already-known scopes incur no additional rule-loading round trip.
- Separate complete session billing, current context occupancy, and estimated prompt/tool contributions. Preserve unknown context values.
- Pin development verification to 1.3.0, migrate execution-context fixtures, and verify actual native nested execution as well as ordinary workflows. Upgrade activation remains an explicit user operation after compatibility verification.

## Scope and evidence

This Chore includes the native MCP migration tracked separately by #38; close that issue as addressed when delivery is complete. #70's optional workflow-tool context optimization remains separate. No workflow lifecycle, branch contract, signing format, or provider-mutation policy is redesigned.

Verified baseline: current dependency type-check passes; exact Pi/AI 1.3.0 produces 21 test-only `ExtensionToolContext` errors; all 502 existing tests pass under that dependency. The additional isolated probes use Pi 1.3.0's real `runToolCall` pipeline, not a proposed implementation. They show that a blocked accepted edit has `isError: true` and bypasses result hooks, that nested reads can incorrectly mark scoped rules visible, and that missing MCP metadata can stop a configured server/tool denial from matching. The context probe shows unknown occupancy rendered as zero, overlapping tool categories, and omitted standalone billing.

The earlier signatures Gig intentionally separated `publication.ts`, `publication-tool.ts`, and `publication-mcp.ts`. Its isolated native-MCP research is prior evidence, not a completed migration or a maintained fixture to restore. Preserve that ownership split and the ordinary tests. Investigate any further compatibility failure at its owning boundary; ask before broadening scope to an unrelated defect.

## Dependencies and activation boundary

- Add exact 1.3.0 development dependencies for the host Pi and AI packages, refresh `package-lock.json`, and verify that related host packages resolve coherently through their pinned dependencies.
- Declare the minimum supported host version required by the native APIs used here. Keep host-provided packages out of runtime `dependencies` and retain native package peer resolution.
- Add a repeatable `typecheck` script alongside `test`; tests transpiling successfully must not stand in for type-checking. Use the package's existing formatting conventions.
- Development and integration checks use the isolated or local 1.3.0 installation. Do not reload the changed extensions into the old running harness or modify its global install/settings as a side effect.
- Once compatibility checks pass, report readiness and ask the user to activate 1.3.0. The user owns live harness/Neovim checks; record supplied outcomes or clearly mark checks not run by the agent. Perform workflow review in the target runtime. The review subprocess currently reuses the running CLI; it must not silently exercise the old CLI after source migration.

## Native MCP and configuration ownership

Use public `createMcpExtension()` factory composition for pi-af's attachment to native tool registration. Pi's native implementation retains transport, authentication/OAuth, timeouts, retries, background readiness, resource handling, result conversion, dynamic tool changes, and shutdown. Only one MCP implementation connects each configured server. Composition retains native `/mcp` behavior and uses Pi's documented replacement mechanism rather than running a second transport alongside it.

Keep one three-tier configuration interface: `<agent-dir>/mcp.json`, `<repo-root>/.agents/mcp.json`, and `<repo-root>/.agents/mcp.local.json`. Every tier uses `mcpServers`. Merge by exact server name in that order; later tiers replace earlier entries. Read global settings independently of project trust, and read both project tiers only in a trusted project. Register every effective native per-server configuration through `pi.registerMcpServer()`; Pi resolves credentials and owns transport execution.

The shared pi-af settings convention becomes `<name>.json` and `<name>.local.json` for the MCP, permissions, and web-search families and global workflow settings. The permissions extension uses `extensions/permissions/`, the `permissions` identifier, and `/permissions-*` commands. Existing scopes stay unchanged: for example, project permission files are `.agents/permissions.json` and `.agents/permissions.local.json`, while global workflow settings become `<agent-dir>/workflows.json`. Pi's own `settings.json` and `.project/config.json` / `config.local.json` remain unchanged. This is an intentional hard break with no old-filename, old-key, or older-API compatibility paths. Update loaders, writers, descriptions, examples, diagnostics, tests, and managed exclusions together.

Configuration discovery remains in the thin adapter. The composed native factory consumes registered servers rather than discovering a second set from Pi-managed project files; this package creates no separate Pi project configuration directory. Native `/mcp` retains its registered-server behavior, including session-only enabled/exposure changes. Preserve one connection owner and each server's alias, endpoint, environment references, and toolset headers. Invalid settings and normalized-name conflicts are reported instead of inventing aliases or redirecting tracker/forge bindings.

Keep private project-local registrations outside Git and scoped to their project. Setup ensures exact `/.agents/mcp.local.json` and the corresponding renamed local permission exclusion when it creates those files. No private registration is moved into global configuration. Update `configure_mcp`, `inspect_project_setup`, service recognition, and `registeredCredentialEnvironment` against the same effective three-tier configuration. Inspection reads references without executing credential commands, opening a provider client, or exposing credential values. Honor trust and registered-server lifetimes on startup, reload, new session, resume, and project changes.

Implement source-code, committed source-checkout configuration, documentation, and test changes in this migration. Record the file/key/exclusion changes needed for rollout. Coordinate any live private/global settings rename with the user's explicit harness activation so the older running harness is not disrupted. After this checkout's configuration switch and compatibility verification, migrate only the consuming repositories explicitly approved by the user, before final review and delivery. Preserve their configuration values, private scopes, existing branches, Git indexes, and unrelated work.

## Native tool identity, permissions, and publication

The shared MCP metadata boundary must retain original server/tool identity, actual registered Pi tool name, original input schema, annotations, and live availability. Capture native definitions from the composed factory's registration boundary, including fresh, changed, and withdrawn definitions. Use original identity supplied by that boundary; do not infer it by splitting normalized or hashed model-facing names. Never expose credentials through metadata.

Inspect every consumer of `extensions/__lib/mcp.ts`, including permission selection, setup inspection, publication attachment, creation/resource evidence, and incoming-PR operations. Replace synthetic tool-name assumptions with the actual registered-name mapping where native normalization or hashing matters. Update affected consumers directly. Missing metadata must not silently turn a known MCP operation into an unrelated generic tool and bypass its configured selector.

Preserve permission precedence and skill-derived rules. Read-only hints remain untrusted declarations and match only explicitly true values. Live metadata for a new definition must be available before it can execute; withdrawn/hidden tools must not be reported as available. This metadata is addressing/description state, not a cache of provider lifecycle or merge facts.

Reuse `publication.ts` and `publication-tool.ts` unchanged except for genuinely required SDK type adjustments. Replace the current backend attachment in `publication-mcp.ts`. The generic composition remains provider-neutral; workflow code recognizes official service URLs and maps original operations to signing behavior. Preserve agent-facing authorship schema/guidance, exact verbatim delivery, one native delegation, current model identity, complete-text enforcement, and unmapped-tool identity.

Direct, deferred/search-loaded, and codemode calls all pass through native validation, permissions, and the same signing wrapper. Keep exposure, namespace, annotations, output schema, rendering, structured content/errors, IDs, signals, update callbacks, and context intact. Dynamic re-registration must not stack wrappers or restore withdrawn tools.

## Permission bridge decision table

Keep one permission evaluator. Generic permission decisions remain in the permission hook; interactive file-edit application is owned by edit/write execution wrappers using the native tool definitions. All permission/rules preflight handlers complete before those wrappers prompt or mutate. Preserve native schemas, prompt contributions, rendering, path normalization, result details, and file-mutation serialization.

| Case | Result |
| --- | --- |
| Allowed edit/write | Delegate to the native operation once. |
| Denied operation or invalid permission settings | Block and preserve the current abort policy; no file mutation. |
| Ask without UI | Block without applying the operation. |
| Ordinary TUI Accept | Execute the native operation once. |
| Editor Accepted | Return successful accepted status; editor already applied the change; do not delegate again. |
| Editor AcceptModified | Return successful status with the editor's final content and notes; do not overwrite the modification. |
| Rejected with notes | File remains unchanged; deliver the notes and preserve continuation for the model's response. |
| Rejected without notes or cancelled | File remains unchanged; preserve the current turn-abort policy. |

Remove the approved-call set and `message_end` error repair after the wrappers own success. Native nested edit outcomes must report success at the execution boundary, not depend on transcript messages that nested calls do not create.

### Verified parent-call review-note handoff

Compose public `createCodemodeExtension()` in the permission integration and copy the complete native definition when attaching its execution wrapper. Keep native settings, model calls, discovery/loadout preparation, exposure, sampling constraints, rendering, worker engine, and ordinary results. Use Pi's documented built-in replacement behavior so there is one codemode implementation, backed by the native factory.

For each parent execution, create a private `AbortController` and combine its signal with the original tool signal using `AbortSignal.any()`. Pass a proxied `ExtensionToolContext` to native execution: forward every property unchanged except `executeTool`, which delegates through the real context and inspects only typed review metadata produced by our edit/write wrappers. Do not parse arbitrary provider output or infer notes from prose.

The child first finishes normally through native validation, hooks, and recording. An accepted edit remains a successful child outcome; rejection with notes remains a rejected child outcome. Once a delegated child returns review notes, retain its complete outcome/notes, cancel only this parent script, and prevent further delegated calls from that script. Cancellation ends the native worker even when script code catches an individual tool error. Do not call `ctx.abort()` for a note handoff. Calls already in flight follow native cancellation rules; effects completed before the user supplied notes are not rolled back. The wrapper does not claim to retract earlier authorized work or make arbitrary scripts transactional.

After native execution settles, return an explicitly identified `reviewHandoff` parent result, explaining that the script stopped for user review, the child outcome is final, and accepted edits must not be repeated. Include complete formatted notes outside the native script-output truncation budget, regardless of whether the script printed the child result. Retain the native partial output, call records, and usage, and explain that native cancellation text describes the stopped script rather than a failed accepted edit. Normalize only this owned review interruption to a handled parent result; retain the original signal's abort and independent failures as failures. The parent returns normally without a turn-wide abort or termination hint, allowing the next model response to address every note before new work. Ordinary acceptance without notes delegates/returns unchanged and lets the script continue.

An ignored planning probe using the public 1.3.0 factory and actual native sandbox verified accepted notes, a script catching the tool error, rejection with notes, and acceptance without notes. Both accepted-note scenarios applied the edit once, preserved child success and an `ok` native call record, stopped the subsequent tool call, and left the outer signal live. Rejection with notes left the file unchanged and still left the outer signal live. Ordinary acceptance ran the subsequent call. This proves the public handoff path; real pi.nvim interaction and the full session continuation remain implementation verification, not completed checks.

## Lazy rule delivery before scripted edits

Retain always-on rules and lazy path-scoped rules. A completed file read is not itself proof that the model received its appended rule text. Record pending delivery separately from visibility and establish visibility from the model-facing context boundary. Do not promote script-only reads or a direct read still in the same pre-authored tool batch into permission to edit.

| Scope state | Direct read | Nested read | Edit/write |
| --- | --- | --- | --- |
| Rules unseen by model | Deliver complete applicable rule text for the next model request. | May return file data, but does not establish model visibility. | Block before editor review or mutation; request a model-facing read. |
| Rules delivered to model | Preserve compact reminders. | Allow normal scripted reads without a new model round trip. | Allow subject to ordinary permissions and file checks. |
| Visibility cleared by compaction | Deliver the full rules again. | Does not restore visibility. | Block until redelivered. |

The model-facing guidance tells the model to read relevant files before composing editing scripts. Runtime enforcement prevents premature edits; it does not claim to control what scripts the model generates. A script discovering a new rule scope must return to the model before editing that scope. Another file covered by already-delivered rules incurs no additional rule-loading round trip.

Preserve branch-relative state, resume/tree behavior, and compaction clearing. Count actual model-visible rule delivery, not discarded nested output or raw pre-compaction history. Do not inject all path-scoped rules at startup or when codemode is enabled.

## Context report accounting

Use the target runtime's session-entry/accounting semantics as the reference and keep three distinct concepts:

- Current context occupancy comes from `ctx.getContextUsage()`. Unknown tokens/percentage/free space stay unknown, including immediately after compaction.
- Session billing covers all persisted session entries, including abandoned branches as native session totals do: assistant usage, tool-result usage, standalone usage, compaction usage, and branch-summary usage. Include input/output and cache reads/writes; do not count nested usage again after it has been aggregated into its parent result.
- Prompt/tool contributions remain labeled estimates, not provider-measured context totals. Built-in, extension, and MCP categories are disjoint and based on tool provenance/metadata rather than a hard-coded built-in name list. Distinguish registered/callable tools from model-declared tools under native exposure and codemode loadout behavior; do not present hidden or deferred schemas as upfront declarations.

Message-content size is not cumulative billed token usage. Use the actual projected message context for a clearly labeled size estimate, or omit that component when the API cannot supply a reliable estimate; never present billed tokens as current message occupancy. Tests cover the reported totals and labels independently of rendering.

## Implementation and verification

1. Establish target development resolution and fix execution-context fixtures. Use a shared typed fixture where appropriate, with explicit tools/nested-execution behavior; do not suppress the 21 errors with broad casts.
2. Replace transport ownership with native factory composition and registration of all effective global/project/local servers through the thin adapter. Adopt `mcpServers` in every MCP tier and the shared `<name>.json` / `<name>.local.json` convention without compatibility readers. Keep project files under `.agents`; update this checkout's committed configuration, setup/inspection/credential-reference consumers, web-search/global-workflow settings consumers, exclusions, and docs together. After this checkout's switch and compatibility checks, complete the explicitly approved consuming-project migrations before final review and delivery.
3. Adapt the original/native tool-identity boundary, permission consumers, publication attachment, and workflow evidence/addressing consumers. Retain ordinary policy and native-definition preservation tests.
4. Implement the permission execution wrappers and the verified native-codemode parent wrapper. Cover typed child review metadata, script-local cancellation, complete parent note delivery, preserved child outcomes/partial output/usage, and ordinary no-note behavior before treating the bridge as migrated.
5. Correct rule visibility at the model-context boundary, including same-batch reads, nested calls, branch navigation, and compaction.
6. Correct context reporting and add ordinary regression coverage.
7. Run `npm run typecheck`, all focused tests, `npm test`, targeted formatting checks, and Git whitespace checks. Use a clean dependency resolution to prove the checks really target 1.3.0.
8. Use ordinary integration tests with Pi 1.3.0 and an in-memory MCP server for direct/deferred/codemode calls, dynamic availability, unsigned verbatim and signed AI text, one wire call, structured error/result preservation, trust across all registration tiers, no duplicate connections, and native shutdown. At the shared settings boundary, verify the literal new file paths, `mcpServers` key, tier precedence, consistent setup/inspection behavior, and private exclusions; cover each affected settings family. These are maintained boundary tests, not a resurrected one-off compatibility fixture.
9. Verify native rule/permission ordering and zero-or-one file mutation with target-runtime pipeline tests: accepted/modified/rejected edits, notes, no UI, explicit denies, unseen scopes, known scopes, first model delivery, resume, and compaction. Include scripts that discard child results or catch tool errors, and confirm that review notes still stop further scripted calls and reach the parent. Verify parent partial output/usage, no-note continuation, real external cancellation and genuine failures, and that an actual target-runtime session can produce its next model response after the handoff.
10. Report compatibility readiness before the user's harness bump. The user owns live checks of pi.nvim direct and nested accepted/modified/rejected edits, review notes, lazy scoped-rule delivery, `/context`, native MCP discovery, and representative workflow initialization/review/provider publication. Record user-reported outcomes without claiming agent-run verification; mark checks not run by the agent in the completion artifact. Any live provider mutation still needs explicit approval. No arbitrary live issue, comment, or other provider test posting is authorized by the plan.
11. Create and synchronize `result.md` with actual outcomes and unrun checks; perform final workflow review and user review in the target runtime. Preserve the existing submission/finish approval gates. Close #38 as addressed only after the work is delivered; leave #70 untouched.

## Boundaries

No running-harness upgrade, global MCP scope change, credential disclosure, provider substitution, production code execution from incoming PRs, remote Git operation, issue #38 closure, or unrelated workflow fix occurs merely from plan acceptance. The user owns activation and any live verification mutation. Maintain a private notes record of unresolved verification and stop on a new product/visibility/permission decision rather than supplying a fallback.
