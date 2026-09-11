/**
 * Permission Extension
 *
 * Controls tool execution via settings files:
 *   ~/<agent-dir>/permission.settings.json             (global)
 *   <repo-root>/.agents/permission.settings.json       (project, committed)
 *   <repo-root>/.agents/permission.settings.local.json (project, gitignored)
 *
 * Schema:
 * {
 *   "defaultMode": "ask" | "allow" | "deny",
 *   "allow": ["toolPattern", "tool(argPattern)", ...],
 *   "deny":  ["toolPattern", "tool(argPattern)", ...],
 *   "ask":   ["toolPattern", "tool(argPattern)", ...]
 * }
 *
 * Trusted local skills (global + project) may also contribute runtime allow rules
 * via SKILL frontmatter: allowed_tools / allowed-tools.
 *
 * Rule format:
 *   "read"                          — blanket match on a non-MCP tool name
 *   "mcp(playwright, *)"            — every tool from one MCP server
 *   "mcp(*, hint: readOnly)"        — annotated read-only tools from every MCP server
 *   "bash(git *)"                   — match tool "bash" where command matches "git *"
 *   "edit(/tmp/*)"                  — match tool "edit" where path matches "/tmp/*"
 *
 * Evaluation order: deny > ask > allow > defaultMode (default: "ask")
 *
 * Argument matching depends on the tool:
 *   bash  — matched against command string
 *   edit/write/read — matched against file path
 *   grep/find/ls — matched against path argument
 */

import * as fs from "node:fs"
import * as path from "node:path"

