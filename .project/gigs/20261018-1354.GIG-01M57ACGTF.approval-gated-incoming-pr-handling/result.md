# Result

## Overview

Added `/pr <GitHub PR URL or #NN>` for reviewing and integrating existing contributions without initializing an Epic, Task or Gig. PRs must target the current configured repository; contributor heads may be forks.

- **Board:** explicit missing intake chooses Backlog or Todo; interrupted intake can finish that choice without another add, while ordinary existing cards are preserved. Maintainer review starts In Review and stays there through feedback, contributor updates, rebase, fixes and testing. Confirmed merge becomes Done; cancel closes the PR, confirms unmerged closure and sets Canceled. No contributor activity inference, In Progress or Phase projection.
- **One merge policy:** Deliverable finish and incoming shipping call the same forge-owned merge operation and canonical contract. The existing squash policy and verified expected head have one implementation; incoming PRs do not choose another strategy.
- **Managed delivery:** registered tooling owns checkout, approved standard rebase/immediate SHA-pinned lease update, exact-path additive commit, separately approved normal fix push and safe post-merge cleanup. An exact ship/merge request covers merge, Done and cleanup without another cleanup approval.
- **Automatic intake option:** Project Setup renders a pinned, metadata-only fork-PR workflow. It adds membership only and uses the Project's native Backlog default, never resetting existing Status. Same-repository PRs, including Deliverables, are excluded. This feature does not deploy or activate that workflow.
- **Preservation:** parent files, branch, HEAD, index and configuration stay untouched. Contributor branches and private notes/evidence/reviews remain. Unexpected, dirty, unpublished or incomplete work is preserved and blocks unsafe operations.

All GitHub Git transport uses existing SSH authentication; no HTTPS credentials or parent/global Git settings are configured. Contributor-code execution remains separately approved and requires appropriate isolation; a nested checkout is not a sandbox. Delta/pi.nvim browsing support and isolated execution infrastructure are unchanged.

## Implementation walkthrough

### Identity, Project and shared merge

Concrete GitHub integration helpers are grouped under `integrations/forge/github/`. `incoming-pr-context.ts` owns exact configured-repository selection, compact `repo.full_name` evidence normalization, fork distinction and safe private paths. Incoming context exposes optional configured GitHub Project lookup/Status metadata independently of the forge server. Forge-only private work remains available without inventing another tracker destination.

`incoming-pr-project.ts` validates scoped native PR, field and membership evidence and returns only required native add/Status/close arguments, unchanged state or a blocker. Actual provider calls remain direct registered MCP operations under normal permissions. Complete native mutation success can supply required outcome facts; incomplete responses need only the missing reads. After a lost add response, reconciled intake validates the actual attempted call and fresh exact membership, then completes the original Status choice without another add or fabricated success. Matching Status and In Review/terminal progress remain unchanged; ordinary existing membership is never requeued. No local lifecycle authority or approval token is created, and unrelated fields/issues are untouched.

`forge/github/merge.ts` owns the repository merge decision and exact pinned native arguments. Deliverable `finishReadDecision` retains its stored PR/branch/local-head guards and delegates there. `incoming-pr-merge.ts` binds actual reviewed/fresh PR evidence and delegates to the same operation. Complete already-merged proof avoids another merge call; mismatched evidence, unknown required facts or rejected operations do not select another strategy. Both routes link to `references/integrations/forge/merge.md`.

### Checkout, updates and cleanup

The independent nested repository lives at `.project/.local/pull-requests/<number>/checkout/`. Object preparation leaves source unmaterialized. Before checkout, present an evidence-backed 1–5 malicious-code score with its scale-provided label, for example **Checkout safety: 5/5 (safe)**. The labels are malicious, suspicious, inconclusive, concerns and safe; a 5 is not a guarantee, and exact-revision/path approval remains required at every score. Contributor-only staged review uses the original merge-base while source/index remain at the contribution head. Validated `beginFixes` restores clean contributor HEAD before edits or an approved rebase.

Actual target/source observations stay separate from unchanged provider evidence. Standard rebase preserves native conflicts for approved exact-path resolution and immediately attempts the explicit original-head `--force-with-lease` update on completion. Existing HTTPS-failed rebased results recover over SSH with the same result/lease, without recreation, refetch, rebase rerun or migration. Unexpected/deleted contributor heads stop without refreshing a lease.

`fixes.ts` records exact approved parent/tree/message/path intent and additive commit result. Commit approval alone does not push. `publishFixes` normally pushes only the recorded result to the verified contributor ref; rejected/uncertain outcomes preserve local work and reconcile actual remote state before retrying. Confirmed publication advances the baseline independently of historical rebase facts, so inspection/resume and later drafts remain valid. Original contribution, integration, published fixes and current draft diffs remain separate.

