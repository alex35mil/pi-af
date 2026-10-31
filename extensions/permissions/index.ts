/**
 * Permissions Extension
 *
 * Controls tool execution via settings files, each tier followed by its runtime file:
 *   ~/<agent-dir>/permissions.json             (global)
 *   <repo-root>/.agents/permissions.json       (project, committed)
 *   <repo-root>/.agents/permissions.local.json (project, gitignored)
 * Runtime files insert the runtime before `.json` / `.local.json`, e.g. `permissions.sandbox.json`.
 * PI_AF_RUNTIME selects the runtime: unset = host, `sandbox` = sandboxed worker; other values are invalid.
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
 * Session modes (/permissions-mode, auto-accept) never weaken explicit deny/ask rules:
 * the result is the stricter of the session mode and any matching explicit deny/ask rule.
 * Without a matching explicit rule, the session mode replaces allow rules and defaultMode.
 *
 * A deny blocks only that call and returns its cause (matched rule, session mode, defaultMode, ...)
 * to the model; the turn continues. Rejecting an ask prompt ends the turn.
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
import { requireRuntime, type Runtime } from "../__lib/runtime.js"
import { analyzeBash, type BashAnalyzer } from "./bash.js"
import { registerPermissionFiles } from "./files.js"
import { registerReviewCodemode } from "./review.js"

export const EXTENSION = "permissions"
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

interface ResolvedPermissions {
    settings: PermissionSettings
    runtime: Runtime
    // Files that exist and were merged, in merge order.
    files: { tier: PermissionTier; scope: PermissionScope; path: string }[]
}

type SettingsResult = ResolvedPermissions | { error: Error }

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

// Runtime mode overrides (toggled by user during session, not persisted)
const SessionModeOverrides = new Map<string, Mode>()
const STATUS_REJECTED = "[rejected]"

const LOCAL_SKILL_SCOPES = new Set(["user", "project", "temporary"])
let cachedDerivedSkillAllowState: DerivedSkillAllowState | undefined

export default function (pi: ExtensionAPI) {
    let mcpCatalog: McpToolCatalog = new Map()
    const disposeMcpCatalogListener = pi.events.on(MCP_TOOL_CATALOG_EVENT, (data) => {
        mcpCatalog = data instanceof Map ? new Map(data as McpToolCatalog) : new Map()
    })

    const initSettings = tryLoadPermissionSettings(() => loadSettings(process.cwd()))
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

    pi.registerCommand(`${EXTENSION}-toggle-auto-accept`, {
        description: "Toggle auto-accept edits",
        handler: async (_args, ctx) => toggleAutoAcceptEdits(ctx),
    })

    pi.registerCommand(`${EXTENSION}-mode`, {
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

    pi.registerCommand(`${EXTENSION}-settings`, {
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
                    runtime: result.runtime,
                    files: result.files,
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

    const callMode = (
        settings: PermissionSettings,
        toolName: string,
        input: Record<string, unknown>,
        ctx: ExtensionContext,
    ) =>
        resolveMode(
            settings,
            toolName,
            getMatchValue(toolName, input) ?? "",
            ctx.cwd,
            SessionModeOverrides,
            analyzeBash,
            mcpCatalog.get(toolName),
        )

    registerPermissionFiles(pi, async (kind, input, ctx) => {
        const result = loadResolvedPermissionSettings(pi, ctx.cwd)
        updatePermissionSettingsErrorDisplay(result, ctx)
        if ("error" in result) {
            ctx.abort()
            throw new Error(`${STATUS_REJECTED} ${formatPermissionSettingsError(result.error)}`)
        }
        const decision = await callMode(result.settings, kind, input, ctx)
        return decision.mode === "deny" ? { mode: "deny", reason: denyReason(kind, decision.cause) } : decision
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
        const decision = await callMode(
            settingsResult.settings,
            event.toolName,
            event.input as Record<string, unknown>,
            ctx,
        )

        switch (decision.mode) {
            case "allow": {
                return undefined
            }

            // A deny blocks only this call; the model gets the cause and the turn continues.
            case "deny": {
                return { block: true, reason: denyReason(event.toolName, decision.cause) }
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
                        // File review runs only after every tool_call gate has completed.
                        return undefined
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
    return registerReviewCodemode(pi)
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

export type PermissionTier = "global" | "project" | "local"

// A tier's shared file applies everywhere; its runtime file applies only in that runtime.
export type PermissionScope = "shared" | Runtime

export interface PermissionSource {
    tier: PermissionTier
    scope: PermissionScope
    path: string
    settings: PermissionSettings
}

// `permissions.json` -> `permissions.sandbox.json`; `permissions.local.json` -> `permissions.sandbox.local.json`.
function runtimeSettingsPath(sharedPath: string, tier: PermissionTier, runtime: Runtime): string {
    const suffix = tier === "local" ? ".local.json" : ".json"
    if (!sharedPath.endsWith(suffix)) throw new Error(`unexpected permission settings path ${sharedPath}`)
    return `${sharedPath.slice(0, -suffix.length)}.${runtime}${suffix}`
}

/**
 * Every permission file for the runtime, in merge order: each tier's shared file, then its runtime file.
 * The more specific location wins for single values; rule lists from all files are combined.
 */
