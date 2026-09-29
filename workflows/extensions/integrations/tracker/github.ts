import type { McpToolCatalog } from "../../../../extensions/__lib/mcp.js"
import type { GitHubTracker } from "../config.js"
import { type IntegrationOperation, type ToolRequirement, validateRequirements } from "../capabilities.js"

export const GITHUB_TRACKER_TOOL_NAMES = {
    issueRead: "issue_read",
    issueWrite: "issue_write",
    getLabel: "get_label",
    searchIssues: "search_issues",
    projectsList: "projects_list",
    projectsWrite: "projects_write",
    subIssueWrite: "sub_issue_write",
    listIssueFields: "list_issue_fields",
} as const

export const GITHUB_TRACKER_METHODS = {
    issueGet: "get",
    issueCreate: "create",
    issueUpdate: "update",
    projectFields: "list_project_fields",
    projectItems: "list_project_items",
    projectAddItem: "add_project_item",
    projectUpdateItem: "update_project_item",
    subIssueAdd: "add",
} as const

const TRACKER_REQUIREMENTS: ToolRequirement[] = [
    {
        name: GITHUB_TRACKER_TOOL_NAMES.issueRead,
        properties: ["method", "owner", "repo", "issue_number"],
        methods: ["get", "get_labels"],
    },
    {
        name: GITHUB_TRACKER_TOOL_NAMES.issueWrite,
        properties: ["method", "owner", "repo", "title", "body", "issue_number", "issue_fields", "labels"],
        methods: ["create", "update"],
    },
    {
        name: GITHUB_TRACKER_TOOL_NAMES.searchIssues,
        properties: ["query", "owner", "repo", "fields", "sort", "order"],
    },
    {
        name: GITHUB_TRACKER_TOOL_NAMES.projectsList,
        properties: ["method", "owner", "owner_type", "project_number", "field_names"],
        methods: ["list_project_fields", "list_project_items"],
    },
    {
        name: GITHUB_TRACKER_TOOL_NAMES.projectsWrite,
        properties: [
            "method",
            "owner",
            "owner_type",
            "project_number",
            "item_owner",
            "item_repo",
            "item_type",
            "issue_number",
            "updated_field",
        ],
        methods: ["add_project_item", "update_project_item"],
    },
    {
        name: GITHUB_TRACKER_TOOL_NAMES.subIssueWrite,
        properties: ["method", "owner", "repo", "issue_number", "sub_issue_id"],
    },
]

export function resolveGitHubTracker(
    catalog: McpToolCatalog,
    config: GitHubTracker,
    operation: IntegrationOperation,
    artifactMode: "versioned" | "unversioned" = "versioned",
) {
    try {
        const tools = validateGitHubTrackerCapabilities(catalog, config, operation, artifactMode)
        return {
            state: "enabled" as const,
            provider: "github" as const,
            config,
            tools,
            methods: GITHUB_TRACKER_METHODS,
            remoteValidation:
                operation === "artifactProjection" ? [] : buildGitHubRemoteValidationSteps(config, tools, artifactMode),
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

export function validateGitHubTrackerCapabilities(
    catalog: McpToolCatalog,
    config: GitHubTracker,
    operation: IntegrationOperation = "inspect",
    artifactMode: "versioned" | "unversioned" = "versioned",
) {
    const selected =
        operation === "artifactProjection"
            ? TRACKER_REQUIREMENTS.filter(
                  (requirement) =>
                      requirement.name === GITHUB_TRACKER_TOOL_NAMES.issueRead ||
                      requirement.name === GITHUB_TRACKER_TOOL_NAMES.issueWrite,
              )
            : TRACKER_REQUIREMENTS
    const requirements = selected.map((requirement) => {
        if (operation === "artifactProjection" && requirement.name === GITHUB_TRACKER_TOOL_NAMES.issueRead) {
            return { ...requirement, methods: ["get"] }
        }
        if (artifactMode === "unversioned" && requirement.name === GITHUB_TRACKER_TOOL_NAMES.issueWrite) {
            return { ...requirement, properties: ["method", "owner", "repo", "title", "body", "issue_number", "labels"] }
        }
        return requirement
    })
    if (
        operation === "inspect" ||
        operation === "initialize" ||
        operation === "resume" ||
        (operation === "queueIntake" && artifactMode === "versioned")
    ) {
        requirements.push({
            name: GITHUB_TRACKER_TOOL_NAMES.getLabel,
            properties: ["owner", "repo", "name"],
        })
    }
    if (
        operation !== "artifactProjection" &&
        (config.fields.priority.scope === "issue" ||
            (artifactMode === "versioned" && config.fields.internalId.scope === "issue"))
    ) {
        requirements.push({ name: GITHUB_TRACKER_TOOL_NAMES.listIssueFields, properties: ["owner", "repo"] })
    }
    return validateRequirements(catalog, config.mcpServer, "GitHub", requirements)
}

export function buildGitHubRemoteValidationSteps(
    config: GitHubTracker,
    tools: Record<string, string>,
    artifactMode: "versioned" | "unversioned" = "versioned",
): string[] {
    const projectFields = [config.fields.status.field]
    if (config.fields.priority.scope === "project") projectFields.push(config.fields.priority.field)
    if (artifactMode === "versioned" && config.fields.internalId.scope === "project") {
        projectFields.push(config.fields.internalId.field)
    }
    const projectPriorityRequirement =
        config.fields.priority.scope === "project" ? " Require every configured Priority option." : ""
    const steps = [
        `Use ${tools.projectsList} method=list_project_fields for ${config.project.owner} project ${config.project.number}; require exact Project fields ${projectFields.map((field) => JSON.stringify(field)).join(", ")} with compatible types and every configured Status option.${projectPriorityRequirement}`,
    ]
    if (tools.getLabel) {
        steps.push(
            `Use ${tools.getLabel} for ${config.repository.owner}/${config.repository.repo} label ${JSON.stringify(config.labels.planning)}; require that exact configured Planning label.`,
        )
        if (artifactMode === "versioned") {
            const kindLabels = [config.labels.kind.epic, ...Object.values(config.labels.kind.deliverableKinds)]
            steps.push(
                `Use ${tools.getLabel} once for each configured Kind label in ${config.repository.owner}/${config.repository.repo}: ${kindLabels.map((label) => JSON.stringify(label)).join(", ")}; require every exact label.`,
            )
        }
    }
    if (
        config.fields.priority.scope === "issue" ||
        (artifactMode === "versioned" && config.fields.internalId.scope === "issue")
    ) {
        const fields = [
            ...(config.fields.priority.scope === "issue" ? [config.fields.priority.field] : []),
            ...(artifactMode === "versioned" && config.fields.internalId.scope === "issue"
                ? [config.fields.internalId.field]
                : []),
        ]
        steps.push(
            `Use ${tools.listIssueFields} for ${config.repository.owner}/${config.repository.repo}; require exact issue fields ${fields.map((field) => JSON.stringify(field)).join(", ")} and compatible field types/options.`,
        )
    }
    return steps
}
