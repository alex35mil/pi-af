# Deliverable extension

Registers native deferred `cleanup_delivery_branch`, which validates and executes one explicitly approved post-merge Task/Gig branch cleanup in the current clone without remote deletion.

It takes the merged PR's exact `pull_request_read` get as `evidence`; `githubMergeProof` in `index.ts` extracts merge facts through the same `shippingReadDecision` validation used by `prepare_integration_merge`. Every Deliverable ships through a merged PR, so there is no other delivery route. The strict internal merge-proof schema and the repository operation live in `cleanup.ts`. See [Deliverable guidance](../../references/deliverable.md) for the lifecycle and approval contract.
