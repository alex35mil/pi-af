# Deliverable submission

Read this when final subagent review has approved, `result.md` or `report.md` is synchronized, and the user has reviewed the final work.

## What acceptance authorizes

- Accepting the final `result.md` or `report.md` diff starts submission. Submission means committing the work, pushing the stored branch, and creating or recovering the PR for the stored head and target. Don't ask again about delivery, title, or body.
- An explicit request to ship ("ship it", "ship this", "finish it") covers submission and then shipping. When you reach that point, read [shipping](./shipping.md).
- When the user asks for commit-only, no push, or no PR, stop after committing.

## Commits

These rules apply to every Deliverable commit, including an accepted intermediate commit step before final review.

- A Deliverable may have several commits. Each must stay within the accepted plan's scope.
- When the plan defines commit steps, complete each step's cycle in order: implement, interim review, user review, then commit.
- Use the available `commit` skill for selection and message rules. Without one, use plain Git and follow repository conventions.
- Stage only the reviewed implementation. Workflow artifacts under `.project/.local/` are never committed. Preserve every unrelated staged change and every unrelated path, in Git or outside it. Never amend another commit unless the user asks.
- **No repository changes:** when the branch has no commits ahead of its target at submission (typically research or audit), make one empty commit (`git commit --allow-empty`) with the commit skill's message rules, so GitHub can open the PR. The completion artifact is the PR body.

## Open the PR

Every Deliverable ships through a merged PR.

1. **Save PR intent.** After the last Deliverable commit, call `prepare_integration_pull_request`, then `begin_resource_creation`, and let both finish.
   - `begin_resource_creation` only saves the immutable PR repository, head, and target in the local `metadata.json`. It's a local checkpoint and authorizes no push or PR.
   - When intent already exists or IDs are missing, investigate through the configured tools. Never prepare a replacement creation.
2. **Render the body.** Call `render_provider_body` with the complete synchronized `result.md` or `report.md` and destination `pullRequest`. Publish its Markdown unchanged.
3. **Push** only the stored entity branch.
4. **Create the PR** with one direct native call:
   - title: the approved entity title, without an internal or tracker identifier;
   - head: the stored branch `name`;
   - base: the stored `target`.

   Approval never changes that contract. Don't discover PRs first.
5. **Record.** On clear success, call `record_resource_creation` with the create evidence. It records the PR number and URL only in the local Resource IDs file; it never changes `metadata.json` or causes a follow-up commit. Use the number from the PR URL, not the database ID.
6. **In Review.** After the PR is created or recovered, set native Status to In Review and clear native Phase (see [Phase](../phase.md)). A local commit or push without a reviewable PR is not submission.

## Revisions on an open PR

- Return to In Progress and Execution for corrections, then Self-Review for interim, final, and user review.
- After an approved post-creation change to `result.md` or `report.md`, render and publish the complete PR body again.
- Return to In Review after successful approved resubmission. Reuse native automation outcomes and skip writes that are already applied.

## Choosing an existing PR

When investigation finds an existing PR that might be the right one, ask the user. Pass the chosen PR's exact read to `select_pull_request_resource`. Never replace an ambiguous or closed PR.

When an outcome is uncertain, see [core](../core.md#outcomes-and-recovery) and [recovery](../integrations/recovery.md#uncertain-pr-operations).