export function permissionSourcePaths(cwd: string, runtime: Runtime) {
    const paths = project.getExtensionSettingsPaths(EXTENSION, cwd)
    return (["global", "project", "local"] as const).flatMap((tier) => [
        { tier, scope: "shared" as PermissionScope, path: paths[tier] },
        { tier, scope: runtime as PermissionScope, path: runtimeSettingsPath(paths[tier], tier, runtime) },
    ])
}

export function readPermissionSettings(file: string): PermissionSettings {
    if (!fs.existsSync(file)) return {}
    let value: unknown
    try {
        value = JSON.parse(fs.readFileSync(file, "utf-8"))
    } catch (error) {
        throw new Error(`Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`invalid permission settings ${file}: expected an object`)
    }
    return validatePermissionSettings(value as PermissionSettings)
}

export function inspectPersistentPermissions(cwd: string, runtime: Runtime = requireRuntime()) {
    const sources: PermissionSource[] = permissionSourcePaths(cwd, runtime).map((source) => ({
        ...source,
        settings: readPermissionSettings(source.path),
    }))
    return {
        runtime,
        sources,
        settings: sources.reduce<PermissionSettings>(
            (settings, source) => mergePermissions(settings, source.settings),
            {},
        ),
    }
}

function loadSettings(cwd: string): ResolvedPermissions {
    const { runtime, sources, settings } = inspectPersistentPermissions(cwd)
    return {
        runtime,
        settings: validatePermissionSettings(settings),
        files: sources
            .filter((source) => fs.existsSync(source.path))
            .map(({ tier, scope, path: file }) => ({ tier, scope, path: file })),
    }
}

// These checks describe persistent policy, never temporary session or skill grants.
export function inspectMcpAllowRules(rules: string[], sources: readonly PermissionSource[], catalog: McpToolCatalog) {
    validatePermissionSettings({ allow: rules })
    const configured = sources.flatMap((source) =>
        (["allow", "ask", "deny"] as const).flatMap((mode) =>
            (source.settings[mode] ?? []).map((rule) => ({
                tier: source.tier,
                scope: source.scope,
                path: source.path,
                mode,
                rule,
            })),
        ),
    )
    const settings = sources.reduce<PermissionSettings>(
        (settings, source) => mergePermissions(settings, source.settings),
        {},
    )
    return rules.map((rule) => {
        const candidate = parseMcpRule(rule)
        if (!candidate) throw new Error(`expected an MCP allow rule: ${JSON.stringify(rule)}`)
        const tools = [...catalog.entries()]
            .filter(([, metadata]) => matchesMcpRule(candidate, metadata))
            .map(([name, metadata]) => ({
                name,
                server: metadata.serverName,
                tool: metadata.serverToolName,
                readOnlyHint: metadata.annotations?.readOnlyHint ?? null,
                mode: resolveSingleMode(settings, name, "", metadata),
                blockers: configured.filter(
                    (entry) => entry.mode !== "allow" && matchesAnyRule([entry.rule], name, "", metadata),
                ),
            }))
        const coveredBy = configured.filter(
            (entry) => entry.mode === "allow" && coversMcpRule(entry.rule, candidate, catalog),
        )
        const unverifiedConflicts = configured.filter((entry) => {
            if (entry.mode === "allow") return false
            const parsed = parseMcpRule(entry.rule)
            return (
                (entry.rule === "*" || (parsed && mcpRulesMayOverlap(candidate, parsed, catalog))) &&
                !tools.some((tool) => tool.blockers.includes(entry))
            )
        })
        const status =
            tools.length === 0
                ? "unavailable"
                : coveredBy.length > 0
                  ? "covered"
                  : tools.every((tool) => tool.blockers.length > 0)
                    ? "blocked"
                    : "available"
        return { rule, status, coveredBy, tools, unverifiedConflicts }
    })
}

function coversMcpRule(existing: string, candidate: ParsedMcpRule, catalog: McpToolCatalog): boolean {
    if (existing === "*") return true
    const parsed = parseMcpRule(existing)
    if (!parsed || (parsed.server !== "*" && parsed.server !== candidate.server)) return false
    if (parsed.selector.type === "tool" && parsed.selector.value === "*") return true
    if (parsed.selector.type === candidate.selector.type && parsed.selector.value === candidate.selector.value)
        return true
    if (
        parsed.selector.type !== "hint" ||
        candidate.selector.type !== "tool" ||
        candidate.server === "*" ||
        candidate.selector.value === "*"
    )
        return false
    return [...catalog.values()].some(
        (tool) =>
            tool.serverName === candidate.server &&
            tool.serverToolName === candidate.selector.value &&
            tool.annotations?.readOnlyHint === true,
    )
}

function mcpRulesMayOverlap(left: ParsedMcpRule, right: ParsedMcpRule, catalog: McpToolCatalog): boolean {
    if (left.server !== "*" && right.server !== "*" && left.server !== right.server) return false
    if (left.selector.type !== right.selector.type) {
        const exact = left.selector.type === "tool" ? left.selector : right.selector
        const server = left.server === "*" ? right.server : left.server
        if (exact.value !== "*" && server !== "*") {
            const metadata = [...catalog.values()].find(
                (tool) => tool.serverName === server && tool.serverToolName === exact.value,
            )
            if (metadata) return metadata.annotations?.readOnlyHint === true
        }
        return true
    }
    return left.selector.value === "*" || right.selector.value === "*" || left.selector.value === right.selector.value
}

function tryLoadPermissionSettings(load: () => ResolvedPermissions): SettingsResult {
    try {
        return load()
    } catch (error) {
        return { error: error instanceof Error ? error : new Error(String(error)) }
    }
}

function loadResolvedPermissionSettings(pi: ExtensionAPI, cwd: string): SettingsResult {
    return tryLoadPermissionSettings(() => {
        const derivedSkillAllowState = getDerivedSkillAllowState(pi)
        const resolved = loadSettings(cwd)
        const settings = mergeSkillAllowRules(resolved.settings, derivedSkillAllowState.rules)
        return { ...resolved, settings: validatePermissionSettings(settings) }
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
        ctx.ui.setStatus(EXTENSION, undefined)
    } else {
        SessionModeOverrides.set("edit", "allow")
        SessionModeOverrides.set("write", "allow")
        ctx.ui.setStatus(EXTENSION, "▶︎ Auto-accept edits")
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

/** The first rule in `rules` that matches the call, if any. */
function matchingRule(
    rules: string[],
    toolName: string,
    argValue: string,
    mcpTool?: McpToolMetadata,
): string | undefined {
    return rules.find((rule) => {
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

function matchesAnyRule(rules: string[], toolName: string, argValue: string, mcpTool?: McpToolMetadata): boolean {
    return matchingRule(rules, toolName, argValue, mcpTool) !== undefined
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

/** Why a call was denied. Bash variants name the command node that caused it. */
export type DenyCause =
    | { kind: "rule"; rule: string }
    | { kind: "bashRule"; rule: string; command: string }
    | { kind: "session" }
    | { kind: "default" }
    | { kind: "bashDefault"; command: string }
    | { kind: "unparsedBash" }
    | { kind: "mcpMetadata" }

export type Decision = { mode: "allow" } | { mode: "ask" } | { mode: "deny"; cause: DenyCause }

const ALLOW = { mode: "allow" } as const
const ASK = { mode: "ask" } as const
const deny = (cause: DenyCause): Decision => ({ mode: "deny", cause })

/** The reason returned to the model when a call is denied. */
export function denyReason(toolName: string, cause: DenyCause): string {
    switch (cause.kind) {
        case "rule":
            return `${STATUS_REJECTED} Denied by permission rule \`${cause.rule}\``
        case "bashRule":
            return `${STATUS_REJECTED} Denied by permission rule \`${cause.rule}\` for command \`${cause.command}\``
        case "session":
            return `${STATUS_REJECTED} Denied by session permission mode for \`${toolName}\``
        case "default":
            return `${STATUS_REJECTED} Denied by defaultMode \`deny\` (no allow rule matched)`
        case "bashDefault":
            return `${STATUS_REJECTED} Denied by defaultMode \`deny\`: no allow rule matched command \`${cause.command}\``
        case "unparsedBash":
            return `${STATUS_REJECTED} Denied: the shell command could not be parsed`
        case "mcpMetadata":
            return `${STATUS_REJECTED} Denied: no live MCP metadata for \`${toolName}\`, so permission rules can't be checked`
    }
}

// An explicit deny or ask rule matching the call; a deny carries its rule.
type Restriction = { mode: "deny"; rule: string } | { mode: "ask" } | undefined

function explicitRestriction(
    settings: PermissionSettings,
    toolName: string,
    argValue: string,
    mcpTool?: McpToolMetadata,
): Restriction {
    const denied = matchingRule(settings.deny ?? [], toolName, argValue, mcpTool)
    if (denied !== undefined) return { mode: "deny", rule: denied }
    if (matchesAnyRule(settings.ask ?? [], toolName, argValue, mcpTool)) return { mode: "ask" }
    return undefined
}

function restrictionRules(settings: PermissionSettings): string[] {
    return [...(settings.deny ?? []), ...(settings.ask ?? [])]
}

/** Whether any deny/ask rule could match an MCP tool, whatever its metadata. */
function mayRestrictMcp(settings: PermissionSettings): boolean {
    return restrictionRules(settings).some((rule) => rule === "*" || parseMcpRule(rule) !== undefined)
}

/** Whether any deny/ask rule could match some command of a non-MCP tool. */
function mayRestrictTool(settings: PermissionSettings, toolName: string): boolean {
    return restrictionRules(settings).some(
        (rule) => !parseMcpRule(rule) && matchPattern(parseRule(rule).toolPattern, toolName),
    )
}

// A non-deny session mode combined with an explicit restriction; the restriction can only tighten it.
function withSession(session: "allow" | "ask", restriction: Restriction, deniedBy: (rule: string) => DenyCause) {
    if (restriction?.mode === "deny") return deny(deniedBy(restriction.rule))
    if (restriction?.mode === "ask" || session === "ask") return ASK
    return ALLOW
}

// One call or Bash node without a session mode. `default` marks a defaultMode deny.
type SingleDecision = { mode: "allow" } | { mode: "ask" } | { mode: "deny"; rule: string } | { mode: "default" }

function resolveSingle(
    settings: PermissionSettings,
    toolName: string,
    argValue: string,
    mcpTool?: McpToolMetadata,
): SingleDecision {
    const restriction = explicitRestriction(settings, toolName, argValue, mcpTool)
    if (restriction) return restriction
    if (matchesAnyRule(BUILT_IN_ALLOW_RULES, toolName, argValue, mcpTool)) return ALLOW
    if (matchesAnyRule(settings.allow ?? [], toolName, argValue, mcpTool)) return ALLOW

    const fallback = settings.defaultMode ?? "ask"
    switch (fallback) {
        case "allow":
            return ALLOW
        case "ask":
            return ASK
        case "deny":
            return { mode: "default" }
    }
}

function resolveSingleMode(
    settings: PermissionSettings,
    toolName: string,
    argValue: string,
    mcpTool?: McpToolMetadata,
): Mode {
    const decision = resolveSingle(settings, toolName, argValue, mcpTool)
    return decision.mode === "default" ? "deny" : decision.mode
}

function wholeCallDecision(decision: SingleDecision): Decision {
    switch (decision.mode) {
        case "allow":
        case "ask":
            return decision
        case "deny":
            return deny({ kind: "rule", rule: decision.rule })
        case "default":
            return deny({ kind: "default" })
    }
}

/**
 * Resolve the permission decision for a tool call.
 * Bash commands are extracted from their syntax tree and evaluated separately.
 * The strictest mode wins: deny > ask > allow. A deny carries its cause.
 * A session mode is combined with explicit deny/ask rules and can never weaken them.
 */
export async function resolveMode(
    settings: PermissionSettings,
    toolName: string,
    argValue: string,
    cwd?: string,
    sessionOverrides: ReadonlyMap<string, Mode> = SessionModeOverrides,
    bashAnalyzer: BashAnalyzer = analyzeBash,
    mcpTool?: McpToolMetadata,
): Promise<Decision> {
    const session = sessionOverrides.get(toolName)
    if (session === "deny") return deny({ kind: "session" })
    const wholeRule = (rule: string): DenyCause => ({ kind: "rule", rule })

    if (toolName.startsWith("mcp__") && !mcpTool) {
        // Rules can't be matched without metadata: fail closed unless no rule could apply.
        if (session && !mayRestrictMcp(settings)) return { mode: session }
        return deny({ kind: "mcpMetadata" })
    }

    if (toolName !== "bash" || !argValue) {
        return session
            ? withSession(session, explicitRestriction(settings, toolName, argValue, mcpTool), wholeRule)
            : wholeCallDecision(resolveSingle(settings, toolName, argValue, mcpTool))
    }

    if (session && !mayRestrictTool(settings, toolName)) return { mode: session }

    let analysis
    try {
        analysis = await bashAnalyzer(argValue, cwd)
    } catch {
        return deny({ kind: "unparsedBash" })
    }

    if (session) {
        let asked = false
        for (const command of analysis.commands) {
            const restriction = explicitRestriction(settings, toolName, command)
            if (restriction?.mode === "deny") return deny({ kind: "bashRule", rule: restriction.rule, command })
            if (restriction?.mode === "ask") asked = true
        }
        return withSession(session, asked ? { mode: "ask" } : undefined, wholeRule)
    }

    let worst: Decision = analysis.writesFile ? ASK : ALLOW
    for (const command of analysis.commands) {
        const decision = resolveSingle(settings, toolName, command)
        switch (decision.mode) {
            case "deny":
                return deny({ kind: "bashRule", rule: decision.rule, command })
            case "default":
                return deny({ kind: "bashDefault", command })
            case "ask":
                worst = ASK
                break
            case "allow":
                break
        }
    }

    return worst
}
