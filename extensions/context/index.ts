/**
 * Context Extension
 *
 * Provides a /context command that shows session introspection:
 * model info, context usage breakdown, tools, skills, and session stats.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export default function (pi: ExtensionAPI) {
    pi.registerCommand("context", {
        description: "Show context usage, tools, skills, and session stats",
        handler: async (_args, ctx) => {
            const lines: string[] = []

            // --- Context Usage ---
            const usage = ctx.getContextUsage()
            const modelId = ctx.model?.id ?? "unknown"
            if (usage) {
                const used = formatTokens(usage.tokens ?? 0)
                const total = formatTokens(usage.contextWindow)
                const pct = usage.percent != null ? `${usage.percent.toFixed(0)}%` : "?%"
                lines.push("Context Usage")
                lines.push(`  ${modelId} · ${used}/${total} tokens (${pct})`)
            } else {
                lines.push("Context Usage")
                lines.push(`  ${modelId} · no usage data`)
            }
            lines.push("")

            // --- Token Breakdown ---
            const allTools = pi.getAllTools()
            const activeToolNames = new Set(pi.getActiveTools())

            const builtinTools = allTools.filter((t) => !t.name.startsWith("mcp__") && activeToolNames.has(t.name))
            const mcpTools = allTools.filter((t) => t.name.startsWith("mcp__") && activeToolNames.has(t.name))
            const extensionTools = allTools.filter(
                (t) =>
                    !t.name.startsWith("mcp__") &&
                    !["read", "bash", "edit", "write", "grep", "find", "ls"].includes(t.name) &&
                    activeToolNames.has(t.name),
            )

            const toolTokens = (tools: typeof allTools) =>
                tools.reduce(
                    (sum, t) =>
                        sum +
                        estimateTokens(
                            JSON.stringify({
                                name: t.name,
                                description: t.description,
                                parameters: t.parameters,
                            }),
                        ),
                    0,
                )

            const systemPrompt = ctx.getSystemPrompt()
            const systemPromptTokens = estimateTokens(systemPrompt)

            const builtinTokens = toolTokens(builtinTools)
            const mcpTokenCount = toolTokens(mcpTools)
            const extensionTokens = toolTokens(extensionTools)

            // Message stats from session
            let userCount = 0
            let assistantCount = 0
            let toolResultCount = 0
            let inputTokens = 0
            let outputTokens = 0
            let totalCost = 0

            for (const entry of ctx.sessionManager.getBranch()) {
                if (entry.type !== "message") continue
                const msg = entry.message
                if (msg.role === "user") {
                    userCount++
                } else if (msg.role === "assistant") {
                    assistantCount++
                    const a = msg as any
                    if (a.usage) {
                        inputTokens += a.usage.input ?? 0
                        outputTokens += a.usage.output ?? 0
                        totalCost += a.usage.cost?.total ?? 0
                    }
                } else if (msg.role === "toolResult") {
                    toolResultCount++
                }
            }

            const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0
            const usedTokens = usage?.tokens ?? 0
            const freeTokens = Math.max(0, contextWindow - usedTokens)

            lines.push("Token Breakdown (estimated)")
            lines.push(`  System prompt:  ${formatTokens(systemPromptTokens)} tokens`)
            lines.push(`  Built-in tools: ${formatTokens(builtinTokens)} tokens (${builtinTools.length} tools)`)
            if (extensionTools.length > 0) {
                lines.push(
                    `  Extension tools: ${formatTokens(extensionTokens)} tokens (${extensionTools.length} tools)`,
                )
            }
            if (mcpTools.length > 0) {
                lines.push(`  MCP tools:      ${formatTokens(mcpTokenCount)} tokens (${mcpTools.length} tools)`)
            }
            lines.push(`  Messages:       ${formatTokens(inputTokens + outputTokens)} tokens`)
            lines.push(`  Free space:     ${formatTokens(freeTokens)} tokens`)
            lines.push("")

            // --- Tools ---
            const activeTools = allTools.filter((t) => activeToolNames.has(t.name))
            lines.push(`Tools (${activeTools.length} active)`)
            for (const t of activeTools) {
                const tokens = estimateTokens(
                    JSON.stringify({
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                    }),
                )
                lines.push(`  ${t.name} — ${formatTokens(tokens)} tokens`)
            }
            lines.push("")

            // --- Skills ---
            const skills = pi.getCommands().filter((c) => c.source === "skill")
            if (skills.length > 0) {
                lines.push("Skills")
                for (const s of skills) {
                    const sourcePath = s.sourceInfo?.path
                    lines.push(`  ${s.name}${sourcePath ? ` — ${sourcePath}` : ""}`)
                }
                lines.push("")
            }

            // --- Session ---
            const totalMessages = userCount + assistantCount + toolResultCount
            lines.push("Session")
            lines.push(
                `  Messages: ${totalMessages} (${userCount} user, ${assistantCount} assistant, ${toolResultCount} tool results)`,
            )
            lines.push(`  Tokens: ${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out`)
            if (totalCost > 0) {
                lines.push(`  Cost: $${totalCost.toFixed(2)}`)
            }

            await ctx.ui.editor("Context", lines.join("\n"))
        },
    })
}

function estimateTokens(str: string): number {
    return Math.ceil(str.length / 4)
}

function formatTokens(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
}
