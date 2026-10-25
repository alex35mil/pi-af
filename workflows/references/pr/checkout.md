# Incoming PR checkout tooling

Selection, safety assessment, contributor access, and approvals are in [incoming PR handling](./incoming.md). The rebase and fix workflow is in [rebase and fixes](./fixes.md), and merge, Done, cleanup, and cancellation are in [shipping](./shipping.md).

The named checkout tools, registered by the PR extension, own:

- initialization and fetch;
- checkout and review setup;
- validated transitions;
- target observation;
- standard rebase and its immediate SHA-pinned, lease-protected PR update.

**No manual route:**

- Never reconstruct that Git work in Bash. No manual fallback is allowed after refusal, failure, or unavailability; preserve work and resolve the blocker.
- When a registered tool is unavailable, reload the trusted extensions.

## Inputs and approval scope

**Inputs:**

- Every operation takes `reference` and the actual configured `pull_request_read` `get` `evidence` (tool, arguments, and unchanged response).
- The tool derives repository URLs, full branch refs, and private paths from that identity. There are no arbitrary URL, path, ref, or command overrides, and no approval booleans.
- Get fresh provider evidence before mutations and on resume. Validation checks consistency, not independent provenance or freshness.

**Transport:** GitHub Git transport is SSH (`git@github.com:<owner>/<repo>.git`) for fetch, exact remote-tip observation, and push, with existing trusted SSH authentication. Never configure HTTPS credentials or change parent or global Git configuration. HTTPS PR URLs and provider evidence are identity and API inputs, not transport overrides.

**The normal update flow:** standard rebase → approved conflict resolution → immediate `--force-with-lease` PR update → approved fixes and maintainer testing.

- Before `rebase_incoming_pr`, establish contributor consent and authenticated access, and get approval of the exact source head, target SHA, destination, and lease.
- That one approved set covers the rebase's replacement commits and its immediate push. `continue_incoming_pr_rebase` also pushes immediately once the last approved conflict is resolved.
- It doesn't authorize later fix commits or pushes, tests, GitHub review publication, or merge.

**Permissions:** keep every checkout operation outside skill-derived allows. Native-tool permissions and conversational gates both apply; change no permission settings automatically. Local state and observations are facts, not approval tokens.