`cleanup.ts` requires matching merged PR/head/timestamp and applicable Project Done proof. It validates the saved representation and refuses extra/unpublished work, unsafe metadata or additional local refs/worktrees. Owned retirement/removal states permit interruption recovery without deleting new work at the original path. Cleanup removes only the managed checkout, retaining PR-root evidence and state; it does not switch/sync the parent, delete contributor/base branches or remove the whole private directory. A later failure does not reverse confirmed merge/Done. Cancellation preserves local work and includes no cleanup.

The PR-owned Git runner uses direct arguments, literal paths, validated refs, an empty init template and existing SSH authentication. It suppresses hooks, filters, fsmonitor, custom merge drivers, signing/editors, rerere, maintenance and submodule recursion. Private-path checks reject existing/dangling symlinks and inherited Git relocation overrides. Per-record serialization and parent before/after fingerprints apply on success and failure; no reset/restoration or manual Git fallback is supplied.

### Private review and setup automation

Only review artifacts live under `reviews/<base-sha>-<head-sha>/review-NNN/`, with write-once `inputs/` source/diff/dependency snapshots and an original-to-snapshot map. Checkout/state/diffs and working evidence stay at the PR root. Repeated same-head drafts cannot rewrite earlier passes. The shared reviewer stays read-only in the trusted parent context; canonical findings/adjudication retain saved-report severity. Existing initialized-entity review gates remain intact.

`project-setup/incoming-pr-intake.ts` and registered `render_incoming_pr_intake` produce an exact optional local workflow candidate from selected forge/Project configuration and an Actions secret name. Setup inspection includes the managed path and preserves unrelated files. The generated trusted-default-branch opened/reopened handler validates open fork identity, then uses idempotent Project addition only. It does not write fields, check out/run contributor code, install dependencies, use caches or copy credentials.

Activation requires the native Backlog default, appropriate Project-capable Actions secret, applicable event policy and normal default-branch deployment. Rendering/writing is not activation. Setup never configures secrets, weakens policies, creates probe PRs or commits/pushes/deploys. PR-specific guidance is grouped under `references/pr/`, including Project, automation, checkout and complete shipping/cancel procedures.

Contributor consent and authenticated write access remain separate. The current GitHub MCP read omits `maintainer_can_modify`; guidance requests only missing UI/confirmation evidence and never treats omission as denial or repeats an established grant.

## Verification

- `npm test` — 502 tests passed.
- `npx tsc --noEmit` — passed.
- Touched-file formatting, `git diff --check` and unchanged package/lock/ignore/MCP/integration settings checks — passed. Previously verified unrelated `workflows/README.md` table-format drift remains untouched.
- Focused incoming identity/review, Project, shared merge, guidance and instruction tests — 65 passed, including lost add-response recovery in both artifact modes, exact attempted-call/item scope, repeat recovery, explicit-choice/schema guards and preserved advanced/ordinary existing progress. Actual registered additive-delivery/cleanup coverage also passes in the full suite.
- GitHub namespace and safety-label checks — direct consumers resolve the concrete `forge/github/` namespace and both merge consumers share its `merge.ts`. Context, procedure, skill and checkout guidance expose the numeric-plus-label format while retaining original scale meanings, coverage limitations and explicit approval at every score.
- Shared merge tests exercise both consumers, fixed method/pinned head parity, incoming fork association, changed evidence, complete merged proof and rejected overrides.
- Generated intake-script fixtures verify fork-only addition, existing Status preservation, user/org Project scope, untrusted text as data, visible API failure and side-effect-free rendering/inspection.
- Real-Git fixtures in both artifact modes verify original-lease SSH rebase recovery, exact-path commit-only behavior, baseline advancement, separate integration/published/draft evidence, interrupted commit recognition without duplication, normal non-forced push rejection and uncertain-push reconciliation.
- Cleanup fixtures cover clean prepared/review/fixes representations, actual configured Project Done proof, remote-only no-op, unmanaged/dirty/ref refusal, immutable evidence preservation and interrupted owned deletion that retains new work at the original path.
- Existing compact evidence, private-path/symlink, merge-base, literal-path, helper-suppression, parent/index/config preservation, immutable review, renderer/adjudication and permission/phase regressions remain in the full suite.

**Not run:**

- Live GitHub SSH authentication; actual #13 or other external contribution checkout/rebase/commit/push/merge/close/cleanup or Project-item mutation — verification uses temporary repositories and mocked provider evidence, not real contributions.
- Hosted Actions deployment/runs, live secret/event-policy changes and live Backlog-default verification — only the local renderer/generated static script and mocked API behavior were tested; activation remains operator-approved setup work.
- External contributor tests, builds and dependency installation — isolated execution is not implemented and no contributor code was executed on the host.
