# Integrations

Registers `/backlog`, `/todo`, read-only `integration_context`, interruption-safe `finalize_linear_branch`, and the pure `render_artifact_links` and `verify_artifact_projection` tools. Provider mutations remain direct calls to Pi-registered MCP tools under normal permission enforcement.

`integration_context` consumes Pi's MCP catalog and returns operation-specific configuration, capabilities, workflow/forge policies, and the shared Links model. `inspect` also lists registered servers before integration configuration exists. Tracker and forge availability are evaluated independently.

- Configuration: [setup](../../references/setup.md).
- Operational contracts: [shared integration rules](../../references/integrations/shared.md) and [Queue](../../references/queue.md).
- Implementations: [tracker](tracker/README.md), [forge](forge/README.md), `config.ts` (strict role configuration), `records.ts` (provider records and invariants), `mcp.ts` (official provider-registration recognition), `policy.ts` (tracker/forge authority and artifact policy), `capabilities.ts`, `links.ts` (link model, strict input schema, and canonical Markdown renderer), and `projection.ts`.
