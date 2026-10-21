# Repository merge contract

Deliverables and incoming PRs use one repository merge policy: **squash merge**, pinned to the verified reviewed head. The shared forge operation in `workflows/extensions/integrations/forge/github/merge.ts` owns the native arguments and confirmed merged proof. Neither workflow chooses or overrides the method.

## Validate and plan

Use actual configured `pull_request_read:get` evidence for the exact repository and PR. Confirm expected base/head repository/ref association and the full expected head SHA. The workflow adapter supplies its own association:

- Deliverable finish verifies the recorded PR, immutable branch contract, local head and required workflow phase.
- Incoming shipping verifies the selected PR/fork and final reviewed/published revision, without creating an entity. Use `integration_context` operation `incomingPullRequestMerge` with `reference`, the actual `reviewedEvidence` and fresh actual `evidence`.

Before merging, establish required verification, reviews, access, repository protections and mergeability. Unknown required facts block shipment. A local `merge-needed` decision establishes matching evidence and arguments, not readiness, permission or approval by itself.

## Merge and confirm

An explicit finish/ship request for the exact ready PR and reviewed head authorizes conditional merge, confirmed Done and the workflow's safe local cleanup as one set. Do not ask a second merge or cleanup question when that exact set is already approved. Changed relevant facts require reassessment; ordinary resume, local signoff and an externally changed status do not authorize shipment.

Pass the shared operation's returned arguments unchanged to the configured `merge_pull_request`: fixed `merge_method: squash` and pinned `expectedHeadSha`. Prepare `commit_title` with the available commit skill's selection/message rules, using the approved Deliverable title or the incoming PR's existing title as the semantic title data. Preserve the PR title/body. No per-flow method setting, alternative merge strategy, protection bypass or automatic history update is permitted after rejection.

After a merge, establish `merged: true`, the exact matching association/head and a nonempty merge timestamp through actual exact PR-get evidence. Reuse complete current-operation facts; read only missing facts. The shared operation returns confirmed proof for an already-merged PR instead of another merge call. Reconcile uncertain native writes before retrying; never merge twice to repair a board or cleanup failure.

Only confirmed delivery permits Done. The workflow adapter owns its tracker/Project update and safe cleanup. A later failure preserves confirmed merge/Done and resumes only the unfinished step; report each actual outcome separately. The different incoming checkout and Deliverable branch cleanup do not change this merge policy.
