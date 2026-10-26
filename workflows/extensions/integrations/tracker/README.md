# Tracker integration

The agent follows the [GitHub](../../../references/integrations/tracker/github.md) or [Linear](../../../references/integrations/tracker/linear.md) procedure and calls registered provider tools directly. Local context reads configuration and entity state; initialization records the tracker object and its Resource IDs. `linear.ts` owns the read-only Linear workspace inspection used by setup.

- Configuration: [setup](../../../references/setup.md).
- Shared contract: [integration roles](../../../references/integrations/shared.md).
- Owned local IDs: `../resource-ids.ts` and `../resource-id-operations.ts`.
