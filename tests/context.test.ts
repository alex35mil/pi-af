import "./host-runtime.ts"

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { Usage } from "@earendil-works/pi-ai"
import { SessionManager, type ContextUsage, type ToolInfo } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

import { renderContextReport, sessionBilling } from "../extensions/context/index.ts"

function usage(multiplier: number): Usage {
    return {
        input: 10 * multiplier,
        output: 2 * multiplier,
        cacheRead: 3 * multiplier,
        cacheWrite: 4 * multiplier,
        totalTokens: 19 * multiplier,
        cost: { input: multiplier, output: 0, cacheRead: 0, cacheWrite: 0, total: multiplier },
    }
}

function tool(name: string, source = "builtin", exposure: ToolInfo["exposure"] = "direct"): ToolInfo {
    return {
        name,
        description: `Description of ${name}`,
        parameters: Type.Object({}),
        exposure,
        sourceInfo: { path: `fixture:${name}`, source, scope: "temporary", origin: "top-level" },
    }
}

function reportFixture(contextUsage: ContextUsage | undefined) {
    const sessionManager = SessionManager.inMemory()
    const tools = [
        tool("read"),
        tool("init", "fixture-extension"),
        tool("mcp__fixture__lookup", "fixture-mcp", "deferred"),
        tool("read_mcp_resource", "fixture-mcp", "deferred"),
        tool("hidden", "fixture-extension", "hidden"),
    ]
    const active = ["read", "init"]
    const pi = {
        getAllTools: () => tools,
        getActiveTools: () => active,
        getCommands: () => [],
    }
    const ctx = {
        model: undefined,
        getContextUsage: () => contextUsage,
        getSystemPrompt: () => "Current system prompt.",
        sessionManager,
    }
    const saveTools = (names: string[]) =>
        sessionManager.appendMessage({
            role: "system",
            content: "System prompt.",
            toolsAdded: tools.filter((entry) => names.includes(entry.name)),
            timestamp: Date.now(),
        })
    return { pi, ctx, tools, active, saveTools, sessionManager, render: () => renderContextReport(pi, ctx) }
}

describe("context report", () => {
    it("keeps unknown occupancy and free space unknown", () => {
        const f = reportFixture({ tokens: null, contextWindow: 1000, percent: null })
        const output = f.render()
        assert.match(output, /unknown\/1.0k tokens \(unknown\)/)
        assert.match(output, /Free space: unknown tokens/)
        assert.doesNotMatch(output, /Free space: 1.0k|0\/1.0k/)
        const absent = reportFixture(undefined).render()
        assert.match(absent, /no usage data/)
        assert.match(absent, /Free space: unknown/)
    })

    it("reports known occupancy without mixing it with session billing", () => {
        const f = reportFixture({ tokens: 250, contextWindow: 1000, percent: 25 })
        f.sessionManager.appendUsage("cache_warm", "fixture", "model", usage(100))
        const output = f.render()
        assert.match(output, /250\/1.0k tokens \(25%\)/)
        assert.match(output, /Free space: 750 tokens/)
        assert.match(output, /Total billed tokens: 1.9k/)
        assert.match(output, /Cost: \$100.00/)
    })

    it("counts saved tool categories once and separates deferred registration from declarations", () => {
        const f = reportFixture({ tokens: 100, contextWindow: 1000, percent: 10 })
        f.saveTools(["read", "init"])
        let output = f.render()
        assert.match(output, /Built-in tools: .*\(1 tools\)/)
        assert.match(output, /Extension tools: .*\(1 tools\)/)
        assert.doesNotMatch(output, /MCP tools: /)
        assert.match(output, /5 registered, 2 active, 4 callable from tools/)
        assert.match(output, /mcp__fixture__lookup — deferred/)
        assert.match(output, /hidden — hidden/)
        f.saveTools(["mcp__fixture__lookup", "read_mcp_resource"])
        output = f.render()
        assert.match(output, /MCP tools: .*\(2 tools\)/)
        assert.match(output, /final provider loadouts can differ/)
    })

    it("uses source metadata for built-ins and reports unavailable registration metadata explicitly", () => {
        const f = reportFixture(undefined)
        f.tools.push(tool("powershell"))
        f.saveTools(["powershell"])
        f.sessionManager.appendMessage({
            role: "system",
            content: "",
            toolsAdded: [{ name: "not_registered_yet", description: "Saved tool", parameters: Type.Object({}) }],
            timestamp: Date.now(),
        })
        const output = f.render()
        assert.match(output, /Built-in tools: .*\(1 tools\)/)
        assert.match(output, /Tools awaiting metadata: .*\(1 tools\)/)
    })

    it("estimates projected message content rather than accumulated request usage", () => {
        const f = reportFixture(undefined)
        f.sessionManager.appendMessage({
            role: "assistant",
            content: [{ type: "text", text: "Short answer." }],
            api: "openai-responses",
            provider: "fixture",
            model: "model",
            usage: usage(1000),
            stopReason: "stop",
            timestamp: Date.now(),
        })
        const output = f.render()
        const projected = Number(/Projected messages: (\d+) tokens/.exec(output)?.[1])
        assert.ok(projected > 0 && projected < 100)
        assert.match(output, /Total billed tokens: 19.0k/)
    })
})

describe("complete session billing", () => {
    it("includes all usage sources and abandoned branches without recounting nested usage", () => {
        const session = SessionManager.inMemory()
        const root = session.appendMessage({ role: "user", content: "Hello", timestamp: Date.now() })
        session.appendMessage({
            role: "assistant",
            content: [],
            api: "openai-responses",
            provider: "fixture",
            model: "model",
            usage: usage(1),
            stopReason: "toolUse",
            timestamp: Date.now(),
        })
        session.appendMessage({
            role: "toolResult",
            toolCallId: "parent",
            toolName: "codemode",
            content: [],
            usage: usage(2),
            nestedCalls: { calls: [{ id: "parent/1", name: "nested", status: "ok" }], complete: true },
            isError: false,
            timestamp: Date.now(),
        })
        session.appendUsage("cache_warm", "fixture", "model", usage(3))
        session.appendCompaction("Summary", root, 100, undefined, false, usage(4))
        session.branchWithSummary(root, "Other branch", undefined, false, usage(5))
        assert.ok(!session.getBranch().some((entry) => entry.type === "message" && entry.message.role === "assistant"))
        assert.deepEqual(sessionBilling(session.getEntries()), {
            messages: 3,
            user: 1,
            assistant: 1,
            toolResults: 1,
            other: 0,
            input: 150,
            output: 30,
            cacheRead: 45,
            cacheWrite: 60,
            cost: 15,
        })
    })
})
