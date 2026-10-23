import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent"
import type { JsonObject } from "@earendil-works/pi-ai"
import { MCP_TOOL_DECORATORS_EVENT, type McpToolDecorator, type McpToolDecorators } from "../extensions/__lib/mcp.ts"
import { nativeMcpFixture } from "./native-mcp-fixture.ts"
import registerPermission from "../extensions/permissions/index.ts"
import registerIntegrations from "../workflows/extensions/integrations/index.ts"
import { identifyMcpService } from "../workflows/extensions/integrations/mcp.ts"
import {
    decorateMcpPublication,
    registerWorkflowPublication,
} from "../workflows/extensions/integrations/publication-mcp.ts"
import { AUTHORSHIP_PARAMETER } from "../workflows/extensions/integrations/publication.ts"

const model = { provider: "openrouter", id: "anthropic/claude-sonnet-4-5" } as ExtensionContext["model"]
const githubFooter = "<sub>Sent via Pi. Model: openrouter/anthropic/claude-sonnet-4-5.</sub>"
const linearFooter = "*Sent via Pi. Model: openrouter/anthropic/claude-sonnet-4-5.*"

function runtimeHarness(
    provider: "github" | "linear",
    tool: string,
    field: string,
    permissions: "absent" | "allow" | "ask" | "deny" = "absent",
    order: "workflow-first" | "mcp-first" = "workflow-first",
) {
    const nativeSchema = {
        type: "object" as const,
        properties: { [field]: { type: "string" }, method: { type: "string" } },
        additionalProperties: true,
    }
    const endpoint = provider === "github" ? "https://api.githubcopilot.com/mcp/" : "https://mcp.linear.app/mcp"
    const h = nativeMcpFixture({
        servers: [{ name: "custom-alias", config: { url: endpoint, exposure: "direct" } }],
        tools: [{ name: tool, inputSchema: nativeSchema }],
    })
    h.context.model = model
    fs.mkdirSync(path.join(h.root, ".agents"))
    fs.writeFileSync(
        path.join(h.root, ".agents/permissions.json"),
        JSON.stringify({ defaultMode: permissions === "absent" ? "ask" : permissions }),
    )
    if (permissions !== "absent") registerPermission(h.pi)
    if (order === "workflow-first") registerIntegrations(h.pi)
    const installed = h.install()
    if (order === "mcp-first") registerIntegrations(h.pi)
    const toolName = () => {
        const entry = [...h.catalog()].find(
            ([, metadata]) => metadata.serverName === "custom-alias" && metadata.serverToolName === tool,
        )
        assert.ok(entry)
        return entry[0]
    }
    return {
        ...h,
        calls: h.wire,
        nativeSchema,
        toolName,
        collectDecorators() {
            const decorators: McpToolDecorator[] = []
            h.events.emit(MCP_TOOL_DECORATORS_EVENT, {
                use: (decorate) => {
                    decorators.push(decorate)
                },
            } satisfies McpToolDecorators)
            return decorators
        },
        async start() {
            await installed
            await h.start()
            await h.waitFor(() => h.catalog().size === 1)
        },
        send: (input: JsonObject) => h.run(toolName(), input),
    }
}

