import * as fs from "node:fs"

import { Type } from "typebox"
import { Value } from "typebox/value"

import { getMcpSettingsPaths, readMcpConfiguration, readMcpSettings } from "../../../extensions/__lib/mcp.js"

export type WorkflowMcpService = "github" | "linear" | "other"

export function identifyMcpService(config: unknown): WorkflowMcpService {
    if (!config || typeof config !== "object" || !("url" in config)) return "other"
    if (config.url === "https://api.githubcopilot.com/mcp/") return "github"
    if (config.url === "https://mcp.linear.app/mcp") return "linear"
    return "other"
}

const ProviderRegistrationSchema = Type.Record(Type.String(), Type.Unknown())

export function inspectProjectMcp(cwd: string, projectTrusted: boolean) {
    const paths = getMcpSettingsPaths(cwd)
    const tiers = (["global", "project", "local"] as const).map((tier) =>
        tier !== "global" && !projectTrusted
            ? { tier, path: paths[tier], state: "untrusted" as const }
            : inspectSettingsFile(tier, paths[tier]),
    )
    try {
        const configured = readMcpConfiguration(cwd, projectTrusted)
        return {
            tiers,
            effectiveServers: configured.servers.map(({ name, config, tier }) => ({
                ...inspectServer(name, config),
                source: tier,
            })),
        }
    } catch (error) {
        return {
            tiers,
            effectiveServers: [],
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

export function registeredCredentialEnvironment(
    cwd: string,
    serverName: string,
    provider: "linear" | "github",
    projectTrusted: boolean,
): string {
    const inspection = inspectProjectMcp(cwd, projectTrusted)
    if (inspection.error) throw new Error(inspection.error)
    const server = inspection.effectiveServers.find((candidate) => candidate.name === serverName)
    if (!server) throw new Error(`MCP server ${JSON.stringify(serverName)} is not configured`)
    if (server.provider !== provider) {
        throw new Error(`MCP server ${JSON.stringify(serverName)} is not a recognized ${provider} registration`)
    }
    if (!server.credentialEnv) {
        throw new Error(
            `MCP server ${JSON.stringify(serverName)} does not expose a recognized credential environment reference`,
        )
    }
    return server.credentialEnv
}

function inspectSettingsFile(tier: "global" | "project" | "local", filePath: string) {
    if (!fs.existsSync(filePath)) return { tier, path: filePath, state: "absent" as const }
    try {
        const settings = readMcpSettings(filePath)
        const servers = Object.entries(settings.mcpServers ?? {}).map(([name, config]) => inspectServer(name, config))
        return {
            tier,
            path: filePath,
            state: "valid" as const,
            serverNames: servers.map(({ name }) => name),
            servers,
        }
    } catch (error) {
        return {
            tier,
            path: filePath,
            state: "invalid" as const,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

function inspectServer(name: string, value: unknown) {
    if (!Value.Check(ProviderRegistrationSchema, value)) return { name }
    const service = identifyMcpService(value)
    const provider = service === "other" ? undefined : service
    const headers = Value.Check(ProviderRegistrationSchema, value.headers) ? value.headers : undefined
    const authorization = headers?.Authorization
    const credentialMatch =
        typeof authorization === "string" ? /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(authorization) : undefined
    return {
        name,
        ...(provider ? { provider } : {}),
        ...(credentialMatch ? { credentialEnv: credentialMatch[1] } : {}),
    }
}
