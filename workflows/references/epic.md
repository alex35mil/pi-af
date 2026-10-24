# Epic delivery and future Task targets

The Epic skill owns the user-approved Task delivery strategy recorded in reviewed `epic.md`. `taskTarget` selects where future Tasks start and deliver; it does not retarget existing Tasks, change the Epic branch identity, or complete the Epic lifecycle.

## Apply the approved strategy

- **Epic:** keep `taskTarget: epic`, or call `set_epic_task_target` with `target: epic` before new undelivered Epic work. The local Epic branch must exist. Supply no `epicDelivery` for this direction.
- **Default:** first deliver the accepted Epic work to its stored repository-default target through separately approved operations. Then call `set_epic_task_target` with `target: default` and the delivery route below. A failed guard leaves the pointer unchanged.

Strategy approval and plan acceptance do not authorize a commit, push, PR, merge, fetch, reset, checkout, or cleanup. Obtain the existing exact-operation approvals. Never delete an Epic branch still targeted by active Tasks. An existing Task always retains its copied start/target even after its parent's pointer changes.

## Select delivery evidence

The target-switch tool and `init_task`, `adopt_github_task`, and `adopt_linear_task` share the same current-revision delivery boundary for default targeting. Supply `epicDelivery` only for default targeting. Both local Epic and stored target branches must exist in the current clone.

### Local ancestry

Use `epicDelivery: { kind: "git-ancestry" }`, or omit the input for the existing ancestry behavior. Git must confirm that the current local Epic branch head is an ancestor of its stored local target.

Fast-forward and merge-commit delivery preserve this ancestry. Squash and rebase delivery do not generally preserve the original Epic commits, so use the verified GitHub route for non-ancestral delivery. Content similarity and commit messages are not delivery evidence.

### Merged GitHub PR

Use `epicDelivery: { kind: "github-pr", evidence: { tool, arguments, response } }` with the actual configured forge's registered `pull_request_read` call, `method: get`, its exact arguments, and actual decoded JSON or complete native MCP result. A tracker alone does not provide forge authority. Resolve the exact Epic planning PR through configured provider tools when its number is unknown; stop for user selection on ambiguity, without creating or replacing a PR.

The shared validator requires:

- Exact configured registered server/operation and read arguments for the repository and PR number.
- Matching response PR number/URL, base repository and stored target branch, and same-repository Epic head branch.
- PR head SHA equal to the current local Epic branch SHA; new Epic commits require new delivery.
- `merged: true` and a nonempty merge timestamp.

Trust that exact GitHub confirmation as delivery evidence. Merge-commit, squash, and rebase deliveries can all satisfy this contract without original-head ancestry. The local source revision and existing local target branch are checked, and versioned Task initialization also verifies the accepted plan below. This route does not independently prove that the local target contains the resulting merge commit or every merged implementation change. The guard never fetches or changes Git refs; synchronize local branches only through separately approved operations.

Explicit PR evidence must pass its route even when local ancestry also holds. Invalid or unavailable evidence never falls back to another route or bypasses MCP permissions. No merged boolean, provider-response snapshot, or forge-creation intent is saved merely to remember delivery.

## Initialize a Task

Read the approved strategy and current parent pointer before initialization. Resolve a missing or conflicting decision through the Epic skill's plan acceptance and switching flow; do not infer approval from the initial `taskTarget: epic`.

Default-target initialization revalidates the current Epic revision and delivery evidence; a past switch is not proof. Pass current-operation PR evidence again when selecting that route. In versioned mode, the working accepted parent `epic.md` blob must also exactly match the stored target branch's blob. This preserves accepted-plan reachability, including its current Task markers. Changed or missing target content blocks before Task branch/artifact creation and parent annotation. Unversioned artifacts retain their existing exclusion rules and need no versioned blob comparison.

After these checks, normal initialization copies the selected parent target into the Task's immutable start/target and annotates its selected plan item once. Existing parent, item, hierarchy, Priority, persistence, and branch-readiness gates remain in force. No Epic lifecycle transition or remote operation is implied.
