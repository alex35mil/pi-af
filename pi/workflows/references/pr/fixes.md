# Rebase and fixes for incoming PRs

Read this when moving from contributor review to fixes, rebasing, or committing or pushing to a contributor branch. Operation mechanics are in the [checkout contract](./checkout.md).

## From contributor review to fixes

Work in two phases: **contributor review only**, then **clean contributor head plus our fixes**.

**During review:**

- Finish contributor discussion and agree on concrete corrections before the transition.
- Never mix staged contributor changes with new maintainer edits.
- The contributor-review baseline is the common ancestor (`git merge-base`) of the provider-reported base and PR head, not the separately observed current target tip. Keep the actual base SHA separately for identity and freshness checks.

**The transition:**

- Restore and verify the clean original PR head before any fix. Preserve unexpected changes; never reset or clean them away.
- Call `begin_incoming_pr_fixes` only after completed contributor discussion, approved corrections, fresh matching PR evidence, and confirmation that editor buffers have no unsaved changes.
- It validates the actual HEAD, index, and source, and refuses untracked files, including ignored additions, before restoring the clean contributor head.

**Inspecting:**

- `inspect_incoming_pr_checkout` returns paths, original and actual provider revisions, the published baseline, separate target and lease observations, phase validation, native rebase and conflict details, and staged, unstaged, and untracked state.
- The original contribution, the rebase result and conflicts, and later baseline-to-fixes diffs stay distinct.
- Preserve refused or incomplete work; never reset or clean it by hand.

## Approved rebase and immediate PR update

**Transport.** All checkout-tool GitHub fetches, remote-tip observations, and pushes use SSH (`git@github.com:<owner>/<repo>.git`) with existing trusted SSH authentication. Never configure HTTPS credentials or change parent or global Git configuration. PR URL selection and MCP evidence are unchanged.

**Approval:**

1. After contributor review and the clean-head transition, call `observe_incoming_pr_target` to read the verified target and contributor branch tips. Keep these Git observations separate from the unchanged provider-reported base and head. A newer target doesn't authorize a rebase.
2. Establish contributor consent and authenticated access (below), then get approval for **standard rebase plus immediate PR update**:
   - the exact source head;
   - the observed target SHA;
   - the actual contributor repository and ref;
   - the source-head lease.
3. Call `rebase_incoming_pr` with the observed `targetSha` and `expectedHeadSha`, only on a clean source and index with no untracked files or native operation. Changed observations before starting need renewed approval.

**Conflicts:**

- Standard rebase replays commits as a straight line and doesn't recreate merge commits. Ordinary already-upstream and empty-commit behavior applies.
- Verified conflicts return affected paths, unmerged stages, and diffs. Propose and get approval for the resolution contents, edit those files, then call `continue_incoming_pr_rebase` with the exact approved checkout-relative `resolutionPaths`.
- The tool stages only those paths and continues. Unexplained index or metadata changes, edits outside those paths, and untracked additions are preserved and refused. Another conflict needs another approved resolution.
- Never automatically abort, skip, reset, clean, or restart.

**The immediate update:**

- On success, `rebase_incoming_pr` and `continue_incoming_pr_rebase` immediately push the recorded result to the existing contributor branch with `--force-with-lease=refs/heads/<head-ref>:<observed-pre-rebase-head-sha>` and an explicit source-SHA refspec.
- Never use plain `--force`, an implicit tracking-ref lease, or a different destination.
- This approval covers replacement rebase commits and approved resolutions, not later fixes, tests, publication, or merge.
- The target stays pinned throughout resolution; later observations never silently replace it.

**When the update fails:**

- A rejected lease keeps remote work and the local rebased result.
- Use explicitly approved `publish_incoming_pr_rebase` only for the recorded result and lease:
  - an already-published result is confirmed without another push;
  - the original lease still present permits the approved retry;
  - a changed or deleted branch stops, without a refreshed lease or recreation.
- Reconcile uncertain push responses with exact remote reads before retrying, and report completed remote steps even when a later local check fails.
- After publication, get fresh provider evidence. Never fabricate a response or alter the original evidence.
- A completed rebase whose HTTPS push failed is recovered through approved `publish_incoming_pr_rebase` over SSH, reusing its result and original lease, without recreating the checkout, rerunning the rebase, or refreshing the lease. Never fall back to manual Git or configure HTTPS credentials.

