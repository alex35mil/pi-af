import "./host-runtime.ts"

import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

import type { AssistantMessageDiagnostic } from "@earendil-works/pi-ai"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { RUNTIME_ENV } from "../extensions/__lib/runtime.ts"
import status, {
    claudeLimits,
    codexLimits,
    formatLimits,
    LIMITS_STATUS,
    RUNTIME_STATUS,
} from "../extensions/status/index.ts"

const H5_RESET = 1793359800
const WK_RESET = 1793588400

/** A Claude `claude-code.rate-limit` diagnostic; a window passed as undefined is absent entirely. */
function claudeDiagnostic(windows: { five_hour?: unknown; seven_day?: unknown }): AssistantMessageDiagnostic {
    return {
        type: "claude-code.rate-limit",
        timestamp: 1,
        details: { status: "allowed", unifiedWindows: windows } as never,
    }
}

function claudeWindow(utilization: unknown, resetsAt: unknown = undefined) {
    return { utilization, resetsAt }
}

function claudeBoth(fiveHour: number, sevenDay: number): AssistantMessageDiagnostic {
    return claudeDiagnostic({
        five_hour: claudeWindow(fiveHour, H5_RESET),
        seven_day: claudeWindow(sevenDay, WK_RESET),
    })
}

/** A Codex `codex.rate_limits` event; `null` models a window the provider reports as null. */
function codexEvent(primary: unknown, secondary: unknown) {
    return { type: "codex.rate_limits", rate_limits: { primary, secondary } }
}

function codexWindow(usedPercent: unknown, resetAt: unknown = undefined) {
    return { used_percent: usedPercent, reset_at: resetAt }
}

type Handler = (event: unknown, ctx: unknown) => unknown

function harness(provider: string | undefined) {
    const handlers = new Map<string, Handler>()
    const statuses = new Map<string, string | undefined>()
    const ctx = {
        model: provider === undefined ? undefined : { provider },
        ui: { setStatus: (key: string, text: string | undefined) => statuses.set(key, text) },
    }
    status({ on: (name: string, handler: Handler) => handlers.set(name, handler) } as unknown as ExtensionAPI)
    const emit = (name: string, event: Record<string, unknown>) => {
        const handler = handlers.get(name)
        assert.ok(handler, `missing handler for ${name}`)
        return handler({ type: name, ...event }, ctx)
    }
    return {
        statuses,
        selectModel(next: string) {
            ctx.model = { provider: next }
            emit("model_select", { model: { provider: next }, previousModel: undefined, source: "set" })
        },
        start: () => emit("session_start", { reason: "startup" }),
        claudeMessage: (diagnostics: AssistantMessageDiagnostic[]) =>
            emit("message_end", { message: { role: "assistant", provider: "claude-code", diagnostics } }),
        codexEvent: (data: unknown) =>
            emit("provider_stream_event", {
                provider: "openai-codex",
                api: "openai-codex-responses",
                model: "m",
                data,
            }),
    }
}

describe("status limits parsing", () => {
    it("converts Claude utilization fractions to whole percentages with resets from the latest diagnostic", () => {
        assert.deepEqual(claudeLimits([claudeBoth(0.1, 0.2), claudeBoth(0.256, 0.61)]), {
            h5: { used: 26, resetsAt: H5_RESET },
            wk: { used: 61, resetsAt: WK_RESET },
        })
    })

    it("reads Codex used_percent and reset_at values", () => {
        assert.deepEqual(codexLimits(codexEvent(codexWindow(25.6, H5_RESET), codexWindow(61, WK_RESET))), {
            h5: { used: 26, resetsAt: H5_RESET },
            wk: { used: 61, resetsAt: WK_RESET },
        })
    })

    it("omits a missing or non-numeric reset time and keeps its percentage", () => {
        assert.deepEqual(
            claudeLimits([claudeDiagnostic({ five_hour: claudeWindow(0.2), seven_day: claudeWindow(0.6, "soon") })]),
            { h5: { used: 20 }, wk: { used: 60 } },
        )
        assert.deepEqual(codexLimits(codexEvent(codexWindow(10, null), codexWindow(40, WK_RESET))), {
            h5: { used: 10 },
            wk: { used: 40, resetsAt: WK_RESET },
        })
    })

    it("drops a reset time whose window has no usable percentage", () => {
        assert.deepEqual(
            claudeLimits([
                claudeDiagnostic({ five_hour: claudeWindow(undefined, H5_RESET), seven_day: claudeWindow(0.6) }),
            ]),
            { wk: { used: 60 } },
        )
        assert.equal(codexLimits(codexEvent(codexWindow(null, H5_RESET), codexWindow("61", WK_RESET))), undefined)
    })

    it("keeps a single reported window", () => {
        assert.deepEqual(claudeLimits([claudeDiagnostic({ seven_day: claudeWindow(0.61, WK_RESET) })]), {
            wk: { used: 61, resetsAt: WK_RESET },
        })
        assert.deepEqual(codexLimits(codexEvent(codexWindow(26, H5_RESET), null)), {
            h5: { used: 26, resetsAt: H5_RESET },
        })
    })

    it("returns nothing for payloads with neither window", () => {
        assert.equal(claudeLimits(undefined), undefined)
        assert.equal(claudeLimits([{ type: "other", timestamp: 1 }]), undefined)
        assert.equal(claudeLimits([claudeDiagnostic({})]), undefined)
        assert.equal(codexLimits({ type: "response.completed" }), undefined)
        assert.equal(codexLimits(codexEvent(null, null)), undefined)
        assert.equal(codexLimits(null), undefined)
    })

    it("formats only the present fields, in order", () => {
        assert.equal(
            formatLimits({ h5: { used: 26, resetsAt: H5_RESET }, wk: { used: 61, resetsAt: WK_RESET } }),
            `{"h5":26,"h5Reset":${H5_RESET},"wk":61,"wkReset":${WK_RESET}}`,
        )
        assert.equal(formatLimits({ h5: { used: 26 } }), '{"h5":26}')
        assert.equal(formatLimits({ wk: { used: 61, resetsAt: WK_RESET } }), `{"wk":61,"wkReset":${WK_RESET}}`)
    })
})

