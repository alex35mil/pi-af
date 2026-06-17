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
 *   "read"                — blanket match on tool name
 *   "mcp__playwright__*"  — glob match on tool name
 *   "bash(git *)"         — match tool "bash" where command matches "git *"
 *   "edit(/tmp/*)"        — match tool "edit" where path matches "/tmp/*"
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

import * as project from "../__lib/project.js"

const EXTENSION = "permission"

type Mode = "allow" | "ask" | "deny"

interface PermissionSettings {
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
    line: number
    lineText: string
    note: string
}

// Runtime mode overrides (toggled by user during session, not persisted)
const SessionModeOverrides = new Map<string, Mode>()

// Status prefixes parsed by pi.nvim to resolve tool-call display status
const STATUS_ACCEPTED = "[accepted]"
const STATUS_REJECTED = "[rejected]"

// [pi.nvim] Track tool calls approved by the user (nvim) so we can flip isError back to false
const approvedToolCalls = new Set<string>()

function formatReviewNotes(notes: unknown): string {
    if (!Array.isArray(notes) || notes.length === 0) return ""

    return (
        "\n\nAddress these review notes in a follow-up edit.\n\nReview notes:\n" +
        notes
            .map((note) => {
                const n = note as Partial<ReviewNote>
                const side = n.side ?? "unknown"
                const line = typeof n.line === "number" ? n.line : "?"
                const lineText = typeof n.lineText === "string" ? JSON.stringify(n.lineText) : '""'
                const text = typeof n.note === "string" ? n.note : ""
                return `- ${side}:${line} ${lineText}\n  ${text}`
            })
            .join("\n")
    )
}

const LOCAL_SKILL_SCOPES = new Set(["user", "project", "temporary"])
let cachedDerivedSkillAllowState: DerivedSkillAllowState | undefined

