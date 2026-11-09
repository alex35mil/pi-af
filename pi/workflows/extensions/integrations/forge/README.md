# Forge integration

The agent follows the [GitHub forge procedure](../../../references/integrations/forge/github.md) and calls registered provider tools directly. The named integration context tools read local role configuration; Resource IDs recording/selection uses the existing ignored IDs file. Exact shipping-evidence checks live in `../resource-id-operations.ts`; branch cleanup lives in `../../deliverable/cleanup.ts`.

GitHub-specific implementations live in `github/`. `github/merge.ts` owns the single shared repository merge operation used by Deliverable and incoming PR shipping.

[Incoming PR handling](../../../references/pr/incoming.md) uses the distinct `github/incoming-pr-context.ts` identity/evidence model and entity-independent `inspect_incoming_pr_context` tool. It resolves URLs or `#NN` only for the current configured repository, distinguishes fork head repositories from the base repository, and keeps private review evidence outside Git without adopting a workflow-created branch contract. `github/incoming-pr-merge.ts` validates reviewed/fresh evidence before the shared merge operation; `github/incoming-pr-project.ts` handles scoped GitHub Project membership and Status. Native provider calls remain explicit agent operations under normal permissions.

See [configuration](../../../references/setup.md). The harness creates no provider-call program or approval/progress token.