describe("workflow MCP publication binding", () => {
    it("recognizes official registration rather than aliases or generic field names", () => {
        assert.equal(identifyMcpService({ url: "https://api.githubcopilot.com/mcp/" }), "github")
        assert.equal(identifyMcpService({ url: "https://mcp.linear.app/mcp" }), "linear")
        for (const config of [null, {}, { command: "github" }, { url: "https://example.com/mcp" }])
            assert.equal(identifyMcpService(config), "other")
        const native: ToolDefinition = {
            name: "mcp__github__add_issue_comment",
            label: "Native",
            description: "Native",
            parameters: { type: "object" } as any,
            async execute() {
                return { content: [], details: undefined }
            },
        }
        const metadata = { serverName: "github", serverToolName: "add_issue_comment", inputSchema: { type: "object" } }
        assert.equal(decorateMcpPublication(native, metadata, { type: "stdio" }), native)
        assert.equal(
            decorateMcpPublication(native, metadata, { type: "streamable-http", url: "https://example.com/mcp" }),
            native,
        )
    })

    for (const order of ["workflow-first", "mcp-first"] as const) {
        it(`signs without permission or project workflow configuration (${order})`, async () => {
            const h = runtimeHarness("github", "issue_write", "body", "absent", order)
            try {
                await h.start()
                const toolName = h.toolName()
                assert.deepEqual(h.catalog().get(toolName)!.inputSchema, h.nativeSchema)
                assert.ok(
                    (h.tools.get(toolName)!.parameters as { properties: Record<string, unknown> }).properties[
                        AUTHORSHIP_PARAMETER
                    ],
                )
                await h.send({ method: "create", body: "Queue request.", labels: ["Kind: Feature"] })
                assert.deepEqual(h.calls[0].arguments, {
                    method: "create",
                    body: `Queue request.\n\n${githubFooter}`,
                    labels: ["Kind: Feature"],
                })
                assert.ok(!fs.existsSync(path.join(h.context.cwd, ".project")))
                assert.equal(h.prompts.length, 0)
            } finally {
                await h.cleanup()
            }
        })
    }

    it("disposes registration and installs one wrapper after a fresh binding", async () => {
        const h = runtimeHarness("github", "add_issue_comment", "body")
        try {
            assert.equal(h.collectDecorators().length, 1)
            await h.start()
            await h.send({ body: "First." })
            await h.shutdown()
            assert.equal(h.collectDecorators().length, 0)
            registerWorkflowPublication(h.pi)
            assert.equal(h.collectDecorators().length, 1)
            await h.start()
            await h.send({ body: "Fresh." })
            assert.equal((String(h.calls[1].arguments.body).match(/Sent via/g) ?? []).length, 1)
        } finally {
            await h.cleanup()
        }
    })

    it("keeps user text exact and strips either local authorship value", async () => {
        const h = runtimeHarness("linear", "save_comment", "body")
        try {
            await h.start()
            h.context.model = undefined
            await h.send({ issueId: "issue", body: "  User says this.\r\n", [AUTHORSHIP_PARAMETER]: "user-verbatim" })
            assert.deepEqual(h.calls[0].arguments, { issueId: "issue", body: "  User says this.\r\n" })
            h.context.model = model
            await h.send({ issueId: "issue", body: "AI says this.", [AUTHORSHIP_PARAMETER]: "ai-assisted" })
            assert.deepEqual(h.calls[1].arguments, { issueId: "issue", body: `AI says this.\n\n${linearFooter}` })
        } finally {
            await h.cleanup()
        }
    })

    it("preserves proposed arguments and the existing ask lane", async () => {
        const h = runtimeHarness("github", "add_issue_comment", "body", "ask")
        try {
            await h.start()
            const proposed = { body: "AI message." }
            await h.send(proposed)
            assert.deepEqual(proposed, { body: "AI message." })
            assert.deepEqual(h.prompts, [JSON.stringify(proposed, null, 2)])
            assert.equal(h.calls[0].arguments.body, `AI message.\n\n${githubFooter}`)
            const verbatim = { body: "Exact user message.", [AUTHORSHIP_PARAMETER]: "user-verbatim" }
            await h.send(verbatim)
            assert.deepEqual(h.prompts, [JSON.stringify(proposed, null, 2), JSON.stringify(verbatim, null, 2)])
            assert.deepEqual(verbatim, { body: "Exact user message.", [AUTHORSHIP_PARAMETER]: "user-verbatim" })
            assert.deepEqual(h.calls[1].arguments, { body: "Exact user message." })
            h.setApproval(false)
            assert.equal((await h.send({ body: "Rejected" })).isError, true)
            assert.equal(h.calls.length, 2)
            assert.equal(h.prompts.length, 3)
        } finally {
            await h.cleanup()
        }
    })

    it("adds no prompt to allowed publications", async () => {
        const h = runtimeHarness("github", "add_issue_comment", "body", "allow")
        try {
            await h.start()
            const proposed = { body: "Allowed AI message." }
            await h.send(proposed)
            assert.deepEqual(proposed, { body: "Allowed AI message." })
            assert.equal(h.prompts.length, 0)
            assert.equal(h.calls[0].arguments.body, `Allowed AI message.\n\n${githubFooter}`)
        } finally {
            await h.cleanup()
        }
    })

    it("does not send denied publications", async () => {
        const h = runtimeHarness("github", "add_issue_comment", "body", "deny")
        try {
            await h.start()
            assert.equal((await h.send({ body: "Denied" })).isError, true)
            assert.equal(h.calls.length, 0)
            assert.equal(h.prompts.length, 0)
        } finally {
            await h.cleanup()
        }
    })

    it("blocks partial edits before native execution, with or without permission", async () => {
        for (const permission of ["absent", "ask"] as const) {
            const h = runtimeHarness("linear", "save_document", "content", permission)
            try {
                await h.start()
                const outcome = await h.send({ patch: [{ op: "append", text: "Text" }] })
                assert.equal(outcome.isError, true)
                assert.match(
                    outcome.result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n"),
                    /complete edited text/,
                )
                assert.equal(h.calls.length, 0)
                assert.equal(h.prompts.length, permission === "ask" ? 1 : 0)
            } finally {
                await h.cleanup()
            }
        }
    })
})