describe("status extension", () => {
    const original = process.env[RUNTIME_ENV]
    afterEach(() => {
        if (original === undefined) delete process.env[RUNTIME_ENV]
        else process.env[RUNTIME_ENV] = original
    })

    it("publishes the runtime on session start and clears it when the runtime is invalid", () => {
        const host = harness("claude-code")
        host.start()
        assert.equal(host.statuses.get(RUNTIME_STATUS), "host")
        assert.ok(host.statuses.has(LIMITS_STATUS))
        assert.equal(host.statuses.get(LIMITS_STATUS), undefined)

        process.env[RUNTIME_ENV] = "sandbox"
        const sandbox = harness("claude-code")
        sandbox.start()
        assert.equal(sandbox.statuses.get(RUNTIME_STATUS), "sandbox")

        process.env[RUNTIME_ENV] = "bogus"
        const invalid = harness("claude-code")
        invalid.start()
        assert.ok(invalid.statuses.has(RUNTIME_STATUS))
        assert.equal(invalid.statuses.get(RUNTIME_STATUS), undefined)
    })

    it("publishes Claude limits with reset times from message_end", () => {
        const h = harness("claude-code")
        h.claudeMessage([claudeBoth(0.22, 0.6)])
        assert.equal(h.statuses.get(LIMITS_STATUS), `{"h5":22,"h5Reset":${H5_RESET},"wk":60,"wkReset":${WK_RESET}}`)
        h.claudeMessage([claudeDiagnostic({ seven_day: claudeWindow(0.61, WK_RESET) })])
        assert.equal(h.statuses.get(LIMITS_STATUS), `{"wk":61,"wkReset":${WK_RESET}}`)
    })

    it("publishes Codex limits while Codex is current and ignores unrelated events", () => {
        const h = harness("openai-codex")
        h.codexEvent(codexEvent(codexWindow(26, H5_RESET), codexWindow(61, WK_RESET)))
        const both = `{"h5":26,"h5Reset":${H5_RESET},"wk":61,"wkReset":${WK_RESET}}`
        assert.equal(h.statuses.get(LIMITS_STATUS), both)
        h.codexEvent({ type: "response.output_text.delta" })
        assert.equal(h.statuses.get(LIMITS_STATUS), both)
        h.codexEvent(codexEvent(codexWindow(30, H5_RESET), null))
        assert.equal(h.statuses.get(LIMITS_STATUS), `{"h5":30,"h5Reset":${H5_RESET}}`)
    })

    it("leaves the status unchanged when a payload has neither window", () => {
        const h = harness("openai-codex")
        h.codexEvent(codexEvent(codexWindow(26), codexWindow(61)))
        h.codexEvent(codexEvent(null, null))
        assert.equal(h.statuses.get(LIMITS_STATUS), '{"h5":26,"wk":61}')
    })

    it("replaces stored values with a one-window update, so the unreported window and its reset disappear", () => {
        const h = harness("claude-code")
        h.claudeMessage([claudeBoth(0.22, 0.6)])
        h.claudeMessage([claudeDiagnostic({ seven_day: claudeWindow(0.65) })])
        assert.equal(h.statuses.get(LIMITS_STATUS), '{"wk":65}')

        h.selectModel("openai-codex")
        h.selectModel("claude-code")
        assert.equal(h.statuses.get(LIMITS_STATUS), '{"wk":65}')
    })

    it("keeps each provider's values and shows the current provider's on model_select", () => {
        const h = harness("claude-code")
        h.claudeMessage([claudeDiagnostic({ five_hour: claudeWindow(0.22), seven_day: claudeWindow(0.6) })])
        h.codexEvent(codexEvent(codexWindow(10), codexWindow(40)))
        assert.equal(h.statuses.get(LIMITS_STATUS), '{"h5":22,"wk":60}')

        h.selectModel("openai-codex")
        assert.equal(h.statuses.get(LIMITS_STATUS), '{"h5":10,"wk":40}')

        h.selectModel("anthropic")
        assert.ok(h.statuses.has(LIMITS_STATUS))
        assert.equal(h.statuses.get(LIMITS_STATUS), undefined)

        h.selectModel("claude-code")
        assert.equal(h.statuses.get(LIMITS_STATUS), '{"h5":22,"wk":60}')
    })
})
