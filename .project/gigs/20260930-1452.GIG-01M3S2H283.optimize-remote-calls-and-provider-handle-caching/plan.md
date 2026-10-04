# Plan

## Outcome

Simplify workflow remote calls and the implementation. The user explicitly deleted `operation-policy.ts` and `forge-journal.ts` and requested their dependencies be cleaned out. Remove the call-template language, runtime provider-tool/schema preflights, PR creation state machine and `.local/forge.json` artifact. Do not replace them with another planner, executor, journal, readiness protocol or framework.

The workflow harness reads/writes its own configuration, metadata, artifacts and Resource IDs, and checks real branch/delivery invariants. The agent follows provider references and calls registered GitHub/Linear tools directly under normal permissions. The existing MCP bridge owns provider-tool registration and schemas. Provider errors and uncertain outcomes require agent investigation before retry; errors never establish absence.

Keep the original brief, immutable title/branch/start/target, historical reviews/entities, real integration configuration, default-branch discovery, mixed staging and unrelated work unchanged. Earlier snapshots remain history; their planner/journal requirements are superseded by this explicit instruction.

## Storage and interfaces

- Durable metadata keeps semantic GitHub repository/issue number, Linear UUID/Task parent Project UUID, lifecycle authority/unfinished desired values, immutable branch contract and PR repository/head/target intent.
- Prepare immutable PR intent before the one submission commit/push. It contains no creation-progress or unique/selected bookkeeping. Existing intent is not authorization for another first creation.
- After the one actual PR-create call succeeds, record its validated returned number/URL directly in the existing ignored `.local/metadata.json` Resource IDs file. Recording and later explicit PR selection update only this file, never versioned metadata. There is no separate PR progress artifact or staged local binding protocol.
- Resource IDs remain strict `{ entityId, resourceIds }` scoped IDs/URLs with queued atomic mutation, unrelated-entry preservation and operation memo reset. Adoption/create/required reads supply IDs without extra provider reads. Missing/stale data is agent-led investigation, not automated discovery/restoration. Status/Priority/labels/bodies/merge state remain live or authoritative facts.
- `resource_ids` retains local use/record/selection/invalidation and tracker creation recording. Forge preparation writes only immutable intent; forge creation recording writes only returned IDs. Drop journal states and their response fields/requirements directly, with no aliases.
- `integration_context` returns local configuration, authority, entity and selected role information. It does not enumerate or validate provider tool definitions, generate calls or return placeholder/proof-string programs. Remove runtime-only adapter wrappers and capability helpers that have no remaining consumer. Preserve actual Linear branch finalization.
- Exact finish validation stays focused: use the locally recorded PR number and fresh exact PR-get evidence, compare repository/head/base/local source SHA, return fixed expected-head squash only when unmerged, reuse complete merged proof, block mismatch/incomplete evidence. Cleanup checks the recorded PR number and unchanged target/origin/worktree/authority safeguards. A synchronous scoped cache read may serve these existing synchronous local boundaries; it performs no remote operation or restoration.
- Remove the journal-associated `ForgeAssociation` model. The recorded PR ID is the currently selected PR; explicit selection changes that ID through actual exact read evidence. Only the active Gig can adopt changed metadata; it has no forge intent yet. Document strict breaking interfaces in `workflows/MIGRATIONS.md`; no historical conversion or compatibility reader.

## Decision table

| Case | Behavior |
| --- | --- |
| Read integration context | Read local configuration/entity/authority; return the selected role configuration, without provider schema/call checks. |
| First approved PR creation | Prepare immutable intent before one commit/push; agent makes one native create; save returned IDs directly. |
| Known PR or explicit selection | Use/record its scoped number/URL in the existing IDs file; no journal or post-submit metadata write. |
| Missing IDs or uncertain create/update | Agent investigates through configured provider tools and conversation; no generated search, blind retry or replacement. |
| Finish with matching recorded PR and exact unmerged evidence | Return fixed squash with verified local head SHA. |
| Finish with matching recorded PR and complete merged evidence | Reuse proof; no merge call. |
| Missing/mismatched/incomplete finish evidence | Block merge/Done/cleanup and preserve work. |
| Confirmed stale IDs | Remove only that entry; agent investigates replacement. |

## Retained eleven normal optimizations

1. GitHub queue: direct approved issue create, only selected versioned Kind, Task parent when applicable, supported named Project Status/Priority writes. Parent-bearing creation and issue fields are separate calls. No discovery/label/option preflight or queued cache.
2. Linear queue: create only the selected Epic Project, Task issue in its parent Project, or projectless Gig issue using named team/status/native Priority.
3. Adoption: exact read-only title/Request/queue/Priority/repository/Project/parent intake; initialize the same object and seed already-obtained IDs; reuse proven membership/hierarchy.
4. Initialization: combine supported initial writes, keep semantic identity and unfinished desired Priority, complete only unproven updates, preserve unrelated labels. Tracker-owned creation checkpoints remain existing tracker metadata, not a new PR protocol.
5. Linear naming: generated names need no unused provider-name read; tracker naming saves its exact returned/fetched name before existing safe provisioning.
6. Resume: fresh required Status/Priority/Planning/Kind using known addressing; correct only wrong managed values. No PR/configuration discovery or cached lifecycle.
7. Tracker bodies: complete rendered accepted artifact published directly by durable identity; no routine pre-read/comparison/confirmation after clear success. Discussion stays in comments; agent reconciles uncertain writes.
8. Submission: one focused commit/push, direct first PR create using exact approved title/body and immutable head/target, then direct local ID recording. No second bookkeeping commit/CI.
9. PR revisions: direct full-body update using known PR number; clear success is trusted, uncertainty is agent-reconciled, no replacement PR.
10. Explicit finish: conditional fixed expected-head squash, fresh exact merged-state proof before Done, never cached merge receipts. No merge-commit SHA requirement, automatic Epic/local merge or configurable method.
11. Cleanup: confirmed delivery/Done, stored target checkout, fast-forward and exact fresh-origin equality, delete only local Deliverable source. Keep no-forge ancestry, Epic/main/remote protections and source preservation on blockers.

## Verification

- Delete the planner trace suite and journal-state tests. Retain focused tests at owned boundaries: configuration/authority, ID recording/selection, branch naming/provisioning, bodies, exact finish evidence and real-Git cleanup.
- Verify context works without provider-tool catalog/schema inspection, returns no call-template program, and distinguishes tracker/forge roles through configuration. Test malformed owned inputs/configuration at their existing boundary, not provider-schema hypotheticals.
- Verify one actual creation response records number/URL with one unchanged submission commit, no `.local/forge.json`, no versioned mutation and both-mode ID exclusion. Verify explicit selection updates only recorded IDs and required finish/cleanup rejects another PR number.
- Keep strict ID scoping/atomic writes/unrelated entries/memo reset. Missing cache has only a small local missing-ID assertion, not a recovery suite. Tracker initialization preserves native desired Priority; direct agent procedures remain in the provider references.
- Reuse established GitHub/Linear deployed mutation/merge evidence for unchanged provider contracts; use focused local/real-Git tests for changed storage and finish consumers. No substitute network client or new probes to justify invented cases.
- Run full/focused tests, affected TypeScript, installed oxfmt, staged/unstaged whitespace and protected-path checks. Measure current production/test/documentation additions/deletions against d90b984 and the previous implementation (+2,289/-378 production, +2,093/-244 tests, +172/-110 docs). Report actual remaining growth, not only deleted filenames or passing tests.
- Synchronize result and pending work; independent final review and final user artifact acceptance precede one product submission. Reload changed tool interfaces before live use. Acceptance is not finish permission.
