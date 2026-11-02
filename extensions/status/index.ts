/**
 * Publishes Pi status entries for editor integrations such as pi.nvim:
 *
 * - `status:runtime`: where Pi runs, `host` or `sandbox`.
 * - `status:limits`: the current model provider's latest rate-limit usage as JSON with the windows it reported
 *   and their reset times, such as `{"h5":26,"h5Reset":1793359800,"wk":61,"wkReset":1793588400}` or `{"wk":61}`,
 *   cleared while that provider has reported nothing.
 */

import type { AssistantMessageDiagnostic } from "@earendil-works/pi-ai"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

import { resolveRuntime } from "../__lib/runtime.ts"

export const RUNTIME_STATUS = "status:runtime"
export const LIMITS_STATUS = "status:limits"

const CLAUDE_PROVIDER = "claude-code"
const CLAUDE_RATE_LIMIT_DIAGNOSTIC = "claude-code.rate-limit"
const CODEX_PROVIDER = "openai-codex"
const CODEX_RATE_LIMITS_EVENT = "codex.rate_limits"

/** One rate-limit window: usage in whole percent, and the provider's reset timestamp when it reported one. */
export type LimitWindow = { used: number; resetsAt?: number }

/**
 * Rate-limit usage: `h5` for the 5-hour window, `wk` for the weekly window.
 * A window is absent when the provider didn't report its usage; parsers never produce a value with neither.
 */
export type Limits = { h5?: LimitWindow; wk?: LimitWindow }

type StatusContext = Pick<ExtensionContext, "model" | "ui">

export default function (pi: ExtensionAPI) {
    const limitsByProvider = new Map<string, Limits>()

    const publishLimits = (ctx: StatusContext, provider: string | undefined): void => {
        const limits = provider === undefined ? undefined : limitsByProvider.get(provider)
        ctx.ui.setStatus(LIMITS_STATUS, limits === undefined ? undefined : formatLimits(limits))
    }

    // The latest payload replaces the stored one, so a window or reset time the provider stopped reporting
    // disappears instead of showing an old value that looks current. A payload with neither window changes nothing.
    const recordLimits = (ctx: StatusContext, provider: string, limits: Limits | undefined): void => {
        if (limits === undefined) return
        limitsByProvider.set(provider, limits)
        publishLimits(ctx, ctx.model?.provider)
    }

    pi.on("session_start", (_event, ctx) => {
        const result = resolveRuntime()
        // An invalid PI_AF_RUNTIME is reported by the permissions extension; here it only clears the entry.
        ctx.ui.setStatus(RUNTIME_STATUS, "runtime" in result ? result.runtime : undefined)
        publishLimits(ctx, ctx.model?.provider)
    })

    pi.on("model_select", (event, ctx) => {
        publishLimits(ctx, event.model.provider)
    })

    pi.on("message_end", (event, ctx) => {
        const message = event.message
        if (message.role !== "assistant" || message.provider !== CLAUDE_PROVIDER) return
        recordLimits(ctx, CLAUDE_PROVIDER, claudeLimits(message.diagnostics))
    })

    pi.on("provider_stream_event", (event, ctx) => {
        if (event.provider !== CODEX_PROVIDER) return
        recordLimits(ctx, CODEX_PROVIDER, codexLimits(event.data))
    })
}

/**
 * Limits from the latest `claude-code.rate-limit` diagnostic. Utilizations are fractions from 0 to 1;
 * `resetsAt` is passed through as reported (Unix seconds in observed diagnostics).
 */
export function claudeLimits(diagnostics: readonly AssistantMessageDiagnostic[] | undefined): Limits | undefined {
    const diagnostic = diagnostics?.filter((entry) => entry.type === CLAUDE_RATE_LIMIT_DIAGNOSTIC).at(-1)
    const windows = field(diagnostic?.details, "unifiedWindows")
    const claudeWindow = (name: string): LimitWindow | undefined => {
        const window = field(windows, name)
        const utilization = field(window, "utilization")
        return limitWindow(isFiniteNumber(utilization) ? utilization * 100 : undefined, field(window, "resetsAt"))
    }
    return limitsFrom(claudeWindow("five_hour"), claudeWindow("seven_day"))
}

/**
 * Limits from a Codex `codex.rate_limits` stream event. `used_percent` values are already percentages;
 * `reset_at` is passed through as reported.
 */
export function codexLimits(data: unknown): Limits | undefined {
    if (field(data, "type") !== CODEX_RATE_LIMITS_EVENT) return undefined
    const rateLimits = field(data, "rate_limits")
    const codexWindow = (name: string): LimitWindow | undefined => {
        const window = field(rateLimits, name)
        const used = field(window, "used_percent")
        return limitWindow(isFiniteNumber(used) ? used : undefined, field(window, "reset_at"))
    }
    return limitsFrom(codexWindow("primary"), codexWindow("secondary"))
}

/** Flat status text with only the present fields, in `h5`, `h5Reset`, `wk`, `wkReset` order. */
export function formatLimits(limits: Limits): string {
    // JSON.stringify drops undefined fields, so absent windows and reset times are left out.
    return JSON.stringify({
        h5: limits.h5?.used,
        h5Reset: limits.h5?.resetsAt,
        wk: limits.wk?.used,
        wkReset: limits.wk?.resetsAt,
    })
}

/** A window from its usage percentage and raw reset value; no usage means no window, whatever the reset says. */
function limitWindow(usedPercent: number | undefined, resetsAt: unknown): LimitWindow | undefined {
    if (usedPercent === undefined) return undefined
    return {
        used: Math.round(usedPercent),
        ...(isFiniteNumber(resetsAt) ? { resetsAt } : {}),
    }
}

/** Limits from the present windows, or nothing when neither window is present. */
function limitsFrom(fiveHour: LimitWindow | undefined, weekly: LimitWindow | undefined): Limits | undefined {
    if (fiveHour === undefined && weekly === undefined) return undefined
    return {
        ...(fiveHour === undefined ? {} : { h5: fiveHour }),
        ...(weekly === undefined ? {} : { wk: weekly }),
    }
}

function field(value: unknown, key: string): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
    return (value as Record<string, unknown>)[key]
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
}
