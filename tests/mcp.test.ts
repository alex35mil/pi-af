import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import { MCP_TOOL_CATALOG_EVENT, type McpToolCatalog } from "../extensions/__lib/mcp.ts"
import { createServerTransport, registerMcpServers, resolveServerConfig } from "../extensions/mcp/index.ts"

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown

function createMcpHarness() {
    const handlers = new Map<string, EventHandler>()
    const publications: McpToolCatalog[] = []
    const registeredTools: string[] = []
    const order: string[] = []
    const pi = {
        events: {
            emit(channel: string, data: unknown) {
                assert.equal(channel, MCP_TOOL_CATALOG_EVENT)
                publications.push(data as McpToolCatalog)
                order.push("catalog")
            },
            on() {
                return () => undefined
            },
        },
        on(event: string, handler: EventHandler) {
            handlers.set(event, handler)
        },
        registerTool(tool: { name: string }) {
            registeredTools.push(tool.name)
            order.push(`tool:${tool.name}`)
        },
    } as unknown as Pick<ExtensionAPI, "events" | "on" | "registerTool">

    const ctx = { ui: { setWidget() {} } } as unknown as ExtensionContext
    return {
        handlers,
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
): { client: never; closeCount: () => number } {
    let closes = 0
    return {
        client: {
            async connect() {},
            async listTools() {
                if (listError) throw listError
                return { tools }
            },
            async callTool() {
                return { content: [] }
            },
            async close() {
                closes++
            },
        } as never,
        closeCount: () => closes,
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
