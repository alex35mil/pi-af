import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"
import { createInitialSystemMessage, getCurrentTools, type Model, type TranscriptContext } from "@earendil-works/pi-ai"
import { stream as streamCompletions } from "@earendil-works/pi-ai/api/openai-completions"
import { Type } from "typebox"
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing"
import { registerNativeMcp } from "../extensions/mcp/index.ts"
import { Value } from "typebox/value"

import { EntityInitializationSchema } from "../workflows/extensions/init/entity.ts"
import { IntegrationContextSchema } from "../workflows/extensions/integrations/index.ts"
import { ReviewRequestSchema } from "../workflows/extensions/review/index.ts"
import {
    GitHubPhaseInputSchema,
    LinearPhaseInputSchema,
    githubPhaseFacts,
    linearPhaseFacts,
} from "../workflows/extensions/integrations/phase.ts"
import { claudeCodeSchema } from "./claude-code-schema-fixture.ts"
import {
    codingFactories,
    expectedWorkflowTools,
    registeredWorkflowTools,
    workflowFactories,
} from "./workflow-tools-fixture.ts"
import { answer, call, nativeSessionFixture } from "./native-session-fixture.ts"

const json = (value: unknown) => JSON.parse(JSON.stringify(value))
function measurement(context: TranscriptContext) {
    const tools = getCurrentTools(context.messages)
    const serialized = JSON.stringify(
        tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    )
    return {
        count: tools.length,
        bytes: Buffer.byteLength(serialized),
        tokens: Math.ceil(serialized.length / 4),
        tools,
    }
}
function git(root: string, ...args: string[]) {
    return cp.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

describe("workflow model-facing contracts", () => {
    it("registers exactly the reviewed operation inventory, with native deferred object contracts", () => {
        const tools = registeredWorkflowTools()
        assert.deepEqual(tools.map((t) => t.name).sort(), [...expectedWorkflowTools].sort())
        assert.equal(new Set(tools.map((t) => t.name)).size, tools.length)
        for (const tool of tools) {
            assert.match(tool.name, /^[A-Za-z0-9_-]{1,50}$/)
            assert.ok(Type.IsObject(tool.parameters), tool.name)
            assert.ok(!("anyOf" in tool.parameters), tool.name)
            assert.ok(!("oneOf" in tool.parameters), tool.name)
            assert.ok(!("allOf" in tool.parameters), tool.name)
            const checkChoices = (value: unknown, location: string): void => {
                if (!value || typeof value !== "object") return
                assert.notEqual(
                    typeof (value as Record<string, unknown>).const,
                    "string",
                    `${location} must use a string enum`,
                )
                for (const [key, child] of Object.entries(value)) checkChoices(child, `${location}.${key}`)
            }
            checkChoices(json(tool.parameters), tool.name)
            assert.equal(tool.exposure, "deferred")
            assert.match(tool.namespace!.name, /^workflows_/)
            assert.deepEqual(
                claudeCodeSchema(json(tool.parameters)),
                json(tool.parameters),
                `${tool.name} must retain all schema information`,
            )
        }
    })

    it("keeps the discovery guide and skill grants aligned with the exact public inventory", () => {
        const names = new Set<string>(expectedWorkflowTools)
        const guide = fs.readFileSync("workflows/references/tools.md", "utf8")
        for (const name of names) assert.ok(guide.includes(`\`${name}\``), `discovery guide must name ${name}`)
        for (const skill of ["epic", "task", "gig", "pr", "project-setup", "backlog", "todo"]) {
            const source = fs.readFileSync(`workflows/skills/${skill}/SKILL.md`, "utf8")
            const frontmatter = source.split("---")[1]
            for (const [, name] of frontmatter.matchAll(/^ +-[ ]+"([^"]+)"$/gm)) {
                if (/^(read|write|edit)\(/.test(name)) continue
                assert.ok(names.has(name), `${skill} grants unknown workflow tool ${name}`)
            }
        }
    })

    it("reproduces the old empty-root failure without preserving a public dispatch alias", () => {
        for (const schema of [EntityInitializationSchema, IntegrationContextSchema, ReviewRequestSchema])
            assert.deepEqual(claudeCodeSchema(json(schema)), { type: "object", properties: {} })
        for (const old of [
            "init",
            "integration_context",
            "review",
            "resource_ids",
            "tracker_publication",
            "set_workflow_phase",
            "confirm_tracker_initialization",
            "provision_github_project",
            "incoming_pull_request_checkout",
            "prepare_plan_presentation",
        ])
            assert.ok(!registeredWorkflowTools().some((t) => t.name === old), old)
    })

    it("retains nested configuration alternatives instead of multiplying configuration tools", () => {
        const tools = registeredWorkflowTools()
        const setup = tools.find((t) => t.name === "preview_github_project_setup")!.parameters
        assert.ok(Type.IsObject(setup))
        const specification = setup.properties.specification
        assert.ok(Type.IsObject(specification))
        assert.ok("anyOf" in specification.properties.project)
        assert.deepEqual(claudeCodeSchema(json(setup)), json(setup))
        const selection = tools.find((t) => t.name === "select_pull_request_resource")!.parameters
        assert.ok(Type.IsObject(selection))
        assert.deepEqual(Object.keys(selection.properties).sort(), ["entityDir", "evidence"])
        const mcp = tools.find((t) => t.name === "configure_mcp")!.parameters
        assert.ok(Type.IsObject(mcp))
        assert.ok("anyOf" in json(mcp).properties.registrations.items)
    })

    it("maps only genuine native empty leaves to domain nulls and still requires read facts", () => {
        const github = {
            field: { name: "Phase", dataType: "SINGLE_SELECT", options: ["Planning", "Execution", "Self-Review"] },
        }
        assert.ok(Value.Check(GitHubPhaseInputSchema, github))
        assert.equal(githubPhaseFacts(github).provider, "github")
        assert.deepEqual(githubPhaseFacts(github), { provider: "github", ...github, current: null })
        assert.equal(Value.Check(GitHubPhaseInputSchema, {}), false)
        assert.equal(Value.Check(GitHubPhaseInputSchema, { ...github, current: null }), false)
        const linear = { catalog: [{ id: "group", name: "Phase", isGroup: true }], applied: [] }
        assert.ok(Value.Check(LinearPhaseInputSchema, linear))
        assert.deepEqual(linearPhaseFacts(linear), {
            provider: "linear",
            catalog: [{ ...linear.catalog[0], team: null, parentId: null, groupType: null, retiredAt: null }],
            applied: [],
        })
        assert.equal(Value.Check(LinearPhaseInputSchema, { applied: [] }), false)
    })

    it("keeps actual native default declarations within the context and GLM-count budgets", async () => {
        const h = await nativeSessionFixture({
            extensions: [...codingFactories, ...workflowFactories],
            tools: ["+codemode"],
        })
        try {
            h.respond(answer("Measured."))
            await h.prompt("Ordinary coding, without a workflow operation.")
            const m = measurement(h.requests[0])
            assert.ok(m.count <= 10)
            assert.ok(m.count <= 128)
            assert.ok(m.tokens <= 2500)
            assert.ok(m.bytes <= 94354 * 0.2)
            const workflowNames = new Set(expectedWorkflowTools)
            assert.ok(m.tools.every((t) => !workflowNames.has(t.name as (typeof expectedWorkflowTools)[number])))
            assert.ok(
                !m.tools.find((t) => t.name === "codemode")!.description.includes("tools.preview_github_project_setup"),
            )

            const glm: Model<"openai-completions"> = {
                id: "glm-4.7",
                name: "GLM request-conversion fixture",
                provider: "zai",
                api: "openai-completions",
                baseUrl: "https://api.z.ai/api/paas/v4",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 65536,
                maxTokens: 4096,
            }
            let payload: any
            const stopped = await streamCompletions(glm, h.requests[0], {
                apiKey: "fixture-only",
                maxRetries: 0,
                onPayload(value) {
                    payload = value
                    throw new Error("Captured before network transport")
                },
            }).result()
            assert.equal(stopped.stopReason, "error")
            assert.match(stopped.errorMessage!, /Captured before network transport/)
            assert.equal(payload.tools.length, m.count)
            const code = payload.tools.find((t: any) => t.function?.name === "codemode")
            assert.equal(code.function.parameters.type, "object")
            assert.equal(code.function.parameters.properties.code.type, "string")
            assert.ok(payload.tools.every((t: any) => t.function?.parameters?.type === "object"))
        } finally {
            await h.cleanup()
        }
    })

    it("keeps native MCP discovery alongside deferred workflow operations without loading the workflow catalog", async () => {
        const mcp = (pi: Parameters<typeof registerNativeMcp>[0]) =>
            registerNativeMcp(pi, {
                createTransport() {
                    const { client, server } = createInMemoryTransportPair()
                    server.onMessage((message) => {
                        if (!("id" in message) || !("method" in message)) return
                        const result =
                            message.method === "initialize"
                                ? {
                                      protocolVersion: "2025-11-25",
                                      capabilities: { tools: {} },
                                      serverInfo: { name: "memory", version: "1" },
                                  }
                                : message.method === "tools/list"
                                  ? {
                                        tools: [
                                            {
                                                name: "echo",
                                                inputSchema: { type: "object", properties: {} },
                                                annotations: { readOnlyHint: true },
                                            },
                                        ],
                                    }
                                  : { content: [{ type: "text", text: "memory-ok" }] }
                        void server.send({ jsonrpc: "2.0", id: message.id, result })
                    })
                    void server.start()
                    return client
                },
            })
        const h = await nativeSessionFixture({
            extensions: [...codingFactories, mcp, ...workflowFactories],
            tools: ["+codemode"],
            setup(root) {
                fs.writeFileSync(path.join(root, "agent/permissions.json"), JSON.stringify({ defaultMode: "allow" }))
                fs.writeFileSync(
                    path.join(root, "agent/mcp.json"),
                    JSON.stringify({
                        mcpServers: { memory: { url: "https://memory.invalid/mcp", exposure: "codemode" } },
                    }),
                )
            },
        })
        try {
            h.respond(
                call({
                    name: "codemode",
                    arguments: {
                        code: 'text(await describeTool("init_github_gig")); text(await tools.mcp__memory__echo({}));',
                    },
                }),
                answer("Done."),
            )
            await h.prompt("Discover a workflow operation and use the in-memory MCP fixture.")
            for (const request of h.requests) {
                const m = measurement(request)
                assert.ok(m.count <= 10)
                assert.ok(m.tokens <= 2500)
                assert.ok(
                    !m.tools.some((t) =>
                        expectedWorkflowTools.includes(t.name as (typeof expectedWorkflowTools)[number]),
                    ),
                )
            }
            assert.match(JSON.stringify(h.manager.buildSessionProjection().messages), /memory-ok/)
        } finally {
            await h.cleanup()
        }
    })

    it("preserves a denied nested workflow operation even when Codemode itself is allowed", async () => {
        const h = await nativeSessionFixture({
            extensions: [...codingFactories, ...workflowFactories],
            tools: ["+codemode"],
            setup(root) {
                fs.writeFileSync(
                    path.join(root, "agent/permissions.json"),
                    JSON.stringify({ defaultMode: "deny", allow: ["codemode"], deny: ["preflight_gig"] }),
                )
            },
        })
        try {
            assert.ok(h.session.getAllTools().some((t) => t.name === "preflight_gig"))
            h.respond(
                call({
                    name: "codemode",
                    arguments: {
                        code: 'text(await tools.preflight_gig({title:"Blocked",slug:"blocked",request:"Do not execute.",kind:"refactor"}));',
                    },
                }),
                answer("Denied."),
            )
            await h.prompt("Exercise the explicit permission denial.")
            const result = h.manager.buildSessionProjection().messages.find((m) => m.role === "toolResult")
            const outcome = json(result)
            assert.equal(outcome.isError, true)
            assert.equal(outcome.details.calls[0].name, "preflight_gig")
            assert.equal(outcome.details.calls[0].status, "cancelled")
            assert.equal(fs.existsSync(path.join(h.root, ".project/.local/gigs")), false)
        } finally {
            await h.cleanup()
        }
    })

    it("does not restore Codemode through an explicit native tool allowlist", async () => {
        const h = await nativeSessionFixture({
            extensions: [...codingFactories, ...workflowFactories],
            tools: ["read"],
        })
        try {
            assert.ok(!h.session.getAllTools().some((t) => t.name === "codemode"))
            assert.ok(!h.session.getActiveToolNames().includes("codemode"))
            assert.match(JSON.stringify(h.errors), /Workflow tools require Codemode discovery/)
        } finally {
            await h.cleanup()
        }
    })

    it("preserves the CLI Codemode exclusion through reload", async () => {
        const previous = [...process.argv]
        process.argv.push("--tools", "-codemode")
        const h = await nativeSessionFixture({
            extensions: [...codingFactories, ...workflowFactories],
            tools: ["-codemode"],
        })
        try {
            assert.ok(!h.session.getActiveToolNames().includes("codemode"))
            assert.match(JSON.stringify(h.errors), /Workflow tools require Codemode discovery/)
            await h.session.reload()
            assert.ok(!h.session.getActiveToolNames().includes("codemode"))
        } finally {
            process.argv.splice(0, process.argv.length, ...previous)
            await h.cleanup()
        }
    })

    it("keeps discovery, setup, real initialization and Phase transitions working through reload and resume", async () => {
        const h = await nativeSessionFixture({
            extensions: [...codingFactories, ...workflowFactories],
            tools: ["+codemode"],
            setup(root) {
                git(root, "init", "-q", "-b", "main")
                git(root, "config", "user.name", "Fixture")
                git(root, "config", "user.email", "fixture@example.invalid")
                fs.writeFileSync(path.join(root, "seed.txt"), "fixture")
                git(root, "add", "seed.txt")
                git(root, "commit", "-qm", "Initial fixture")
                fs.writeFileSync(path.join(root, "agent/permissions.json"), JSON.stringify({ defaultMode: "allow" }))
                fs.mkdirSync(path.join(root, ".project"))
                fs.writeFileSync(
                    path.join(root, ".project/config.json"),
                    JSON.stringify({ branches: { format: "number-title" } }),
                )
                const repository = { owner: "fixture", repo: "app" }
                const statuses = {
                    backlog: "Backlog",
                    todo: "Todo",
                    inProgress: "In Progress",
                    inReview: "In Review",
                    done: "Done",
                    canceled: "Canceled",
                }
                fs.writeFileSync(
                    path.join(root, ".project/integrations.json"),
                    JSON.stringify({
                        tracker: {
                            provider: "github",
                            mcpServer: "github",
                            repository,
                            project: { owner: "fixture", ownerType: "user", number: 1 },
                            fields: {
                                status: { field: "Status", values: statuses },
                                phase: {
                                    field: "Phase",
                                    values: { planning: "Planning", execution: "Execution", selfReview: "Self-Review" },
                                },
                                priority: { scope: "project", field: "Priority", values: ["High"] },
                            },
                        },
                        forge: { provider: "github", mcpServer: "github", repository },
                    }),
                )
                fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
            },
        })
        async function invoke(code: string) {
            h.respond(call({ name: "codemode", arguments: { code } }), answer("Done."))
            await h.prompt("Continue the workflow fixture.")
        }
        try {
            await invoke(
                'text(await tools.inspect_project_setup({})); text(await tools.prepare_artifacts({})); text(await describeTool("init_github_gig"));',
            )
            await invoke(
                'text(await tools.preflight_gig({title:"Fixture work",slug:"fixture-work",request:"Do fixture work.",kind:"refactor"})); text(await tools.init_github_gig({title:"Fixture work",slug:"fixture-work",request:"Do fixture work.",kind:"refactor",object:{issueId:900,issueNumber:9,issueUrl:"https://github.com/fixture/app/issues/9"}}));',
            )
            const directory = ".project/.local/gigs/9-fixture-work"
            assert.ok(fs.existsSync(path.join(h.root, directory, "metadata.json")))
            const metadataPath = path.join(h.root, directory, "metadata.json")
            const initial = JSON.parse(fs.readFileSync(metadataPath, "utf8"))
            git(h.root, "switch", initial.branch.name)
            await invoke(`text(await tools.initialize_integration({entityDir:${JSON.stringify(directory)}}));`)
            const native = JSON.stringify({
                field: { name: "Phase", dataType: "SINGLE_SELECT", options: ["Planning", "Execution", "Self-Review"] },
            })
            for (const phase of ["execution", "selfReview", "planning"]) {
                await invoke(
                    `text(await tools.set_github_workflow_phase({entityDir:${JSON.stringify(directory)},phase:${JSON.stringify(phase)},lifecycle:"inProgress",native:${native}}));`,
                )
                assert.equal(JSON.parse(fs.readFileSync(metadataPath, "utf8")).phase, phase)
            }
            await h.session.reload()
            await invoke(
                `text(await tools.resume_integration({entityDir:${JSON.stringify(directory)}})); text(await describeTool("review_gig"));`,
            )
            await h.reopen()
            await invoke(
                `text(await tools.resume_integration({entityDir:${JSON.stringify(directory)}})); text(await describeTool("prepare_gig_plan_presentation"));`,
            )
            const names = new Set(expectedWorkflowTools)
            for (const request of h.requests) {
                const m = measurement(request)
                assert.ok(m.count <= 10)
                assert.ok(m.tokens <= 2500)
                assert.ok(m.tools.every((t) => !names.has(t.name as (typeof expectedWorkflowTools)[number])))
            }
            assert.deepEqual(JSON.parse(fs.readFileSync(metadataPath, "utf8")).tracker, initial.tracker)
            assert.equal(fs.existsSync(path.join(h.root, directory, "status.md")), false)
        } finally {
            await h.cleanup()
        }
    })
})
