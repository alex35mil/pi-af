# GitHub forge

This procedure covers workflow-created PR submission and shipping. Existing incoming contributions follow [incoming PR handling](../../pr/incoming.md), with separate identity, approvals and execution boundaries.

This procedure extends [integration roles](../shared.md). Ordinary resume does not discover PRs.

## Epic planning delivery

[Epic delivery](../../epic.md) separates approved routing intent from Task initialization's current-revision delivery proof. Record the choice before committing, and deliver the accepted plan and routing metadata together through the approved normal PR flow; no post-merge target mutation is needed. Every default-target Task initialization verifies delivery, including a squash-merged planning PR. It trusts exact registered GitHub merged-PR confirmation, with local source revision and versioned accepted-plan checks, without creating a forge intent, changing lifecycle, or authorizing a merge. The Epic skill owns strategy approval and separate delivery-operation approval.

## Submission and revisions

Submission, revisions, and PR selection are in [Deliverable submission](../../deliverable/submission.md). Tracker reads use the tracker registration; PR reads use the forge registration. `list_pull_requests` is addressing evidence, not authoritative merge state.

## Shipping a Task or Gig

The shipping procedure is in [Deliverable shipping](../../deliverable/shipping.md). It uses the [repository merge contract](./merge.md), shared with incoming PR shipping. Missing merge evidence blocks completion even when every mutation otherwise succeeded.
