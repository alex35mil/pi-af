# Tracker integration

The agent follows the [GitHub](../../../references/integrations/tracker/github.md) or [Linear](../../../references/integrations/tracker/linear.md) procedure and calls registered provider tools directly. Local context reads configuration/authority/entity state; `../creation.ts` and Resource IDs helpers record actual identities. `linear.ts` owns branch finalization from the durable exact saved-name contract.

- Configuration: [setup](../../../references/setup.md).
- Shared contract: [integration roles](../../../references/integrations/shared.md).
- Owned local IDs: `../resource-ids.ts` and `../resource-id-operations.ts`.
