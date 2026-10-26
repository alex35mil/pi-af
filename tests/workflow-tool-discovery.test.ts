import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"
import { getCurrentTools } from "@earendil-works/pi-ai"
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type, type TSchema } from "typebox"
import { Value } from "typebox/value"

import permissions from "../extensions/permissions/index.ts"
import initialize from "../workflows/extensions/init/index.ts"
import { activateWorkflowDiscovery } from "../workflows/extensions/__lib/tools.ts"
import { answer, call, nativeSessionFixture } from "./native-session-fixture.ts"

function accepts(schema: TSchema, input: unknown): boolean {
    return Value.Check(schema, input)
}

function activation(options: { defaults?: string[]; registered?: boolean; active?: string[] } = {}) {
    let active = options.active ?? ["read"]
    const writes: string[][] = []
    const pi = {
        getSettings: () => ({ defaultTools: options.defaults }),
        getAllTools: () => (options.registered === false ? [] : [{ name: "codemode", exposure: "model-only" }]),
        getActiveTools: () => active,
        setActiveTools: (names: string[]) => {
            writes.push(names)
            active = names
        },
    } as unknown as ExtensionAPI
    return { pi, writes, active: () => active }
}

describe("workflow tool discovery", () => {
    it("activates only existing Codemode and preserves active tools", () => {
        const h = activation()
        assert.equal(activateWorkflowDiscovery(h.pi, []), undefined)
        assert.deepEqual(h.active(), ["read", "codemode"])
        assert.equal(activateWorkflowDiscovery(h.pi, []), undefined)
        assert.equal(h.writes.length, 1)
    })

    for (const [label, defaults, argv] of [
        ["setting exclusion", ["-codemode"], []],
        ["setting exclusion plus unrelated CLI modifier", ["-codemode"], ["--tools", "+read"]],
        ["explicit setting selection", ["read", "bash"], []],
        ["CLI exclusion", undefined, ["--tools", "-codemode"]],
        ["all tools disabled", undefined, ["--no-tools"]],
    ] as const) {
        it(`preserves ${label}`, () => {
            const h = activation({ defaults: defaults ? [...defaults] : undefined })
            assert.match(activateWorkflowDiscovery(h.pi, [...argv])!, /require Codemode discovery/)
            assert.deepEqual(h.writes, [])
        })
    }

    it("honors an explicit CLI addition over the setting exclusion", () => {
        const h = activation({ defaults: ["-codemode"] })
        assert.equal(activateWorkflowDiscovery(h.pi, ["--tools", "+codemode"]), undefined)
        assert.deepEqual(h.active(), ["read", "codemode"])
    })

    it("reports a missing or allowlist-filtered tool without registering a replacement", () => {
        const h = activation({ registered: false })
        assert.match(activateWorkflowDiscovery(h.pi, [])!, /Enable the existing codemode/)
        assert.deepEqual(h.writes, [])
    })

    it("registers concrete initialization operations with provider-specific required inputs", () => {
        const tools: Parameters<ExtensionAPI["registerTool"]>[0][] = []
        initialize({
            on() {},
            events: createEventBus(),
            registerTool: (tool: (typeof tools)[number]) => tools.push(tool),
        } as never)
        assert.equal(tools.length, 10)
        assert.ok(!tools.some((tool) => tool.name === "init"))
        for (const tool of tools) {
            assert.ok(Type.IsObject(tool.parameters))
            assert.ok(!("anyOf" in tool.parameters))
            assert.equal(tool.exposure, "deferred")
            assert.equal(tool.namespace?.name, "workflows_initialization")
        }
        const schema = tools.find((tool) => tool.name === "init_gig")!.parameters
        const input = { title: "Example", slug: "example", request: "Do the work.", priority: "High", kind: "refactor" }
        assert.ok(accepts(schema, input))
        assert.ok(!accepts(schema, { ...input, entity: "gig" }))
        assert.ok(!accepts(schema, { ...input, source: { mode: "new" } }))
        assert.ok(!accepts(schema, { ...input, kind: "unsupported" }))
        const adopted = tools.find((tool) => tool.name === "adopt_github_gig")!.parameters
        assert.ok(!accepts(adopted, input))
        assert.ok(
            accepts(adopted, {
                ...input,
                source: {
                    issueId: 123,
                    issueNumber: 4,
                    issueUrl: "https://github.com/o/r/issues/4",
                    projectItemId: 456,
                },
            }),
        )
        const task = tools.find((tool) => tool.name === "init_task")!.parameters
        assert.ok(!accepts(task, input))
        assert.ok(accepts(task, { ...input, parentEpicDir: ".project/.local/epics/example", epicItemTitle: "Example" }))
    })

    it("discovers initialization through native Codemode without declaring or inlining the catalog", async () => {
        const h = await nativeSessionFixture({
            extensions: [permissions, initialize],
            tools: ["+read"],
            setup(root) {
                fs.writeFileSync(path.join(root, "agent/permissions.json"), JSON.stringify({ defaultMode: "allow" }))
            },
        })
        try {
            assert.ok(h.session.getActiveToolNames().includes("codemode"))
            assert.ok(!h.session.getActiveToolNames().includes("init_gig"))
            h.respond(
                call({ name: "codemode", arguments: { code: 'text(await describeTool("init_gig"));' } }),
                answer("Discovered."),
            )
            await h.prompt("Find the standalone initialization operation.")
            for (const request of h.requests) {
                const tools = getCurrentTools(request.messages)
                assert.ok(!tools.some((tool) => tool.name === "init_gig"))
                assert.ok(!tools.find((tool) => tool.name === "codemode")!.description.includes("tools.init_gig"))
            }
            const result = h.manager.buildSessionProjection().messages.find((message) => message.role === "toolResult")
            assert.match(JSON.stringify(result), /init_gig/)
            assert.match(JSON.stringify(result), /priority/)
            assert.match(JSON.stringify(result), /refactor/)
            await h.reopen()
            assert.ok(h.session.getActiveToolNames().includes("codemode"))
            assert.ok(!h.session.getActiveToolNames().includes("init_gig"))
        } finally {
            await h.cleanup()
        }
    })
})
