# Deliverable extension

Registers native deferred `cleanup_github_delivery_branch` and `cleanup_ancestry_delivery_branch`, each of which validates and executes one explicitly approved post-merge Task/Gig branch cleanup in the current clone without remote deletion.

Both operations require confirmed Done authority via `completionAuthority`; the GitHub operation requires exact merged proof. The strict internal cleanup schema and shared repository operation live in `cleanup.ts`. See [Deliverable guidance](../../references/deliverable.md) for the lifecycle and approval contract.
