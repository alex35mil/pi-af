# Plan

## Overview

GitHub Project setup can reject a successfully created Board because it treats visible-field order as a provider guarantee. When the create response also lacks the expected envelope, recovery rejects the Board and reports only `invalid created Board`, hiding the failed check and request context. Correct Board visibility validation and diagnostics so approved setup can finish or explain exactly why it stopped, without duplicate creation or unsafe cleanup.

### Plan highlights

- Treat Board visible fields as an exact selection, not a controllable card-field sequence, throughout preview, verification, recovery, and default-view safety checks.
- Preserve table ordering, roadmap constraints, Status columns, no swimlanes, Priority sorting, and the existing approval and deletion boundaries.
- Report safe request method/path, provisioning stage, and specific failed checks; retain both create-response and recovery evidence when recovery cannot confirm success.
- Cover the reproduced failure and explicit recovery of a partially provisioned Project without replacing resources or deleting unapproved views.

## Root cause

### Symptom

Approved fresh personal-Project setup leaves both the generated default view and the requested Board, then stops with `GitHub setup failed during apply: GitHub setup failed during Board setup: invalid created Board`.

### Evidence

- `GitHubClient.createBoardView` expects REST JSON under `value.node_id`. The `record(result.value, "created Board")` check emits the exact innermost error when `value` is absent. This parsing occurs outside the request-context wrapper used by `rest`.
- `provisionFreshBoard` already catches create failures and reads newly appeared views. Its `matchesBoard` calls shared `matchesView`, which compares `visibleFieldIds` using exact JSON array equality. A permutation of the same fields rejects recovery; the code then rethrows the original parsing error without explaining the failed recovery checks.
- The existing test `reconciles a created Board when HTTP success omits the expected response envelope` records a prior live 201 response without `value`; its full shape was not retained. The test currently succeeds because its fake preserves request order.
- A local probe under `.local/scratch/` changes only that test's returned Board-field sequence by reversing it. Against unchanged product code, it reproduces the exact reported error. Baseline `tsx --test tests/workflow-github-project-setup.test.ts` passes all 66 tests.
- GitHub's [REST view documentation](https://docs.github.com/en/rest/projects/views) defines `visible_fields` as the field IDs visible in table/board views, without an ordering guarantee. Its [Board documentation](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout) documents showing/hiding fields, not card-field ordering. Table documentation separately supports reordering columns in the UI; this bugfix preserves current table behavior.
- `viewFingerprint` and the preview's selected-view snapshot also retain Board visible-field sequence. They must use the same Board-selection semantics rather than introducing another order-dependent check.

### Cause

The owning view model conflates Board visibility membership with table-style field sequence. That false requirement affects fresh-Board verification and recovery, selected-view reconciliation, approval stability, and Board default-view fingerprints. Separately, REST Board response parsing bypasses safe request-context diagnostics and failed recovery discards its useful mismatch evidence.

The original consuming installation's revision, local modifications, and complete HTTP response were not retained. The local causal reproduction establishes a current-code defect matching the symptom, not proof of every historical production detail. No third-party dependency defect is alleged.

## Proposed fix

### View contract and consumers

Implement the distinction at the shared view-model/comparison boundary in `workflows/extensions/project-setup/github-project.ts`, not as a fresh-Board-only workaround. Use one consistent Board visibility representation/comparison for all consumers, including hash-visible selected-view snapshots and default-view fingerprints.

| Case | Required behavior |
| --- | --- |
| Board has exactly the requested distinct visible field IDs in a different sequence | Equal; no corrective write, verification failure, recovery rejection, approval invalidation, or edited-default classification solely for that permutation. |
| Board visibility is missing a requested field, includes an unrequested field, or repeats an ID | Not equal; preserve views on failed verification and identify the mismatch. |
| Board name/layout differs, columns differ, swimlanes exist, or sole Priority field/direction differs | Preserve the existing mismatch behavior and report the exact failed checks. |
| Table visible-field sequence differs | Retain current ordered matching and field-order behavior. |
| Roadmap has visible fields requested | Retain existing rejection; an empty selection remains required. |
| Captured default view changes materially, or Project gains items | Stop cleanup and preserve views, as today. A Board-field permutation alone is not a material edit. |

