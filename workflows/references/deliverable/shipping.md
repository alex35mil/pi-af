# Ship a Deliverable

Read this when the user explicitly asks to ship a Task or Gig: "ship it", "ship this", "finish it", or equivalent.

## What shipping authorizes

A request to ship authorizes the whole remaining sequence without another merge or cleanup question:

commit approved work → push the stored branch → create or update the PR → merge → set Done → clean up the local branch.

- Carry shipping intent through [submission](./submission.md) even when no PR exists yet.
- Complete every required verification, review, and merge-protection gate first.
- Accepting the final completion artifact authorizes submission, not shipping. An ordinary resume or an externally changed tracker status is not a request to ship.
- Shipping never authorizes merging an Epic, choosing a different target or merge method, or deleting remote or Epic branches.

## Merge and clean up

Follow the [repository merge contract](../integrations/forge/merge.md).

1. Call `prepare_integration_shipping`, then read the PR once with `pull_request_read` `get`. Reuse a matching read already made in this operation.
2. Call `prepare_integration_merge` with that read as `evidence`. Branch on the returned `roles.forge.shipping.state`:
   - `merge-needed`: prepare `commit_title` with the `commit` skill's message rules, using `metadata.title` as the summary. Call `merge_pull_request` with `roles.forge.shipping.arguments` unchanged plus that `commit_title`. Keep the PR title unchanged. When the tool reports failed checks, stop.
   - `merged`: reuse `roles.forge.shipping.merge` as delivery proof.
   - `blocked`: report `roles.forge.shipping.reason` and stop.
3. Before setting Done, confirm with a fresh PR get that the PR is merged, with the expected repository, head, base, head SHA, and `merged_at`. After a new merge, read only the missing facts.
4. Set native Status to Done. Clear native Phase and keep the last metadata Phase. The lifecycle update never creates a commit.
5. Call `cleanup_delivery_branch` once with the merged PR read as `evidence`.

Never merge locally or merge an Epic.

## What cleanup does

The cleanup tool:

- checks out only the stored target;
- fast-forwards it to freshly fetched origin;
- requires exact equality with origin, the recorded PR and head, and safe worktree state. It doesn't check lifecycle; setting Done comes first;
- deletes only the local Deliverable branch.

An Epic-target Task stays on the Epic branch and leaves main untouched.

## When something blocks

A blocked merge, missing evidence, unavailable origin, ahead or diverged target, head mismatch, or worktree failure stops shipping and preserves the Deliverable branch. Report what completed and the exact blocker. Claim it fully shipped only when the clone is on the synchronized target and the local branch is deleted.

Never stash, reset, clean unrelated files, force checkout, push the target to hide divergence, delete remote or Epic branches, or revert a confirmed `done`.
