# Integration roles

`tracker` owns external work objects, Backlog/Todo queues, lifecycle, priority, hierarchy, and accepted task-definition projection. `forge` owns pull requests. Either role may be absent. Persisted `.project/` artifacts remain authoritative in versioned or unversioned mode.

Read and follow `../phase.md` for the shared Phase transitions, native projection invariant, and fresh-fact validation procedure.

`integration_context` reads local configuration, authority and entity state. An enabled role means it is configured, not that the harness has probed its provider tools. Follow that provider's reference and call the configured registered MCP tools directly under normal permissions.

On denied/unavailable provider calls, preserve work and continue only independent work/the other role. Tracker-backed lifecycle/Priority never falls back to workflow authority. After uncertain/partial outcomes, the agent reads exact provider state, continues from confirmed application and retries only confirmed non-application. Report ambiguity instead of inventing a replacement.

Durable operation checkpoints are limited to non-idempotent creation/provisioning, duplicate-creation risk, or an exact user choice unavailable elsewhere. Already-bound lifecycle/Priority assignments and artifact projections create no checkpoint; recover them through provider read-back and safe absolute retry.

Never replace a denied or failed MCP operation with HTTP, `gh`, another client, or a provider SDK. Never let one role failure alter another role.

## Operations and Resource IDs