| Operation | Required state and scope | Result |
| --- | --- | --- |
| `prepare_incoming_pr_checkout` | Explicit object init and fetch approval; no unmanaged existing path. | An independent object repository with an empty init template, verified provider base and head commits, and their common ancestor. Returns `prepared`; source and configuration stay unmaterialized. |
| `checkout_incoming_pr` | An evidence-backed **Checkout safety: N/5 (label)**, exact checkout approval at every score, fresh matching provider evidence, and valid prepared state. | Detached exact contributor source and index, then detached HEAD at the common ancestor for contributor-only staged review. Returns `contributorReview`. |
| `begin_incoming_pr_fixes` | Finished contributor review, approved corrections, and no unsaved buffers (Git can't see unsaved Neovim buffers). | Validates the original index and source and no untracked files, including ignored additions, then restores the clean contributor HEAD. Returns `fixes`: begin approved static edits, or request the separate rebase-and-update set first. |
| `observe_incoming_pr_target` | Approved Git reads of the verified target and contributor branch. | Observes both current remote tips, separately from provider evidence. Never changes the checkout HEAD, index, or source, or replaces an active pinned rebase or lease. |
| `rebase_incoming_pr` | Clean `fixes` state, the exact approved observed `targetSha` and `expectedHeadSha`, consent and access, and immediate-update approval. | Rechecks both tips, fetches the pinned target, and runs a standard linear rebase. Returns `rebasing` at conflicts; on success, immediately attempts the pinned-lease PR update. |
| `continue_incoming_pr_rebase` | A known native rebase, unchanged progress and index, and exact approved checkout-relative `resolutionPaths`. | Stages only those approved resolutions and deletions and continues without an editor. Returns the next conflict, or immediately publishes the completed result. Edits outside those paths, untracked additions, and unexplained staging are preserved and refused. |
| `publish_incoming_pr_rebase` | A completed but unpublished `rebased` state; explicit approval to recover only the recorded result and lease. | Reads the remote first. Already at the result: confirmed, no push. Still at the original lease: the approved retry. Any other or missing head: rejected. Never refreshes the lease or rebases again. |
| `commit_incoming_pr_fixes` | An accepted final draft, the exact approved `paths` and `message`, fresh open-PR evidence, and consent and access. | Stages only the complete literal approved fix set and creates one additive commit, without pushing. Records `committingFixes` intent and the `committedFixes` result; exact-intent recovery never duplicates a completed commit. |
| `publish_incoming_pr_fixes` | Explicit approval of the recorded additive result and exact contributor destination. | Observes first, then pushes that result normally, without force, only from the recorded source head. Confirms an already-present result without another push; unexpected or missing heads stop. Advances the confirmed baseline. |
| `cleanup_incoming_pr_checkout` | The exact shipping and merge scope, a matching merged PR, head, and timestamp, applicable Project Done proof, and no extra or unpublished work. | Removes only the managed checkout, through owned retirement and removal. Keeps parent state, contributor branches, and private evidence. Extra refs or worktrees, dirty, incomplete, or unmanaged work, or unsafe identity block removal. No second cleanup approval and no manual fallback. |
| `inspect_incoming_pr_checkout` | An existing managed checkout or owned removal state, and actual provider evidence. | Returns recorded and observed revisions, baseline, target, lease, phase, and Git and native progress and conflict state, even for inspectable local mismatches. Never repairs anything or changes HEAD, index, or source. |

**Repeated calls and mismatches:**

- Repeated valid prepare, review, or fixes calls don't reset drafts or re-fetch over work.
- Mismatches, incompatible or unmanaged paths, unexpected changes, and incomplete operations stop. They never clean up, reset, stash, abort, skip, force a checkout, adopt work automatically, or delete branches. Inspect and agree on recovery instead of bypassing the tool.

**During contributor review**, detached HEAD is the original common ancestor while the index and source are the original PR head. **Don't edit, stage, unstage, commit, or push in this phase.** Restore the clean contributor HEAD with `begin_incoming_pr_fixes` before a rebase or static edits.

## Rebase and publication semantics

**How it rebases:**

- Use standard rebase, never merge-into-PR or preserve-merges. PR commits are replayed onto the approved target as a straight line, and merge commits aren't recreated.
- Ordinary Git handling of already-upstream and empty commits applies, and returned messages keep Git's skipped-commit information.
- No interactive todo editing, exec commands, autosquash, autostash, or updates of unrelated refs.

**Target and lease:**

- Provider-reported base and head evidence stays unchanged. `observe_incoming_pr_target` reads the actual `refs/heads/<base-ref>` tip and the contributor branch separately.
- A changed tip before starting needs reassessment and renewed exact approval.
- During conflict resolution, the active target and lease stay pinned; later observations never silently replace them.

**Conflicts:**

- Conflicts are expected, inspectable states. No push while conflicts remain.
- In Git's rebase terms, **ours** is the target plus commits already replayed, and **theirs** is the contributor commit being replayed.
- The tool returns unmerged index stages, affected paths, native progress, and diffs. The agent proposes and edits approved resolution contents; the tool stages and continues.
- Mechanical validation doesn't prove a resolution is semantically correct or tested.

**The immediate push:**

- On a successful rebase, the tool verifies native completion, target ancestry, and a clean detached result, then immediately pushes the recorded result SHA to the existing contributor repository and ref.
- The push uses `--force-with-lease=refs/heads/<head-ref>:<observed-pre-rebase-head-sha>` and an explicit result-SHA-to-ref refspec. Never plain `--force`, an implicit tracking-ref lease, or the base repository as a fork destination.
- A contributor update rejects the lease and preserves remote work and the local rebased result.

**Publication states:** publication is recorded as pending, attempted or uncertain, rejected with the observed head, or confirmed.

- The attempted result and lease are saved before sending.
- A lost response can follow a successful update: read the exact remote head before retrying. An already-published result is confirmed without another push. Changed or deleted branches are never overwritten or recreated.
- Cancellation and incomplete operations keep their actual state. They never grant a fresh lease or trigger an automatic rollback.
- Report confirmed remote completion even when a later local check fails.

**Recovery from authentication failures:**

- After an HTTPS authentication failure with a saved completed rebase, use approved `publish_incoming_pr_rebase` over SSH with the same recorded result and original lease. No checkout recreation, refetch, rebase rerun, lease refresh, or state migration is needed.
- An SSH authentication failure keeps that result and lease. Resolve access separately, with no HTTPS or manual Git fallback.

**After publication:**

- Get fresh PR evidence for the new head; never edit an old response to manufacture it.
- Later fixes use the confirmed published head as their baseline. Before any separately approved fix commit, verify the actual HEAD equals the freshly verified published contributor head.
- Keep later fixes **uncommitted throughout maintainer review, discussion, and revision**. Ordinary fix commits and pushes, review publication, testing, and GitHub merge keep their own approvals.

## Additive fixes and cleanup

**Fix commits:**

- Use `commit_incoming_pr_fixes` and separately approved `publish_incoming_pr_fixes`, never a shell commit or push that bypasses managed state.
- An approved fix commit must have the recorded parent, tree, and message and a clean exact result. Unexpected staged, changed, or untracked paths are preserved.
- `committingFixes` can recognize an already-applied exact commit after an interruption. `committedFixes` stays unpublished until remote confirmation.
- A rejected or uncertain normal push keeps the commit and never forces, rebases, or silently refreshes its source.

**Baselines:**

- The saved rebase result is historical integration evidence, not permanently the published baseline.
- Confirmed additive publication advances `baselineSha`, keeping original evidence, historical rebase facts, and valid inspection and resume.
- The original-to-rebase comparison stops at that recorded integration, separate from published and pending fixes.

**Cleanup:**

- Cleanup is part of the exact shipping and merge set, after confirmed merge and applicable native Project Done.
- Supply `completion` with scoped field and item evidence for a configured Project, or explicit `forgeOnly` only when no GitHub Project is configured.
- A clean, known object-only or contributor-review checkout is removable. Maintainer drafts, pending commits or rebases, extra local refs or worktrees, and unsafe paths aren't.
- Confirm unsaved buffers are safe before anything is removed. No checkout is a no-op, never a reason to create one.

**Removal states:**

- `removing`, `deleting`, and `removed` are owned local removal facts, not PR lifecycle. Inspection stays available without recreating source.
- Retired-source removal resumes only at its recorded private path, and new work at the original checkout path is preserved.
- Notes, state, evidence, diffs, and immutable reviews are kept.
- A later failure never reverses a confirmed merge or Done. Cancellation closes the PR and keeps local work, with no cleanup.

## Returned state and private evidence

**Active-checkout output includes:**

- paths: relative and absolute;
- revisions:
  - the unchanged original `revision` and the actual input `providerRevision`;
  - the original `reviewBaseSha` and the current published `baselineSha`;
  - the separate remote `observation`;
- rebase:
  - active or completed `rebase_incoming_pr` facts;
  - publication status and Git messages;
- phase: the phase and `phaseValid`;
- comparisons:
  - HEAD, commit, index, and worktree; `indexMatchesBaseline` refers to the published baseline;
  - `fixCommit` intent and result, when present;
- working state: staged and unstaged state, native operation and unmerged stages, and untracked paths, including ignored additions;
- the parent-verification outcome.

Keep these files at `.project/.local/pull-requests/<number>/`, not inside review rounds:

| File | Contents |
| --- | --- |
| `checkout/` | the independent source repository, with its own `.git`, HEAD, and index |
| `checkout.json` | original evidence and identity, observed tips, validated progress, working baseline, and completed publication facts; never approval or workflow lifecycle |
| `checkout-inspection.json` | the latest complete observations and phase validation |
| `checkout-contribution.diff` | the original merge-base-to-PR contribution |
| `checkout-rebase.diff` | the original source head to the current rebased or intermediate result; upstream integration isn't labeled as a later fix |
| `checkout-conflicts.diff` | the current combined conflict comparison, with unmerged stage details in the inspection record |
| `checkout-fixes.diff` | the confirmed baseline to the local tracked draft or pending additive fixes; empty during object preparation or rebase |
| `checkout-published-fixes.diff` | additive fixes already published after the latest integration point, separate from the current draft |
| `checkout-untracked.json` | every new file, including ignored additions. Read relevant contents explicitly; don't stage later fixes just to see them |

**Output size:**

- Output is limited to 2000 lines or 50 KB and points to the full private evidence when truncated.
- These inspection files are mutable working evidence. Freeze relevant original, rebase, resolution, fix, and source evidence through `reviews/<provider-base-sha>-<provider-head-sha>/review-NNN/inputs/` before independent review.
- Earlier review records and source snapshots are never moved or rewritten.

## Safety boundary

**Execution:**

- The tool uses direct argument arrays, exact independent `.git` and worktree paths, and private-path validation, including dangling symlinks. No parent-repository discovery or contributor resource loading.
- Inherited Git relocation or configuration overrides are refused before context or artifact readers run. Unset those host overrides explicitly and retry only the approved operation.
- Operations on the same checkout share the existing file-mutation queue.

**Git controls disable:**

- hooks (`core.hooksPath=/dev/null` on the supported Unix host);
- fsmonitor;
- configured clean, smudge, and process filters;
- external diff and textconv helpers;
- custom merge-driver commands. A blocked driver reports a conflict instead of running, or silently declaring a successful merge;
- signing and editor helpers;
- rerere reuse;
- maintenance;
- submodule recursion, including at push time.

It uses an empty init template, never fetches LFS or submodule assets automatically, and changes no parent or global configuration.

**Parent repository:**

- Compare the parent branch, HEAD, raw index and configuration, status, and working-file evidence before and after success, conflict, and failure, without refreshing the parent index or restoring anything automatically.
- Keep the agent, shell, editor, and reviewer rooted in the trusted parent. Use full checkout-prefixed paths and real line numbers.
- Never activate contributor instructions, extensions, rules, packages, or editor or environment configuration; disable editor project tooling separately.
- Inspect symlinks as links or Git objects, never by following them outside the checkout.

**Execution boundary:**

- A nested checkout isn't a sandbox.
- A rebase and its immediate publication don't authorize contributor tests, builds, installs, scripts, hooks, plugins, or formatters. Running them needs separate exact-command and isolated-environment approval; report unavailable runtime checks as **not run**.

**Editor support:**

- Delta doesn't automatically choose this nested Git repository from the parent working directory, and Pi autocomplete skips ignored checkout files.
- Direct file and line references work. This change modifies neither plugin.
