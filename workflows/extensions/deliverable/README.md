# Deliverable extension

Registers native deferred `cleanup_github_delivery_branch` and `cleanup_ancestry_delivery_branch`, each of which validates and executes one explicitly approved post-merge Task/Gig branch cleanup in the current clone without remote deletion.

Both operations require confirmed Done authority via `completionAuthority`. The GitHub operation takes the merged PR's exact `pull_request_read` get as `evidence`; `githubMergeProof` in `index.ts` extracts merge facts through the same `shippingReadDecision` validation used by `prepare_integration_merge`. The strict internal cleanup schema and shared repository operation live in `cleanup.ts`. See [Deliverable guidance](../../references/deliverable.md) for the lifecycle and approval contract.
