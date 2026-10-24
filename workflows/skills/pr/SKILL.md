---
name: pr
description: "Use for /pr <URL>, /pr #NN, or an explicit request to inspect, review, or integrate an existing incoming GitHub pull request. Does not initialize an Epic, Task, or Gig."
allowed-tools:
    - "inspect_incoming_pr_context"
    - "plan_incoming_pr_merge"
    - "plan_incoming_pr_intake"
    - "plan_incoming_pr_review"
    - "plan_incoming_pr_ship"
    - "plan_incoming_pr_cancel"
    - "review_pull_request"
    - "record_pull_request_review_response"
---

# Incoming pull request

Read and follow `../../references/pr/incoming.md` relative to this skill directory. It owns identity, Project intake, private inspection/review, publication approval, fixes, execution safety, and shipping behavior. Follow `../../references/pr/project.md` for scoped board operations and `../../references/pr/shipping.md` for the complete terminal process, using the shared forge merge contract linked by those procedures.

Read actual Project membership first. Fork-only automation may already have added the card to Backlog; preserve existing membership/status without another intake choice. For explicit missing intake, ask Backlog or Todo and use `plan_incoming_pr_intake` with actual scoped evidence. An explicit maintainer review request moves it to In Review and keeps it there through feedback, contributor updates, rebase, fixes and testing until confirmed merge/Done or close/Canceled. No contributor activity inference, In Progress or Phase projection. Never change the native board merely because a reference was supplied.

Before checkout, present the 1–5 malicious-code safety score with its context-provided label, for example **Checkout safety: 5/5 (safe)**, plus evidence and limitations. A 5 is not a guarantee; every score requires explicit checkout approval. Use `prepare_incoming_pr_checkout`, `checkout_incoming_pr`, `inspect_incoming_pr_checkout`, and `begin_incoming_pr_fixes` for approved object preparation, exact checkout/contributor-review setup, inspection, and the validated fixes transition. Never reconstruct that Git orchestration in Bash or fall back manually after refusal/unavailability. Review contributor code first; restore a clean verified contributor head through the tool before approved uncommitted fixes. Checkout/edit approval is not execution permission.

For an approved update, use standard rebase, not merge-into-PR or preserve-merges: `observe_incoming_pr_target`, approval of exact target/source/destination and immediate SHA-pinned `--force-with-lease` update, then `rebase_incoming_pr`/approved `continue_incoming_pr_rebase` resolutions. Successful rebase/continuation immediately updates the existing contributor branch before later fixes and testing. Verify consent/access first. Use `publish_incoming_pr_rebase` only for approved reconciliation/retry of the recorded result and lease; never plain force or automatic lease replacement. Later fix commits/push, execution, GitHub publication and merge remain separately approved.

Accepted final fixes use approved `commit_incoming_pr_fixes` and separately approved `publish_incoming_pr_fixes`, with no manual Git route. An exact ready-PR ship/merge request covers the shared repository merge, confirmed Done and safe registered `cleanup_incoming_pr_checkout` as one set, without another strategy or cleanup question. Keep the parent repository, contributor branches and private evidence. Explicit cancel closes the PR and sets Canceled, preserving local work without cleanup. Report partial outcomes and resume only confirmed unfinished steps.

GitHub Git transport uses SSH with existing authentication for fetch, remote-tip observation and push; configure no HTTPS credentials and change no parent/global Git configuration. A saved completed rebase with failed publication uses approved `publish_incoming_pr_rebase` recovery with its existing result and original lease, not another checkout or rebase. No manual Git fallback.

The command argument is one exact GitHub PR URL or `#NN`. Ask for a missing or ambiguous selection; never infer a PR from a tracker issue or the checked-out branch. Start with `inspect_incoming_pr_context` and `reference` equal to that selection. Use its configured forge server and normalized addressing.

Starting or resuming with a reference alone authorizes private inspection only. A scoped Backlog/Todo intake choice approves only this PR's membership/initial Status; explicit review start approves its In Review assignment and private review. Publication, checkout, edits, Git writes, close and merge retain their independent scopes. Never initialize an Epic/Task/Gig or adopt the contribution into a workflow-created branch contract. Keep remote mutation tools and Git writes outside skill-derived allow rules; keep all checkout operation tools outside them too. Use existing permissions and conversational approval gates. Do not change permission settings automatically.
