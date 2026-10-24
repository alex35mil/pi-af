import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { createProvider, createAssistantMessageEventStream, type Model } from "@earendil-works/pi-ai"
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all"
import {
    createAgentSession,
    DefaultResourceLoader,
    ModelRuntime,
    SessionManager,
    SettingsManager,
    type ExtensionFactory,
} from "@earendil-works/pi-coding-agent"
import { buildReviewerArgs, runReviewAgent } from "../workflows/extensions/review/agent.ts"
import {
    resolveReviewerLaunch,
    reviewerEnvironment,
    type ReviewerEnvironment,
} from "../workflows/extensions/review/model.ts"

const fixtureModel: Model<"review-fixture"> = {
    id: "review-fixture",
    name: "Isolated reviewer fixture",
    provider: "claude-code",
    api: "review-fixture",
    baseUrl: "process://review-fixture",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 65536,
    maxTokens: 4096,
}
function provider(model = fixtureModel) {
    return createProvider({
        id: "claude-code",
        auth: {
            apiKey: {
                name: "Fixture login",
                async check() {
                    return { type: "api_key" as const, source: "fixture" }
                },
                async resolve() {
                    return { auth: { apiKey: "fixture-only" }, source: "fixture" }
                },
            },
        },
        models: [model],
        api: {
            stream() {
                throw new Error("Selection tests must not generate")
            },
            streamSimple() {
                throw new Error("Selection tests must not generate")
            },
        },
    })
}
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-model-"))
    const agentDir = path.join(root, "agent")
    const extensionPath = path.join(root, "provider/index.ts")
    fs.mkdirSync(agentDir)
    fs.mkdirSync(path.dirname(extensionPath))
    fs.writeFileSync(extensionPath, "export default function () {}\n")
    fs.writeFileSync(path.join(agentDir, "auth.json"), "{}")
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = agentDir
    const environment: ReviewerEnvironment = {
        defaultProvider: "openai-codex",
        defaultModel: "gpt-5.3-codex",
        claudeCode: { kind: "loaded", provider: provider(), extensionPath },
    }
    return {
        root,
        agentDir,
        extensionPath,
        environment,
        cleanup() {
            if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
            else process.env.PI_CODING_AGENT_DIR = previousAgentDir
            fs.rmSync(root, { recursive: true, force: true })
        },
    }
}
const unavailable: ReviewerEnvironment = {
    defaultProvider: undefined,
    defaultModel: undefined,
    claudeCode: { kind: "unavailable" },
}

function fakeExtensionSource(log: string, allowed: string, forbidden: string): string {
    return `
import * as fs from "node:fs";
import { createProvider, createAssistantMessageEventStream, getCurrentTools } from "@earendil-works/pi-ai";
const model=${JSON.stringify(fixtureModel)};
function streamFixture(model,context){
   const tools=getCurrentTools(context.messages).map(t=>t.name).sort();
   const results=context.messages.filter(m=>m.role==="toolResult");
   fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({tools,results}));
   const probing=results.length===0;
   const content=probing ? [
    {type:"toolCall",id:"allowed-read",name:"read",arguments:{path:${JSON.stringify(allowed)}}},
    {type:"toolCall",id:"blocked-write",name:"write",arguments:{path:${JSON.stringify(forbidden)},content:"not allowed"}},
    {type:"toolCall",id:"blocked-bash",name:"bash",arguments:{command:"false"}},
    {type:"toolCall",id:"blocked-codemode",name:"codemode",arguments:{code:"text(1)"}}
   ] : [{type:"text",text:JSON.stringify({findings:[],signoff:"approved"})}];
   const message={role:"assistant",content,api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:probing?"toolUse":"stop",usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
   const stream=createAssistantMessageEventStream();stream.push({type:"start",partial:message});stream.push({type:"done",reason:message.stopReason,message});stream.end();return stream;
}
export default function(pi){
 pi.registerCommand("claude-code-status",{description:"Fixture status",handler:async()=>{}});
 pi.registerProvider(createProvider({
  id:"claude-code",
  auth:{apiKey:{name:"Fixture login",check:async()=>({type:"api_key",source:"fixture"}),resolve:async()=>({auth:{apiKey:"fixture-only"},source:"fixture"})}},
  models:[model],
  api:{stream:streamFixture,streamSimple:streamFixture}
 }));
}
`
}

