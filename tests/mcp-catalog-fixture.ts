import type { McpToolCatalog, McpToolMetadata } from "../extensions/__lib/mcp.ts"

// Declared fixture names, not a reimplementation of Pi's name allocation.
export function fixtureToolName(server: string, operation: string): string {
    return `mcp__${server}__${operation}`
}

export function fixtureCatalog(...tools: McpToolMetadata[]): McpToolCatalog {
    return new Map(tools.map((tool) => [fixtureToolName(tool.serverName, tool.serverToolName), tool]))
}

const workflowOperations = [
    "issue_read",
    "issue_write",
    "add_issue_comment",
    "update_issue_comment",
    "projects_get",
    "projects_list",
    "projects_write",
    "create_pull_request",
    "pull_request_read",
    "update_pull_request",
    "merge_pull_request",
    "get_project",
    "get_issue",
    "save_project",
    "save_issue",
    "save_document",
    "get_document",
    "list_documents",
]

export function workflowMcpCatalog(...servers: string[]): McpToolCatalog {
    return fixtureCatalog(
        ...servers.flatMap((serverName) =>
            workflowOperations.map((serverToolName) => ({
                serverName,
                serverToolName,
                inputSchema: {},
            })),
        ),
    )
}