import { parseFrontmatter, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent"

import { MCP_TOOL_CATALOG_EVENT, type McpToolCatalog, type McpToolMetadata, validateMcpName } from "../__lib/mcp.js"
import * as project from "../__lib/project.js"
import { analyzeBash, type BashAnalyzer } from "./bash.js"

const EXTENSION = "permission"
const BUILT_IN_ALLOW_RULES = ["bash(true)", "bash(false)"]

export type Mode = "allow" | "ask" | "deny"

export interface PermissionSettings {
    defaultMode?: Mode
    allow?: string[]
    deny?: string[]
    ask?: string[]
    keybindings?: {
        autoAcceptEdits?: string
    }
}

interface ParsedRule {
    toolPattern: string
    argPattern?: string
}

type PermissionList = "allow" | "ask" | "deny"

type McpSelector = { type: "tool"; value: string } | { type: "hint"; value: "readOnly" }

interface ParsedMcpRule {
    server: string
    selector: McpSelector
}

type SettingsResult = { settings: PermissionSettings } | { error: Error }

interface SkillCommandInfo {
    name: string
    sourceInfo: {
        path: string
        scope: "user" | "project" | "temporary"
    }
}

interface SkillAllowSource {
    skill: string
    location: string
    path: string
    rules: string[]
}

interface DerivedSkillAllowState {
    cacheKey: string
    rules: string[]
    sources: SkillAllowSource[]
}

type ReviewNote = {
    path: string
    side: "current" | "proposed"
    lineStart: number
    lineEnd: number
    lines: string[]
    note: string
}

// Runtime mode overrides (toggled by user during session, not persisted)
const SessionModeOverrides = new Map<string, Mode>()

// Status prefixes parsed by pi.nvim to resolve tool-call display status
const STATUS_ACCEPTED = "[accepted]"
const STATUS_REJECTED = "[rejected]"

// [pi.nvim] Track tool calls approved by the user (nvim) so we can flip isError back to false
const approvedToolCalls = new Set<string>()

function formatReviewNotes(notes?: ReviewNote[]): string {
    if (!notes?.length) return ""

    return (
        '\n\nUser review notes require explicit response. Before doing anything else, you MUST reply in chat to the user with every note below and your response to each one. For each note in your chat reply, quote the full note text exactly with every quoted line prefixed by `>`, then write your response below the quote. Do not respond with only a label or summary. Do not ignore, silently drop, or skip a note because you disagree. A response may be as short as "Accepted and agreed.", but every note must have an explicit response: accepted, rejected with reason, or needs clarification. If every note is fully accepted and has an obvious local resolution, do not stop after the chat response and do not wait for user approval; immediately continue with the follow-up edit/tool call. Stop and ask the user only for unclear, rejected, conflicting, scope-changing, or product/domain notes.\n\nReview notes:\n' +
        notes
            .map((n, index) => {
                const range = n.lineStart === n.lineEnd ? `${n.lineStart}` : `${n.lineStart}-${n.lineEnd}`
                const label = `N${index + 1}`

                return [
                    `- ${label}: ${n.side}:${range}`,
                    `  lines: ${JSON.stringify(n.lines)}`,
                    `  note: ${n.note}`,
                ].join("\n")
            })
            .join("\n")
    )
}

const LOCAL_SKILL_SCOPES = new Set(["user", "project", "temporary"])
let cachedDerivedSkillAllowState: DerivedSkillAllowState | undefined

export default function (pi: ExtensionAPI) {
    let mcpCatalog: McpToolCatalog = new Map()
    const disposeMcpCatalogListener = pi.events.on(MCP_TOOL_CATALOG_EVENT, (data) => {
        mcpCatalog = data instanceof Map ? new Map(data as McpToolCatalog) : new Map()
    })

    const initSettings = tryLoadPermissionSettings(() => validatePermissionSettings(loadSettings(process.cwd())))
    const keybindings = "settings" in initSettings ? (initSettings.settings.keybindings ?? {}) : {}
    let displayedSettingsError: string | undefined

    const updatePermissionSettingsErrorDisplay = (result: SettingsResult, ctx: ExtensionContext): void => {
        if ("settings" in result) {
            if (displayedSettingsError !== undefined && ctx.hasUI) {
                ctx.ui.setWidget(`${EXTENSION}:invalid-settings`, undefined)
            }
            displayedSettingsError = undefined
            return
        }

        const message = formatPermissionSettingsError(result.error)
        if (message !== displayedSettingsError) {
            console.error(`[permission] ${message}`)
            if (ctx.hasUI) ctx.ui.notify(message, "error")
        }
        if (ctx.hasUI) {
            ctx.ui.setWidget(`${EXTENSION}:invalid-settings`, [
                "Permission settings are invalid. Agent prompts and tools are blocked.",
                message,
                "Fix the settings, then retry your prompt.",
            ])
        }
        displayedSettingsError = message
    }

    pi.on("session_start", async (_event, ctx) => {
        updatePermissionSettingsErrorDisplay(loadResolvedPermissionSettings(pi, ctx.cwd), ctx)
    })

    pi.on("session_shutdown", async () => {
        disposeMcpCatalogListener()
        mcpCatalog = new Map()
    })

    if (keybindings.autoAcceptEdits) {
        pi.registerShortcut(keybindings.autoAcceptEdits as any, {
            description: "Toggle auto-accept edits",
            handler: toggleAutoAcceptEdits,
        })
    }

    pi.registerCommand("permission-toggle-auto-accept", {
        description: "Toggle auto-accept edits",
        handler: async (_args, ctx) => toggleAutoAcceptEdits(ctx),
    })

    pi.registerCommand("permission-mode", {
        description: "Set permission mode for a tool in the current session",
        handler: async (_args, ctx) => {
            const tool = await ctx.ui.input("Tool name", "e.g. bash, edit")
            if (!tool) return
            const mode = await ctx.ui.select("Mode", ["allow", "ask", "deny"])
            if (!mode) return
            SessionModeOverrides.set(tool, mode as Mode)
            ctx.ui.notify(`Permission mode for "${tool}" set to "${mode}" (current session only)`, "info")
        },
    })

    pi.registerCommand("permission-settings", {
        description: "Show resolved permission settings",
        handler: async (_args, ctx) => {
            const result = loadResolvedPermissionSettings(pi, ctx.cwd)
            if ("error" in result) {
                updatePermissionSettingsErrorDisplay(result, ctx)
                await ctx.ui.editor("Invalid permission settings", formatPermissionSettingsError(result.error))
                return
            }
            updatePermissionSettingsErrorDisplay(result, ctx)

            const derivedSkillAllowState = getDerivedSkillAllowState(pi)
            const overrides = Object.fromEntries(SessionModeOverrides)
            const output = JSON.stringify(
                {
                    settings: result.settings,
                    derivedSkillAllowRules: derivedSkillAllowState.rules,
                    skillRuleSources: derivedSkillAllowState.sources,
                    sessionOverrides: overrides,
                },
                null,
                2,
            )
            await ctx.ui.editor("Resolved permission settings", output)
        },
    })

    pi.on("input", async (_event, ctx) => {
        const result = loadResolvedPermissionSettings(pi, ctx.cwd)
        updatePermissionSettingsErrorDisplay(result, ctx)
        return "settings" in result ? { action: "continue" } : { action: "handled" }
    })

    pi.on("message_end", async (event) => {
        const msg = event.message as unknown as Record<string, unknown>
        // Only process tool results
        if (msg.role !== "toolResult") return
        if (typeof msg.toolCallId !== "string") return

        // Blocked tool results come back as isError=true. Flip back for approved calls
        // so the LLM doesn't treat accepted edits as failures.
        if (approvedToolCalls.delete(msg.toolCallId)) {
            msg.isError = false
        }
    })

    pi.on("tool_call", async (event, ctx) => {
        const settingsResult = loadResolvedPermissionSettings(pi, ctx.cwd)
        updatePermissionSettingsErrorDisplay(settingsResult, ctx)
        if ("error" in settingsResult) {
            ctx.abort()
            return {
                block: true,
                reason: `${STATUS_REJECTED} ${formatPermissionSettingsError(settingsResult.error)}`,
            }
        }

        const argValue = getMatchValue(event.toolName, event.input as Record<string, unknown>)
        const mode = await resolveMode(
            settingsResult.settings,
            event.toolName,
            argValue ?? "",
            ctx.cwd,
            SessionModeOverrides,
            analyzeBash,
            mcpCatalog.get(event.toolName),
        )

        switch (mode) {
            case "allow": {
                return undefined
            }

            case "deny": {
                ctx.abort()
                return {
                    block: true,
                    reason: `${STATUS_REJECTED} Denied by permission settings (${event.toolName})`,
                }
            }

            case "ask": {
                if (!ctx.hasUI) {
                    return {
                        block: true,
                        reason: `${STATUS_REJECTED} Blocked (no UI for confirmation): ${event.toolName}`,
                    }
                }

                switch (event.toolName) {
                    case "edit":
                    case "write": {
                        if (!argValue) break

                        const title = JSON.stringify({
                            prompt: `${event.toolName}: ${argValue}`,
                            toolName: event.toolName,
                            toolInput: event.input,
                        })
                        const choice = await ctx.ui.select(title, ["Accept", "Reject"])

                        if (choice === "Accept") {
                            // TUI — don't block, let the tool apply the change
                            return undefined
                        } else if (choice?.startsWith("{")) {
                            const parsed = JSON.parse(choice)
                            if (parsed.result === "Accepted") {
                                // Nvim plugin already applied the change
                                approvedToolCalls.add(event.toolCallId)
                                return {
                                    block: true,
                                    reason: `${STATUS_ACCEPTED} User approved the edit. Changes applied to ${argValue} as proposed.${formatReviewNotes(parsed.notes)}`,
                                }
                            } else if (parsed.result === "AcceptModified") {
                                // Nvim plugin applied user's modified version
                                approvedToolCalls.add(event.toolCallId)
                                return {
                                    block: true,
                                    reason: `${STATUS_ACCEPTED} User approved with modifications. ${argValue} was updated with user's version, which differs from what you proposed. Current content of ${argValue}:\n\`\`\`\n${parsed.content}\n\`\`\`${formatReviewNotes(parsed.notes)}`,
                                }
                            } else if (parsed.result === "Rejected") {
                                const reviewNotes = formatReviewNotes(parsed.notes)
                                if (reviewNotes) {
                                    return {
                                        block: true,
                                        reason: `${STATUS_REJECTED} User rejected the edit to ${argValue}. File unchanged.${reviewNotes}`,
                                    }
                                }
                            }
                        }
                        ctx.abort()
                        return {
                            block: true,
                            reason: `${STATUS_REJECTED} User rejected the edit to ${argValue}. File unchanged.`,
                        }
                    }
                    case "bash": {
                        if (!argValue) return { block: true, reason: "No command provided" }
                        const allowed = await ctx.ui.confirm("Agent wants to run shell command. Allow?", argValue)
                        if (!allowed) {
                            ctx.abort()
                            return { block: true, reason: `${STATUS_REJECTED} Rejected by user` }
                        }
                        return undefined
                    }
                    default: {
                        const message = argValue ?? JSON.stringify(event.input, null, 2)
                        const allowed = await ctx.ui.confirm(event.toolName, message)
                        if (!allowed) {
                            ctx.abort()
                            return { block: true, reason: `${STATUS_REJECTED} Rejected by user` }
                        }
                        return undefined
                    }
                }
            }
        }
    })
}

function mergePermissions(
    base: Partial<PermissionSettings>,
    override: Partial<PermissionSettings>,
): Partial<PermissionSettings> {
    return {
        defaultMode: override.defaultMode ?? base.defaultMode,
        allow: [...(base.allow ?? []), ...(override.allow ?? [])],
        deny: [...(base.deny ?? []), ...(override.deny ?? [])],
        ask: [...(base.ask ?? []), ...(override.ask ?? [])],
        keybindings: { ...base.keybindings, ...override.keybindings },
    }
}

function loadSettings(cwd: string) {
    return project.loadExtensionSettings<PermissionSettings>(EXTENSION, cwd, mergePermissions)
}

function tryLoadPermissionSettings(load: () => PermissionSettings): SettingsResult {
    try {
        return { settings: load() }
    } catch (error) {
        return { error: error instanceof Error ? error : new Error(String(error)) }
    }
}

function loadResolvedPermissionSettings(pi: ExtensionAPI, cwd: string): SettingsResult {
    return tryLoadPermissionSettings(() => {
        const derivedSkillAllowState = getDerivedSkillAllowState(pi)
        const settings = mergeSkillAllowRules(loadSettings(cwd), derivedSkillAllowState.rules)
        return validatePermissionSettings(settings)
    })
}

function formatPermissionSettingsError(error: Error): string {
    return `Invalid permission settings: ${error.message}`
}

function toggleAutoAcceptEdits(ctx: ExtensionContext) {
    const editCurrent = SessionModeOverrides.get("edit")
    const writeCurrent = SessionModeOverrides.get("write")

    if (editCurrent === "allow" && writeCurrent === "allow") {
        SessionModeOverrides.delete("edit")
        SessionModeOverrides.delete("write")
        ctx.ui.setStatus("permission", undefined)
    } else {
        SessionModeOverrides.set("edit", "allow")
        SessionModeOverrides.set("write", "allow")
        ctx.ui.setStatus("permission", "▶︎ Auto-accept edits")
    }
}

function parseRuleList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .filter((entry): entry is string => typeof entry === "string")
            .filter((entry) => entry.trim().length > 0)
    }

    if (typeof value === "string") return value.trim() ? [value] : []
    return []
}

