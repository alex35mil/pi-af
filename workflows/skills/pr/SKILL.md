---
name: pr
description: "Use for /pr <URL>, /pr #NN, or an explicit request to inspect, review, or integrate an existing incoming GitHub pull request. Does not initialize an Epic, Task, or Gig."
allowed-tools:
    - "inspect_incoming_pr_context"
    - "plan_incoming_pr_merge"
    - "plan_incoming_pr_intake"
    - "plan_incoming_pr_review"
    - "plan_incoming_pr_shipping"
    - "plan_incoming_pr_cancellation"
    - "review_pull_request"
    - "record_pull_request_review_response"
---

# Incoming pull request

Review an existing contribution privately, then publish, fix, push, or merge only with the maintainer's separate approvals. Never initialize an Epic, Task, or Gig, or adopt the contribution into a workflow-created branch contract.

## Read first

- [Core rules](../../references/core.md)
- [Incoming PR handling](../../references/pr/incoming.md): identity, inspection, the safety score, the checkout boundary, private review, and what each approval allows.

When changing board state, read [Project handling](../../references/pr/project.md). When moving to fixes, rebasing, fixing, committing, or pushing, read [rebase and fixes](../../references/pr/fixes.md). When publishing a GitHub review, read [publishing](../../references/pr/publishing.md). When merging, shipping, or canceling, read [shipping](../../references/pr/shipping.md).

## Start

1. **Selection.** The command argument is one exact GitHub PR URL or `#NN`. Ask for a missing or ambiguous selection; never infer a PR from a tracker issue or the checked-out branch.
2. **Context.** Call `inspect_incoming_pr_context` with `reference` set to that selection, and use its configured forge server and normalized addressing.
3. **Board.** Read actual Project membership.
   - Fork-only automation may already have added the card to Backlog. Keep existing membership and Status without asking for another intake choice.
   - For explicit missing intake, ask Backlog or Todo and use `plan_incoming_pr_intake` with actual scoped evidence.
   - Never change the board just because a reference was supplied.

## Lifecycle on the board

- An explicit maintainer review request moves the PR to In Review.
- It stays there through feedback, contributor updates, rebase, fixes, and testing, until a confirmed merge (Done) or close (Canceled).
- Never infer contributor activity, set In Progress, or project Phase.

## Checkout

- **Safety score:** before checkout, present the 1–5 malicious-code safety score with its context label, for example **Checkout safety: 5/5 (safe)**, plus evidence and limitations. A 5 isn't a guarantee, and every score requires explicit checkout approval.
- **Tools:** use `prepare_incoming_pr_checkout`, `checkout_incoming_pr`, `inspect_incoming_pr_checkout`, and `begin_incoming_pr_fixes` for approved object preparation, checkout and contributor-review setup, inspection, and the validated move to fixes.
- **No manual Git:** never reconstruct that Git work in Bash, or fall back to manual Git after a refusal or unavailability.
- **Order:** review contributor code first. Restore a clean, verified contributor head through the tool before approved uncommitted fixes.
- Checkout and edit approval isn't permission to run contributor code.

## Rebase, fixes, and transport

**Rebase:**

- Use standard rebase, never merge-into-PR or preserve-merges.
- The sequence is: `observe_incoming_pr_target`; approval of the exact target, source, and destination and of the immediate SHA-pinned `--force-with-lease` update; then `rebase_incoming_pr` and any approved `continue_incoming_pr_rebase` resolutions.
- A successful rebase or continuation immediately updates the existing contributor branch, before later fixes and testing.
- Verify consent and access first.

**Recovery:** use `publish_incoming_pr_rebase` only for approved reconciliation or retry of the recorded result and lease. Never plain force or replace the lease automatically.

**Fixes:** accepted final fixes use approved `commit_incoming_pr_fixes` and separately approved `publish_incoming_pr_fixes`, with no manual Git route. Later fix commits and pushes, execution, GitHub publication, and merge each stay separately approved.

**Transport:**

- GitHub Git transport uses SSH with existing authentication for fetch, remote-tip observation, and push. Configure no HTTPS credentials, and change no parent or global Git configuration.
- A saved completed rebase whose publication failed is recovered with approved `publish_incoming_pr_rebase`, reusing its result and original lease, never another checkout or rebase. No manual Git fallback.

## Shipping and cancellation

- **Shipping:** an exact request to ship and merge a ready PR covers the shared repository merge, confirmed Done, and safe registered `cleanup_incoming_pr_checkout` as one set, with no further strategy or cleanup question. Keep the parent repository, contributor branches, and private evidence.
- **Cancellation:** an explicit cancellation closes the PR and sets Canceled, keeping local work, with no cleanup.
- **Partial outcomes:** report them, and resume only confirmed unfinished steps.

## Approval scope

**What each approval covers:**

- Starting or resuming with a reference alone authorizes private inspection only.
- A scoped Backlog or Todo intake choice approves only this PR's membership and initial Status.
- An explicit review start approves its In Review assignment and private review.
- Publication, checkout, edits, Git writes, closing, and merging each keep their own scope.

**Permissions:**

- Keep remote mutation tools, Git writes, and every checkout operation tool outside skill-derived allow rules.
- Use existing permissions and conversational approval gates. Never change permission settings automatically.