async function loadedEnvironment(root: string, agentDir: string, packageRoot: string, enabled = true) {
    let environment: ReviewerEnvironment | undefined
    const capture: ExtensionFactory = (pi) => {
        pi.on("session_start", (_event, ctx) => {
            environment = reviewerEnvironment(pi, ctx.modelRegistry)
        })
    }
    const settingsManager = SettingsManager.inMemory({
        packages: [{ source: packageRoot, ...(enabled ? {} : { extensions: [] }) }],
        defaultProvider: "claude-code",
        defaultModel: fixtureModel.id,
        compaction: { enabled: false },
        retry: { enabled: false },
    })
    settingsManager.setProjectTrusted(true)
    const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir,
        settingsManager,
        extensionFactories: [capture],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
    })
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    const modelRuntime = await ModelRuntime.create({
        modelsPath: null,
        authPath: path.join(agentDir, "auth.json"),
        refreshOnCreate: false,
    })
    const { session } = await createAgentSession({
        cwd: root,
        agentDir,
        settingsManager,
        modelRuntime,
        model: fixtureModel,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(root),
        noTools: "all",
    })
    try {
        await session.bindExtensions({ mode: "print" })
        assert.ok(environment)
        return environment
    } finally {
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
        session.dispose()
    }
}

describe("reviewer provider loading", () => {
    it("preserves the configured/automatic standard default without inheriting a parent selection", async () => {
        assert.deepEqual(await resolveReviewerLaunch(unavailable, undefined), { kind: "standard", model: undefined })
        const h = fixture()
        try {
            assert.deepEqual(await resolveReviewerLaunch(h.environment, undefined), {
                kind: "standard",
                model: undefined,
            })
        } finally {
            h.cleanup()
        }
    })

    it("pins a configured Claude Code default and keeps explicit isolation flags", async () => {
        const h = fixture()
        try {
            const launch = await resolveReviewerLaunch(
                { ...h.environment, defaultProvider: "claude-code", defaultModel: fixtureModel.id },
                undefined,
            )
            assert.deepEqual(launch, {
                kind: "claude-code",
                model: "claude-code/review-fixture",
                extensionPath: h.extensionPath,
            })
            const args = buildReviewerArgs("review", "prompt.md", launch)
            assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls")
            for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-session"])
                assert.ok(args.includes(flag))
            assert.equal(args.filter((value) => value === "--extension").length, 3)
            assert.equal(args[args.indexOf("--model") + 1], "claude-code/review-fixture")
        } finally {
            h.cleanup()
        }
    })

    it("uses native qualified/pattern selection and thinking suffixes", async () => {
        const h = fixture()
        try {
            for (const selection of ["claude-code/review-fixture", "review-fixture:high"]) {
                const launch = await resolveReviewerLaunch(h.environment, selection)
                assert.equal(launch.kind, "claude-code")
                assert.equal(launch.model, selection)
            }
            for (const selection of ["openai-codex/gpt-5.3-codex", "zai/glm-4.7"]) {
                const launch = await resolveReviewerLaunch(h.environment, selection)
                assert.deepEqual(launch, { kind: "standard", model: selection })
                assert.equal(
                    buildReviewerArgs("review", "prompt.md", launch).filter((value) => value === "--extension").length,
                    2,
                )
            }
        } finally {
            h.cleanup()
        }
    })

    it("reports missing or deleted providers without installation or fallback", async () => {
        await assert.rejects(
            resolveReviewerLaunch(unavailable, "claude-code/review-fixture"),
            /provider is unavailable/,
        )
        await assert.rejects(
            resolveReviewerLaunch(
                { ...unavailable, defaultProvider: "claude-code", defaultModel: fixtureModel.id },
                undefined,
            ),
            /provider is unavailable/,
        )
        const h = fixture()
        try {
            fs.rmSync(h.extensionPath)
            await assert.rejects(
                resolveReviewerLaunch(
                    { ...h.environment, defaultProvider: "claude-code", defaultModel: fixtureModel.id },
                    undefined,
                ),
                /entry point is unavailable/,
            )
        } finally {
            h.cleanup()
        }
    })

    it("rejects a native ambiguous model instead of guessing its provider", async () => {
        const h = fixture()
        try {
            fs.writeFileSync(
                path.join(h.agentDir, "models.json"),
                JSON.stringify({ providers: { anthropic: { apiKey: "fixture-only" } } }),
            )
            const same = getBuiltinModels("anthropic")[0]
            assert.ok(same)
            h.environment.claudeCode = {
                kind: "loaded",
                provider: provider({ ...fixtureModel, id: same.id, name: same.name }),
                extensionPath: h.extensionPath,
            }
            await assert.rejects(resolveReviewerLaunch(h.environment, same.id), /ambiguous across providers/)
        } finally {
            h.cleanup()
        }
    })

    for (const layout of [
        "local",
        "npm/node_modules/@earendil-works/pi-claude-code",
        "git/github.com/earendil-works/pi-claude-code",
    ]) {
        it(`uses native enabled entry-point provenance in ${layout} locations`, async () => {
            const h = fixture()
            try {
                const packageRoot = path.join(h.root, layout)
                fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true })
                const entry = path.join(packageRoot, "src/index.ts")
                fs.writeFileSync(
                    path.join(packageRoot, "package.json"),
                    JSON.stringify({
                        name: "@earendil-works/pi-claude-code",
                        version: "0.1.0",
                        pi: { extensions: ["./src/index.ts"] },
                    }),
                )
                fs.writeFileSync(entry, fakeExtensionSource(path.join(h.root, "unused-log"), "unused", "unused"))
                const environment = await loadedEnvironment(h.root, h.agentDir, packageRoot)
                assert.equal(environment.claudeCode.kind, "loaded")
                if (environment.claudeCode.kind === "loaded") assert.equal(environment.claudeCode.extensionPath, entry)
                const disabled = await loadedEnvironment(h.root, h.agentDir, packageRoot, false)
                assert.equal(disabled.claudeCode.kind, "unavailable")
            } finally {
                h.cleanup()
            }
        })
    }

    it("runs the real reviewer subprocess with only read-only tools and blocks undeclared actions", async () => {
        const h = fixture()
        const previousScript = process.argv[1]
        try {
            const log = path.join(h.root, "requests.json")
            const allowed = path.join(h.root, "allowed.txt")
            const forbidden = path.join(h.root, "forbidden.txt")
            fs.writeFileSync(allowed, "READ_ONLY_OK")
            fs.writeFileSync(h.extensionPath, fakeExtensionSource(log, allowed, forbidden))
            fs.writeFileSync(
                path.join(h.agentDir, "settings.json"),
                JSON.stringify({
                    defaultProvider: "claude-code",
                    defaultModel: fixtureModel.id,
                    defaultProjectTrust: "always",
                    retry: { enabled: false },
                }),
            )
            fs.writeFileSync(
                path.join(h.agentDir, "permissions.json"),
                JSON.stringify({ defaultMode: "deny", allow: ["read"] }),
            )
            process.argv[1] = fs.realpathSync(path.resolve("node_modules/.bin/pi"))
            const result = await runReviewAgent({
                environment: { ...h.environment, defaultProvider: "claude-code", defaultModel: fixtureModel.id },
                cwd: h.root,
                prompt: "Return the structured review report.",
                agentName: "isolation-fixture",
                progressLabel: "test",
            })
            assert.equal(result.exitCode, 0, result.stderr)
            assert.match(result.finalOutput, /"signoff":"approved"/)
            const captured = JSON.parse(fs.readFileSync(log, "utf8"))
            assert.deepEqual(captured.tools, ["find", "grep", "ls", "read"])
            assert.match(
                JSON.stringify(captured.results.find((r: { toolName: string }) => r.toolName === "read")),
                /READ_ONLY_OK/,
            )
            for (const name of ["write", "bash", "codemode"]) {
                const outcome = captured.results.find((r: { toolName: string }) => r.toolName === name)
                assert.ok(outcome?.isError, `${name} must be unavailable`)
            }
            assert.equal(fs.existsSync(forbidden), false)
        } finally {
            process.argv[1] = previousScript
            h.cleanup()
        }
    })
})
