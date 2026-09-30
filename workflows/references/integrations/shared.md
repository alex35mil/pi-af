# Integration roles

`tracker` owns external work objects, Backlog/Todo queues, lifecycle, priority, hierarchy, and accepted task-definition projection. `forge` owns pull requests. Either role may be absent. Persisted `.project/` artifacts remain authoritative in versioned or unversioned mode.

When `integration_context` returns top-level `state: enabled`, inspect each configured entry under `roles` independently:

- role `state: enabled`: use only its returned provider configuration, Pi-registered MCP tools, and read-only validation steps;
- role `state: unavailable`: report its exact capability error and preserve working-tree work plus any existing durable operation checkpoint. Continue only role-independent workflow work and the other enabled role; tracker-backed lifecycle/Priority reads, transitions, progress derivation, and completion remain blocked because no workflow-authority fallback exists;
- tool denial/provider failure: preserve working-tree work plus any existing durable operation checkpoint. Read provider state, continue from confirmed presence/application, retry only after confirmed absence/non-application, and report ambiguity or inconsistency. Never let recovery alter the other role.

Durable operation checkpoints are limited to non-idempotent creation/provisioning, duplicate-creation risk, or an exact user choice unavailable elsewhere. Already-bound lifecycle/Priority assignments and artifact projections create no checkpoint; recover them through provider read-back and safe absolute retry.

Never replace a denied or failed MCP operation with HTTP, `gh`, another client, or a provider SDK. Never let one role failure alter another role.

## Provider bodies

`artifactProjection` requires only the tracker role. Its source is the accepted `epic.md` or `plan.md`, which remains the tracker body's task definition throughout the entity lifecycle. Pull-request bodies use the synchronized `result.md` or `report.md`.

1. Read the current provider body and start from the complete source artifact. Never summarize or condense it.
2. For unversioned tracker projection, first remove or minimally rewrite only the forbidden content listed below. Present the complete candidate or exact diff, explain every change, and require approval.
3. Call `render_provider_body` with the approved candidate and destination. It removes the first Markdown H1 plus its following blank line. For a pull request whose bound GitHub tracker and forge use the same repository, it also appends a horizontal rule and `Closes #<issue number>.` Linear adds nothing to the body.
4. H1 removal and the same-repository GitHub closing block need no separate content approval. Any other difference from the source artifact requires the existing complete-candidate or exact-diff approval. Preserve unrelated provider content.
5. Update the provider only when the expected body differs. Re-read it and call `verify_artifact_projection`; only exact bytes verify. If verification differs, preserve work, show the exact difference, and stop. After an uncertain update, re-read first and retry only after confirmed non-application.
6. Update an existing pull request when its source `result.md` or `report.md` changes.

Unversioned mode may include the approved entity title, the approved Request during initialization, the accepted Epic/Plan task definition after planning, native lifecycle, native priority, native hierarchy/Project relationship, exact provider branch name, and an explicitly approved PR reference. Never project qualified workflow IDs, `.project` paths or links, entity or kind labels/types, workflow/review terminology, review artifacts, or raw workflow artifact structure. These restrictions do not make ordinary repository implementation paths private.

## Branch gate

A ready branch contract contains exact `name`, `start`, `target`, and generated/tracker source. A Linear `tracker` Epic is immediately ready after reconstructing current provider branch settings; a new Linear Task/Gig can instead be `tracker-pending` or `provisioning` until its issue supplies the exact branch. Do not plan, review, push, or create a PR until `finalize_linear_branch` returns a ready contract. Never invent or rewrite a provider-generated branch name.

## Workflow-first updates

For initialized entities, update workflow kind, `workStage`, and artifacts first. Without a tracker, workflow authority stores Priority in `metadata.authority` and initialized lifecycle in `.local/status.md`. With a tracker, tracker authority uses native provider Status/Priority and `.local/status.md` is absent. For an already-bound tracker object, re-read current provider values, set the absolute intended lifecycle/Priority values, and re-read for confirmation. Tracker authority never falls back to workflow authority. Versioned GitHub reconciles its managed Kind label from workflow metadata; unversioned GitHub and Linear keep Kind in workflow artifacts only. Provider failure never rolls workflow artifacts back.

Adding work to Backlog or Todo creates no workflow artifact or saved workflow recovery state. Follow `../queue.md`; recover uncertain provider results through read-back without a separate candidate protocol.
