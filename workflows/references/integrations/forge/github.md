# GitHub forge

This covers workflow-created PR submission and shipping. Incoming contributions follow [incoming PR handling](../../pr/incoming.md), which has its own identity, approvals, and execution boundaries.

This procedure extends [integration roles](../shared.md). Ordinary resume never discovers PRs. Tracker reads use the tracker's registration; PR reads use the forge's. `list_pull_requests` gives addressing, not authoritative merge state.

## Epic planning delivery

[Epic delivery](../../epic.md) keeps the approved routing intent separate from the delivery proof checked at Task initialization.

- Record the routing choice before committing, and deliver the accepted plan and its routing metadata together through the normal PR flow. No target change is needed after the merge.
- Every default-target Task initialization verifies delivery, including a squash-merged planning PR, from GitHub's merged-PR confirmation plus local revision and versioned plan checks.
- It creates no forge intent, changes no lifecycle, and authorizes no merge.
- The Epic skill owns the strategy approval and each delivery operation's approval.

## Submission

Submission, revisions, and choosing an existing PR are in [Deliverable submission](../../deliverable/submission.md).

## Shipping a Task or Gig

The shipping procedure is in [Deliverable shipping](../../deliverable/shipping.md). It uses the [repository merge contract](./merge.md), shared with incoming PR shipping. Missing merge evidence blocks completion even when every mutation succeeded.
