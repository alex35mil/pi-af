# Repository merge contract

Deliverables and incoming PRs share one merge policy: **squash merge, pinned to the verified reviewed head**. The shared operation in `workflows/extensions/integrations/forge/github/merge.ts` owns the native arguments and the merged proof. Neither workflow chooses or overrides the method.

## Validate and plan

Use the configured `pull_request_read` `get` evidence for the PR. Confirm the expected base and head repository and ref, and the full expected head SHA. Each workflow adds its own checks:

- **Deliverable shipping:** the recorded PR, the immutable branch contract, the local head, and the required Phase.
- **Incoming shipping:** the selected PR or fork and the final reviewed and published revision, with no entity. Call `plan_incoming_pr_merge` with `reference`, the actual `reviewedEvidence`, and fresh `evidence`.

Before merging, complete required verification and reviews and get the shipping approval.

- Under [proportional checks](../../core.md#tool-calls), GitHub validates access, the merge method, protections, and mergeability when it processes the merge; don't inspect repository policy or permissions first to predict rejection.
- A local `merge-needed` decision only means the evidence matches and the arguments are ready. It doesn't mean verification, review, or approval is complete.
- A rejected merge stops dependent steps; preserve work and report the error.

## Merge and confirm

**Authorization:**

- An explicit request to ship the ready PR and reviewed head authorizes, as one set, a conditional merge, confirmed Done, and the workflow's safe local cleanup. Don't ask again about merge or cleanup.
- Changed relevant facts need reassessment. Ordinary resume, a local signoff, or an externally changed status doesn't authorize shipping.

**Merging:**

- Pass the returned arguments unchanged to the configured `merge_pull_request`: `merge_method: squash` and the pinned `expectedHeadSha`.
- Prepare `commit_title` with the `commit` skill's message rules, using the Deliverable's approved title or the incoming PR's existing title. Keep the PR title and body.
- No per-flow method setting, alternative strategy, protection bypass or change, or automatic history update after a rejection.

**Confirming:**

- After a merge, establish `merged: true`, the expected association and head, and a merge timestamp from an actual PR read. Reuse complete facts from this operation and read only what's missing.
- For an already-merged PR, the shared operation returns the merged proof instead of another merge call.
- Reconcile uncertain writes before retrying. Never merge twice to repair a board or cleanup failure.

**Completion:**

- Only confirmed delivery permits Done. Each workflow owns its own tracker or Project update and cleanup.
- A later failure keeps the confirmed merge and Done, and resumes only the unfinished step. Report each outcome separately.
