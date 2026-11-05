# Tracker integration

The agent follows the [GitHub](../../../references/integrations/tracker/github.md) or [Linear](../../../references/integrations/tracker/linear.md) procedure and calls registered provider tools directly. Local context reads configuration and entity state; initialization records the tracker object and its Resource IDs. `linear.ts` owns setup's Linear API client: the read-only workspace inspection, the status defaults, and the status creates that the approved status setup runs.

- Configuration: [setup](../../../references/setup.md).
- Shared contract: [integration roles](../../../references/integrations/shared.md).
- Owned local IDs: `../resource-ids.ts` and `../resource-id-operations.ts`.
