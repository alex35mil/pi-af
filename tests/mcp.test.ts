import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    createEventBus,
    type ExtensionAPI,
    type ExtensionContext,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import {
    MCP_TOOL_CATALOG_EVENT,
    MCP_TOOL_DECORATORS_EVENT,
    type McpToolCatalog,
    type McpToolDecorators,
} from "../extensions/__lib/mcp.ts"
import { createServerTransport, registerMcpServers, resolveServerConfig } from "../extensions/mcp/index.ts"

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown

function createMcpHarness() {
    const handlers = new Map<string, EventHandler>()
    const publications: McpToolCatalog[] = []
    const registeredTools: string[] = []
    const definitions = new Map<string, ToolDefinition>()
    const order: string[] = []
    const events = createEventBus()
    events.on(MCP_TOOL_CATALOG_EVENT, (data) => {
        publications.push(data as McpToolCatalog)
        order.push("catalog")
    })
    const pi = {
        events,
        on(event: string, handler: EventHandler) {
            handlers.set(event, handler)
        },
        registerTool(tool: ToolDefinition) {
            definitions.set(tool.name, tool)
            registeredTools.push(tool.name)
            order.push(`tool:${tool.name}`)
        },
    } as unknown as Pick<ExtensionAPI, "events" | "on" | "registerTool">

    const ctx = { ui: { setWidget() {} } } as unknown as ExtensionContext
    return {
        handlers,
        definitions,
        ctx,
        order,
        pi,
        publications,
        registeredTools,
        start: async () => handlers.get("session_start")?.({}, ctx),
        shutdown: async () => handlers.get("session_shutdown")?.({}, ctx),
    }
}

function createFakeClient(
    tools: Array<Record<string, unknown>> = [],
    listError?: Error,
): { client: never; closeCount: () => number; requests: unknown[][] } {
    let closes = 0
    const requests: unknown[][] = []
    return {
        client: {
            async connect() {},
            async listTools() {
                if (listError) throw listError
                return { tools }
            },
            async callTool(...args: unknown[]) {
                requests.push(args)
                return { content: [] }
            },
            async close() {
                closes++
            },
        } as never,
        closeCount: () => closes,
        requests,
    }
}

function mcpTool(name: string, annotations?: Record<string, unknown>) {
    return { name, inputSchema: { type: "object" }, ...(annotations ? { annotations } : {}) }
}

async function suppressErrors(run: () => Promise<void>) {
    const original = console.error
    console.error = () => undefined
    try {
        await run()
    } finally {
        console.error = original
    }
}

describe("MCP extension lifecycle", () => {
    it("defers discovery until session start", () => {
        const harness = createMcpHarness()
        let clientCount = 0

        assert.doesNotThrow(() =>
            registerMcpServers(harness.pi, { invalid: {} }, () => {
                clientCount++
                return createFakeClient().client
            }),
        )
        assert.deepEqual([...harness.handlers.keys()], ["session_start", "session_shutdown"])
        assert.equal(clientCount, 0)
    })

    it("publishes complete annotations before registering tools", async () => {
        const harness = createMcpHarness()
        const fake = createFakeClient([
            mcpTool("get_issue", {
                title: "Get issue",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            }),
        ])
        registerMcpServers(harness.pi, { github: { command: "noop" } }, () => fake.client)

        await harness.start()

        assert.deepEqual(harness.order, ["catalog", "tool:mcp__github__get_issue"])
        assert.deepEqual(
            [...harness.publications[0]],
            [
                [
                    "mcp__github__get_issue",
                    {
                        serverName: "github",
                        serverToolName: "get_issue",
                        inputSchema: { type: "object" },
                        annotations: {
                            title: "Get issue",
                            readOnlyHint: true,
                            destructiveHint: false,
                            idempotentHint: true,
                            openWorldHint: true,
                        },
                    },
                ],
            ],
        )

        await harness.shutdown()
        assert.equal(fake.closeCount(), 1)
    })

    it("closes and excludes servers that fail after connecting", async () => {
        await suppressErrors(async () => {
            const harness = createMcpHarness()
            const listingFailure = createFakeClient([], new Error("listing failed"))
            const invalidTool = createFakeClient([mcpTool("invalid tool")])
            const clients = new Map([
                ["listing", listingFailure.client],
                ["invalid-tool", invalidTool.client],
            ])
            registerMcpServers(
                harness.pi,
                { listing: { command: "noop" }, "invalid-tool": { command: "noop" } },
                (name) => clients.get(name)!,
            )

            await harness.start()

            assert.deepEqual([...harness.publications[0]], [])
            assert.deepEqual(harness.registeredTools, [])
            assert.equal(listingFailure.closeCount(), 1)
            assert.equal(invalidTool.closeCount(), 1)
        })
    })

    it("rejects invalid server names before connecting", async () => {
        await suppressErrors(async () => {
            const harness = createMcpHarness()
            let clients = 0
            registerMcpServers(harness.pi, { "invalid server": { command: "noop" } }, () => {
                clients++
                return createFakeClient().client
            })

            await harness.start()

            assert.equal(clients, 0)
            assert.deepEqual([...harness.publications[0]], [])
            assert.deepEqual(harness.registeredTools, [])
        })
    })

    it("rejects generated-name collisions atomically and closes every client", async () => {
        await suppressErrors(async () => {
            const harness = createMcpHarness()
            const first = createFakeClient([mcpTool("b__c")])
            const second = createFakeClient([mcpTool("c")])
            const clients = new Map([
                ["a", first.client],
                ["a__b", second.client],
            ])
            registerMcpServers(
                harness.pi,
                { a: { command: "noop" }, a__b: { command: "noop" } },
                (name) => clients.get(name)!,
            )

            await harness.start()

            assert.deepEqual([...harness.publications[0]], [])
            assert.deepEqual(harness.registeredTools, [])
            assert.equal(first.closeCount(), 1)
            assert.equal(second.closeCount(), 1)
        })
    })
})