`inspect` is local/read-only. `inspect` and `queueIntake` require an explicit `target: "current" | "workflow"`: ordinary project operations use `current`; workflow-problem Todo intake uses the global source reference with `workflow`, as defined in [setup](../setup.md#workflow-reporting-source) and [queue](../queue.md). Use the returned selected-project tracker and artifact policy. The context's local `projectRoot` is not external report content. Missing or invalid source configuration stops the attempt with a corrective error, without setup or fallback. Select queue entity/Priority/Kind before `queueIntake`; explicit selected existing work uses `adopt`. Initialized work supplies `entityDir` for `initialize`, `resume`, tracker-only `artifactProjection`, or forge `pullRequest`. A required correction uses tracker-only `trackerMutation` with the selected labels/lifecycle/Phase/Priority/Task-hierarchy change. Phase mutations additionally supply fresh native lifecycle and normalized Phase metadata/applied-label facts as specified in `../phase.md`; the local tool validates and calculates the assignment without executing it. An explicit Task/Gig finish uses `finishRead` and only when merging is necessary `finishMerge`.

Provider references own call procedures. The agent uses approved content, exact configured names, recorded IDs and required live responses directly. The harness validates its own inputs/configuration and actual delivery evidence, not provider-tool schemas. `finishMerge` consumes exact PR-get evidence and compares the recorded PR number, repository/head/base and local source SHA. It returns fixed expected-head squash for an unmerged PR, complete merged proof or a blocked decision.

Strict `.local/metadata.json` remains outside Git in both artifact modes. Its root is `{ entityId, resourceIds }`; entries store IDs/URLs under exact entity/server/repository/Project/team/object or head/target scope. Lifecycle, Priority, labels, bodies, branch names and merge state remain live or authoritative facts, not cache snapshots.

| Object | Durable identity/progress | Local Resource IDs |
| --- | --- | --- |
| GitHub tracker | repository/issue number and pending creation/initialization work | numeric issue ID/URL and exact configured Project-item ID |
| Linear Project | Project UUID and pending work | URL |
| Linear issue | issue UUID; Task parent Project UUID; exact named/provisioning/ready branch contract | identifier/URL |
| GitHub PR | immutable versioned repository/head/target intent | currently recorded PR number/URL |

Use local `resource_ids` when a consumer needs addressing values. `resolve` uses the operation memo or scoped cache and reports missing IDs without generating provider calls. `record` validates actual required-read or clear-success mutation evidence before caching; `invalidate` removes only provider-proven stale IDs. Scope mismatch discards only the affected entry; access/network errors preserve it. Missing/stale data and malformed caches require agent investigation through the configured tracker/forge tools under normal permissions. Record the actual evidence afterward. Reuse required live facts from that response; do not read merely to populate cache.

For tracker initialization, `beginCreation` retains its existing attempted-create metadata under approval. For a PR, it prepares only immutable repository/head/target intent before the one submission commit. The agent then makes one native create and supplies clear-success evidence to `recordCreation`, which saves number/URL directly in the existing IDs file. Explicit `select` records the user's chosen PR in that same file. Post-submit recording never changes versioned metadata. Existing intent or uncertain outcomes require agent investigation, not blind replacement. Adoption and mutations seed IDs already obtained; queued work retains IDs only during its operation.

Each context request starts a fresh addressing-fact memo; shutdown/reload discards it. Required lifecycle/merge reads use current facts. When an operational read rejects an in-progress entity, check `../../MIGRATIONS.md`: if the reported violations match an entry's recognition cues, convert that one entity in one rewrite straight to the current schema, read it back, and continue, reporting the conversion in one line; otherwise investigate with the user. Normal reads never convert historical state.

## Confirm initialized tracker outcomes

After the provider's initialization steps are confirmed, call `confirm_tracker_initialization` with `entityDir` and `facts` from current-operation reads or established clear-success mutations. It validates consistency against pending approved intent and updates the existing binding. It does not execute provider calls, independently authenticate freshness/provenance, record Resource IDs, or provision branches. Missing/conflicting facts leave the binding pending; investigate through the configured MCP tools. Reuse outcome proof already obtained rather than adding routine confirmation reads.

Both provider variants require native `lifecycle`, `priority`, `phase` facts under [Phase](../phase.md), and `systemMetadata`:

- GitHub: `provider: github`, exact `repository`, `issueNumber`, configured `project` (`owner`, `ownerType`, `number`), observed `itemId`, and `parentIssueNumber` (Task parent issue number; otherwise `null`). Priority is the configured native value or `not set`.
- Linear: `provider: linear`, `resource: project | task-issue | gig-issue`, immutable object UUID as `id`, configured `team`, and `projectId` (Task parent Project UUID; otherwise `null`). Priority uses the native 0–4 value.
- Unversioned `systemMetadata` is `{ mode: unversioned }`. Versioned GitHub supplies `{ mode: versioned, labels, internalId: { scope, field, value } }` using complete observed issue labels and the configured Internal ID field outcome. Versioned Linear supplies `{ mode: versioned, internalId }` with the confirmed embedded ID.

The tool returns `changed`; an already-bound object is a local no-op. Only identified pending bindings with matching In Progress/Planning, copied Priority, relationships and applicable system metadata can complete. Keep exact branch naming/finalization and creation/Resource ID recording at their existing boundaries.

## Provider bodies

`artifactProjection` requires only the tracker role. Its source is the accepted `epic.md` or `plan.md`, which remains the tracker body's task definition throughout the entity lifecycle. Pull-request bodies use the synchronized `result.md` or `report.md`.

The workflow owns the provider's task-definition or result content; the workflow publication layer owns its attribution footer. Discussion, feedback, screenshots, logs, and supporting links belong in comments. Requirements and agreed decisions belong in the accepted source artifact. Publishing does not automatically create comments.

AI-assisted human-facing communication through the official GitHub/Linear MCP registrations is signed in code: GitHub uses a final `<sub>` paragraph and Linear uses italics, without an added divider. This includes initialization, queues, artifact publication, and comments. Keep signatures out of repository artifacts and do not add them manually. Prepared provider requests retain the approved content plus this sole deterministic attribution addition.

Automatically set local `__pi_authorship: "user-verbatim"` when the user supplies the complete message and you relay it unchanged. No special user opt-out wording is needed. Do not use verbatim mode for messages you compose, reword, expand, or generate around a user quotation; those use normal `ai-assisted` signing. Code preserves verbatim text byte-for-byte and removes the local mode before sending. The mode is per call, not a persistent setting. Metadata-only operations remain unchanged.

Use complete communication text for edits. Patch-only or template-only content writes require explicit registered reads as needed and a full-text write; signing never performs hidden provider calls. Publication policy belongs to `workflows/extensions/integrations/publication.ts`; the reusable Pi wrapper/runtime identity reader lives in `publication-tool.ts`, and current MCP attachment lives in `publication-mcp.ts`. These workflow-owned modules prepare attribution, not the generic transport or agent-written prose. Provider recognition is shared with workflow MCP setup inspection.

1. Start from the complete approved source artifact in the reviewed document shape in `../artifacts.md`: a nonempty `## Overview` followed by nonempty level-two supporting sections. Tracker Overview explains the brief and carries `### Plan highlights`; PR Overview explains the delivered outcome or report conclusion and material limitations. Both portions belong to the same reviewed source. Never summarize or condense during publication.
2. For unversioned projection, first remove or minimally rewrite only the forbidden content listed below from both visible and collapsed content. Present the complete sanitized candidate or exact diff, explain every change, and require approval before rendering. Folding is not a privacy boundary; keep the sanitized Overview/details shape.
3. Call `render_provider_body` with `entityDir`, the complete approved candidate as `source`, and `destination: tracker | pullRequest`. Publish its exact returned `markdown`. `projection.ts` owns all deterministic presentation and eligible closing references; do not recreate its algorithms in instructions or at callers.
4. Deterministic renderer output and the code-owned attribution treatment need no second approval. Preserve every source section and its text across the visible and collapsed portions. Any substantive omission, rewrite, addition, or new summary requires the existing complete-candidate or exact-diff approval. Preserve the exact rendered content in the request; workflow publication code applies attribution before native execution. An incompatible source produces a local layout error; revise and approve that source through the existing gates before publication.
5. Update the exact bound object's complete body directly. Trust an established clear provider success without requiring a full response echo or a routine pre-read, comparison, or confirmation read. Provider Markdown normalization does not authorize rewriting the submitted source.
6. After an uncertain or partial update, read the exact body to reconcile before retrying. Retry only confirmed non-application; preserve work and report ambiguity.
7. Apply this same contract when an existing pull request's synchronized `result.md` or `report.md` changes.

Unversioned mode may include the approved entity title, the approved Request during initialization, the accepted Epic/Plan task definition after planning, native lifecycle, native Phase metadata (Planning, Execution, and Self-Review), native priority, native hierarchy/Project relationship, exact provider branch name, and an explicitly approved PR reference. Never project qualified workflow IDs, `.project` paths or links, entity or kind labels/types, workflow/review terminology outside native Phase metadata, review artifacts, or raw workflow artifact structure. These restrictions do not make ordinary repository implementation paths private. The same code-owned attribution footer applies in both artifact modes and contains only the harness and configured provider/model identity.

## Branch gate

A ready branch contract contains exact `name`, `start`, `target`, and generated/tracker source. A Linear `tracker` Epic is immediately ready after reconstructing current provider branch settings; a Linear Task/Gig can be `tracker-pending`, `tracker-named` (exact saved name), or `provisioning` (name/start commit) before ready. Save a needed returned name before creating its local branch; generated naming needs no provider branch. Do not plan, review, push, or create a PR until `finalize_linear_branch` returns a ready contract. Never invent or rewrite a provider-generated branch name.

## Workflow-first updates

For initialized entities, update workflow kind, `phase`, and artifacts first. Without a tracker, workflow authority stores Priority in `metadata.authority` and initialized lifecycle in `.local/status.md`. With a tracker, tracker authority uses native provider Status/Priority and `.local/status.md` is absent. For an already-bound tracker object, read required fresh provider values, set only the intended absolute lifecycle/Priority or changed label values through the selected operation, and verify required outcome facts absent from established clear-success responses. Reconcile uncertain/partial application before retry. Tracker authority never falls back to workflow authority. Versioned GitHub reconciles its managed Kind label from workflow metadata; unversioned GitHub and Linear keep Kind in workflow artifacts only. Provider failure never rolls workflow artifacts back.

Adding work to Backlog or Todo creates no workflow artifact or saved workflow recovery state. Follow `../queue.md`; recover uncertain provider results through read-back without a separate candidate protocol.
