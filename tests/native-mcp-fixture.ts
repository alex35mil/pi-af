import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import { runToolCall } from "@earendil-works/pi-agent-core"
import type { AssistantMessage, JsonObject } from "@earendil-works/pi-ai"
import {
    createEventBus,
    type ExtensionAPI,
    type ExtensionToolContext,
    type McpServerConfig,
    type McpExtensionOptions,
    type RegisteredMcpServer,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import type { CallToolResult, Tool } from "@earendil-works/pi-mcp"
import { createInMemoryTransportPair, type InMemoryTransport } from "@earendil-works/pi-mcp/testing"

import { MCP_TOOL_CATALOG_EVENT, type McpToolCatalog } from "../extensions/__lib/mcp.ts"
import { registerNativeMcp } from "../extensions/mcp/index.ts"

type Hook = (event: any, ctx: ExtensionToolContext) => any
export function nativeMcpFixture(
    options: {
        servers?: Array<{ name: string; config: McpServerConfig }>
        tools?: Tool[]
        result?: CallToolResult
        projectTrusted?: boolean
    } = {},
) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-mcp-"))
    const oldAgentDir = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = path.join(root, "agent")
    if (options.servers) {
        fs.mkdirSync(path.join(root, "agent"))
        fs.writeFileSync(
            path.join(root, "agent/mcp.json"),
            JSON.stringify({
                mcpServers: Object.fromEntries(options.servers.map(({ name, config }) => [name, config])),
                autoEnableCodemode: false,
            }),
        )
    }
    const tools = new Map<string, ToolDefinition>()
    const hooks = new Map<string, Hook[]>()
    const peers = new Map<string, InMemoryTransport>()
    const registrations = new Map<string, RegisteredMcpServer>()
    const active = new Set<string>()
    const events = createEventBus()
    const wire: Array<{ server: string; name: string; arguments: Record<string, unknown> }> = []
    const prompts: string[] = []
    const notifications: string[] = []
    const order: string[] = []
    let offered = options.tools ?? [{ name: "echo", inputSchema: { type: "object", properties: {} } }]
    let catalog: McpToolCatalog = new Map()
    let connects = 0
    let closes = 0
    let approval = true
    let aborted = false
    events.on(MCP_TOOL_CATALOG_EVENT, (data) => {
        catalog = data as McpToolCatalog
        order.push("catalog")
    })
    const context = {
        cwd: root,
        mode: "print",
        hasUI: true,
        model: { provider: "fixture", id: "model" },
        modelRegistry: {},
        sessionManager: { getBranch: () => [] },
        isProjectTrusted: () => options.projectTrusted ?? true,
        abort() {
            aborted = true
        },
        ui: {
            setWidget() {},
            notify(text: string) {
                notifications.push(text)
            },
            async confirm(_title: string, text: string) {
                prompts.push(text)
                return approval
            },
        },
        get tools() {
            return [...tools.values()].filter((tool) => tool.exposure !== "hidden" && tool.exposure !== "model-only")
        },
        executeTool(name: string, args: JsonObject, callOptions: { signal?: AbortSignal } = {}) {
            return run(name, args, callOptions.signal, "parent")
        },
    } as unknown as ExtensionToolContext
    const pi = {
        events,
        on(name: string, handler: Hook) {
            const handlers = hooks.get(name) ?? []
            handlers.push(handler)
            hooks.set(name, handlers)
            return () => {
                const index = handlers.indexOf(handler)
                if (index >= 0) handlers.splice(index, 1)
            }
        },
        getCommands: () => [],
        registerCommand() {},
        registerShortcut() {},
        registerToolRenderer() {},
        getSettings: () => ({}),
        appendEntry() {},
        getActiveTools: () => [...active],
        setActiveTools(names: string[]) {
            active.clear()
            names.forEach((name) => active.add(name))
        },
        getAllTools: () => [...tools.values()],
        getMcpServers: () => [...registrations.values()],
        registerMcpServer(name: string, config: McpServerConfig) {
            registrations.set(name, { name, config, extensionPath: "fixture:private-project" })
        },
        unregisterMcpServer(name: string) {
            registrations.delete(name)
        },
        registerTool(tool: ToolDefinition) {
            tools.set(tool.name, tool)
            order.push(`tool:${tool.name}`)
        },
    } as unknown as ExtensionAPI
    const nativeOptions: Omit<McpExtensionOptions, "loadConfig"> = {
        logPath: path.join(root, "mcp.log"),
        createTransport(entry) {
            connects++
            const { client, server } = createInMemoryTransportPair()
            peers.set(entry.name, server)
            server.onClose(() => {
                closes++
            })
            server.onMessage((message) => {
                if (!("id" in message) || !("method" in message)) return
                let result: unknown
                if (message.method === "initialize")
                    result = {
                        protocolVersion: "2025-11-25",
                        capabilities: { tools: { listChanged: true } },
                        serverInfo: { name: "fixture", version: "1" },
                    }
                else if (message.method === "tools/list") result = { tools: offered }
                else if (message.method === "tools/call") {
                    const params = message.params as { name: string; arguments: Record<string, unknown> }
                    wire.push({ server: entry.name, name: params.name, arguments: structuredClone(params.arguments) })
                    result = options.result ?? { content: [{ type: "text", text: "ok" }] }
                } else throw new Error(`Unexpected fixture request ${message.method}`)
                void server.send({ jsonrpc: "2.0", id: message.id, result })
            })
            void server.start()
            return client
        },
    }
    const install = () => registerNativeMcp(pi, nativeOptions)
    async function emit(name: string, event: unknown = {}) {
        for (const handler of hooks.get(name) ?? []) await handler(event, context)
    }
    async function waitFor(predicate: () => boolean) {
        const until = Date.now() + 5000
        while (!predicate() && Date.now() < until) await delay(5)
        assert.ok(predicate(), `Native MCP did not reach the expected state: ${notifications.join("; ")}`)
    }
    let sequence = 0
    async function run(name: string, args: JsonObject, signal?: AbortSignal, parent?: string) {
        const available = [...tools.values()].filter((tool) => tool.exposure !== "hidden")
        const executable = available.map((tool) => ({
            ...tool,
            execute: (id: string, params: any, callSignal: AbortSignal | undefined, update: any) =>
                tool.execute(id, params, callSignal, update, context),
        }))
        const assistant: AssistantMessage = {
            role: "assistant",
            content: [],
            api: "openai-completions",
            provider: "fixture",
            model: "model",
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse",
            timestamp: 0,
        }
        const call = { type: "toolCall" as const, id: `${parent ?? "call"}/${++sequence}`, name, arguments: args }
        return runToolCall(call, {
            tools: executable,
            assistantMessage: assistant,
            context: { messages: [], tools: executable },
            signal,
            async beforeToolCall({ toolCall }) {
                const event = {
                    type: "tool_call",
                    toolName: toolCall.name,
                    toolCallId: toolCall.id,
                    ...(parent ? { parentToolCallId: parent } : {}),
                    input: toolCall.arguments,
                }
                for (const handler of hooks.get("tool_call") ?? []) {
                    const decision = await handler(event, context)
                    if (decision?.block) return decision
                }
            },
            async afterToolCall({ toolCall, result, isError }) {
                let output = result
                for (const handler of hooks.get("tool_result") ?? []) {
                    const change = await handler(
                        {
                            type: "tool_result",
                            toolName: toolCall.name,
                            toolCallId: toolCall.id,
                            ...(parent ? { parentToolCallId: parent } : {}),
                            input: toolCall.arguments,
                            ...output,
                            isError,
                        },
                        context,
                    )
                    if (change) output = { ...output, ...change }
                }
                return output
            },
        })
    }
    return {
        root,
        context,
        pi,
        tools,
        hooks,
        events,
        wire,
        prompts,
        notifications,
        order,
        registrations,
        catalog: () => catalog,
        connects: () => connects,
        closes: () => closes,
        aborted: () => aborted,
        setApproval(value: boolean) {
            approval = value
        },
        nativeOptions,
        install,
        emit,
        waitFor,
        run,
        async start() {
            await emit("session_start", { reason: "startup" })
        },
        async changeTools(next: Tool[]) {
            offered = next
            for (const peer of peers.values())
                await peer.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })
        },
        async shutdown() {
            await emit("session_shutdown")
        },
        async cleanup() {
            await emit("session_shutdown")
            if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
            else process.env.PI_CODING_AGENT_DIR = oldAgentDir
            fs.rmSync(root, { recursive: true, force: true })
        },
    }
}
