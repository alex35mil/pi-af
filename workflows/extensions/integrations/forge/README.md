# Forge integration

The agent follows the [GitHub forge procedure](../../../references/integrations/forge/github.md) and calls registered provider tools directly. `integration_context` reads local role configuration; Resource IDs recording/selection uses the existing ignored IDs file. Exact finish-evidence checks live in `../resource-id-operations.ts`; branch cleanup lives in `../../deliverable/cleanup.ts`.

See [configuration](../../../references/setup.md). The harness creates no provider-call program or separate PR-progress artifact.
