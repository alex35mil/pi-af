# Plan

## Overview

Two workflow gates block approved delivery at the wrong boundary. Merge instructions demand separate permission and repository-policy inspection instead of using GitHub's authoritative response. Epic target selection requires delivery before recording routing intent, forcing a tracked metadata change after the planning PR merges. Fix both in this Gig without adding inspection machinery or weakening delivery validation.

### Plan highlights

- Preserve the implemented workflow-wide cost/benefit rule: cheap, useful local checks remain; avoid remote calls and interruptions merely predicting safe rejection.
- Keep merge/shipping guidance aligned with GitHub's authoritative merge response and existing verification, approval, pinned-head, outcome, and recovery safeguards.
- Record the approved Epic Task routing choice before committing and delivering the planning work; the plan and its target metadata travel together.
- Treat `taskTarget: default` as future routing intent, never delivery proof. Every new/adopted default-target Task independently verifies current delivery.
- Preserve exact repository, branch, source revision, merged-state, registered-tool provenance, versioned accepted-plan checks, and existing Task targets.
- Use local Git fixtures and provider-shaped evidence; add no persisted proof snapshots, approval tokens, broader MCP toolsets, or consuming-project changes.

## Root cause

### Symptom

An approved finish can stall after PR creation while requesting repository-policy evidence unavailable through the configured GitHub tools. Separately, an Epic planning PR can merge while its metadata still routes Tasks to the Epic branch. The required post-merge switch to default dirties tracked metadata; committing that switch on the Epic branch advances its head beyond the revision in the merged PR evidence.

### Evidence

- `workflows/extensions/project-setup/mcp.ts` generates `pull_requests` for a forge and `issues,projects,pull_requests` for combined roles. The original merge and incoming-PR guidance required independent permission/protection/mergeability evidence. The official branch-list output does not expose classic protection requirements, while GitHub's merge API validates the submitted merge request.
- The agreed preflight fix is already implemented in `workflows/references/tools.md`, `workflows/references/integrations/forge/merge.md`, `workflows/references/pr/incoming.md`, and `workflows/references/pr/shipping.md`, with guidance tests. Its prior full verification passed 670 tests; that result predates the expanded routing fix.
- `setEpicTaskTarget` in `workflows/extensions/init/entity.ts` calls `assertEpicDelivered` before writing `taskTarget: default`. Its native schema and caller also accept `epicDelivery`.
- `readParentEpic` independently calls `assertEpicDelivered` at every default-target Task initialization and, in versioned mode, verifies the exact working accepted `epic.md` blob against the stored default target. All new/adopted Task entry points share this boundary.
- The PR guard compares the merged PR head SHA with the current local Epic source branch SHA. A later metadata commit therefore invalidates the earlier proof by design.
- The existing real-squash fixture commits metadata with the initial Epic pointer, merges it, then changes the pointer in the working tree. Its 27-test baseline passes but does not prove that the delivered metadata is already default and clean before Task initialization.

### Cause

The merge instructions duplicate safe rejection checks belonging to GitHub. The Epic setter instead conflates an approved routing decision with delivery proof, even though Task initialization already owns the proof gate. This ordering creates needless dirty metadata and makes a correct exact-source-revision guard reject the subsequent metadata commit. The fix moves routing selection earlier, not delivery validation later or to a weaker boundary.

## Proposed fix

### Shared preflight and merge guidance

Retain the existing shared rule and all three aligned merge/shipping instructions. Keep required tests, reviews, explicit approval, exact PR/head association, pinned squash arguments, confirmed merge outcomes, and uncertain-write recovery. Preserve their guidance tests. No additional inspector or MCP configuration change is needed.

### Epic routing model and native tool

- Make `setEpicTaskTarget` intent-only. Remove its delivery prerequisite and the `epicDelivery`/catalog options that exist only for that prerequisite. Keep repository and persistence validation, entity containment/type checks, ready-branch validation, the local Epic branch check, and the existing default-target branch existence check when selecting default. A failed validity check must not write metadata.
- Keep `taskTarget: epic | default` as the existing metadata representation. Explain in the model/tool contract that it chooses future routing and proves no delivery; introduce no extra state, proof snapshot, or approval token.
- Remove `epicDelivery` from `set_epic_task_target`'s concrete input schema and caller. Reject obsolete evidence inputs rather than add a compatibility shim. Keep `epicDelivery` on `init_task`, `adopt_github_task`, and `adopt_linear_task` only.
- Leave `readParentEpic`, `assertEpicDelivered`, shared merged-PR validation, and accepted-plan reachability enforcement behavior intact. Update misleading delivery-helper ownership comments, not the guards. The setter changes no existing Task's immutable start/target.

