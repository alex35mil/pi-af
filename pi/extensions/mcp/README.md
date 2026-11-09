# MCP Extension

Composes Pi 1.3.0's native MCP support with pi-af's tool metadata and decorators. Pi owns connections, authentication, discovery, resources, execution, result conversion, and shutdown. Registering `/mcp` through this composition replaces the built-in extension; it does not start a second transport.

## Configuration

| Source                | Path                                 | Root key     |
| --------------------- | ------------------------------------ | ------------ |
| Global                | `<agent-dir>/mcp.json`               | `mcpServers` |
| Committed project     | `<repo-root>/.agents/mcp.json`       | `mcpServers` |
| Private project-local | `<repo-root>/.agents/mcp.local.json` | `mcpServers` |

The adapter merges global, project, then local settings by exact server name; a later entry replaces the whole earlier entry. Global settings load independently of project trust; both project tiers require trust. Names differing only by `-` and `_` conflict rather than overriding one another. Keep private project registrations outside Git; setup ensures exact `/.agents/mcp.local.json` in `.git/info/exclude`. They are never moved into global configuration.

Every effective server is registered through `pi.registerMcpServer()`. The composed native extension consumes those registrations without discovering another set of project files. `/mcp` retains native connection management; enabled/exposure changes to registered servers last for the session. Native `pi mcp` shell commands do not load this adapter or manage its project tiers.

Example for any tier:

```json
{
    "mcpServers": {
        "tools": {
            "url": "https://example.com/mcp",
            "headers": { "Authorization": "Bearer ${TOOLS_TOKEN}" },
            "exposure": "codemode"
        }
    }
}
```

Pi validates native per-server settings and resolves credentials. Stdio entries use `command`, `args`, `env`, and `cwd`. HTTP entries use `url`, `headers`, and native OAuth settings. Server names contain letters, digits, `_`, and `-`. The top-level `autoEnableCodemode` follows the same tier precedence and defaults to native behavior.

Use `/reload` after configuration changes in a compatible harness. See the [breaking settings migration](../../UPGRADING.md#pi-130) before activating this version.

## Native behavior

- Connections start in the background when the session starts. Pi retains readiness waits and reconnect behavior.
- Server exposure is `codemode` by default; `deferred`, `direct`, and `hidden` are also supported, with native per-tool overrides.
- `codemode` and deferred discovery reach the same native definitions and permission hooks as direct calls.
- Native structured results, errors, progress, resource handling, namespaces, renderers, and output schemas are preserved.
- Native tool names can be normalized or shortened with hashes. The catalog records actual registered names and original server/tool identity separately.
- A fresh catalog snapshot is published before each available definition is registered. Hidden and withdrawn definitions leave the available catalog; shutdown clears it.
- Annotation hints are untrusted declarations. Read-only permission selectors match only an explicitly true hint.

## Tool decorators

Subscribe to `MCP_TOOL_DECORATORS_EVENT` from [the shared MCP contract](../__lib/mcp.ts). Its `use(decorator)` method accepts a synchronous callback receiving the complete native definition, original identity/pre-decoration input schema/annotation hints, and transport identity (`stdio`, or `streamable-http` with its URL). Headers and environment values are not included.

Decorators execute outside the event emitter, before catalog publication and registration. They can wrap execution or extend the agent-facing schema and description while preserving the tool name and remaining native fields. Each native registration starts from its fresh definition, so dynamic registration does not stack wrappers. Decorator failures propagate through native registration.

Install listeners during factory loading and dispose them on shutdown. There is no process-global decorator registry. Workflow publication policy remains outside this provider-neutral integration.