describe("MCP tool decoration", () => {
    for (const [url, name, field] of [
        ["https://api.githubcopilot.com/mcp/", "issue_write", "body"],
        ["https://mcp.linear.app/mcp", "save_issue", "description"],
    ]) {
        it(`preserves native ${name} schemas, descriptions, and arguments without decorators`, async () => {
            const h = createMcpHarness()
            const schema = { type: "object", properties: { [field]: { type: "string" } }, additionalProperties: false }
            const fake = createFakeClient([{ name, description: "Native description", inputSchema: schema }])
            registerMcpServers(h.pi, { alias: { url } }, () => fake.client)
            try {
                await h.start()
                const tool = h.definitions.get(`mcp__alias__${name}`)!
                assert.deepEqual(JSON.parse(JSON.stringify(tool.parameters)), schema)
                assert.equal(tool.description, "Native description")
                const input = { [field]: "Unchanged text." }
                await tool.execute("native", input, undefined, undefined, h.ctx)
                assert.deepEqual(fake.requests, [[{ name, arguments: input }, undefined, undefined]])
                assert.deepEqual(input, { [field]: "Unchanged text." })
                assert.deepEqual(h.publications[0].get(tool.name)!.inputSchema, schema)
            } finally {
                await h.shutdown()
            }
        })
    }

    for (const config of [
        { command: "noop", env: { SECRET: "private-value" } },
        { url: "https://example.com/mcp", headers: { Authorization: "Bearer private-value" } },
    ]) {
        it(`supports a provider-neutral decorator with ${"command" in config ? "stdio" : "HTTP"} transport identity`, async () => {
            const h = createMcpHarness()
            const fake = createFakeClient([mcpTool("echo")])
            const seen: unknown[] = []
            h.pi.events.on(MCP_TOOL_DECORATORS_EVENT, (registration) => {
                ;(registration as McpToolDecorators).use((native, metadata, transport) => {
                    seen.push(transport)
                    assert.equal(metadata.serverToolName, "echo")
                    assert.deepEqual(metadata.inputSchema, { type: "object" })
                    return {
                        ...native,
                        description: "Decorated description",
                        execute(id, _params, signal, onUpdate, ctx) {
                            return native.execute(id, { value: "decorated" }, signal, onUpdate, ctx)
                        },
                    }
                })
            })
            registerMcpServers(h.pi, { alias: config }, () => fake.client)
            try {
                await h.start()
                assert.deepEqual(seen, [
                    "command" in config ? { type: "stdio" } : { type: "streamable-http", url: config.url },
                ])
                const tool = h.definitions.get("mcp__alias__echo")!
                assert.equal(tool.description, "Decorated description")
                const signal = new AbortController().signal
                assert.deepEqual(await tool.execute("echo", {}, signal, undefined, h.ctx), {
                    content: [],
                    details: undefined,
                })
                assert.deepEqual(fake.requests, [
                    [{ name: "echo", arguments: { value: "decorated" } }, undefined, { signal }],
                ])
                assert.deepEqual(h.order, ["catalog", "tool:mcp__alias__echo"])
            } finally {
                await h.shutdown()
            }
        })
    }

    for (const failure of ["throw", "rename"] as const) {
        it(`closes clients and registers no tools after decorator ${failure}`, async () => {
            await suppressErrors(async () => {
                const h = createMcpHarness()
                const fake = createFakeClient([mcpTool("first"), mcpTool("second")])
                h.pi.events.on(MCP_TOOL_DECORATORS_EVENT, (registration) => {
                    ;(registration as McpToolDecorators).use((native, metadata) => {
                        if (metadata.serverToolName === "first") return native
                        if (failure === "throw") throw new Error("decoration failed")
                        return { ...native, name: "changed" }
                    })
                })
                registerMcpServers(h.pi, { alias: { command: "noop" } }, () => fake.client)
                await h.start()
                assert.deepEqual(h.registeredTools, [])
                assert.deepEqual([...h.publications[0]], [])
                assert.equal(fake.closeCount(), 1)
                assert.deepEqual(fake.requests, [])
            })
        })
    }
})

