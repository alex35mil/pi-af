# Resolve merge conflicts

Read this when GitHub rejects a Task or Gig merge because the PR conflicts with its target.

The branch takes one ordinary merge commit of the target. History isn't rewritten, nothing is force-pushed, and the PR records exactly what the resolution changed. Two adversarial reviews check the resolution: one before it's made and one after.

## Plan the resolution

1. **Stop shipping.** Fetch the target and list the conflicts without changing the branch: `git merge-tree --write-tree --name-only --messages <branch> origin/<target>`.
2. **Learn why the target changed.** List the target commits that touch a conflicting file: `git log <branch>..origin/<target> -- <files>`. For each, read its PR, the linked issues, the published plan, and any merge-resolution comments, following the [MCP boundary](../core.md#mcp-boundary).
3. **Check scope.** When resolving would change accepted behavior or wording, use [material replanning](../planning.md#material-replanning) instead.
4. **Plan** in Execution, returning native Status to In Progress as for any correction on submitted work. Write a plain-words resolution plan:
   - each conflicting file, what each side changed, and how each conflict is kept or combined;
   - a **Target changes to keep** section: for each of those commits, its SHA and PR, the fix or behavior that must survive, and how the resolution keeps it. A commit without a PR is described from its diff and message.
5. **Review the plan.** Set Self-Review, then call `review_task` or `review_gig` with `phase: "conflict-plan"` and the plan as `resolution`. Follow [review](../review.md) until it approves.
6. **Present** the reviewed plan in chat; no file is written. Accepting it authorizes only the local merge commit.

## Resolve

1. **Merge** in Execution on the stored branch: `git merge --no-ff --no-commit origin/<target>`. Git stops before committing, even when it or rerere resolves everything.
2. **Apply** the approved resolution and stage only the conflicted paths.
3. **Verify** the staged result with the plan and Project Policy verification.
4. **Commit** with Git's default merge message only after verification passes.

When the resolution needs a different approach than the approved plan, run `git merge --abort` and plan again.

## Review the merge

1. Set Self-Review, then call the review tool with `phase: "conflict-merge"`. It reviews the merge commit's `git show --remerge-diff` against the newest approved resolution plan.
2. Amend the unpushed merge commit for corrections within the approved plan. Rerun verification and the merge review after each one.
3. A correction outside the approved plan goes back to planning. Approving the revised plan also approves `git reset --keep <first-parent>` on the unpushed branch, then the merge runs again.

## Push and record

1. **Ask to push.** Show the final plain-words summary of the resolution, which becomes the PR comment. On request, show `git show --remerge-diff <merge>`.
2. **After approval,** push the stored branch once, without force, so CI runs once.
3. **Record it.** Call `prepare_merge_resolution_comment` with the approved summary and run the returned comment call unchanged; the push approval covers it.
4. **In Review.** Return native Status to In Review and clear native Phase.

Merging the new head needs a new request to ship. When the comment's outcome is uncertain, read the PR's comments for its marker before retrying.