function getSkillAllowedRules(skillPath: string): string[] {
    let rules: string[]
    try {
        const content = fs.readFileSync(skillPath, "utf-8")
        const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content)
        rules = [...parseRuleList(frontmatter.allowed_tools), ...parseRuleList(frontmatter["allowed-tools"])]
    } catch {
        return []
    }

    validatePermissionSettings({ allow: rules })
    return expandSkillRelativeRules(
        rules.map((rule) => rule.trim()),
        path.dirname(skillPath),
    )
}

function expandSkillRelativeRules(rules: string[], skillDir: string): string[] {
    return rules.map((rule) => expandSkillRelativeRule(rule, skillDir))
}

function expandSkillRelativeRule(rule: string, skillDir: string): string {
    const parsed = parseRule(rule)
    if (!parsed.argPattern) return rule

    const expandedArgPattern = parsed.argPattern.replace(
        /(^|\s)(\.\/\S+)/g,
        (_match, prefix: string, token: string) => {
            return `${prefix}${path.resolve(skillDir, token)}`
        },
    )
    if (expandedArgPattern === parsed.argPattern) return rule
    return `${parsed.toolPattern}(${expandedArgPattern})`
}

function buildSkillAllowCacheKey(skills: SkillCommandInfo[]): string {
    return skills
        .map((skill) => {
            const skillPath = skill.sourceInfo.path ?? ""
            let stamp = "missing"

            if (skillPath) {
                try {
                    const stat = fs.statSync(skillPath)
                    stamp = `${stat.mtimeMs}:${stat.size}`
                } catch {
                    stamp = "missing"
                }
            }

            return `${skill.sourceInfo.scope}:${skillPath}:${stamp}`
        })
        .sort()
        .join("\n")
}

