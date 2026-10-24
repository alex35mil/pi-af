# Explicit Epic Task branch strategy

## Overview

Epic planning will explain where Tasks can be delivered, recommend a strategy from the decomposition, and obtain the user's approval before the first Task is initialized. The accepted Epic document will record that decision. Independently shippable Tasks can target the repository default branch; work that needs integration can target the Epic branch.

A squash-merged Epic planning PR will count as delivered when GitHub confirms that the exact matching Epic revision was merged into its stored default target. Both switching future Tasks to default and initializing those Tasks will use the same delivery check. Local source-branch revision and versioned accepted-plan content checks remain; GitHub owns delivery confirmation, without independently proving that the local target contains the squash commit.

### Plan highlights

- Record the approved strategy and its reason in the reviewed `epic.md`; keep the initial `taskTarget: epic` until the guarded switch is valid.
- Preserve local-ancestry delivery and add an explicit merged-GitHub-PR delivery route that supports squash merges.
- Keep existing Tasks' immutable targets, Epic branch identity, lifecycle, permissions, and versioned artifact checks unchanged.
- Explain switching in both directions and require fresh validation at Task initialization rather than trusting an earlier target switch.

## Evidence and ownership

At revision `ea0bfd7bc4bbc4e92cdb5a383972a468ab843e0c`, `workflows/extensions/init/entity.ts` calls `assertEpicBranchMerged` from both `setEpicTaskTarget` and `readParentEpic`. That helper accepts only `git merge-base --is-ancestor` of the local Epic branch into the stored target. Versioned default-target Task initialization additionally compares the working `epic.md` blob with the target branch blob.

A temporary-repository probe under `.local/scratch/reproduce-squash.ts` created an Epic planning branch with two commits, squash-merged it into `main`, and confirmed that the delivered `epic.md` blob equals the working artifact. Both the target switch and, independently, Task initialization rejected that delivery with `has not been merged`. This is a deterministic supported planning flow, not a timing edge case. The impact is blocked Task work after an otherwise successful planning delivery; a shared delivery-evidence operation and focused tests are justified by the two affected consumers.

The owning boundaries are:

- Epic skill: the recommendation, approval, durable strategy decision, and future-target switching procedure.
- Task skill: checking that decision and applying the parent's current target during explicit Task intake.
- Initialization domain: deciding whether the current Epic revision has been delivered before default targeting.
- Existing shared GitHub merge validator: registered PR-get provenance and exact repository/head/base/revision/merged-state validation. Extend or reuse this owner rather than duplicate its provider validation at either initialization caller.

A live configured `pull_request_read:get` of already-merged PR #81 supplies repository, head/base branches, source SHA, merged state, and merge timestamp, but omits `merge_commit_sha`. Its base SHA is the pre-merge commit, not the delivered squash commit. Saved native evidence under `.local/scratch/deployed-merged-pr-evidence.json` establishes the deployed response shape. The user approved trusting exact GitHub merged-state confirmation plus local source revision and accepted-plan validation, matching the existing shared merge validator. No server hosting, provider changes, or project-setup changes are needed. No claim of a live GitHub squash-transition test is made.

## Planning and strategy approval

Before the first Task is initialized, the Epic workflow must explain both choices, recommend one based on the ordered Tasks, and obtain explicit user approval. Incorporate the approved strategy and rationale into the normal reviewed Epic contract, including the overview highlights and a supporting section. The review and user-diff acceptance cover this decision with the rest of the decomposition.

For default targeting, explain that the accepted Epic planning work must first be delivered to the stored default target through separately approved Git operations. Strategy acceptance does not itself authorize a commit, push, PR, merge, fetch, or branch cleanup. After confirmed delivery, apply `set_epic_task_target` through its guarded operation. For Epic targeting, retain the existing Epic branch route.

Task intake reads the accepted parent strategy and current `taskTarget`. A missing decision in an existing Epic is resolved with the user and recorded through the existing Epic plan-review/acceptance flow before the first new Task is initialized; never infer approval from the initialization default. A material strategy change follows existing material replanning. This is an agent workflow approval gate recorded in `epic.md`, not a new metadata approval token or a Markdown-parsing authorization mechanism.

Document `default` to `epic` switching before new undelivered Epic work and `epic` to `default` switching after verified delivery. Both affect future Tasks only. Existing Tasks keep their stored start/target; never retarget them or delete an Epic branch still needed by active Tasks.

## Shared delivery contract

Introduce an explicit delivery-evidence domain with local-ancestry and GitHub-PR variants. Expose the PR variant through the target-switch operation and all Task initialization variants, including new and adopted GitHub/Linear Tasks. Keep native deferred tool schemas concrete objects and use the existing MCP evidence envelope and observed registered-tool catalog. Preserve existing ancestry-based callers; an explicit PR-evidence request must validate that evidence rather than silently selecting another route after invalid evidence.

The shared initialization boundary always verifies that the local Epic and stored target branches exist. Its GitHub route requires a configured GitHub forge; a tracker alone is not forge authority. It validates the actual registered `pull_request_read:get` arguments and response, exact configured repository and PR URL/number, same-repository Epic head branch, stored target base branch, `merged: true`, nonempty merge timestamp, and PR head SHA equal to the current local Epic branch SHA. Trust this exact provider confirmation as delivery evidence. The current clone must still have the source and stored target branches; local target contents are checked through the existing versioned accepted-plan rule below. Do not require ancestry of the original PR head or a merged-result SHA. This route does not independently establish local inclusion of every merged implementation change.

