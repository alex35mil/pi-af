# Integrations

Registers `/backlog`, `/todo`, read-only `integration_context`, interruption-safe `finalize_linear_branch`, entity-aware `render_provider_body`, and pure `verify_artifact_projection`. Provider mutations remain direct calls to Pi-registered MCP tools under normal permission enforcement.

`integration_context` consumes Pi's MCP catalog and returns operation-specific configuration, capabilities, and workflow/forge policies. `inspect` also lists registered servers before integration configuration exists. Tracker and forge availability are evaluated independently.

- Configuration: [setup](../../references/setup.md).
- Operational contracts: [shared integration rules](../../references/integrations/shared.md) and [Queue](../../references/queue.md).
- Implementations: [tracker](tracker/README.md), [forge](forge/README.md), `config.ts` (strict role configuration), `records.ts` (provider records and invariants), `mcp.ts` (official provider-registration recognition), `policy.ts` (tracker/forge authority and artifact policy), `capabilities.ts`, and `projection.ts` (provider-body rendering and exact Markdown verification).
