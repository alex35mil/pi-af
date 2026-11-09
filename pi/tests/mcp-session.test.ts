import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { it } from "node:test"

import type { TranscriptContext } from "@earendil-works/pi-ai"
import { createToolSearchExtension } from "@earendil-works/pi-coding-agent"
import { getMcpToolName, observeMcpTools, type McpToolCatalog } from "../extensions/__lib/mcp.ts"
import { registerNativeMcp } from "../extensions/mcp/index.ts"
import registerPermission from "../extensions/permissions/index.ts"
import { registerWorkflowPublication } from "../workflows/extensions/integrations/publication-mcp.ts"
import { nativeMcpFixture } from "./native-mcp-fixture.ts"
import { answer, call, nativeSessionFixture } from "./native-session-fixture.ts"

function declarations(context: TranscriptContext) {
    return context.messages
        .flatMap((message) => (message.role === "system" ? (message.toolsAdded ?? []) : []))
        .map((tool) => tool.name)
}

for (const exposure of ["direct", "deferred", "codemode"] as const) {
    it(`publishes through the actual SDK's ${exposure} MCP path with one connection and native policy`, async () => {
        const peer = nativeMcpFixture({
            tools: [
                {
                    name: "issue_write",
                    description: "Update the issue body",
                    inputSchema: {
                        type: "object",
                        properties: { method: { type: "string" }, body: { type: "string" } },
                        required: ["method", "body"],
                        additionalProperties: false,
                    },
                },
            ],
        })
        let catalog: McpToolCatalog = new Map()
        const h = await nativeSessionFixture({
            extensions: [
                registerPermission,
                createToolSearchExtension(),
                (pi) => {
                    catalog = observeMcpTools(pi)
                    registerWorkflowPublication(pi)
                },
                (pi) => registerNativeMcp(pi, peer.nativeOptions),
            ],
            tools: [exposure === "codemode" ? "codemode" : "tool_search", "mcp__*"],
            setup(root) {
                fs.mkdirSync(path.join(root, ".agents"))
                fs.writeFileSync(path.join(root, ".agents/permissions.json"), JSON.stringify({ defaultMode: "allow" }))
                fs.writeFileSync(
                    path.join(root, ".agents/mcp.json"),
                    JSON.stringify({
                        mcpServers: {
                            publisher: { url: "https://api.githubcopilot.com/mcp/", exposure },
                        },
                    }),
                )
            },
        })
        const post = (body: string, authorship: "ai-assisted" | "user-verbatim") =>
            call({
                name: getMcpToolName("publisher", "issue_write", catalog),
                arguments: { method: "update", body, __pi_authorship: authorship },
            })
        try {
            if (exposure === "codemode") {
                h.respond((context) => {
                    assert.equal(
                        declarations(context).some((name) => name.startsWith("mcp__")),
                        false,
                    )
                    return call({
                        name: "codemode",
                        arguments: {
                            code: 'const tool = ALL_TOOLS.find(t => t.name.includes("issue_write")); await tools[tool.name]({method:"update",body:"Approved body",__pi_authorship:"ai-assisted"}); await tools[tool.name]({method:"update",body:"Unchanged user text",__pi_authorship:"user-verbatim"}); text("done");',
                        },
                    })
                }, answer("Done"))
            } else {
                if (exposure === "deferred") {
                    h.respond((context) => {
                        assert.equal(
                            declarations(context).some((name) => name.startsWith("mcp__")),
                            false,
                        )
                        return call({ name: "tool_search", arguments: { query: "issue_write", limit: 1 } })
                    })
                }
                h.respond(
                    (context) => {
                        assert.ok(declarations(context).includes(getMcpToolName("publisher", "issue_write", catalog)))
                        return post("Approved body", "ai-assisted")
                    },
                    post.bind(undefined, "Unchanged user text", "user-verbatim"),
                    answer("Done"),
                )
            }
            await h.prompt("Publish the two approved fixture bodies")
            assert.equal(peer.connects(), 1)
            assert.deepEqual(peer.wire, [
                {
                    server: "publisher",
                    name: "issue_write",
                    arguments: {
                        method: "update",
                        body: "Approved body\n\n<sub>Sent via Pi. Model: fixture/fixture.</sub>",
                    },
                },
                {
                    server: "publisher",
                    name: "issue_write",
                    arguments: { method: "update", body: "Unchanged user text" },
                },
            ])
            assert.equal(h.requests.length, exposure === "codemode" ? 2 : exposure === "deferred" ? 4 : 3)
            await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
            assert.equal(peer.closes(), 1)
        } finally {
            try {
                await h.cleanup()
            } finally {
                await peer.cleanup()
            }
        }
    })
}
