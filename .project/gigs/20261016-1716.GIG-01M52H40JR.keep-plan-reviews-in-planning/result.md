# Result

## Overview

- Plan reviews and plan-presentation preparation require Planning. Interim and final reviews still require Self-Review.
- `prepare_plan_presentation` validates and selects a reviewed snapshot and returns source/target paths. The write tool presents the approval diff. Tool registration, schema names, skill permissions, guidance, and tests use the preparation name.
- The user guide and shared phase, planning, review, Epic, and Deliverable guidance keep plan drafting, review, corrections, presentation, and waiting for approval in Planning. The user-guide diagram shows this planning loop before Execution. Implementation corrections remain Execution.
- User-directed kind changes are allowed between any supported kinds at any lifecycle, including Done and Canceled. They update metadata and the managed Kind label where configured, leaving lifecycle, Phase, branch, and existing artifacts unchanged.
- Existing branch-readiness, local lifecycle, review-category, approved-snapshot, completion-artifact, and pending-work checks remain intact. Tracker lifecycle and Phase projection behavior are unchanged.

Existing Pi sessions need `/reload` to activate the updated review guard and renamed preparation tool.

## Implementation details

The review extension owns one category-aware `assertReviewPhase` guard. `review` passes its parsed plan/interim/final category; `prepare_plan_presentation` passes plan. The guard checks branch readiness, the category's required metadata Phase, and In Progress for workflow-authority lifecycle. Tracker-backed work continues to use the existing fresh-provider lifecycle procedure, without local lifecycle copies or additional provider calls.

Planning corrections and blocked planning-review confirmation pauses stay in Planning. Reviews of delivered work and their confirmation pauses use Self-Review; permitted implementation corrections use Execution. Plan acceptance retains the transition to Execution and remains required before implementation.

The shared kind-change guidance is one metadata update plus existing label reconciliation. A kind-only change preserves identity, Task parent, brief, and accepted plan/result/report artifacts along with workflow state. Future work uses the current kind's strategy; actual scope or behavior changes retain their normal approval rules. Versioned GitHub preserves unrelated labels while reconciling Kind; Linear and unversioned GitHub keep Kind in workflow metadata only. No runtime kind-transition mechanism was added.

## Verification

- `npx tsx --test tests/workflow-phase.test.ts tests/workflow-review.test.ts tests/workflow-instructions.test.ts` — all 29 focused tests passed.
- `npm test` — all 212 tests passed.
- `npx tsc --noEmit` — passed.
- `npx oxfmt --check` on all four changed TypeScript files — passed.
- `git diff --check` — passed.
- Boundary tests cover Epic/Task/Gig, category/Phase combinations, inactive local lifecycle, GitHub/Linear tracker authority without local lifecycle state, and pending branch rejection.
- Registered-tool tests exercise category routing and `prepare_plan_presentation`, verify its returned snapshot/target paths, preserve a distinct previously accepted plan plus snapshots and metadata, and reject a blocked snapshot. They stop before spawning a reviewer subprocess.
- Instruction tests cover unrestricted kind changes, preserved state/artifacts, managed-label disclosure rules, the user-guide lifecycle diagram and review wording, the complete planning loop, implementation corrections, blocked-review pauses, acceptance, and unchanged external-submission rules. Existing tests continue to cover entity/category schema restrictions, result/report requirements, pending-work checks, and approved-snapshot selection.
