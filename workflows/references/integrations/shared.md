# Integration roles

`tracker` owns external work objects, backlog, lifecycle, priority, hierarchy, and accepted task-definition projection. `forge` owns repository links and pull requests. Either role may be absent. Persisted `.project/` artifacts remain authoritative in versioned or unversioned mode.

When `integration_context` returns top-level `state: enabled`, inspect each configured entry under `roles` independently:

- role `state: enabled`: use only its returned provider configuration, Pi-registered MCP tools, and read-only validation steps;
- role `state: unavailable`: report its exact capability error and preserve working-tree work plus any existing durable operation checkpoint. Continue only role-independent workflow work and the other enabled role; tracker-backed lifecycle/Priority reads, transitions, progress derivation, and completion remain blocked because no workflow-authority fallback exists;
- tool denial/provider failure: preserve working-tree work plus any existing durable operation checkpoint, reconcile remote state, and retry only the incomplete operation without changing the other role.

Durable operation checkpoints are limited to non-idempotent creation/provisioning, duplicate-creation risk, or an exact user choice unavailable elsewhere. Already-bound lifecycle/Priority assignments and artifact projections create no checkpoint; recover them through a provider re-read and safe absolute retry.

Never replace a denied or failed MCP operation with HTTP, `gh`, another client, or a provider SDK. Never let one role failure alter another role.

## Projection operations

`artifactProjection` requires only the tracker role and updates provider-facing content without requiring forge capability. Its source is the exact accepted `epic.md` or `plan.md`, which remains the tracker body's task definition throughout the entity lifecycle. `result.md` and `report.md` never replace or append to that body; versioned mode exposes them only through the shared Links section. Projection is lossless by default:

1. Read the current provider description/body and start from the complete authoritative artifact. Preserve its structure, wording, technical detail, ordinary repository paths such as `infra/...`, and unrelated provider content. Call `verify_artifact_projection` with the final expected candidate and current provider Markdown; only `exact` completes verification without a write.
2. Never summarize, condense, or otherwise rewrite accepted content automatically. Concision belongs in drafting and review before acceptance.
3. Apply one automatic presentation normalization without approval: remove the artifact's first Markdown H1 and its immediately following blank line only when the heading text exactly equals the provider title or `Plan: <provider title>`. This avoids repeating the provider's separately rendered title. Never remove any other heading or content under this rule.
4. In unversioned mode, remove or minimally rewrite only content forbidden below. In versioned mode, keep the remaining artifact text unchanged except for the shared deterministic `## Links` section or explicitly approved additions.
5. Except for duplicate-title H1 normalization and the shared deterministic `## Links` rendering, whenever the final provider candidate differs from the authoritative artifact, present the complete candidate or an exact diff before mutation. List every omission, rewrite, or addition and its reason. Require explicit user approval of that exact candidate.
6. Update the provider with only the unchanged artifact or explicitly approved candidate. Re-read the provider and call `verify_artifact_projection` again. Only exact bytes verify. `different` means verification failed: preserve working-tree work, show the exact difference, present the tool's remediation hint, and stop. Resume by re-reading the provider and rebuilding the candidate; do not repeat the write or seek new approval unless the user chooses a changed candidate.

## Shared Links section

Call `render_artifact_links` for PR and tracker bodies with the configured `artifactMode`, the `destination` (`pullRequest` or `tracker`), and verified `entries`. The tool only formats supplied evidence; it does not read Git, verify URLs, mutate providers, or authorize publication. Available link entries are:

1. `Brief` — root `brief.md`.
2. `Epic` or `Plan` — root `epic.md` or `plan.md`.
3. `Result` or `Report` — root `result.md` or `report.md`.
4. `Tracker` — configured tracker object.
5. `Pull request` — confirmed forge PR.

Supply repository entries as `brief`, `planOrEpic`, and `resultOrReport`, selecting the matching `label` for the latter two. Each contains `permanentCommit` and `targetBranch: { url, state }`; set `state` to `resolved` only after the target URL resolves, otherwise `available-after-merge`. Supply confirmed provider URLs as `tracker` and `pullRequest`; include a PR reference only when its publication is approved. Omit unavailable entries. Unversioned input accepts only external entries.

Use the returned `markdown` unchanged. Append a nonempty block after the exact approved destination body, separated by a blank line; omit the section when the returned string is empty. No separate content approval is required for the rendered Links; the enclosing approved operation and configured permission gate still govern provider mutation.

`artifactLinks` requires only the forge role; its generated repository links may be rendered into PR or tracker bodies. In versioned mode, after a containing commit exists, generate the repository entries above whether or not a tracker exists. In unversioned mode, link generation skips before forge capability or branch checks and `.project` links are never exposed.

Unversioned mode may include the approved entity title, the approved Request during initialization, the accepted Epic/Plan task definition after planning, native lifecycle, native priority, native hierarchy/Project relationship, exact provider branch name, and an explicitly approved PR reference. Never project qualified workflow IDs, `.project` paths/links, entity or kind labels/types, workflow/review terminology, review artifacts, or raw workflow artifact structure. These restrictions do not make ordinary repository implementation paths private. Preserve unrelated provider content.

## Branch gate

A ready branch contract contains exact `name`, `start`, `target`, and generated/tracker source. A Linear `tracker` Epic is immediately ready after reconstructing current provider branch settings; a new Linear Task/Gig can instead be `tracker-pending` or `provisioning` until its issue supplies the exact branch. Do not plan, review, link artifacts, push, or create a PR until `finalize_linear_branch` returns a ready contract. Never invent or rewrite a provider-generated branch name.

## Workflow-first updates

For initialized entities, update workflow kind and artifacts first. Without a tracker, workflow authority stores Priority in `metadata.authority` and lifecycle in `.local/status.md`. With a tracker, tracker authority uses native provider Status/Priority and `.local/status.md` is absent. For an already-bound tracker object, re-read current provider values, set the absolute intended lifecycle/Priority values, and re-read for confirmation. An interrupted or failed assignment is safe to retry after another provider read; tracker authority never falls back to workflow authority. Project kind/type only in versioned mode; unversioned mode keeps kind in workflow artifacts. Provider failure never rolls workflow artifacts back.

Backlog intake is the sole exception with no workflow artifact or retry queue. It therefore uses provider-specific candidate reconciliation and user confirmation before recreating an uncertain item.
