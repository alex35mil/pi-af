# GitHub forge

First follow `../shared.md`.

## Artifact links

Unversioned mode returns an explicit skip before forge configuration, capability, or branch checks and produces no `.project/` links. In versioned mode, artifact links require configured `roles.forge` provider `github`. For each approved artifact, prove a containing commit in repository history, then generate:

- permanent: `https://github.com/<owner>/<repo>/blob/<commit-sha>/<path>`;
- convenience: `https://github.com/<owner>/<repo>/blob/<stored-target>/<path>`.

Verify whether the convenience URL resolves from the target branch. Omit both links while uncommitted. Pass every available repository entry and its target availability to `render_artifact_links` using the shared destination contract. `artifactProjection` remains a separate operation that requires only the tracker role when a tracker exists.

## Pull requests

When entity metadata has no forge record, use returned `listPullRequests` with the exact stored branch `name` as head and stored `target` as base before proposing creation and on every resume. One exact open match is the entity's PR: verify it with `pullRequestRead` method `get`, then store only `{ role: "forge", provider: "github", pullRequest: { number, url } }`. Stop for user direction if results are ambiguous.

During full submission authorized by `../../deliverable.md`, use its final approved commit and exact title/body contract:

1. Require a ready stored branch, push only that branch to `origin`, then repeat the exact head/base lookup. A unique open match is success and is verified/stored without creating another PR.
2. When no match exists, call returned `createPullRequest` once with the approved title/body, stored branch `name` as head, and stored `target` as base.
3. On confirmed success, verify the PR with `pullRequestRead` method `get`, then store `{ role: "forge", provider: "github", pullRequest: { number, url } }` in entity metadata.
4. If creation has an unknown outcome, repeat the exact head/base lookup. Store the unique verified match; when none exists, leave metadata unchanged. Never blindly repeat creation.

Keep lifecycle `inReview` while the PR is open or receiving revisions. To verify delivery, call returned `pullRequestRead` with method `get`, the configured repository, and the stored PR number. Require `merged: true`, exact stored `head.ref`/`base.ref`, exact current-clone branch `head.sha`, `merged_at`, and `merge_commit_sha` before allowing `done`; then update lifecycle through the tracker when configured or authoritative `.local/status.md` otherwise. This verified PR result is the squash/rebase-safe merge evidence supplied to `cleanup_delivery_branch`.

Do not push, create a PR, merge, close, delete branches, or use a worktree without explicit approval for that operation or set. After explicit cleanup approval, `cleanup_delivery_branch` may delete only the Deliverable branch in the current clone; it never deletes the remote branch or changes the stored branch contract.
