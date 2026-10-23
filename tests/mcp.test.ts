import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { McpServerConfig } from "@earendil-works/pi-coding-agent"
import { getMcpSettingsPaths, MCP_TOOL_DECORATORS_EVENT, type McpToolDecorators } from "../extensions/__lib/mcp.ts"
import { nativeMcpFixture } from "./native-mcp-fixture.ts"

const schema = { type: "object" as const, properties: { value: { type: "string" } }, additionalProperties: false }
const server = { name: "team-tools", config: { url: "https://example.com/mcp", exposure: "direct" as const } }

function write(file: string, value: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
}

describe("native MCP integration", () => {
    it("starts only with the session, publishes identity before execution, and closes once", async () => {
        const h = nativeMcpFixture({
            servers: [server],
            tools: [
                {
                    name: "echo",
                    inputSchema: schema,
                    annotations: {
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false,
                    },
                },
            ],
        })
        try {
            await h.install()
            assert.equal(h.connects(), 0)
            await h.start()
            await h.waitFor(() => h.catalog().size === 1)
            const [name, metadata] = [...h.catalog()][0]
            assert.equal(name, "mcp__team_tools__echo")
            assert.equal(metadata.serverName, "team-tools")
            assert.equal(metadata.serverToolName, "echo")
            assert.deepEqual(metadata.inputSchema, schema)
            assert.deepEqual(metadata.annotations, {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            })
            assert.equal(h.order[h.order.indexOf(`tool:${name}`) - 1], "catalog")
            const result = await h.run(name, { value: "exact" })
            assert.equal(result.isError, false)
            assert.deepEqual(h.wire, [{ server: "team-tools", name: "echo", arguments: { value: "exact" } }])
            await h.shutdown()
            assert.equal(h.closes(), 1)
            assert.equal(h.catalog().size, 0)
        } finally {
            await h.cleanup()
        }
    })

    it("keeps original tool identity when native names collide or need shortening", async () => {
        const names = ["same-name", "same_name", "a".repeat(90)]
        const h = nativeMcpFixture({ servers: [server], tools: names.map((name) => ({ name, inputSchema: schema })) })
        try {
            await h.install()
            await h.start()
            await h.waitFor(() => h.catalog().size === names.length)
            assert.equal(new Set(h.catalog().keys()).size, names.length)
            for (const [name, metadata] of h.catalog()) {
                assert.ok(name.length <= 64)
                assert.match(name, /^[A-Za-z0-9_]+$/)
                assert.ok(names.includes(metadata.serverToolName))
                assert.equal(metadata.serverName, "team-tools")
                assert.equal((await h.run(name, {})).isError, false)
                assert.equal(h.wire.at(-1)!.name, metadata.serverToolName)
            }
        } finally {
            await h.cleanup()
        }
    })

    it("withdraws dropped and hidden tools from the live catalog and re-registers fresh definitions", async () => {
        const h = nativeMcpFixture({ servers: [server], tools: [{ name: "echo", inputSchema: schema }] })
        try {
            let decorations = 0
            h.events.on(MCP_TOOL_DECORATORS_EVENT, (request) => {
                ;(request as McpToolDecorators).use((tool) => {
                    decorations++
                    return tool
                })
            })
            await h.install()
            await h.start()
            await h.waitFor(() => h.catalog().size === 1)
            const name = [...h.catalog().keys()][0]
            await h.changeTools([])
            await h.waitFor(() => h.tools.get(name)?.exposure === "hidden")
            assert.equal(h.catalog().has(name), false)
            assert.equal((await h.run(name, {})).isError, true)
            assert.equal(h.wire.length, 0)
            await h.changeTools([{ name: "echo", inputSchema: schema, annotations: { readOnlyHint: true } }])
            await h.waitFor(() => h.catalog().get(name)?.annotations?.readOnlyHint === true)
            assert.equal(decorations, 2)
            assert.equal((await h.run(name, {})).isError, false)
            assert.equal(h.wire.length, 1)
        } finally {
            await h.cleanup()
        }
    })

    for (const config of [
        { command: "fixture", env: { SECRET: "private-value" } },
        { url: "https://example.com/mcp", headers: { Authorization: "Bearer private-value" } },
    ] satisfies McpServerConfig[]) {
        it(`decorates ${"command" in config ? "stdio" : "HTTP"} tools without exposing credentials or replacing native fields`, async () => {
            const h = nativeMcpFixture({
                servers: [{ name: "alias", config }],
                tools: [{ name: "echo", inputSchema: schema }],
            })
            try {
                let observed: unknown
                h.events.on(MCP_TOOL_DECORATORS_EVENT, (request) => {
                    ;(request as McpToolDecorators).use((native, metadata, transport) => {
                        observed = { metadata, transport }
                        return { ...native, execute: (...args) => native.execute(...args) }
                    })
                })
                await h.install()
                await h.start()
                await h.waitFor(() => h.catalog().size === 1)
                const name = [...h.catalog().keys()][0]
                assert.doesNotMatch(JSON.stringify(observed), /private-value|Authorization|SECRET/)
                assert.deepEqual(
                    (observed as any).transport,
                    "command" in config ? { type: "stdio" } : { type: "streamable-http", url: config.url },
                )
                assert.equal((await h.run(name, { value: "unmodified" })).isError, false)
                assert.deepEqual(h.wire[0].arguments, { value: "unmodified" })
                assert.ok(h.tools.get(name)!.outputSchema)
                assert.ok(h.tools.get(name)!.renderCall)
                assert.ok(h.tools.get(name)!.renderResult)
                assert.equal(h.tools.get(name)!.namespace?.aliases?.[0], "alias")
            } finally {
                await h.cleanup()
            }
        })
    }

    it("preserves native structured error results", async () => {
        const result = {
            content: [{ type: "text" as const, text: "Provider rejected this request" }],
            structuredContent: { reason: "fixture" },
            isError: true,
        }
        const h = nativeMcpFixture({ servers: [server], result })
        try {
            await h.install()
            await h.start()
            await h.waitFor(() => h.catalog().size === 1)
            const outcome = await h.run([...h.catalog().keys()][0], {})
            assert.equal(outcome.isError, true)
            assert.deepEqual(outcome.result.structuredContent, result)
            assert.deepEqual(outcome.result.details, { server: "team-tools", tool: "echo" })
            assert.equal(h.wire.length, 1)
        } finally {
            await h.cleanup()
        }
    })

    it("loads global registrations without reading either untrusted project tier", async () => {
        const h = nativeMcpFixture({ projectTrusted: false, servers: [server] })
        try {
            const files = getMcpSettingsPaths(h.root)
            for (const file of [files.project, files.local]) {
                fs.mkdirSync(path.dirname(file), { recursive: true })
                fs.writeFileSync(file, "untrusted malformed JSON")
            }
            await h.install()
            await h.start()
            await h.waitFor(() => h.catalog().size === 1)
            assert.equal(h.registrations.size, 1)
            assert.equal(h.connects(), 1)
            assert.equal(h.notifications.length, 0)
        } finally {
            await h.cleanup()
        }
    })

    it("registers every effective tier once with exact-name local precedence and no second file discovery", async () => {
        const h = nativeMcpFixture()
        try {
            const files = getMcpSettingsPaths(h.root)
            const privateConfig = { url: "https://private.example/mcp", exposure: "direct" }
            write(files.global, { mcpServers: { shared: server.config, global: server.config } })
            write(files.project, { mcpServers: { shared: { command: "replaced" }, project: server.config } })
            write(files.local, { mcpServers: { shared: privateConfig, local: server.config } })
            fs.mkdirSync(path.join(h.root, ".pi"))
            fs.writeFileSync(path.join(h.root, ".pi/mcp.json"), "not an adapter configuration source")
            const globalBefore = fs.readFileSync(files.global, "utf-8")
            await h.install()
            await h.start()
            await h.waitFor(() => h.catalog().size === 4)
            assert.deepEqual([...h.registrations.keys()].sort(), ["global", "local", "project", "shared"])
            assert.deepEqual(h.registrations.get("shared")?.config, privateConfig)
            assert.equal(h.connects(), 4)
            assert.equal((await h.run("mcp__shared__echo", {})).isError, false)
            assert.equal(h.wire[0].server, "shared")
            assert.equal(fs.readFileSync(files.global, "utf-8"), globalBefore)
            assert.match(fs.readFileSync(files.local, "utf-8"), /private\.example/)
            await h.shutdown()
            assert.equal(h.closes(), 4)
        } finally {
            await h.cleanup()
        }
    })

    it("reports normalized namespace collisions instead of overriding a different exact server name", async () => {
        const h = nativeMcpFixture({ servers: [server] })
        try {
            write(getMcpSettingsPaths(h.root).project, { mcpServers: { team_tools: server.config } })
            await h.install()
            await assert.rejects(h.start(), /team_tools.*conflicts.*team-tools/)
            assert.equal(h.registrations.size, 0)
            assert.equal(h.connects(), 0)
        } finally {
            await h.cleanup()
        }
    })

    it("removes old owned registrations before loading the next session's trusted configuration", async () => {
        const options = { projectTrusted: true, servers: [server] }
        const h = nativeMcpFixture(options)
        try {
            write(getMcpSettingsPaths(h.root).local, { mcpServers: { private: server.config } })
            await h.install()
            await h.start()
            await h.waitFor(() => h.catalog().size === 2)
            await h.shutdown()
            options.projectTrusted = false
            await h.start()
            await h.waitFor(() => h.catalog().size === 1)
            assert.deepEqual([...h.registrations.keys()], ["team-tools"])
            assert.equal(h.connects(), 3)
            assert.equal(h.closes(), 2)
        } finally {
            await h.cleanup()
        }
    })
})
