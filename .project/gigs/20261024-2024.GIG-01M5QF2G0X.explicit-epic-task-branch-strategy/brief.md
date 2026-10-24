# Brief

Make Epic Task branch strategy an explicit planning decision

## Problem

Epic initialization always sets `taskTarget: epic`, but Epic planning has no explicit decision gate for choosing umbrella-based integration versus Tasks delivered directly to the repository default branch.

This leaves users to discover the choice when starting Tasks. Existing Tasks have immutable targets, so a late decision cannot simply retarget them.

## Expected procedure

Before initializing the first Task:

1. Explain the tradeoff: independently shippable Tasks can target the default branch; intermediate work requiring integration can target the Epic branch.
2. Recommend a strategy based on the accepted decomposition and obtain user approval.
3. Record the decision and apply it through the existing guarded workflow.

## Existing switching support

`set_epic_task_target` already switches the target for future Tasks. Switching to `default` requires a locally verified Epic merge; versioned Task initialization additionally checks Epic artifact reachability. Existing Task targets, Epic branch identity, and lifecycle remain unchanged.

Document both switching directions and the treatment of existing Tasks.

Explicitly settle merge-method compatibility: the current guard uses `git merge-base --is-ancestor`. A squash-merged PR does not generally satisfy this check. Do not imply that every merge method is supported or weaken the guard without defining equivalent delivery evidence.

## Evidence

Relevant sources:

- `workflows/skills/epic/SKILL.md`
- `workflows/skills/task/SKILL.md`
- `workflows/extensions/init/entity.ts`

Inspected revision: `21f9c5f4ca14fe5bd571acf65c63743e02de2ac4`; no local changes in these files. Findings are based on source inspection and observed planning friction, not a live squash-transition test. The live tools’ exact source revision was not independently established.

## Acceptance criterion

After an Epic planning PR is squash-merged into the default branch, the workflow can verify that delivery, switch future Tasks to the default branch, and initialize those Tasks without requiring the original Epic commit to be an ancestor. Preserve repository, branch, revision, and artifact validation.

Both the target-switch guard and Task initialization need to support that evidence.