function getDerivedSkillAllowState(pi: ExtensionAPI): DerivedSkillAllowState {
    const skills = pi
        .getCommands()
        .filter(
            (command) =>
                command.source === "skill" &&
                LOCAL_SKILL_SCOPES.has(command.sourceInfo.scope) &&
                typeof command.sourceInfo.path === "string",
        )
        .map(
            (command): SkillCommandInfo => ({
                name: command.name,
                sourceInfo: {
                    path: command.sourceInfo.path,
                    scope: command.sourceInfo.scope,
                },
            }),
        )
        .sort((a, b) => a.sourceInfo.path.localeCompare(b.sourceInfo.path))

    const cacheKey = buildSkillAllowCacheKey(skills)
    if (cachedDerivedSkillAllowState?.cacheKey === cacheKey) {
        return cachedDerivedSkillAllowState
    }

    const sources = skills
        .map((skill) => {
            const rules = getSkillAllowedRules(skill.sourceInfo.path)
            return {
                skill: skill.name.replace(/^skill:/, ""),
                location: skill.sourceInfo.scope,
                path: skill.sourceInfo.path,
                rules,
            }
        })
        .filter((skill) => skill.rules.length > 0)

    cachedDerivedSkillAllowState = {
        cacheKey,
        rules: [...new Set(sources.flatMap((skill) => skill.rules))],
        sources,
    }
    return cachedDerivedSkillAllowState
}

