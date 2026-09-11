# MCP Extension

Connects to [Model Context Protocol](https://modelcontextprotocol.io/) servers and registers their tools with pi.

## Configuration

Settings file: `mcp.settings.json` (3-tier loading):

| Tier    | Path                                          |
| ------- | --------------------------------------------- |
| Global  | `~/<agent-dir>/mcp.settings.json`             |
| Project | `<repo-root>/.agents/mcp.settings.json`       |
| Local   | `<repo-root>/.agents/mcp.settings.local.json` |

### Local stdio servers

```json
{
    "servers": {
        "playwright": {
            "command": "npx",
            "args": ["-y", "@playwright/mcp@latest"],
            "env": { "KEY": "value" }
        }
    }
}
```

### Remote Streamable HTTP servers

```json
{
    "servers": {
        "github": {
            "url": "https://api.githubcopilot.com/mcp/",
            "headers": {
                "Authorization": "Bearer ${GITHUB_TOKEN}",
                "X-MCP-Toolsets": "repos,issues,pull_requests"
            }
        }
    }
}
```

Remote URLs must use `http:` or `https:`. Header values can reference environment variables with `${NAME}`; connection fails if a referenced variable is unset. Export the token before starting pi, for example:

```sh
export GITHUB_TOKEN="..."
```

Each entry must contain exactly one transport: `command` for stdio or `url` for Streamable HTTP. Server names and discovered tool names must contain only ASCII letters, digits, `_`, `.`, or `-`.

## Behavior

- Servers are connected and their tools discovered on session start (in parallel)
- Failed connections, tool listings, and invalid names are logged; affected clients are closed and excluded
- Tool metadata, including complete MCP annotations, is published atomically before tools are registered
- MCP annotations are untrusted, self-declared metadata; every permission hint selector trusts the selected server and can override `defaultMode`, including `ask` over `defaultMode: deny`; use hint selectors only for servers you trust
- Generated-name collisions abort the whole catalog: all new clients are closed and no MCP tools are registered
- Successful connections show a widget with tool counts
- On session shutdown, all MCP clients are closed gracefully

## Dependencies

- `@modelcontextprotocol/sdk` — MCP client implementation