### Planning and delivery lifecycle

Update `workflows/skills/epic/SKILL.md`, `workflows/skills/task/SKILL.md`, `workflows/references/epic.md`, `workflows/references/tools.md`, `workflows/references/artifacts.md`, the Epic planning section of forge guidance, and workflow/init READMEs consistently:

1. During Epic planning, explain the decomposition-based strategy and obtain approval; preserve the initial Epic pointer as provisioning, not approval.
2. Record the reviewed, accepted strategy in `epic.md` and apply its approved routing choice through the setter before any planning commit. Default selection needs no delivery evidence.
3. Commit and deliver the accepted plan and routing metadata together through the separately approved normal Git/PR flow. Do not mutate routing metadata after merging merely to acknowledge delivery.
4. At each new/adopted default-target Task initialization, verify the current Epic revision using local ancestry or actual exact registered merged-GitHub-PR evidence, plus the versioned accepted-plan blob check. An undelivered revision remains blocked even with default routing selected.

Future strategy changes still require approval and the normal Epic planning/acceptance flow. They affect future Tasks only. Selecting a strategy never authorizes Git/provider operations or changes lifecycle. Existing records remain valid without a metadata migration.

### Regression coverage

Update `tests/workflow-epic-delivery.test.ts`, `tests/workflow-domain.test.ts`, and `tests/workflow-instructions.test.ts`, and retain shared merge/guidance coverage:

- Select default routing and commit that metadata with the accepted plan before delivery; an attempted default-target Task must still fail without creating a Task branch, directory, or parent annotation.
- Build a real local squash merge containing the plan and default-target metadata. Assert the delivered metadata says default, the source SHA still matches the planning PR, the worktree is clean before Task initialization, and no post-merge setter call or metadata mutation is required. Initialize using matching native-shaped PR-get evidence.
- Exercise new, GitHub-adopted, and Linear-adopted native Task entry points in both artifact modes. Retain successful delivery and reject invalid/stale evidence, wrong repository/branch/revision, unmerged/untimestamped responses, missing forge/catalog/branches, errored MCP evidence, and invalid explicit PR evidence even when ancestry holds. Preserve no-mutation-on-rejection checks.
- Preserve versioned accepted-plan reachability, current-revision revalidation, ancestry delivery, and target-advanced-after-delivery behavior.
- Verify setter validity failures preserve metadata, its schema accepts routing choice without evidence and rejects the removed input, and existing Task targets remain unchanged across parent intent changes.
- Assert instruction ordering: approve strategy, record intent, deliver plan plus metadata, then independently validate each Task's delivery.

## Boundaries

The original request and prior implemented preflight fix stay intact. The user explicitly expanded this same Gig; no new work item or separate PR is created. Do not solve routing with metadata-only follow-up PRs, ignored tracked files, stashes, resets, source-branch rewrites, or weaker guards. No consuming-project changes or live provider operations are needed to exercise the fix; verification uses temporary repositories and evidence fixtures. Contributor-edit consent/write procedures and runtime merge implementation remain unchanged. Synchronize `result.md` and repeat final review for the combined work.

## Verify

- `node --import tsx --test tests/workflow-epic-delivery.test.ts tests/workflow-domain.test.ts tests/workflow-instructions.test.ts tests/workflow-tool-contracts.test.ts tests/workflow-incoming-pr-guidance.test.ts tests/workflow-merge.test.ts` — exercise routing, entry-point/schema, delivery, guidance, and merge regressions.
- `npm test` — run the complete regression suite with enough time for the existing Git-heavy fixtures.
- `npm run typecheck` — verify all updated callers and schemas.
- `git diff --check` — check patch whitespace.
- Inspect the final diff for unchanged delivery guards and existing Task targets, consistent lifecycle guidance, no persisted proof/token or consumer change, and preservation of the earlier preflight fix.