**Afterwards:** only once the rebase update is confirmed do approved fixes and maintainer testing proceed. Keep those fixes uncommitted throughout discussion; their commit and push, and any contributor-code execution, stay separately approved.

## Small fixes

1. Propose the concrete patch and intended verification, and get approval.
2. Finish contributor review and get a successful `begin_incoming_pr_fixes` before editing. After an approved rebase, wait for its confirmed PR update first.
3. Apply only agreed static corrections. Keep fixes **uncommitted throughout maintainer review, discussion, and revision**.
4. Show the full relevant source and the published-head-to-fixes diff, with untracked additions separately. Freeze each reviewed draft's evidence independently.
5. Report runtime checks not run. Never claim passing runtime verification from static inspection.

Larger or independent work needs a separate scope decision, never automatic Epic, Task, or Gig initialization.

### Consent and write access

Before committing or pushing, verify **contributor consent** and **effective authenticated write access** as two separate facts for the actual head repository and ref.

**Consent evidence:**

- For a fork, GitHub's **Allow edits by maintainers** checkbox (`maintainer_can_modify: true`) supplies contributor consent to maintainer edits. It doesn't prove the current identity can push.
- Existing explicit contributor authorization is also consent evidence.
- Check what's already established before asking for anything.

| Consent evidence | What to report and request |
| --- | --- |
| Checkbox enabled, a current `true` read, or applicable explicit contributor authorization | Consent is verified; don't ask the contributor to grant it again. Request only any still-missing authenticated write-access evidence. |
| Field omitted or unavailable, and no independent consent evidence | Say **"consent is unverified"**, not that consent is missing or still needs granting. Explain the checkbox and request only its current state, a screenshot or maintainer confirmation, or existing contributor authorization. |
| Maintainer edits confirmed disabled, or contributor refusal established, with no other applicable authorization | Report the known restriction for the proposed edit route and stop writes. Request a new grant only when its absence is actually established. |

**Why the field is missing:**

- The registered `pull_request_read` `get` response omits `maintainer_can_modify`. The read schema has no arbitrary-field or raw-output option, and the list schema doesn't offer it either.
- The local MCP bridge forwards provider text unchanged. The official server's [minimal PR type](https://github.com/github/github-mcp-server/blob/main/pkg/github/minimal_types.go) and [PR-read projection](https://github.com/github/github-mcp-server/blob/main/pkg/github/pullrequests.go) drop the field before it reaches the bridge, structured output included.
- Exposing it needs an upstream read-output change that keeps both explicit `true` and `false`; no local switch restores it.
- Until the registered read supplies it, request the missing UI or confirmation evidence rather than inferring consent. Never probe an update tool, fabricate the field, or bypass MCP with another API client.

**Write access:**

- Verify authenticated write access separately, with available registered permission evidence or explicit maintainer-supplied evidence. Missing, denied, or ambiguous access stops writes even when consent is verified.
- Never widen credentials, enable maintainer edits, or make probe commits or pushes.
- GitHub's fork permission can grant access to workflow secrets; never change it on the contributor's behalf.

### Committing and pushing

1. Run only separately approved checks, in an appropriately isolated environment. Unavailable runtime checks don't prohibit approved static edits.
2. Stage and commit only after the maintainer accepts the final fix diff and explicitly approves committing it, using registered `commit_incoming_pr_fixes` with the exact paths and message.
   - Verify the actual HEAD is the freshly verified published contributor head before the first fix commit.
   - Preserve the approved published history and add new fix commits only.
   - Keep hooks and project execution disabled for Git writes too.
3. Get explicit push approval for the exact head repository and ref and the reviewed fix, then call `publish_incoming_pr_fixes` for the recorded result.
   - Later fix pushes are normal, non-forced updates. Never amend or rebase them implicitly, or replace or delete branches. Only the separately approved rebase update uses the SHA-pinned lease.
   - A changed remote head needs reassessment. A non-fast-forward rejection stops instead of overwriting contribution history.
4. Verify the resulting remote SHA, then repeat verification and private review for the correction. Renew affected review and merge approvals.
