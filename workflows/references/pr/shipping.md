# Ship or cancel an incoming PR

**What a request to ship authorizes:** an explicit maintainer request to ship and merge the exact ready PR and reviewed head authorizes, as one set, a conditional merge, confirmed Project Done, and safe local checkout cleanup, like Deliverable shipping. Don't ask again about merge or cleanup.

**What it isn't:**

- Ordinary resume, a local signoff, or a generic "ready" comment isn't shipping approval.
- Changed relevant facts need reassessment.

When each step is reached, read the [repository merge contract](../integrations/forge/merge.md), the [Project procedure](./project.md), and the [checkout contract](./checkout.md). Incoming identity, native Project Status, and checkout cleanup differ from a Deliverable; the merge policy doesn't.

## Readiness

1. **Read fresh state:** the selected PR's identity, requirements and discussion, reviews, checks, and Project membership and Status.
   - Confirm the head and base identity, open and non-draft status, and review and CI evidence for the reviewed head.
   - Present the final contribution and fix diff, inspected coverage, unresolved concerns, and exact checks not run.
2. **Prerequisites:**
   - Ask for merge approval only after concerns are resolved and required verification passes.
   - CI can satisfy documented requirements, but required local checks that didn't run block merging. They don't block approved static review or editing.
   - Never run contributor code automatically or trigger CI as a workaround.
3. **Merge validation:** under [proportional checks](../core.md#tool-calls), rely on GitHub's merge response to validate access, the method, protections, and mergeability. A rejected merge stops shipping; preserve work and report the error.
4. **Local checkout:** inspect an existing managed checkout with `inspect_incoming_pr_checkout`.
   - Resolve unexplained source, index, or HEAD changes, a native rebase, a pending commit, or uncertain publication through the registered operation before shipping. Never hide local drafts or use manual Git.
   - A remote-only contribution needs no checkout just to ship it.
5. **Uncommitted maintainer fixes:** get final diff acceptance and explicit approval of the exact paths and message.
   - Call `commit_incoming_pr_fixes` with those checkout-relative `paths` and `message`. It stages only the complete approved fix set and creates one additive commit, without pushing.
   - Follow the `commit` skill's message rules. The registered tool owns Git, not a generic parent-repository commit route.
   - Refused staging, extra ignored or untracked work, or an incomplete intent is preserved, never reset or adopted.
6. **Push the fixes:** get separate approval of the exact fix result and contributor repository and ref, then call `publish_incoming_pr_fixes` ([rebase and fixes](./fixes.md#committing-and-pushing)).
   - It pushes the recorded commit normally over SSH, without force. An already-present result is confirmed without another push; unexpected or missing remote heads stop.
   - It never rebases, refreshes a lease, amends, or forces.
   - Contributor consent and authenticated fork access stay separate required facts; board membership grants neither.
7. **Re-verify:** get fresh PR-get evidence for the confirmed published head, and repeat required verification and private review. With no unpublished fixes, there's no commit or push step and no empty commit.

The Project stays In Review through all feedback, drafts, rebase, fix publication, and checks.

**Recovering interrupted steps:**

- A recorded interrupted commit is recovered only with its exact approved `commit_incoming_pr_fixes` paths and message. The tool validates parent, tree, and message, and never blindly creates a second commit.
- A failed or uncertain fix publication uses `publish_incoming_pr_fixes` after reconciling the remote, never a recommit.
- Rebase recovery stays `publish_incoming_pr_rebase` with its original SHA-pinned lease, never another rebase or checkout.

## Merge, Done, and cleanup

1. **Plan the merge.** Under the existing request to ship and merge, call `plan_incoming_pr_merge` with the selected `reference`, the actual final `reviewedEvidence`, and fresh `evidence`. Reuse the existing approval; resolve only missing PR or head scope or changed facts, never a strategy choice.
2. **Merge.** Pass the returned arguments unchanged to the configured `merge_pull_request`, including `expectedHeadSha` equal to the freshly verified reviewed head.
   - Use the shared title and message rules with the existing PR title.
   - A blocked or rejected merge stops. Never bypass or change branch protections, substitute the method, or update or retry automatically.
   - Changed head or base identity needs reassessment and renewed approval.
3. **Confirm.** Confirm merged state, the exact association and head, and the merge timestamp from an actual PR-get read. Reuse a complete already-merged proof instead of merging again. Reconcile an uncertain merge through the same shared operation.
4. **Done.** Set Done with the Project planner and native tool only after that proof, skipping an already-applied assignment.
5. **Clean up.** Within the same request, call `cleanup_incoming_pr_checkout` with the merged PR evidence.
   - For a configured GitHub Project, supply `completion: { kind: "project", fieldEvidence, itemEvidence }` proving this item is Done. A complete scoped write success may supply the item evidence; otherwise read the missing facts.
   - Only a genuinely unconfigured board uses `{ kind: "forgeOnly" }`.

**What cleanup checks and keeps:**

- It verifies the managed identity and published head, the phase representation, no extra or unpublished work, and safe metadata. Confirm unsaved editor buffers are safe before anything is removed.
- It removes only the managed checkout. It keeps PR-root notes, original evidence, inspection files, diffs, and immutable reviews.
- It never switches, fetches, or fast-forwards the parent, changes its files, index, or configuration, deletes contributor, base, or remote branches, removes the whole PR directory, or calls Deliverable branch cleanup.

**What blocks cleanup:**

- A pristine prepared or contributor-review checkout is removable; known staged contributor code isn't treated as our draft.
- Dirty or staged maintainer edits, untracked or ignored files, pending commits or rebases, extra local refs or worktrees, or unsafe metadata block cleanup.
- No managed checkout is a no-op, never a reason to create one. An unmanaged existing path is preserved.

**Interruptions:**

- Owned retirement and removal states keep inspection working and allow retry after interruption. The tool never deletes new work later created at the original checkout path.
- A board failure after merge stops before cleanup. A cleanup failure keeps the confirmed merge and Done.
- Resume only the known unfinished step, under the same approval; never another merge or cleanup approval.

**Reporting:**

- Report merge, board update, and cleanup separately. Claim it fully shipped only when every applicable step is confirmed.
- Keep the PR title, body, and contributor and base branches.
- Never create replacement PRs, start entity Done transitions, or reuse the Deliverable branch cleanup.
- Report confirmed outcomes and outstanding limitations, without implying verification or cleanup that didn't happen.

## Cancellation

An explicit request to cancel approves closing the exact PR and setting its Project item to Canceled.

1. Read fresh identity.
2. Run the scoped configured `update_pull_request` close call.
3. Confirm closed and not merged.
4. Reconcile only that item's Status through the Project planner.

**Edge cases:**

- A failed or uncertain closure isn't Canceled; read the exact outcome before retrying.
- An already-merged PR is Done, never Canceled or closed again.

**What cancellation keeps:**

- Checkout files, staged and unstaged work, unpublished commits, native progress, private evidence, and every branch.
- It never commits or pushes fixes, aborts or restarts a rebase, stashes, resets, or cleans up.

**Reporting:** forge operations and a blocked board update are separate outcomes. Report the confirmed closure and the pending board step, rather than claiming everything succeeded or changing credentials or settings.
