import * as fs from "node:fs"
import * as path from "node:path"
import { isDeepStrictEqual } from "node:util"

import { Type } from "typebox"
import { Value } from "typebox/value"

import { validateMcpName } from "../../../extensions/__lib/mcp.js"
import { getExtensionSettingsPaths, resolveRootDir } from "../../../extensions/__lib/project.js"
import { readMcpSettings } from "../__lib/mcp.js"
import { ensureLocalSettingsExclusion } from "./local-settings.js"

export const LOCAL_MCP_SETTINGS_EXCLUDE = "/.agents/mcp.settings.local.json"

const EnvironmentNameSchema = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" })
const ServerNameSchema = Type.String({ minLength: 1, pattern: "^[A-Za-z0-9_.-]+$" })
const SettingsTargetSchema = Type.Union([Type.Literal("project"), Type.Literal("local")])
const GitHubRoleSchema = Type.Union([Type.Literal("tracker"), Type.Literal("forge")])

const LinearRegistrationSchema = Type.Object(
    {
        provider: Type.Literal("linear"),
        name: ServerNameSchema,
        credentialEnv: EnvironmentNameSchema,
    },
    { additionalProperties: false },
)

const GitHubRegistrationSchema = Type.Object(
    {
        provider: Type.Literal("github"),
        name: ServerNameSchema,
        credentialEnv: EnvironmentNameSchema,
        roles: Type.Array(GitHubRoleSchema, { minItems: 1, uniqueItems: true }),
    },
    { additionalProperties: false },
)

export const ProjectMcpConfigurationSchema = Type.Object(
    {
        target: SettingsTargetSchema,
        registrations: Type.Array(Type.Union([LinearRegistrationSchema, GitHubRegistrationSchema]), {
            minItems: 1,
        }),
    },
    { additionalProperties: false },
)

export type ProjectMcpConfiguration = Type.Static<typeof ProjectMcpConfigurationSchema>
type Registration = ProjectMcpConfiguration["registrations"][number]
type SettingsTarget = ProjectMcpConfiguration["target"]

export function configureProjectMcp(cwd: string, input: unknown, options: { globalSettingsPath?: string } = {}) {
    const parsed = Value.Parse(ProjectMcpConfigurationSchema, input)
    const root = resolveRootDir(cwd)
    const resolvedPaths = getExtensionSettingsPaths("mcp", root)
    const paths = {
        ...resolvedPaths,
        global: options.globalSettingsPath ?? resolvedPaths.global,
    }
    const settings = {
        global: readMcpSettings(paths.global),
        project: readMcpSettings(paths.project),
        local: readMcpSettings(paths.local),
    }
    const names = new Set<string>()
    const additions: Array<{ registration: Registration; config: Record<string, unknown> }> = []

    for (const registration of parsed.registrations) {
        validateMcpName("server", registration.name)
        if (names.has(registration.name)) {
            throw new Error(`duplicate requested MCP server ${JSON.stringify(registration.name)}`)
        }
        names.add(registration.name)

        const config = registrationConfig(registration)
        for (const tier of ["global", "project", "local"] as const) {
            const existing = settings[tier].servers?.[registration.name]
            if (existing === undefined) continue
            if (tier === parsed.target && isDeepStrictEqual(existing, config)) continue
            throw new Error(
                `MCP server ${JSON.stringify(registration.name)} is already configured in the ${tier} settings; reuse it or choose another name`,
            )
        }
        additions.push({ registration, config })
    }

    const changedTargets = new Set<SettingsTarget>()
    for (const { registration, config } of additions) {
        const target = settings[parsed.target]
        target.servers ??= {}
        if (target.servers[registration.name] === undefined) {
            target.servers[registration.name] = config
            changedTargets.add(parsed.target)
        }
    }

    if (parsed.target === "local") {
        ensureLocalSettingsExclusion(root, ".agents/mcp.settings.local.json", LOCAL_MCP_SETTINGS_EXCLUDE)
    }
    for (const target of ["project", "local"] as const) {
        if (!changedTargets.has(target)) continue
        fs.mkdirSync(path.dirname(paths[target]), { recursive: true })
        fs.writeFileSync(paths[target], `${JSON.stringify(settings[target], null, 4)}\n`)
    }

    return {
        changed: [...changedTargets],
        files: [...changedTargets].map((target) => path.relative(root, paths[target])),
        servers: parsed.registrations.map(({ name, provider, credentialEnv }) => ({
            name,
            provider,
            target: parsed.target,
            credentialEnv,
        })),
        restartRequired: changedTargets.size > 0,
    }
}

function registrationConfig(registration: Registration): Record<string, unknown> {
    const authorization = `Bearer \${${registration.credentialEnv}}`
    if (registration.provider === "linear") {
        return {
            url: "https://mcp.linear.app/mcp",
            headers: { Authorization: authorization },
        }
    }

    const roles = new Set(registration.roles)
    const toolsets = [
        ...(roles.has("tracker") ? ["issues", "projects"] : []),
        ...(roles.has("forge") ? ["pull_requests"] : []),
    ]
    return {
        url: "https://api.githubcopilot.com/mcp/",
        headers: {
            Authorization: authorization,
            "X-MCP-Toolsets": toolsets.join(","),
        },
    }
}
