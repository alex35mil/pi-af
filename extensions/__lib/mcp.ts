import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"

export const MCP_TOOL_CATALOG_EVENT = "mcp:tool-catalog"

const MCP_TOOL_NAMESPACE = "mcp"
const MCP_TOOL_NAME_SEPARATOR = "__"
const MCP_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/

export interface McpToolMetadata {
    serverName: string
    serverToolName: string
    inputSchema: Readonly<Record<string, unknown>>
    annotations?: ToolAnnotations
}

export type McpToolCatalog = ReadonlyMap<string, McpToolMetadata>

export function validateMcpName(kind: "server" | "tool", name: string): void {
    if (!MCP_NAME_PATTERN.test(name)) {
        throw new Error(`invalid MCP ${kind} name ${JSON.stringify(name)}; expected [A-Za-z0-9_.-]+`)
    }
}

export function getMcpToolName(serverName: string, toolName: string): string {
    return [MCP_TOOL_NAMESPACE, serverName, toolName].join(MCP_TOOL_NAME_SEPARATOR)
}
