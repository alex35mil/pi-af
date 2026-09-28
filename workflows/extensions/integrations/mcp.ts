import * as fs from "node:fs"

import { Type } from "typebox"
import { Value } from "typebox/value"

import { getExtensionSettingsPaths } from "../../../extensions/__lib/project.js"
import { readMcpSettings } from "../__lib/mcp.js"

const ProviderRegistrationSchema = Type.Record(Type.String(), Type.Unknown())

export function inspectProjectMcp(cwd: string) {
    const paths = getExtensionSettingsPaths("mcp", cwd)
    const tiers = (["global", "project", "local"] as const).map((tier) => inspectSettingsFile(tier, paths[tier]))
    const effective = new Map<
        string,
        {
            name: string
            source: "global" | "project" | "local"
            provider?: "linear" | "github"
            credentialEnv?: string
        }
    >()
    for (const tier of tiers) {
        if (tier.state !== "valid") continue
        for (const server of tier.servers) effective.set(server.name, { ...server, source: tier.tier })
    }
    return {
        tiers,
        effectiveServers: [...effective.values()],
    }
}

export function registeredCredentialEnvironment(
    cwd: string,
    serverName: string,
    provider: "linear" | "github",
): string {
    const server = inspectProjectMcp(cwd).effectiveServers.find((candidate) => candidate.name === serverName)
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
        const servers = Object.entries(settings.servers ?? {}).map(([name, config]) => inspectServer(name, config))
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
    const provider =
        value.url === "https://mcp.linear.app/mcp"
            ? ("linear" as const)
            : value.url === "https://api.githubcopilot.com/mcp/"
              ? ("github" as const)
              : undefined
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
