import { getMcpToolName, type McpToolCatalog, type McpToolMetadata } from "../../../extensions/__lib/mcp.js"

const OPERATION_POLICIES = {
    inspect: { operation: "inspect", entity: false, tracker: "optional", forge: "optional", forgeCapabilities: true },
    queueIntake: {
        operation: "queueIntake",
        entity: false,
        tracker: "required",
        forge: "none",
        forgeCapabilities: false,
    },
    initialize: {
        operation: "initialize",
        entity: true,
        tracker: "optional",
        forge: "optional",
        forgeCapabilities: true,
    },
    resume: { operation: "resume", entity: true, tracker: "optional", forge: "optional", forgeCapabilities: true },
    artifactProjection: {
        operation: "artifactProjection",
        entity: true,
        tracker: "optional",
        forge: "none",
        forgeCapabilities: false,
    },
    artifactLinks: {
        operation: "artifactLinks",
        entity: true,
        tracker: "none",
        forge: "required",
        forgeCapabilities: false,
    },
    pullRequest: {
        operation: "pullRequest",
        entity: true,
        tracker: "none",
        forge: "required",
        forgeCapabilities: true,
    },
} as const
export type IntegrationOperation = keyof typeof OPERATION_POLICIES
export type IntegrationOperationPolicy = (typeof OPERATION_POLICIES)[IntegrationOperation]

export function resolveIntegrationOperationPolicy(operation: IntegrationOperation): IntegrationOperationPolicy {
    if (!Object.hasOwn(OPERATION_POLICIES, operation)) {
        throw new Error(`unhandled integration operation: ${JSON.stringify(operation)}`)
    }
    return { ...OPERATION_POLICIES[operation] }
}

export interface ToolRequirement {
    name: string
    properties: string[]
    methods?: string[]
}

export function validateRequirements(
    catalog: McpToolCatalog,
    mcpServer: string,
    provider: string,
    requirements: ToolRequirement[],
): Record<string, string> {
    const tools: Record<string, string> = {}
    for (const requirement of requirements) {
        const toolName = getMcpToolName(mcpServer, requirement.name)
        const metadata = catalog.get(toolName)
        if (!metadata) throw new Error(`configured ${provider} MCP server is missing required tool ${toolName}`)
        validateToolSchema(metadata, requirement)
        tools[capabilityKey(requirement.name)] = toolName
    }
    return tools
}

function validateToolSchema(metadata: McpToolMetadata, requirement: ToolRequirement): void {
    const properties = metadata.inputSchema.properties
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
        throw new Error(`${metadata.serverToolName} has no object input properties`)
    }
    const record = properties as Record<string, unknown>
    const missing = requirement.properties.filter((property) => !(property in record))
    if (missing.length > 0) {
        throw new Error(`${metadata.serverToolName} schema is missing: ${missing.join(", ")}`)
    }
    if (!requirement.methods) return

    const method = record.method
    if (!method || typeof method !== "object" || Array.isArray(method)) {
        throw new Error(`${metadata.serverToolName} schema has no method definition`)
    }
    const values = (method as { enum?: unknown }).enum
    if (!Array.isArray(values)) throw new Error(`${metadata.serverToolName} schema has no method enum`)
    const missingMethods = requirement.methods.filter((value) => !values.includes(value))
    if (missingMethods.length > 0) {
        throw new Error(`${metadata.serverToolName} schema is missing methods: ${missingMethods.join(", ")}`)
    }
}

function capabilityKey(toolName: string): string {
    return toolName.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}
