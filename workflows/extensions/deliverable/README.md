# Deliverable extension

Registers native deferred `cleanup_delivery_branch`, which validates and executes one explicitly approved post-merge Task/Gig branch cleanup in the current clone without remote deletion, and `prepare_merge_resolution_comment`.

`merge-resolution.ts` renders the PR comment that records a pushed merge-conflict resolution. It requires the recorded PR, a stored branch head that is a two-parent merge whose second parent is on `origin/<target>`, `origin/<branch>` at that merge, and a non-empty `git show --remerge-diff`. The body has the heading, target and merge SHAs, the push-approved summary, the remerge-diff folded by the shared `integrations/comment-diff.ts` helper, and a `merge-resolution:<sha>` marker; oversized diffs are replaced by the local command. It returns the native `add_issue_comment` call and never calls providers.

It takes the merged PR's exact `pull_request_read` get as `evidence`; `githubMergeProof` in `index.ts` extracts merge facts through the same `shippingReadDecision` validation used by `prepare_integration_merge`. Every Deliverable ships through a merged PR, so there is no other delivery route. The strict internal merge-proof schema and the repository operation live in `cleanup.ts`. See [Deliverable guidance](../../references/deliverable.md) for the lifecycle and approval contract.
