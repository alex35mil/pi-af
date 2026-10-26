# Epic delivery and future Task targets

The Epic skill owns the approved Task delivery strategy, recorded in reviewed `epic.md`. `taskTarget` decides where future Tasks start and deliver. It's routing intent, not proof of delivery. It never retargets existing Tasks, changes the Epic's branch identity, or completes the Epic.

## Apply the approved strategy

During Epic planning, get the strategy approved and record it in reviewed `epic.md`. Apply it on acceptance:

- **Epic:** keep `taskTarget: epic`, or call `set_epic_task_target` with `target: epic`. The local Epic branch must exist.
- **Default:** call `set_epic_task_target` with `target: default`. The local Epic and default-target branches must exist. Delivery isn't required to select this intent.

**The setter:**

- takes no `epicDelivery`;
- leaves metadata unchanged when a branch, entity, or persistence check fails.

**Delivery:**

- Routing metadata is local and never committed. No metadata change is needed after a merge.
- A revision with default intent that isn't delivered still can't initialize a Task.

**Approvals:**

- Strategy approval and plan acceptance don't authorize a commit, push, PR, merge, fetch, reset, checkout, or cleanup. Each needs its own approval.
- Never delete an Epic branch that active Tasks still target.
- An existing Task keeps its copied start and target even after the parent's pointer changes.

## Choose delivery evidence

`preflight_task`, `init_github_task`, and `init_linear_task` share one delivery check for default-target Tasks. Pass `epicDelivery` only to these tools, and only when targeting default, never to the setter. The local Epic and target branches must exist in this clone.

### Local ancestry

Use `epicDelivery: { kind: "git-ancestry" }`, or omit it. Git must confirm that the current local Epic head is an ancestor of the stored local target.

- Epic planning commits nothing, so an Epic branch with no commits ahead of its target passes.
- Fast-forward and merge-commit delivery keep ancestry.
- Squash and rebase delivery usually don't, so use the GitHub route for them.
- Similar content or commit messages are not evidence.

### Merged GitHub PR

Use `epicDelivery: { kind: "github-pr", evidence: { tool, arguments, response } }`, with the configured forge's registered `pull_request_read` `get` call, its exact arguments, and the actual response.

- A tracker alone doesn't count as forge authority.
- When the planning PR number is unknown, find it through the configured tools. Stop for a user choice when ambiguous, and never create or replace a PR.

The validator requires:

- the configured server and operation, with read arguments for this repository and PR;
- a matching PR number and URL, base repository and stored target, and same-repository Epic head branch;
- a PR head SHA equal to the current local Epic branch SHA. New Epic commits need new delivery;
- `merged: true` and a merge timestamp.

**What this proves:**

- GitHub's confirmation is trusted as delivery evidence, so merge-commit, squash, and rebase all qualify without ancestry.
- The local source revision and target branch are checked.
- It doesn't prove that the local target contains the merge commit or every merged change.
- The guard never fetches or moves refs; sync branches only through separately approved operations.

**Rules:**

- Explicit PR evidence must pass its own route even when ancestry also holds.
- Invalid or unavailable evidence never falls back to another route or bypasses MCP permissions.
- No merged flag, response snapshot, or forge intent is saved to remember delivery.

## Initialize a Task

1. **Strategy.** Read the approved strategy and the current parent pointer. Resolve a missing or conflicting decision through the Epic skill's plan acceptance and routing step. The initial `taskTarget: epic` is not approval.
2. **Delivery.** Every new or adopted default-target Task revalidates the current Epic revision and its delivery evidence; recorded routing intent proves nothing. Pass current PR evidence again when using that route.
3. **Initialize.** Copy the parent's target into the Task's immutable start and target, and annotate its plan item once.

All other parent, item, hierarchy, Priority, persistence, and branch-readiness gates still apply. No Epic lifecycle change or remote operation is implied.