export default function (pi: ExtensionAPI) {
    const initSettings = loadSettings(process.cwd())
    const keybindings = initSettings.keybindings ?? {}

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
            const derivedSkillAllowState = getDerivedSkillAllowState(pi)
            const settings = mergeSkillAllowRules(loadSettings(ctx.cwd), derivedSkillAllowState.rules)
            const overrides = Object.fromEntries(SessionModeOverrides)
            const output = JSON.stringify(
                {
                    settings,
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
        const derivedSkillAllowState = getDerivedSkillAllowState(pi)
        const settings = mergeSkillAllowRules(loadSettings(ctx.cwd), derivedSkillAllowState.rules)
        const argValue = getMatchValue(event.toolName, event.input as Record<string, unknown>)
        const mode = resolveMode(settings, event.toolName, argValue ?? "", ctx.cwd)

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
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
    }

    if (typeof value === "string") {
        const trimmed = value.trim()
        return trimmed ? [trimmed] : []
    }

    return []
}

function getSkillAllowedRules(skillPath: string): string[] {
    try {
        const content = fs.readFileSync(skillPath, "utf-8")
        const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content)
        return [...parseRuleList(frontmatter.allowed_tools), ...parseRuleList(frontmatter["allowed-tools"])]
    } catch {
        return []
    }
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

function matchPattern(pattern: string, value: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
    // Make trailing " .*" optional so "cmd *" also matches bare "cmd"
    const adjusted = escaped.replace(/ \.\*$/, "( .*)?")
    return new RegExp(`^${adjusted}$`).test(value)
}

function matchesAnyRule(rules: string[], toolName: string, argValue: string): boolean {
    return rules.some((rule) => {
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

function resolveSingleMode(settings: PermissionSettings, toolName: string, argValue: string): Mode {
    const override = SessionModeOverrides.get(toolName)
    if (override) return override

    if (matchesAnyRule(settings.deny ?? [], toolName, argValue)) return "deny"
    if (matchesAnyRule(settings.ask ?? [], toolName, argValue)) return "ask"
    if (matchesAnyRule(settings.allow ?? [], toolName, argValue)) return "allow"

    return settings.defaultMode ?? "ask"
}

/**
 * Resolve the permission mode for a tool call.
 * For bash commands, splits on pipes/operators and checks every segment.
 * The strictest mode wins: deny > ask > allow.
 * As an extra safety layer, otherwise-allowed bash commands that contain
 * output redirection are escalated to "ask".
 */
function resolveMode(settings: PermissionSettings, toolName: string, argValue: string, cwd?: string): Mode {
    if (toolName !== "bash" || !argValue) {
        return resolveSingleMode(settings, toolName, argValue)
    }

    const normalized = cwd ? normalizeBashForPermission(argValue, cwd) : argValue
    const segments = splitShellCommand(normalized)
    let worst: Mode = "allow"

    for (const segment of segments) {
        const mode = resolveSingleMode(settings, toolName, segment)
        if (mode === "deny") return "deny"
        if (mode === "ask") worst = "ask"
    }

    if (worst === "allow" && hasShellOutputRedirection(normalized)) {
        return "ask"
    }

    return worst
}

function normalizeBashForPermission(command: string, cwd: string): string {
    const start = skipWhitespace(command, 0)
    if (!command.startsWith("cd", start)) return command

    const afterCd = start + 2
    if (afterCd < command.length && !/\s/.test(command[afterCd])) return command

    const dirStart = skipWhitespace(command, afterCd)
    const dirToken = readShellWord(command, dirStart)
    if (!dirToken?.word) return command

    const afterDir = skipWhitespace(command, dirToken.end)
    if (command.slice(afterDir, afterDir + 2) !== "&&") return command

    const rest = command.slice(afterDir + 2).trim()
    if (!rest) return command

    const currentDir = path.resolve(cwd)
    const targetDir = path.resolve(cwd, dirToken.word)

    return targetDir === currentDir ? rest : command
}

/**
 * Split a shell command on unquoted operators: |, ||, &&, ;
 * Respects single/double quotes and backslash escapes.
 */
function splitShellCommand(command: string): string[] {
    const segments: string[] = []
    let current = ""
    let inSingle = false
    let inDouble = false
    let escaped = false

    for (let i = 0; i < command.length; i++) {
        const char = command[i]

        if (escaped) {
            current += char
            escaped = false
            continue
        }
        if (char === "\\" && !inSingle) {
            escaped = true
            current += char
            continue
        }
        if (char === "'" && !inDouble) {
            inSingle = !inSingle
            current += char
            continue
        }
        if (char === '"' && !inSingle) {
            inDouble = !inDouble
            current += char
            continue
        }

        if (!inSingle && !inDouble) {
            if (char === "|" && command[i + 1] === "|") {
                segments.push(current)
                current = ""
                i++
                continue
            }
            if (char === "&" && command[i + 1] === "&") {
                segments.push(current)
                current = ""
                i++
                continue
            }
            if (char === ";") {
                segments.push(current)
                current = ""
                continue
            }
            if (char === "|") {
                segments.push(current)
                current = ""
                continue
            }
        }

        current += char
    }

    if (current.trim()) {
        segments.push(current)
    }

    return segments.map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * Detect unquoted shell output redirections.
 * Escalates otherwise-allowed bash commands to "ask" for an extra confirmation.
 * Redirections to /dev/null are exempt.
 */
function hasShellOutputRedirection(command: string): boolean {
    let inSingle = false
    let inDouble = false
    let escaped = false

    for (let i = 0; i < command.length; i++) {
        const char = command[i]

        if (escaped) {
            escaped = false
            continue
        }
        if (char === "\\" && !inSingle) {
            escaped = true
            continue
        }
        if (char === "'" && !inDouble) {
            inSingle = !inSingle
            continue
        }
        if (char === '"' && !inSingle) {
            inDouble = !inDouble
            continue
        }

        if (inSingle || inDouble) continue

        if (char === "&" && command[i + 1] === ">") {
            return true
        }

        if (char !== ">") continue

        // Ignore fd duplication/closing like 2>&1, >&2, >&-
        if (command[i + 1] === "&") continue
        // Ignore process substitution like >(...)
        if (command[i + 1] === "(") continue
        // Ignore redirection to /dev/null (e.g. >/dev/null, 2>/dev/null, >>/dev/null)
        {
            let j = i + 1
            if (j < command.length && command[j] === ">") j++ // skip >> second >
            while (j < command.length && command[j] === " ") j++ // skip whitespace
            if (command.startsWith("/dev/null", j)) continue
        }

        return true
    }

    return false
}

function skipWhitespace(command: string, index: number): number {
    while (index < command.length && /\s/.test(command[index])) index++
    return index
}

function readShellWord(command: string, start: number): { word: string; end: number } | undefined {
    if (start >= command.length) return undefined

    const first = command[start]
    if (first === '"' || first === "'") {
        const quote = first
        let value = ""
        let escaped = false

        for (let i = start + 1; i < command.length; i++) {
            const char = command[i]
            if (escaped) {
                value += char
                escaped = false
                continue
            }
            if (char === "\\" && quote === '"') {
                escaped = true
                continue
            }
            if (char === quote) {
                return { word: value, end: i + 1 }
            }
            value += char
        }

        return undefined
    }

    let value = ""
    let escaped = false

    for (let i = start; i < command.length; i++) {
        const char = command[i]
        if (escaped) {
            value += char
            escaped = false
            continue
        }
        if (char === "\\") {
            escaped = true
            continue
        }
        if (/\s/.test(char) || char === "&" || char === "|" || char === ";") {
            return value ? { word: value, end: i } : undefined
        }
        value += char
    }

    return value ? { word: value, end: command.length } : undefined
}
