/**
 * MCP Extension
 *
 * Connects to MCP servers and registers their tools with pi.
 *
 * Settings file: mcp.settings.json (same 3-tier loading as permission extension)
 *   ~/<agent-dir>/mcp.settings.json             (global)
 *   <repo-root>/.agents/mcp.settings.json       (project, committed)
 *   <repo-root>/.agents/mcp.settings.local.json (project, gitignored)
 *
 * Schema:
 * {
 *   "servers": {
 *     "local": {
 *       "command": "npx",
 *       "args": ["-y", "@playwright/mcp@latest"],
 *       "env": { "KEY": "value" }
 *     },
 *     "remote": {
 *       "url": "https://example.com/mcp",
 *       "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
 *     }
 *   }
 * }
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { ParseError, Value } from "typebox/value"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import {
    getMcpToolName,
    MCP_TOOL_CATALOG_EVENT,
    type McpToolCatalog,
    type McpToolMetadata,
    validateMcpName,
} from "../__lib/mcp.js"
import * as project from "../__lib/project.js"

const EXTENSION = "mcp"

const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

const StringRecordSchema = Type.Record(Type.String(), Type.String())
const StdioServerConfigSchema = Type.Object(
    {
        command: Type.String({ minLength: 1 }),
        args: Type.Optional(Type.Array(Type.String())),
        env: Type.Optional(StringRecordSchema),
    },
    { additionalProperties: false },
)
const RemoteServerConfigSchema = Type.Object(
    {
        url: Type.String({ minLength: 1 }),
        headers: Type.Optional(StringRecordSchema),
    },
    { additionalProperties: false },
)
export const ServerConfigSchema = Type.Union([StdioServerConfigSchema, RemoteServerConfigSchema])
export type ServerConfig = Type.Static<typeof ServerConfigSchema>

type ResolvedServerConfig =
    | { type: "stdio"; config: Type.Static<typeof StdioServerConfigSchema> }
    | {
          type: "streamable-http"
          url: URL
          headers?: Type.Static<typeof StringRecordSchema>
      }

interface UnvalidatedMcpSettings {
    servers?: Record<string, unknown>
}

export default function (pi: ExtensionAPI) {
    const settings = loadSettings(process.cwd())
    const servers = settings.servers ?? {}

    if (Object.keys(servers).length === 0) return
    registerMcpServers(pi, servers)
}

type McpClient = Pick<Client, "connect" | "listTools" | "callTool" | "close">
type McpTool = Awaited<ReturnType<McpClient["listTools"]>>["tools"][number]
type CreateMcpClient = (name: string) => McpClient

interface DiscoveredServer {
    name: string
    client: McpClient
    tools: McpTool[]
}

export function registerMcpServers(
    pi: Pick<ExtensionAPI, "events" | "on" | "registerTool">,
    servers: Record<string, unknown>,
    createClient: CreateMcpClient = (name) =>
        new Client({
            name: `pi-mcp-${name}`,
            version: "0.1.0",
        }),
) {
    const clients = new Map<string, McpClient>()

    async function closeClient(name: string, client: McpClient) {
        clients.delete(name)
        try {
            await client.close()
        } catch {
            console.error(`[mcp] Failed to close "${name}"`)
        }
    }

    async function closeClients() {
        await Promise.all([...clients].map(([name, client]) => closeClient(name, client)))
    }

    async function discoverServer(name: string, config: unknown): Promise<DiscoveredServer> {
        validateMcpName("server", name)
        const transport = createServerTransport(config)
        const client = createClient(name)

        try {
            await client.connect(transport)
            clients.set(name, client)

            const { tools } = await client.listTools()
            for (const tool of tools) validateMcpName("tool", tool.name)
            return { name, client, tools }
        } catch (error) {
            await closeClient(name, client)
            throw error
        }
    }

    function buildCatalog(discoveredServers: DiscoveredServer[]): McpToolCatalog {
        const catalog = new Map<string, McpToolMetadata>()

        for (const server of discoveredServers) {
            for (const tool of server.tools) {
                const toolName = getMcpToolName(server.name, tool.name)
                if (catalog.has(toolName)) throw new Error(`duplicate MCP tool name ${JSON.stringify(toolName)}`)

                catalog.set(toolName, {
                    serverName: server.name,
                    serverToolName: tool.name,
                    inputSchema: structuredClone(tool.inputSchema as Record<string, unknown>),
                    annotations: tool.annotations ? { ...tool.annotations } : undefined,
                })
            }
        }

        return catalog
    }

    function registerTool(server: DiscoveredServer, tool: McpTool) {
        const toolName = getMcpToolName(server.name, tool.name)
        const params = jsonSchemaToTypebox(tool.inputSchema as Record<string, unknown>)

        pi.registerTool({
            name: toolName,
            label: tool.annotations?.title ?? tool.name,
            description: tool.description ?? `MCP tool from ${server.name}: ${tool.name}`,
            parameters: params,

            async execute(_toolCallId, execParams, signal) {
                const result = await server.client.callTool(
                    {
                        name: tool.name,
                        arguments: execParams as Record<string, unknown>,
                    },
                    undefined,
                    signal ? { signal } : undefined,
                )

                if ("content" in result) {
                    const content = (result.content as Array<Record<string, unknown>>).map((item) => {
                        if (item.type === "text") {
                            return {
                                type: "text" as const,
                                text: item.text as string,
                            }
                        }
                        if (item.type === "image") {
                            return {
                                type: "image" as const,
                                mimeType: item.mimeType as string,
                                data: item.data as string,
                            }
                        }
                        // Fallback: stringify unknown content types
                        return {
                            type: "text" as const,
                            text: JSON.stringify(item),
                        }
                    })

                    return {
                        content,
                        details: undefined,
                    }
                }

                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                    details: undefined,
                }
            },
        })
    }

    const startServers = async (ctx: ExtensionContext) => {
        const discoveredServers: DiscoveredServer[] = []
        const entries = Object.entries(servers)
        const results = await Promise.allSettled(entries.map(([name, config]) => discoverServer(name, config)))

        for (let i = 0; i < results.length; i++) {
            const result = results[i]
            if (result.status === "rejected") {
                console.error(`[mcp] Failed to connect to "${entries[i][0]}":`, result.reason)
            } else {
                discoveredServers.push(result.value)
            }
        }

        let catalog: McpToolCatalog
        try {
            catalog = buildCatalog(discoveredServers)
        } catch (error) {
            console.error("[mcp] Failed to build tool catalog:", error)
            await closeClients()
            catalog = new Map()
            discoveredServers.length = 0
        }

        pi.events.emit(MCP_TOOL_CATALOG_EVENT, catalog)
        for (const server of discoveredServers) {
            for (const tool of server.tools) registerTool(server, tool)
        }

        if (discoveredServers.length === 0) return
        const lines = discoveredServers.map((server) => `- ${server.name}: ${server.tools.length} tools`)
        ctx.ui.setWidget(`${EXTENSION}:startup`, lines)
    }

    pi.on("session_start", async (_event, ctx) => startServers(ctx))
    pi.on("session_shutdown", closeClients)
}

function mergeMcpSettings(
    base: Partial<UnvalidatedMcpSettings>,
    override: Partial<UnvalidatedMcpSettings>,
): Partial<UnvalidatedMcpSettings> {
    return {
        servers: { ...base.servers, ...override.servers },
    }
}

function loadSettings(cwd: string) {
    return project.loadExtensionSettings<UnvalidatedMcpSettings>(EXTENSION, cwd, mergeMcpSettings)
}

export function createServerTransport(
    config: unknown,
    environment: Readonly<Record<string, string | undefined>> = process.env,
) {
    const resolved = resolveServerConfig(config, environment)

    switch (resolved.type) {
        case "stdio":
            return new StdioClientTransport({
                command: resolved.config.command,
                args: resolved.config.args,
                env: resolved.config.env
                    ? ({ ...process.env, ...resolved.config.env } as Record<string, string>)
                    : undefined,
                stderr: "pipe",
            })
        case "streamable-http":
            return new StreamableHTTPClientTransport(
                resolved.url,
                resolved.headers ? { requestInit: { headers: resolved.headers } } : undefined,
            )
    }
}

export function resolveServerConfig(
    config: unknown,
    environment: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedServerConfig {
    let parsed: ServerConfig
    try {
        parsed = Value.Parse(ServerConfigSchema, config)
    } catch (error) {
        if (error instanceof ParseError) throw new Error("invalid server config", { cause: error })
        throw error
    }

    if (Value.Check(StdioServerConfigSchema, parsed)) {
        return { type: "stdio", config: parsed }
    }
    if (Value.Check(RemoteServerConfigSchema, parsed)) {
        return resolveRemoteServerConfig(parsed, environment)
    }
    throw new Error("invalid server config")
}

function resolveRemoteServerConfig(
    config: Type.Static<typeof RemoteServerConfigSchema>,
    environment: Readonly<Record<string, string | undefined>>,
): ResolvedServerConfig {
    let url: URL
    try {
        url = new URL(config.url)
    } catch {
        throw new Error('"url" must be a valid HTTP(S) URL')
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error('"url" must use the http: or https: scheme')
    }

    const headers = config.headers
        ? Object.fromEntries(
              Object.entries(config.headers).map(([name, value]) => [
                  name,
                  value.replace(ENV_REFERENCE, (_reference, variable: string) => {
                      const replacement = environment[variable]
                      if (replacement === undefined) {
                          throw new Error(`environment variable ${variable} is not set`)
                      }
                      return replacement
                  }),
              ]),
          )
        : undefined

    return { type: "streamable-http", url, ...(headers ? { headers } : {}) }
}

function jsonSchemaToTypebox(schema: Record<string, unknown>) {
    return Type.Unsafe(schema)
}
