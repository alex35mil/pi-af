# Keep plan reviews in Planning

## Overview

Plan drafting, review, corrections, presentation, and waiting for approval stay in Planning. Self-Review identifies review of delivered work, rather than review of a plan. This keeps local and tracker Phase accurate without changing lifecycle or approval requirements. User-directed kind changes are simple classification updates, allowed at any point without restarting the workflow.

### Plan highlights

- Make the shared review guard require Planning for plan reviews and plan presentation, and Self-Review for interim/final reviews.
- Name the snapshot-selection tool `prepare_plan_presentation`; it returns source/target paths, and the write tool presents the approval diff.
- Keep plan corrections in Planning; implementation corrections remain Execution.
- Align shared phase, planning, review, Epic, and Deliverable guidance with the same distinction.
- Verify both tool entry points and retain existing branch, local lifecycle, snapshot approval, completion-artifact, and pending-work gates.
- Allow any supported kind to change to any other supported kind at any lifecycle, including completed work, without forced replanning, reopening, or replacement work.

## Root cause

### Symptom

An initialized Epic, Task, or Gig in Planning cannot review or present its plan. Following the current instructions instead moves the work to Self-Review before any implementation exists, and projects that incorrect Phase to the tracker.

### Evidence

At repository baseline `697c2a6`, `review` and `present_plan` both call `assertSelfReview` in `workflows/extensions/review/index.ts`. The helper requires `status.phase === "selfReview"` regardless of review category. A direct ESM invocation against this Gig's Planning metadata throws `GIG-01M52H40JR review requires In Progress and Phase Self-Review`. The existing seven Phase tests pass and explicitly enforce that old requirement.

`workflows/references/phase.md`, `planning.md`, and `review.md` instruct agents to use Self-Review for plan review and Execution for plan corrections. The Epic acceptance guidance and Deliverable pre-execution kind-transition guidance repeat the conflicting behavior. The guard and instructions therefore reinforce the same error; changing one caller would leave the other caller and guidance broken.

### Cause

The shared review boundary treats all review categories as one activity. Review category is already available as `plan`, `interim`, or `final`, but the guard does not receive it. `present_plan` is always planning work.

This is a deterministic supported flow, not a race: requesting plan review immediately reaches the unconditional guard and is rejected, or the agent changes Phase to satisfy it and exposes the wrong activity. The risk occurs on ordinary plan reviews. Passing the existing category through one shared guard and aligning its direct consumers is sufficient; no new state, fallback, migration, or provider behavior is needed.

## Proposed fix

Replace `assertSelfReview(directory)` with a required category-aware shared operation such as `assertReviewPhase(directory, reviewPhase)`, owned by the review extension. The `review` tool passes its parsed category; `prepare_plan_presentation` passes `plan`. Retain branch-readiness validation and the existing In Progress check for workflow-authority lifecycle. Tracker lifecycle remains verified through the established fresh-provider procedure; this change does not add provider reads or local tracker lifecycle snapshots.

| Operation or activity | Required metadata Phase | Lifecycle |
| --- | --- | --- |
| Plan drafting, investigation, review, corrections, presentation, waiting for plan approval | Planning | In Progress |
| `review` with category `plan` | Planning | In Progress |
| `prepare_plan_presentation` | Planning | In Progress |
| Accepted implementation and implementation corrections/verification | Execution | In Progress |
| `review` with category `interim` or `final`, and user review of delivered work | Self-Review | In Progress |
| Successful external submission or confirmed completion | Retain last metadata Phase; native Phase absent | Existing In Review or Done rules |

Keep plan corrections and blocked planning-review confirmation pauses in Planning. Implementation-review corrections and pauses keep their existing Execution/Self-Review behavior. Plan acceptance retains the existing transition to Execution; acceptance remains required before implementation. Material replanning continues to restore In Progress/Planning before the replacement draft.

Update the directly conflicting wording in `workflows/references/phase.md`, `planning.md`, `review.md`, `deliverable.md`, `workflows/skills/epic/SKILL.md`, and the user-guide lifecycle diagram and review wording in `workflows/README.md`. Preserve unrelated review, submission, finish, provider, and approval behavior. Update current-contract tests rather than historical completed artifacts. Do not broaden this work into the deferred instruction-deduplication audit.

## Simple kind changes

Replace the restricted kind-transition section in `workflows/references/deliverable.md` with one simple rule: when the user requests or approves a kind change, update `metadata.json` and reconcile the managed Kind label where configured. Every supported kind can change to every other supported kind at any point, including In Progress, In Review, Done, and Canceled. Kind-only updates preserve lifecycle, Phase, identity, branch, Task parent, brief, and existing artifacts; they do not require plan review, reopening, a finished report, a special continuation route, or separately initialized work.

Scope and behavior changes still follow their ordinary approval and planning rules. They are separate from changing classification. Future work follows the current kind's strategy, while existing report/result evidence is retained. The branch contract and provider disclosure rules remain unchanged: versioned GitHub reconciles the managed Kind label; unversioned GitHub and Linear keep Kind in workflow metadata only.

The restrictions are in shared instructions, not a runtime state machine. Searches of workflow code and tests found no kind-change timing/lifecycle guard to remove. Remove the obsolete transition-gate wording from `workflows/references/phase.md`, update the user guide's description, and align current-kind plan/report wording in `workflows/references/artifacts.md` so it does not imply that a classification-only correction must rewrite accepted artifacts. Test the positive instruction contract; do not add a new kind-transition API or state machine.

## Verify

- Extend `tests/workflow-phase.test.ts` with review-category/metadata-Phase combinations: Planning admits plan reviews, Self-Review admits interim/final reviews, and all mismatched combinations reject. Retain local lifecycle and branch-readiness coverage, and cover Epic/Task/Gig plus workflow/tracker authority where applicable.
- Add registered-tool entry-point coverage in `tests/workflow-review.test.ts` proving that `review` uses the supplied category and `prepare_plan_presentation` uses Planning, returns the reviewed source/target paths, and leaves the accepted plan unchanged. Preserve matching approved snapshot requirements, pending-work checks, result/report requirements, and review schema restrictions.
- Update `tests/workflow-instructions.test.ts` to assert Planning throughout the planning loop and Self-Review only for delivered-work review; verify implementation corrections remain Execution and external submission still owns In Review.
- Add instruction regression checks for any-kind/any-lifecycle user-directed changes, preserved workflow state and artifacts, existing managed-label disclosure rules, and the separation from actual scope changes.
- Run focused Phase/review/instruction tests, full `npm test`, `npx tsc --noEmit`, formatting checks on changed TypeScript, and `git diff --check`.
- Reload the session before relying on changed registered review tools. Verify plan review/presentation in Planning through registered-tool tests; use the reloaded final implementation review for the normal final gate. Do not change Phase merely to satisfy the old guard or invoke a lower-level reviewer as a substitute.

## Execution boundary

The original plan's broken automated planning checks were explicitly waived by the user before the guard was fixed. This scope revision uses the corrected registered planning review and presentation tools while staying in Planning. Accept the revised plan before applying the kind-policy change. Retain verification, final implementation review, synchronized result, and final user approval. Submission and finishing retain their separate authorization boundaries.
