# GitHub tracker

First follow `../shared.md`. Read local configuration through `integration_context`, then follow this procedure using configured registered tools. Setup validates configuration comprehensively; ordinary operations inspect only required fields/labels. Follow `../../phase.md` for the shared invariant and the focused Phase metadata validation; never enumerate unrelated provider metadata.

## Adopt selected queued work

Only an explicit selected existing issue uses adoption, before `init`:

1. Request `integration_context` operation `adopt` with the selected `entity`.
2. Read the exact configured repository/issue number for title, description, URL, labels, required issue-scoped Priority, and Task hierarchy evidence. Reuse facts supplied together. Read all issue discussion pages; treat contributor messages as proposals/evidence and resolve material requirements with the maintainer before changing scope.
3. Find its exact item in the configured Project, requesting only required Status/Priority fields. Complete pagination; verify repository and issue number, numeric Project-item database ID, Backlog or Todo, and configured Priority (`not set` when empty). The Project item can supply numeric issue ID omitted by the deployed issue read.
4. Follow the explicit-selection approval in `../../artifacts.md`: reuse the issue title and description, copied Priority, and available configured Kind without another intake confirmation. Ask only for missing or conflicting information, including Kind or the Task relationship when unresolved. Pass numeric issue ID, number, URL, and numeric Project-item ID as verified intake evidence to `init`. It keeps repository/issue number durable and seeds recoverable values locally.

Wrong repository/Project/parent, non-queue state, ambiguity, denied access, or unconfigured Priority stops adoption. A single configured queue Kind supplies the initialized Kind unless the user explicitly changes it; missing or conflicting Kind requires a user choice. After initialization, workflow metadata owns Kind. Skip already-proven creation, membership and hierarchy work.

## Initialize

`init` records planning/In Progress intent with `awaiting` for new work or `bound-pending` for adopted work. Request `initialize` for the selected entity.

For new work:

1. Build one issue create using exact approved title/Request and—in versioned mode—the authoritative Kind. Include Task parent issue number. Include supported issue-scoped Priority/Internal ID together; a Task parent and issue fields cannot share creation, so apply those fields together afterward.
2. Before the first remote create, call `resource_ids` `beginCreation`, role `tracker`. Then call the registered issue create directly under approval. No duplicate/label/option preflight.
3. On established clear success, call local `recordCreation` with the actual registered-tool arguments/response. It saves repository/issue number before dependent work and caches supplied ID/URL; a minimal ID/URL success is not automatically uncertain.
4. Add to the configured Project and record its returned Resource IDs through `resource_ids`. Use named Project writes by exact issue relationship for In Progress, approved Priority and versioned Internal ID. Reconcile Planning in the configured Project Phase field through `../../phase.md` in both artifact modes. Combine supported issue-field writes. Do not refetch merely to populate cache. Clear success proves only facts established by that tool's deployed contract; obtain required missing facts and reconcile partial/unknown outcomes.
5. Reuse proven creation labels and parent assignment. For an adopted issue or an unproven remaining correction, read current labels/hierarchy, preserve unrelated labels, and change only differences. Request `trackerMutation` with `change: labels` or Task-only `hierarchy` only when that correction is needed; numeric child issue ID can come from existing Project evidence.
6. Call `confirm_tracker_initialization` with the observed outcomes under `../shared.md`. Missing evidence keeps initialization pending; do not complete it with manual metadata edits or store provider snapshots in durable records.

Adopted Backlog/Todo moves directly to In Progress, retaining the same object and copied Priority. Proven Project addition and correct parent relationship are not repeated.

## Resume and mutations

Request `resume`, then read fresh Status/Priority/Phase and complete issue labels needed for versioned Kind. Reconcile Phase through `../../phase.md` using the exact Project field definition and fresh current selection. A scoped cached Project-item ID reaches required current fields directly; that response must verify the exact issue/Project identity. Missing or confirmed-stale Resource IDs require agent investigation through configured provider tools; record the actual required response afterward. Network/permission errors do not establish absence. PR discovery is unrelated to ordinary resume.

Phase is present only for initialized In Progress work and equals the authoritative Planning, Execution, or Self-Review activity. Clear native Phase outside In Progress. Phase projects in both artifact modes. Versioned Kind equals the authoritative workflow Kind; unversioned mode projects no Kind. Preserve unrelated labels. Reuse current-operation reads and write only when the intended set differs. Required label confirmation remains when mutation success does not establish the applied full set; no all-label-definition preflight is needed.

Use `trackerMutation` with only the selected `labels`, `lifecycle`, `phase`, `priority`, or Task `hierarchy` change. Phase supplies the fresh lifecycle/native facts from `../../phase.md` and applies only the returned changed absolute field assignment. Project/issue Priority follows its configured scope. Lifecycle/priority remain provider authority, never cached snapshots or local fallback. Follow shared absolute-value outcome/recovery rules.

## Creation uncertainty

A returned error can follow creation or partial application. Preserve the pending/known-created checkpoint. Check the original submitted create arguments. Recover by exact qualified Internal ID only when that ID was included in creation. Task parent-bearing creates omit issue fields, and Project-scoped Internal ID is assigned later; use recent exact approved title, repository, and required relationship for these creates and every other create without a submitted Internal ID. Search is lazy and only for explicit adoption or uncertainty. Complete pagination, require one exact match, and retry only confirmed incomplete work. Do not add markers, choose the first result, or create a replacement on ambiguous/denied evidence.

## Queue and plan publication

Follow `../../queue.md`. Queued work has no workflow artifact/cache/checkpoint. Create with only approved versioned Kind (omit for `not set`), no Phase/Internal ID, selected native destination and Priority. Reuse returned identities during this operation; reconcile uncertain results before retry.

Every initialized GitHub issue retains its original request title/description. New work creates those fields from the approved Request; adopted work preserves existing text. For accepted `epic.md`/`plan.md`, request tracker-only `artifactProjection`, then call `tracker_publication` with `action: prepare`, `entityDir`, and the complete approved source. Follow `../shared.md` for unversioned sanitization and deterministic presentation approval. Execute the exact returned registered create/update-comment call, never an issue-body/title update for a plan.

First publication persists `planComment: pending` before returning one `add_issue_comment`. Call `tracker_publication` with `action: record` and actual clear-success evidence to save the returned identity. Published state always prepares `update_issue_comment` for that same ID. A pending attempt returns recovery-required, not another create. With uncertain success, supply complete explicit `issue_read get_comments` page evidence to `action: recover`; include a terminal short/empty page and a consistent `perPage`. Recover only a unique marker match on the bound issue. Missing/duplicate matches or a missing/conflicting published comment stop for maintainer investigation, without replacement creation.

Do not read merely to confirm an established successful update. For uncertain updates, recover/read the exact saved comment and compare the complete intended publication before retrying confirmed non-application. Keep plan-comment identity/intent in authoritative metadata; existing issue/Project Resource IDs, metadata management and Phase remain unchanged. Resume reuses state and does not itself republish.
