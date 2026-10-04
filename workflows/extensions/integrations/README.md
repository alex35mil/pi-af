# Integrations

Registers `/backlog`, `/todo`, local `integration_context`, local `resource_ids`, `finalize_linear_branch`, `render_provider_body`, and `verify_artifact_projection`. The agent makes provider calls through registered MCP tools under normal permissions. The harness reads/writes owned configuration, metadata, artifacts and Resource IDs; it does not execute or model provider-call sequences.

`integration_context` returns local configuration, authority and entity state for the selected tracker/forge role. Provider-tool schemas belong to the MCP bridge. For `finishMerge`, the context checks actual exact PR-get evidence against the recorded PR number and local source SHA, returning fixed expected-head squash arguments, complete merged proof or a blocked decision.

`resource_ids` uses scoped IDs/URLs from `.local/metadata.json` and records actual adoption, mutation or required-read evidence. Missing/stale IDs require agent investigation. Scoped cache mutation is queued/atomic, preserves unrelated entries and remains outside Git in both artifact modes; the operation memo resets on context/shutdown/reload.

Before submission, forge `beginCreation` saves immutable repository/head/target intent for the one commit. After one native PR-create call, `recordCreation` writes returned number/URL directly to the IDs file. Explicit `select` updates that same file. Neither operation changes versioned metadata after submission or creates another artifact. Uncertain outcomes require agent investigation before retry. See [Migrations](../../MIGRATIONS.md) for resume-time conversion of an old-format entity.

- Configuration: [setup](../../references/setup.md).
- Procedures: [shared integrations](../../references/integrations/shared.md), [Queue](../../references/queue.md), [tracker](tracker/README.md) and [forge](forge/README.md).
- Owned-data implementations: `config.ts`, `records.ts`, `mcp.ts`, `policy.ts`, `resource-ids.ts`, `resource-id-operations.ts`, `resource-id-tool.ts`, `creation.ts`, `projection.ts` and `tracker/linear.ts` (branch finalization).
