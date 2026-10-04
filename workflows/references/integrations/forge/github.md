# GitHub forge

First follow `../shared.md` for local configuration, Resource IDs, full-body ownership, and permissions. Ordinary resume does not discover PRs.

## Submission and revisions

Final completion-artifact acceptance authorizes the submission set in `../../deliverable.md`, not finishing or merging.

1. Render the complete approved synchronized `result.md`/`report.md` with `render_provider_body`. Use the approved entity title without an identifier, the immutable branch `name` as head, and stored `target` as base.
2. Before the submission commit, request `integration_context` operation `pullRequest`. With no prior forge intent, call `resource_ids` action `beginCreation`, role `forge`: it saves immutable versioned repository/head/target intent. Include that intent with the reviewed implementation in the one authorized submission commit/push. Push only the stored branch; commit-only/no-push/no-PR requests do not prepare PR creation.
3. Call the first registered create tool directly after pushing, without preliminary discovery. Existing intent or missing IDs require agent investigation through configured provider tools before continuing; it never authorizes replacement creation.
4. On established clear create success, call `resource_ids` action `recordCreation` with the exact registered tool, accepted arguments, and actual response. The repository-specific URL supplies the PR number; the returned database ID is not that number. The returned number/URL is recorded directly in the existing ignored Resource IDs file. Creation recording never updates versioned metadata afterward, creates another commit, amends, or pushes bookkeeping. Do not fetch merely to populate cache or revalidate accepted create arguments.
5. Use `resource_ids` to resolve locally recorded PR addressing. Missing/stale IDs or uncertain attempts require agent investigation through configured provider tools and conversation when a choice is needed. Record the actual exact PR read after verifying repository/head/base. Tracker reads use the tracker registration; PR reads use the forge registration. Preserve existing intent, creation history and explicit choices; a closed or ambiguous PR is not permission to replace it.
6. For an approved revised completion artifact, render and update the exact scoped PR's whole body directly. Trust established clear success without a routine body read/comparison or confirmation read. After uncertain/partial outcomes, read the exact PR and reconcile before retrying; never create another PR for a body update.

When investigation requires choosing an existing PR, ask the user and pass that PR's actual exact read to `resource_ids` action `select`. The chosen number/URL replaces the recorded PR ID in the existing IDs file, preserving versioned intent. Finish and cleanup require evidence for that recorded number.

Keep In Review through submission and PR revisions. Creation errors do not prove absence. Preserve stored intent and known identity, and complete only confirmed unfinished work; never blindly retry a non-idempotent create.

## Explicit Task/Gig finish

An explicit finish request authorizes merge-if-needed, Done, stored-target synchronization/checkout, and deletion of the local Deliverable branch without another cleanup question. It does not authorize Epic merging or a different target/method.

1. Request `finishRead` with locally known PR addressing. Use one exact `pull_request_read:get` response to establish current state, repository, stored `head.ref`/`base.ref`, and `head.sha` equal to the local Deliverable head. Reuse a matching required read already obtained in this operation.
2. Already merged: reuse its complete verified evidence. Not merged: after all completion requirements pass, request `finishMerge` with the same exact PR-get `evidence` (`tool`, actual `arguments`, actual `response`). The local context compares it with the stored local branch SHA and recorded PR number. For a merge-needed decision, call `merge_pull_request` using its returned arguments: fixed `merge_method: squash` and `expectedHeadSha` equal to that verified local head. A blocked decision makes no merge call. An already-merged response returns complete proof without a merge call.
3. Require the PR number, `merged: true`, exact repository/head/base/head SHA and `merged_at` from fresh exact PR get before Done. After a new merge, obtain only the missing merged-state facts; reuse matching current-operation evidence. Missing facts, mismatch, denial, or blocked merge stops. Reconcile an uncertain merge through exact PR get before retrying. Delivery trusts GitHub's merged-state confirmation; later target-history rewrites are outside this proof.
4. Set Done through the existing authority, then call `cleanup_delivery_branch` with the same exact merged-state evidence, including repository. The local finalizer validates the recorded PR number, semantic intent, source head, lifecycle, worktree safety and equality with freshly fetched origin before deletion.
5. Successful finish leaves the clone on that exact synchronized target with only the local Deliverable branch deleted. An Epic-target Task leaves main and the Epic branch intact. Failed synchronization or proof preserves the source branch and never undoes confirmed Done. Never force-reset, stash, clean unrelated work, push the target to hide divergence, or delete remote/Epic branches.

`list_pull_requests` is addressing evidence, not authoritative merge state. Use required exact get for merge facts and preserve its provenance. Missing merge evidence blocks completion even when creation/update/merge mutations otherwise succeeded.
