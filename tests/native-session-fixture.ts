import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import {
    createAssistantMessageEventStream,
    type AssistantMessage,
    type JsonObject,
    type Model,
    type TranscriptContext,
} from "@earendil-works/pi-ai"
import {
    createAgentSession,
    DefaultResourceLoader,
    SessionManager,
    SettingsManager,
    VERSION,
    type AgentSessionEvent,
    type ExtensionFactory,
} from "@earendil-works/pi-coding-agent"

const model: Model<"openai-completions"> = {
    id: "fixture",
    name: "Fixture",
    provider: "fixture",
    api: "openai-completions",
    baseUrl: "https://fixture.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 65536,
    maxTokens: 4096,
}
let sequence = 0
function message(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
    return {
        role: "assistant",
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason,
        timestamp: Date.now(),
        usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 15,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
    }
}
export function call(...calls: Array<{ name: string; arguments: JsonObject }>) {
    return message(
        calls.map((call) => ({ ...call, type: "toolCall", id: `fixture-${++sequence}` })),
        "toolUse",
    )
}
export function answer(text: string) {
    return message([{ type: "text", text }], "stop")
}
export function failure(text: string) {
    return { ...message([], "error"), errorMessage: text }
}
export function requestText(context: TranscriptContext) {
    return context.messages
        .flatMap((message) =>
            typeof message.content === "string"
                ? [message.content]
                : message.content.filter((part) => part.type === "text").map((part) => part.text),
        )
        .join("\n")
}
type Reply = AssistantMessage | ((context: TranscriptContext) => AssistantMessage | Promise<AssistantMessage>)

export async function nativeSessionFixture(options: {
    extensions: ExtensionFactory[]
    tools?: string[]
    setup?: (root: string) => void
    review?: (root: string, title: string, signal?: AbortSignal) => Promise<string | undefined>
}) {
    assert.equal(VERSION, "1.3.0")
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-"))
    const agentDir = path.join(root, "agent")
    const oldAgentDir = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = agentDir
    fs.mkdirSync(agentDir)
    options.setup?.(root)
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } })
    settingsManager.setProjectTrusted(true)
    const manager = SessionManager.inMemory(root)
    const replies: Reply[] = []
    const requests: TranscriptContext[] = []
    const events: AgentSessionEvent[] = []
    const errors: unknown[] = []
    async function open() {
        const loader = new DefaultResourceLoader({
            cwd: root,
            agentDir,
            settingsManager,
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            extensionFactories: [
                (pi) =>
                    pi.registerProvider(model.provider, {
                        api: model.api,
                        baseUrl: model.baseUrl,
                        apiKey: "fixture-only-credential",
                        models: [
                            {
                                id: model.id,
                                name: model.name,
                                input: model.input,
                                cost: model.cost,
                                reasoning: model.reasoning,
                                contextWindow: model.contextWindow,
                                maxTokens: model.maxTokens,
                            },
                        ],
                    }),
                ...options.extensions,
            ],
        })
        await loader.reload()
        const { session } = await createAgentSession({
            cwd: root,
            agentDir,
            model,
            settingsManager,
            resourceLoader: loader,
            sessionManager: manager,
            tools: options.tools ?? ["read", "edit", "write", "codemode"],
        })
        session.agent.streamFunction = async (_model, context) => {
            requests.push(context)
            try {
                const next = replies.shift()
                assert.ok(next, "Unexpected model request: no scripted response remains")
                const reply = typeof next === "function" ? await next(context) : next
                assert.ok(reply.stopReason !== "pending", "Scripted responses must be final")
                const stream = createAssistantMessageEventStream()
                if (reply.stopReason === "error" || reply.stopReason === "aborted") {
                    stream.push({ type: "error", reason: reply.stopReason, error: reply })
                } else {
                    stream.push({ type: "done", reason: reply.stopReason, message: reply })
                }
                stream.end()
                return stream
            } catch (error) {
                errors.push(error)
                throw error
            }
        }
        session.subscribe((event) => events.push(event))
        const ui = session.extensionRunner.createContext().ui
        await session.bindExtensions({
            mode: options.review ? "rpc" : "print",
            ...(options.review
                ? {
                      uiContext: {
                          ...ui,
                          select: (title, _choices, dialog) => options.review!(root, title, dialog?.signal),
                      },
                  }
                : {}),
            onError: (error) => errors.push(error),
        })
        return session
    }
    let session = await open()
    return {
        root,
        manager,
        settingsManager,
        requests,
        events,
        get session() {
            return session
        },
        respond(...next: Reply[]) {
            replies.push(...next)
        },
        async prompt(text: string) {
            await session.prompt(text)
            assert.deepEqual(errors, [], "Native session/response errors")
            assert.equal(replies.length, 0, "Not all scripted model responses were consumed")
        },
        async reopen() {
            await session.extensionRunner.emit({ type: "session_shutdown", reason: "resume" })
            session.dispose()
            session = await open()
        },
        async cleanup() {
            try {
                await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
            } finally {
                session.dispose()
                if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
                else process.env.PI_CODING_AGENT_DIR = oldAgentDir
                fs.rmSync(root, { recursive: true, force: true })
            }
        },
    }
}
