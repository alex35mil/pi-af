# Result

## Overview

- Added a shared workflow rule that weighs preflight checks against their cost. Cheap, useful local checks remain appropriate; remote checks and user interruptions that merely predict safe rejection are avoided. Merge/shipping guidance relies on GitHub's authoritative merge response while preserving verification, approval, exact-head, and recovery safeguards.
- Separated Epic routing intent from delivery proof. The approved `taskTarget` is recorded before committing planning work, so the accepted plan and routing metadata are delivered together. No post-merge target mutation is required.
- Every new/adopted default-target Task still verifies current delivery independently. Existing Task targets and the exact repository, branch, source-revision, merged-state, registered-tool provenance, and versioned accepted-plan checks remain unchanged.
- `set_epic_task_target` now accepts only `entityDir` and `target`; delivery evidence remains on the three Task initialization tools. Existing metadata needs no migration. No persisted delivery snapshots, approval tokens, broader MCP configuration, or consuming-project changes were introduced.

## Implementation walkthrough

`setEpicTaskTarget` records routing intent after repository, persistence, entity, ready-branch, and local-branch validation. It no longer invokes the delivery guard or accepts delivery/catalog options. The Epic lifecycle records the approved choice before any planning commit; the Epic/Task skills, shared references, native tool contract, and READMEs describe that ordering consistently.

Task initialization keeps the existing `readParentEpic` delivery boundary and accepted-plan blob comparison. The guard still requires either current source ancestry or exact registered merged-PR evidence, including the current source SHA. Selecting default therefore cannot initialize an undelivered Task or retarget an existing Task.

Local regressions exercise actual plan-plus-default-metadata squash merges with native-shaped PR evidence and a clean working tree before Task initialization, without a post-merge setter call. The matrix covers new, GitHub-adopted, and Linear-adopted Tasks in both artifact modes, including invalid/stale/errored evidence, missing branches/forge/provenance, undelivered revisions, accepted-plan reachability, ancestry, and unchanged existing Task targets.

## Verification

- `node --import tsx --test tests/workflow-epic-delivery.test.ts tests/workflow-domain.test.ts tests/workflow-instructions.test.ts tests/workflow-tool-contracts.test.ts tests/workflow-incoming-pr-guidance.test.ts tests/workflow-merge.test.ts` — all 106 tests passed.
- `npm test` — all 685 tests passed, with no failures, skips, or cancellations.
- `npm run typecheck` — passed.
- `./node_modules/.bin/oxfmt --check` on the seven changed TypeScript files — passed.
- `git diff --check` — passed.
- Final diff inspection — delivery guard behavior and existing Task targets are unchanged; native schema/caller updates and lifecycle guidance agree; the earlier preflight fix is preserved. Regression verification used local fixtures, not live provider operations.