Keep semantic field references, numeric REST field IDs, missing/ambiguous-field errors, and strict input duplicate checks. Keep Priority option ordering distinct from Board visible-field membership; do not weaken its existing checks. Preserve filter/group/sort settings for selected existing/resumed views.

### Diagnostics and recovery

- Wrap REST Board response interpretation with the same credential-safe request context used by request failures. Do not guess another response shape from the unretained live response; keep exact-state recovery as the supported reconciliation route.
- Derive specific verification differences from the same checks that determine matching, avoiding a separate contradictory validator. Explain missing/extra/duplicate fields and name/layout/column/group/sort/direction differences as applicable. Identify missing or unexpected view identity when that prevents verification.
- When create reconciliation finds no matching new Board or more than one, include the original safe create failure and recovery outcome, including candidate identity and failed checks where available. Never silently choose one or retry creation.
- Fresh Board read-back and cleanup failures retain setup stage and the relevant safe method/path context. Diagnostics contain no token, headers, request bodies, or raw fetch/provider objects; keep sanitization at the owning GitHub client boundary.
- Preserve current recovery policy: one confirmed newly appeared matching Board can finish the same apply; lost delete responses require exact absence; a later invocation inspects the existing Project and explicitly selects a view using `resume-created`, obtains a new preview/hash approval, and changes only that selected view. Do not infer deletion provenance across invocations or add durable setup checkpoints.

### Documentation

Update `workflows/skills/project-setup/SKILL.md`, `workflows/references/setup.md`, and `workflows/extensions/project-setup/README.md` together. Describe Board fields as a visible selection without a card-order promise. Keep table ordering distinct. Explain actionable verification diagnostics and explicit partial-Project recovery without duplicate creation or inferred deletion permission. Preserve existing manual-completion requirements.

## Risk and scope

A supported setup action performs a REST create followed by GraphQL read-back within one apply. The existing live-response evidence supports the missing-envelope case, and #61 records a different returned field sequence. Exact sequence matching deterministically rejects that combination, producing a partial Project and an unactionable error; no concurrency or synthetic timing is needed. This is an operational reliability defect, not established data loss. A shared layout-aware visibility contract and diagnostic reuse are less costly and more coherent than per-caller exceptions or a new persistence/retry subsystem.

Do not create a live test Project, delete external resources, change configured tracker Projects, alter authentication/routes, introduce speculative response adapters, or expand setup's API capabilities. Live provider mutation requires separate exact provisioning approval.

## Verify

Add regressions in `tests/workflow-github-project-setup.test.ts` for:

- Reordered Board fields after both a normal response and a missing-envelope/lost create response; one Board create only and only the approved captured default deleted.
- Selected existing/resumed Boards with equivalent field permutations: no update; permutation-only read changes do not invalidate approval. Material changes still require renewed approval.
- Board default fingerprints tolerating only field permutations while preserving protection for actual edits and nonempty Projects; table field order remains significant and roadmap constraints remain intact.
- Missing, extra, and duplicate Board fields and all existing column/group/sort/name/layout/identity mismatches: specific diagnostics and no premature deletion.
- Unexpected response shape, failed or ambiguous recovery, and failed recovery reads: original safe request method/path, setup stage, actionable recovery evidence, and credential redaction throughout the error cause chain; no repeated create.
- A failed setup resumed through inspection, explicit existing Board selection, and new approval: no replacement Project/Board, no default-view deletion, unrelated views/settings preserved.

Run focused setup tests, the complete `npm test` suite, TypeScript checking with `npx tsc --noEmit`, formatting checks for changed files using the repository's formatter, and `git diff --check`. Inspect the final diff for scope and documented guarantees. Record actual outcomes and any unrun checks in `result.md` before final review.