Reuse the existing shared merge validator unchanged for its established repository, branch, source-revision, and merged-state checks; require its confirmed `merged` outcome. Do not change the repository's squash-only merge mutation policy, Deliverable finish behavior, or incoming-PR delivery semantics.

Versioned default-target Task initialization retains its exact working accepted `epic.md` versus target-branch blob comparison for both delivery routes. Unversioned projects retain their existing artifact exclusion and do not acquire a versioned artifact reachability requirement. Switching the target retains its current responsibility for delivery; the Task initializer retains responsibility for accepted-plan reachability.

Each Task initialization revalidates delivery against current local refs and its supplied current-operation provider evidence. Do not persist a merged boolean, provider-response snapshot, extra workflow lifecycle, or new forge-creation association merely to remember this check. The PR read verifies delivery only; it neither creates a PR nor authorizes Git or provider mutations. Missing local branches, invalid PR evidence, or a mismatched versioned accepted-plan blob block the applicable operation; no implicit fetch, merge, reset, or checkout occurs.

### Decision table

| Operation and state | Required evidence/check | Outcome |
| --- | --- | --- |
| Switch future Tasks to Epic | Ready parent Epic and existing local Epic branch | Update only `taskTarget`; existing Tasks unchanged |
| Default target, ancestry route | Existing local branches; current Epic head is an ancestor of stored target | Delivery accepted |
| Default target, GitHub PR route | Configured forge; existing local branches; exact registered merged PR evidence matching repository/head/base/current Epic SHA and merge timestamp | Delivery accepted, including squash |
| PR evidence is supplied but invalid, incomplete, mismatched, or unmerged | Validate the selected PR route | Stop without changing target or creating a Task |
| Neither route establishes delivery | Required local/provenance/revision checks fail | Stop without changing target or creating a Task |
| Initialize a versioned default-target Task after either accepted route | Working accepted parent plan blob equals stored target's blob | Create Task from/targeting stored default and tag the selected parent item once |
| Initialize a versioned default-target Task with a different/missing target plan blob | Existing artifact reachability check | Stop before Task artifacts, branch creation, or parent annotation |
| Initialize an unversioned default-target Task | Accepted delivery route and existing unversioned persistence rules | Create Task without a versioned artifact check |
| Initialize an Epic-target Task | Existing parent/item/branch validation | Preserve existing Epic-target behavior |
| Epic source advances after a PR delivery | PR head no longer equals local Epic head | Old PR evidence cannot authorize new default-target work |

The PR route supports merge-commit, squash, and rebase deliveries only when all these facts hold; a merge-method label alone is never proof. Without configured GitHub forge evidence, the ancestry route remains available; non-ancestral local squash/rebase delivery is not inferred from content similarity or commit messages.

## Implementation scope

- Update `workflows/skills/epic/SKILL.md` and `workflows/skills/task/SKILL.md` with the strategy gate, decision recording, delivery evidence flow, both switching directions, and existing-Task treatment.
- Put the shared initialization delivery policy alongside the initialization domain, using the owning GitHub evidence validator under `workflows/extensions/integrations/forge/github/` for provider facts.
- Update `workflows/extensions/init/entity.ts` and `workflows/extensions/init/index.ts` so the target switch and every Task initialization entry point consume that shared contract. Pass the registered MCP catalog explicitly at the tool boundary.
- Update the relevant initialization README and shared artifact/tool/forge references so their descriptions agree with the new verified-delivery route; add a concise user-facing explanation to `workflows/README.md` where useful.
- Add focused domain, provider-boundary, deferred-tool schema/execution, and instruction-ownership coverage. Do not rewrite historical entities, introduce a metadata migration, or modify unrelated lifecycle/merge policies.

## Verification

1. Add a real local Git squash-delivery regression with multiple Epic planning commits. Confirm non-ancestry, then use matching registered PR-get fixture evidence to switch to default and initialize a versioned Task successfully. This is local integration coverage with provider fixtures, not a live remote merge.
2. Cover ancestry delivery, both switching directions, immutable existing Task targets, and the same delivery contract across new/adopted Task entry points and artifact modes.
3. Verify rejection of wrong registered tool/method, repository, PR identity, head/base branch, current Epic head SHA, missing merge timestamp, unmerged PR, missing local branches, and changed versioned plan content. These are direct validity boundaries of caller-supplied delivery evidence, not speculative races. Check that failures leave metadata, parent annotation, Task artifacts, and branches untouched. Use PR fixtures shaped like the deployed response, without a merged-result SHA, and add a read-only regression of the saved native response through the shared validation boundary.
4. Verify that invalid explicit PR evidence is not hidden by an ancestry success and that new Epic work invalidates prior PR evidence.
5. Run focused tests for changed owners, `npm run typecheck`, `npm test`, and `git diff --check`. Record actual results and any unrun checks in `result.md` before final review.
6. Complete the normal final independent review and user result approval. No live provider merge or delivery operation is part of implementation verification.
