# Integration roles

`tracker` owns external work objects, Backlog/Todo queues, lifecycle, priority, hierarchy, and accepted task-definition projection. `forge` owns pull requests. Either role may be absent. Persisted `.project/` artifacts remain authoritative in versioned or unversioned mode.

`integration_context` reads local configuration, authority and entity state. An enabled role means it is configured, not that the harness has probed its provider tools. Follow that provider's reference and call the configured registered MCP tools directly under normal permissions.

On denied/unavailable provider calls, preserve work and continue only independent work/the other role. Tracker-backed lifecycle/Priority never falls back to workflow authority. After uncertain/partial outcomes, the agent reads exact provider state, continues from confirmed application and retries only confirmed non-application. Report ambiguity instead of inventing a replacement.

Durable operation checkpoints are limited to non-idempotent creation/provisioning, duplicate-creation risk, or an exact user choice unavailable elsewhere. Already-bound lifecycle/Priority assignments and artifact projections create no checkpoint; recover them through provider read-back and safe absolute retry.

Never replace a denied or failed MCP operation with HTTP, `gh`, another client, or a provider SDK. Never let one role failure alter another role.

## Operations and Resource IDs

`inspect` is local/read-only. Select queue entity/Priority/Kind before `queueIntake`; explicit selected existing work uses `adopt`. Initialized work supplies `entityDir` for `initialize`, `resume`, tracker-only `artifactProjection`, or forge `pullRequest`. A required correction uses tracker-only `trackerMutation` with the selected labels/lifecycle/Priority/Task-hierarchy change. An explicit Task/Gig finish uses `finishRead` and only when merging is necessary `finishMerge`.

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

## Provider bodies

`artifactProjection` requires only the tracker role. Its source is the accepted `epic.md` or `plan.md`, which remains the tracker body's task definition throughout the entity lifecycle. Pull-request bodies use the synchronized `result.md` or `report.md`.

The workflow owns the entire provider body. Discussion, feedback, screenshots, logs, and supporting links belong in comments. Requirements and agreed decisions belong in the accepted source artifact. Publishing does not automatically create comments.

1. Start from the complete approved source artifact. Never summarize or condense it.
2. For unversioned tracker projection, first remove or minimally rewrite only the forbidden content listed below. Present the complete candidate or exact diff, explain every change, and require approval.
3. Call `render_provider_body` with the approved candidate and destination. It removes the first Markdown H1 plus its following blank line. For a pull request whose bound GitHub tracker and forge use the same repository, it also appends a horizontal rule, a blank line, and `Closes #<issue number>`. Linear adds nothing to the body.
4. H1 removal and the same-repository GitHub closing block need no separate content approval. Any other difference from the source artifact requires the existing complete-candidate or exact-diff approval. Preserve the exact rendered request.
5. Update the exact bound object's complete body directly. Trust an established clear provider success without requiring a full response echo or a routine pre-read, comparison, or confirmation read. Provider Markdown normalization does not authorize rewriting the submitted source.
6. After an uncertain or partial update, read the exact body to reconcile before retrying. Retry only confirmed non-application; preserve work and report ambiguity.
7. Apply this same contract when an existing pull request's synchronized `result.md` or `report.md` changes.

Unversioned mode may include the approved entity title, the approved Request during initialization, the accepted Epic/Plan task definition after planning, native lifecycle, native priority, native hierarchy/Project relationship, exact provider branch name, and an explicitly approved PR reference. Never project qualified workflow IDs, `.project` paths or links, entity or kind labels/types, workflow/review terminology, review artifacts, or raw workflow artifact structure. These restrictions do not make ordinary repository implementation paths private.

## Branch gate

A ready branch contract contains exact `name`, `start`, `target`, and generated/tracker source. A Linear `tracker` Epic is immediately ready after reconstructing current provider branch settings; a Linear Task/Gig can be `tracker-pending`, `tracker-named` (exact saved name), or `provisioning` (name/start commit) before ready. Save a needed returned name before creating its local branch; generated naming needs no provider branch. Do not plan, review, push, or create a PR until `finalize_linear_branch` returns a ready contract. Never invent or rewrite a provider-generated branch name.

## Workflow-first updates

For initialized entities, update workflow kind, `workStage`, and artifacts first. Without a tracker, workflow authority stores Priority in `metadata.authority` and initialized lifecycle in `.local/status.md`. With a tracker, tracker authority uses native provider Status/Priority and `.local/status.md` is absent. For an already-bound tracker object, read required fresh provider values, set only the intended absolute lifecycle/Priority or changed label values through the selected operation, and verify required outcome facts absent from established clear-success responses. Reconcile uncertain/partial application before retry. Tracker authority never falls back to workflow authority. Versioned GitHub reconciles its managed Kind label from workflow metadata; unversioned GitHub and Linear keep Kind in workflow artifacts only. Provider failure never rolls workflow artifacts back.

Adding work to Backlog or Todo creates no workflow artifact or saved workflow recovery state. Follow `../queue.md`; recover uncertain provider results through read-back without a separate candidate protocol.
