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
 *     "<name>": {
 *       "command": "npx",
 *       "args": ["-y", "@playwright/mcp@latest"],
 *       "env": { "KEY": "value" }
 *     }
 *   }
 * }
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

import * as project from "../__lib/project.js"

const EXTENSION = "mcp"

interface ServerConfig {
    command: string
    args?: string[]
    env?: Record<string, string>
}

interface McpSettings {
    servers?: Record<string, ServerConfig>
}

export default async function (pi: ExtensionAPI) {
    const settings = loadSettings(process.cwd())
    const servers = settings.servers ?? {}

    if (Object.keys(servers).length === 0) return

    const clients = new Map<string, Client>()

    async function connectServer(name: string, config: ServerConfig) {
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env ? ({ ...process.env, ...config.env } as Record<string, string>) : undefined,
            stderr: "pipe",
        })

        const client = new Client({
            name: `pi-mcp-${name}`,
            version: "0.1.0",
        })

        await client.connect(transport)
        clients.set(name, client)

        const { tools } = await client.listTools()

        for (const tool of tools) {
            const toolName = `mcp__${name}__${tool.name}`
            const params = jsonSchemaToTypebox(tool.inputSchema as Record<string, unknown>)

            pi.registerTool({
                name: toolName,
                label: tool.annotations?.title ?? tool.name,
                description: tool.description ?? `MCP tool from ${name}: ${tool.name}`,
                parameters: params,

                async execute(_toolCallId, execParams, signal) {
                    const result = await client.callTool(
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

        return { name, toolCount: tools.length }
    }

    const serverResults: { name: string; toolCount: number }[] = []
    const results = await Promise.allSettled(
        Object.entries(servers).map(([name, config]) => connectServer(name, config)),
    )

    for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === "rejected") {
            const name = Object.keys(servers)[i]
            console.error(`[mcp] Failed to connect to "${name}":`, result.reason)
        } else {
            serverResults.push(result.value)
        }
    }

    const announceStartup = (ctx: ExtensionContext) => {
        if (serverResults.length === 0) return
        const lines = serverResults.map((s) => `- ${s.name}: ${s.toolCount} tools`)
        ctx.ui.setWidget(`${EXTENSION}:startup`, lines)
    }

    pi.on("session_start", async (_event, ctx) => announceStartup(ctx))

    // Cleanup on session end
    pi.on("session_shutdown", async () => {
        for (const [name, client] of clients) {
            try {
                await client.close()
            } catch {
                console.error(`[mcp] Failed to close "${name}"`)
            }
        }
        clients.clear()
    })
}

function mergeMcpSettings(base: Partial<McpSettings>, override: Partial<McpSettings>): Partial<McpSettings> {
    return {
        servers: { ...base.servers, ...override.servers },
    }
}

function loadSettings(cwd: string) {
    return project.loadExtensionSettings<McpSettings>(EXTENSION, cwd, mergeMcpSettings)
}

function jsonSchemaToTypebox(schema: Record<string, unknown>) {
    return Type.Unsafe(schema)
}
