# Deliverable submission

Read this when final subagent review has approved, `result.md` or `report.md` is synchronized, and the user has reviewed the final work.

## What acceptance authorizes

- Accepting the final `result.md` or `report.md` diff starts submission. Submission means committing the work and, with a forge, pushing the stored branch and creating or recovering the PR for the stored head and target. Don't ask again about delivery, title, or body.
- An explicit request to ship ("ship it", "ship this", "finish it") covers submission and then shipping. When you reach that point, read [shipping](./shipping.md).
- When the user asks for commit-only, no push, or no PR, stop after committing.

## Commits

These rules apply to every Deliverable commit, including an accepted intermediate commit step before final review.

- A Deliverable may have several commits. Each must stay within the accepted plan's scope.
- When the plan defines commit steps, complete each step's cycle in order: implement, interim review, user review, then commit.
- Use the available `commit` skill for selection and message rules. Without one, use plain Git and follow repository conventions.
- Stage only the reviewed implementation and durable artifacts. Preserve every unrelated staged change and every unrelated path, in Git or outside it. Never amend another commit unless the user asks.

## With a forge

1. Before staging the last Deliverable commit, call `prepare_integration_pull_request`, then `begin_resource_creation` with role `forge`, and wait for both to finish. With planned commit steps, that is the last step's commit; otherwise it is the single submission commit. `begin_resource_creation` only saves immutable PR repository, head, and target intent in `metadata.json`. It is a local checkpoint that authorizes no push or PR. Include that change in the same commit, never a follow-up commit. When intent already exists or IDs are missing, investigate through the configured provider tools; never prepare a replacement creation.
2. Call `render_provider_body` with the complete synchronized `result.md` or `report.md` and destination `pullRequest`. Publish its returned Markdown unchanged.
3. Push only the stored entity branch.
4. Create the PR with one direct native call:
   - title: the approved entity title, without an internal or tracker identifier;
   - head: the stored branch `name`;
   - base: the stored `target`.

   Approval never changes that contract. Don't discover PRs first.
5. On clear success, call `record_resource_creation` with the create evidence. It records the PR number and URL in the local Resource IDs file only; it never changes versioned metadata or causes a follow-up commit. Use the number from the PR URL, not the database ID.
6. After the PR is created or recovered, set lifecycle `inReview` through its authority and clear native Phase (see [Phase](../phase.md)). A local commit or push without a reviewable PR is not submission.

Without a forge, perform no remote Git or PR operation. Never set In Review.

## Revisions on an open PR

- Return to In Progress and Execution for corrections, then Self-Review for interim, final, and user review.
- After an approved post-creation change to `result.md` or `report.md`, render and publish the complete PR body again.
- Return to In Review after successful approved resubmission. Reuse native automation outcomes and skip writes that are already applied.

## Choosing an existing PR

When investigation finds an existing PR that might be the right one, ask the user. Pass the chosen PR's exact read to `select_pull_request_resource`. Never replace an ambiguous or closed PR.

When an outcome is uncertain, see [core](../core.md#outcomes-and-recovery) and [recovery](../integrations/recovery.md#uncertain-pr-operations).
