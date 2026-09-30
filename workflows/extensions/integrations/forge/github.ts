import type { McpToolCatalog } from "../../../../extensions/__lib/mcp.js"
import type { GitHubForge } from "../config.js"
import { type ToolRequirement, validateRequirements } from "../capabilities.js"

export const GITHUB_FORGE_TOOL_NAMES = {
    createPullRequest: "create_pull_request",
    listPullRequests: "list_pull_requests",
    pullRequestRead: "pull_request_read",
    updatePullRequest: "update_pull_request",
} as const

export const GITHUB_FORGE_METHODS = { pullRequestGet: "get" } as const

const FORGE_REQUIREMENTS: ToolRequirement[] = [
    {
        name: GITHUB_FORGE_TOOL_NAMES.createPullRequest,
        properties: ["owner", "repo", "title", "body", "head", "base"],
    },
    {
        name: GITHUB_FORGE_TOOL_NAMES.listPullRequests,
        properties: ["owner", "repo", "head", "base", "state"],
    },
    {
        name: GITHUB_FORGE_TOOL_NAMES.pullRequestRead,
        properties: ["method", "owner", "repo", "pullNumber"],
        methods: [GITHUB_FORGE_METHODS.pullRequestGet],
    },
    {
        name: GITHUB_FORGE_TOOL_NAMES.updatePullRequest,
        properties: ["owner", "repo", "pullNumber", "body"],
    },
]

export function resolveGitHubForge(catalog: McpToolCatalog, config: GitHubForge, validateCapabilities: boolean) {
    try {
        const tools = validateCapabilities ? validateGitHubForgeCapabilities(catalog, config) : {}
        return {
            state: "enabled" as const,
            provider: "github" as const,
            config,
            tools,
            methods: GITHUB_FORGE_METHODS,
            remoteValidation: [] as string[],
        }
    } catch (error) {
        return {
            state: "unavailable" as const,
            provider: "github" as const,
            config,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

export function validateGitHubForgeCapabilities(catalog: McpToolCatalog, config: GitHubForge) {
    return validateRequirements(catalog, config.mcpServer, "GitHub", FORGE_REQUIREMENTS)
}
