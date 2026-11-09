# GitHub forge

This covers workflow-created PR submission and shipping. Incoming contributions follow [incoming PR handling](../../pr/incoming.md), which has its own identity, approvals, and execution boundaries.

This procedure extends [integration roles](../shared.md). Ordinary resume never discovers PRs. Tracker reads use the tracker's registration; PR reads use the forge's. `list_pull_requests` gives addressing, not authoritative merge state.

## Submission

Submission, revisions, and choosing an existing PR are in [Deliverable submission](../../deliverable/submission.md).

## Shipping a Task or Gig

The shipping procedure is in [Deliverable shipping](../../deliverable/shipping.md). It uses the [repository merge contract](./merge.md), shared with incoming PR shipping. Missing merge evidence blocks completion even when every mutation succeeded.
