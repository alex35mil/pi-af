/** Session introspection: current context estimates, tool exposure, and complete billing. */

import { getCurrentTools, type Tool, type Usage } from "@earendil-works/pi-ai"
import {
    estimateTokens as estimateMessageTokens,
    type ExtensionAPI,
    type ExtensionContext,
    type SessionEntry,
    type ToolInfo,
} from "@earendil-works/pi-coding-agent"

type ReportAPI = Pick<ExtensionAPI, "getAllTools" | "getActiveTools" | "getCommands">
type ReportContext = Pick<ExtensionContext, "getContextUsage" | "getSystemPrompt" | "model" | "sessionManager">

const RESOURCE_TOOLS = new Set(["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"])

export default function (pi: ExtensionAPI) {
    pi.registerCommand("context", {
        description: "Show context usage, tools, skills, and session billing",
        handler: async (_args, ctx) => {
            await ctx.ui.editor("Context", renderContextReport(pi, ctx))
        },
    })
}

export function renderContextReport(pi: ReportAPI, ctx: ReportContext): string {
    const lines = ["Context Usage"]
    const usage = ctx.getContextUsage()
    const modelId = ctx.model?.id ?? "unknown"
    if (usage) {
        const used = usage.tokens === null ? "unknown" : formatTokens(usage.tokens)
        const percent = usage.percent === null ? "unknown" : `${usage.percent.toFixed(0)}%`
        const free = usage.tokens === null ? "unknown" : formatTokens(Math.max(0, usage.contextWindow - usage.tokens))
        lines.push(`  ${modelId} · ${used}/${formatTokens(usage.contextWindow)} tokens (${percent})`)
        lines.push(`  Free space: ${free} tokens`)
    } else {
        lines.push(`  ${modelId} · no usage data`)
        lines.push("  Free space: unknown")
    }

    const allTools = pi.getAllTools()
    const byName = new Map(allTools.map((tool) => [tool.name, tool]))
    const active = new Set(pi.getActiveTools())
    const projection = ctx.sessionManager.buildSessionProjection()
    const savedTools = getCurrentTools(projection.messages)
    const savedByName = new Map(savedTools.map((tool) => [tool.name, tool]))
    const groups = new Map<string, Tool[]>([
        ["Built-in tools", []],
        ["Extension tools", []],
        ["MCP tools", []],
        ["Tools awaiting metadata", []],
    ])
    for (const tool of savedTools) {
        const metadata = byName.get(tool.name)
        const group =
            tool.name.startsWith("mcp__") || RESOURCE_TOOLS.has(tool.name)
                ? "MCP tools"
                : !metadata
                  ? "Tools awaiting metadata"
                  : metadata.sourceInfo.source === "builtin"
                    ? "Built-in tools"
                    : "Extension tools"
        groups.get(group)!.push(tool)
    }

    lines.push("", "Saved Context Components (estimated)")
    lines.push(`  System prompt: ${formatTokens(estimateTextTokens(ctx.getSystemPrompt()))} tokens`)
    for (const [label, tools] of groups) {
        if (tools.length > 0) {
            const tokens = tools.reduce((sum, tool) => sum + estimateToolTokens(tool), 0)
            lines.push(`  ${label}: ${formatTokens(tokens)} tokens (${tools.length} tools)`)
        }
    }
    const messages = projection.messages.filter((message) => message.role !== "system")
    const messageTokens = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
    lines.push(`  Projected messages: ${formatTokens(messageTokens)} tokens`)
    lines.push("  Tool estimates use saved transcript declarations; final provider loadouts can differ.")
    lines.push("  These estimates are not cumulative billed tokens or an exact sum of current occupancy.")

    const callable = allTools.filter((tool) => isCallable(tool, active)).length
    lines.push("", `Tools (${allTools.length} registered, ${active.size} active, ${callable} callable from tools)`)
    for (const tool of allTools) {
        const selection = active.has(tool.name) ? ", active" : ""
        const saved = savedByName.get(tool.name)
        const schema = saved ? `${formatTokens(estimateToolTokens(saved))} saved schema tokens` : "no saved declaration"
        lines.push(`  ${tool.name} — ${tool.exposure}${selection}; ${schema}`)
    }
    lines.push("  Active selection, script-callable tools, and model declarations are different sets.")

    const skills = pi.getCommands().filter((command) => command.source === "skill")
    if (skills.length > 0) {
        lines.push("", "Skills")
        for (const skill of skills) lines.push(`  ${skill.name} — ${skill.sourceInfo.path}`)
    }

    const totals = sessionBilling(ctx.sessionManager.getEntries())
    lines.push("", "Session Billing (all session branches)")
    lines.push(
        `  Messages: ${totals.messages} (${totals.user} user, ${totals.assistant} assistant, ${totals.toolResults} tool results, ${totals.other} other)`,
    )
    lines.push(`  Tokens: ${formatTokens(totals.input)} in / ${formatTokens(totals.output)} out`)
    lines.push(`  Cache: ${formatTokens(totals.cacheRead)} read / ${formatTokens(totals.cacheWrite)} written`)
    lines.push(
        `  Total billed tokens: ${formatTokens(totals.input + totals.output + totals.cacheRead + totals.cacheWrite)}`,
    )
    lines.push(`  Cost: $${totals.cost.toFixed(2)}`)
    return lines.join("\n")
}

/** Match native session totals: nested usage is already aggregated into parent tool results. */
export function sessionBilling(entries: readonly SessionEntry[]) {
    const totals = {
        messages: 0,
        user: 0,
        assistant: 0,
        toolResults: 0,
        other: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
    }
    const add = (usage: Usage) => {
        totals.input += usage.input
        totals.output += usage.output
        totals.cacheRead += usage.cacheRead
        totals.cacheWrite += usage.cacheWrite
        totals.cost += usage.cost.total
    }
    for (const entry of entries) {
        if (entry.type === "usage") add(entry.usage)
        else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) add(entry.usage)
        if (entry.type !== "message") continue
        totals.messages++
        const message = entry.message
        switch (message.role) {
            case "user":
                totals.user++
                break
            case "assistant":
                totals.assistant++
                add(message.usage)
                break
            case "toolResult":
                totals.toolResults++
                if (message.usage) add(message.usage)
                break
            default:
                totals.other++
        }
    }
    return totals
}

function isCallable(tool: ToolInfo, active: ReadonlySet<string>): boolean {
    return (
        tool.exposure === "codemode" ||
        tool.exposure === "deferred" ||
        (tool.exposure === "direct" && active.has(tool.name))
    )
}

function estimateToolTokens(tool: Tool): number {
    return estimateTextTokens(
        JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }),
    )
}

function estimateTextTokens(text: string): number {
    return Math.ceil(text.length / 4)
}

function formatTokens(tokens: number): string {
    return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}