describe("MCP server config", () => {
    it("resolves existing stdio config as a tagged variant", () => {
        const config = {
            command: "npx",
            args: ["-y", "@playwright/mcp@latest"],
            env: { PLAYWRIGHT_HEADLESS: "true" },
        }

        const resolved = resolveServerConfig(config)

        assert.deepEqual(resolved, { type: "stdio", config })
        assert.ok(createServerTransport(config) instanceof StdioClientTransport)
    })

    it("resolves remote config and expands token references", () => {
        const config = {
            url: "https://mcp.linear.app/mcp",
            headers: {
                Authorization: "Bearer ${LINEAR_API_KEY}",
                "X-Account": "${ACCOUNT_ID}:${ACCOUNT_REGION}",
            },
        }

        const resolved = resolveServerConfig(config, {
            LINEAR_API_KEY: "linear-token",
            ACCOUNT_ID: "account-1",
            ACCOUNT_REGION: "eu",
        })

        assert.equal(resolved.type, "streamable-http")
        if (resolved.type !== "streamable-http") return
        assert.equal(resolved.url.href, "https://mcp.linear.app/mcp")
        assert.deepEqual(resolved.headers, {
            Authorization: "Bearer linear-token",
            "X-Account": "account-1:eu",
        })
        assert.ok(
            createServerTransport(config, {
                LINEAR_API_KEY: "linear-token",
                ACCOUNT_ID: "account-1",
                ACCOUNT_REGION: "eu",
            }) instanceof StreamableHTTPClientTransport,
        )
    })

    it("allows HTTP and HTTPS remote URLs", () => {
        for (const url of ["http://localhost:3000/mcp", "https://example.com/mcp"]) {
            const resolved = resolveServerConfig({ url })
            assert.equal(resolved.type, "streamable-http")
        }
    })

    it("rejects malformed or ambiguous transport configs", () => {
        const invalidConfigs = [
            {},
            { command: "npx", url: "https://example.com/mcp" },
            { command: "npx", headers: {} },
            { url: "https://example.com/mcp", args: [] },
            { url: "https://example.com/mcp", env: {} },
            { command: "" },
            { command: "npx", args: [1] },
            { url: "https://example.com/mcp", headers: { Authorization: 1 } },
        ]

        for (const config of invalidConfigs) {
            assert.throws(() => resolveServerConfig(config), /invalid server config/)
        }
    })

    it("rejects invalid and unsupported remote URLs", () => {
        assert.throws(() => resolveServerConfig({ url: "not a URL" }), /valid HTTP\(S\) URL/)
        assert.throws(() => resolveServerConfig({ url: "ftp://example.com/mcp" }), /http: or https:/)
    })

    it("rejects an unset header environment variable", () => {
        assert.throws(
            () =>
                resolveServerConfig(
                    {
                        url: "https://api.githubcopilot.com/mcp/",
                        headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" },
                    },
                    {},
                ),
            /environment variable GITHUB_PERSONAL_ACCESS_TOKEN is not set/,
        )
    })
})