function mergeSkillAllowRules(settings: PermissionSettings, skillRules: string[]): PermissionSettings {
    if (skillRules.length === 0) return settings

    return {
        ...settings,
        allow: [...new Set([...(settings.allow ?? []), ...skillRules])],
    }
}

function parseRule(rule: string): ParsedRule {
    const match = rule.match(/^([^(]+)\((.+)\)$/)
    if (match) {
        return { toolPattern: match[1], argPattern: match[2] }
    }
    return { toolPattern: rule }
}

function validateMcpSelector(kind: "server" | "tool", value: string): void {
    if (value !== "*") validateMcpName(kind, value)
}

function parseMcpRule(rule: string): ParsedMcpRule | undefined {
    const trimmedRule = rule.trim()
    if (!/^mcp\s*\(/.test(trimmedRule)) return undefined
    if (rule !== trimmedRule) throw new Error("MCP rules cannot have leading or trailing whitespace")
    if (!rule.startsWith("mcp(") || !rule.endsWith(")")) throw new Error("malformed MCP rule")

    const parts = rule.slice(4, -1).split(",")
    if (parts.length !== 2) throw new Error("expected mcp(server, selector)")

    const server = parts[0].trim()
    const selector = parts[1].trim()
    validateMcpSelector("server", server)

    if (selector.startsWith("hint:")) {
        const hint = selector.slice(5).trim()
        if (hint !== "readOnly") throw new Error(`unknown MCP hint ${JSON.stringify(hint)}`)
        return { server, selector: { type: "hint", value: hint } }
    }

    validateMcpSelector("tool", selector)
    return { server, selector: { type: "tool", value: selector } }
}

export function validatePermissionSettings(settings: PermissionSettings): PermissionSettings {
    for (const list of ["deny", "ask", "allow"] as const satisfies readonly PermissionList[]) {
        const rules: unknown = settings[list]
        if (rules === undefined) continue
        if (!Array.isArray(rules)) throw new Error(`Invalid permission setting ${list}: expected an array`)

        for (const rule of rules) {
            if (typeof rule !== "string") throw new Error(`Invalid permission rule in ${list}: expected a string`)

            try {
                parseMcpRule(rule)
                if (parseRule(rule.trim()).toolPattern.startsWith("mcp__")) {
                    throw new Error("legacy mcp__ rules are not supported; use mcp(server, selector)")
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                throw new Error(`Invalid permission rule in ${list}: ${JSON.stringify(rule)} (${message})`)
            }
        }
    }

    return settings
}

function matchPattern(pattern: string, value: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
    // Make trailing " .*" optional so "cmd *" also matches bare "cmd"
    const adjusted = escaped.replace(/ \.\*$/, "( .*)?")
    return new RegExp(`^${adjusted}$`, "s").test(value)
}

function matchesMcpRule(rule: ParsedMcpRule, tool: McpToolMetadata): boolean {
    if (rule.server !== "*" && rule.server !== tool.serverName) return false
    if (rule.selector.type === "hint") return tool.annotations?.readOnlyHint === true
    return rule.selector.value === "*" || rule.selector.value === tool.serverToolName
}

function matchesAnyRule(rules: string[], toolName: string, argValue: string, mcpTool?: McpToolMetadata): boolean {
    return rules.some((rule) => {
        if (mcpTool) {
            if (rule === "*") return true
            const parsedMcpRule = parseMcpRule(rule)
            return parsedMcpRule ? matchesMcpRule(parsedMcpRule, mcpTool) : false
        }

        if (parseMcpRule(rule)) return false
        const parsed = parseRule(rule)
        if (!matchPattern(parsed.toolPattern, toolName)) return false
        if (parsed.argPattern) return matchPattern(parsed.argPattern, argValue)
        return true
    })
}

function getMatchValue(tool: string, input: Record<string, unknown>): string | undefined {
    switch (tool) {
        case "bash":
            return input.command as string | undefined
        case "edit":
        case "write":
        case "read":
            return input.path as string | undefined
        case "fetch":
            return input.url as string | undefined
        case "grep":
        case "find":
        case "ls":
            return (input.path as string | undefined) ?? ""
        default:
            return undefined
    }
}

function resolveSingleMode(
    settings: PermissionSettings,
    toolName: string,
    argValue: string,
    mcpTool?: McpToolMetadata,
): Mode {
    if (matchesAnyRule(settings.deny ?? [], toolName, argValue, mcpTool)) return "deny"
    if (matchesAnyRule(settings.ask ?? [], toolName, argValue, mcpTool)) return "ask"
    if (matchesAnyRule(BUILT_IN_ALLOW_RULES, toolName, argValue, mcpTool)) return "allow"
    if (matchesAnyRule(settings.allow ?? [], toolName, argValue, mcpTool)) return "allow"

    return settings.defaultMode ?? "ask"
}

/**
 * Resolve the permission mode for a tool call.
 * Bash commands are extracted from their syntax tree and evaluated separately.
 * The strictest mode wins: deny > ask > allow.
 */
export async function resolveMode(
    settings: PermissionSettings,
    toolName: string,
    argValue: string,
    cwd?: string,
    sessionOverrides: ReadonlyMap<string, Mode> = SessionModeOverrides,
    bashAnalyzer: BashAnalyzer = analyzeBash,
    mcpTool?: McpToolMetadata,
): Promise<Mode> {
    const override = sessionOverrides.get(toolName)
    if (override) return override

    if (toolName !== "bash" || !argValue) {
        return resolveSingleMode(settings, toolName, argValue, mcpTool)
    }

    let analysis
    try {
        analysis = await bashAnalyzer(argValue, cwd)
    } catch {
        return "deny"
    }

    let worst: Mode = analysis.writesFile ? "ask" : "allow"
    for (const command of analysis.commands) {
        const mode = resolveSingleMode(settings, toolName, command)
        if (mode === "deny") return "deny"
        if (mode === "ask") worst = "ask"
    }

    return worst
}
