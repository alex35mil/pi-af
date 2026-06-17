/**
 * Rules Extension
 *
 * Discovers rule files and delivers them to the agent. Rules are Markdown
 * files from two locations:
 *   ~/<agent-dir>/rules/        (global)
 *   <repo-root>/.agents/rules/  (project)
 *
 * Rule types:
 *   - Always-on: no frontmatter `paths` — body injected into system prompt.
 *   - Path-scoped: `paths` glob list in YAML frontmatter — delivered via
 *     read tool results when the agent reads a matching file.
 *
 * Frontmatter schema (optional):
 * ---
 * paths:
 *   - "src/components/**"
 *   - "*.test.ts"
 * ---
 *
 * System prompt:
 *   - Always-on rules are injected with full body.
 *   - If path-scoped rules exist, a note is added telling the agent to
 *     always read files before editing (rules load automatically on read).
 *
 * Path-scoped rule delivery (tool_result on read):
 *   - First matching read: full reminder — glob patterns + rule body, so the
 *     agent understands what files the rule covers.
 *   - Subsequent matching reads: compact reminder — just the patterns, tells
 *     the agent to follow the rule it saw earlier.
 *
 * Edit blocking (tool_call on edit/write):
 *   - If the target file matches a path-scoped rule the agent hasn't seen
 *     yet (not in visibleRuleIds), the tool call is blocked.
 *
 * State:
 *   - loadedRuleIds: which path-scoped rules have been delivered. Persisted
 *     in the session branch via custom entries (rules-state) so it survives
 *     restarts and session replays (--continue/--resume).
 *   - visibleRuleIds: in-memory copy of loadedRuleIds, used by the edit
 *     blocker. Populated from loadedRuleIds on session start/switch/fork/
 *     tree/turn_start.
 *
 * Compaction:
 *   - On session_compact, both sets are cleared and an empty rules-state
 *     entry is persisted. This ensures restoreLoadedRuleIds (which scans
 *     the full branch including pre-compaction entries) picks up the empty
 *     entry as the latest. The agent must re-read matching files to get
 *     full reminders again.
 *
 * Glob matching supports *, **, ?, and brace expansion ({a,b}).
 */

import * as fs from "node:fs"
import * as path from "node:path"

import {
    getAgentDir,
    parseFrontmatter,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import type { TextContent, ImageContent } from "@earendil-works/pi-ai"

import * as project from "../__lib/project.js"

const EXTENSION = "rules"

const RULES_SUBDIR = "rules"
const RULES_STATE_ENTRY = "rules-state"

type RuleSource = "global" | "project"

type RuleFrontmatter = {
    paths?: string | string[]
}

interface RuleFile {
    id: string
    source: RuleSource
    filePath: string
    displayPath: string
    patterns: string[]
    body: string
}

interface RuntimeState {
    repoRoot: string
    projectRulesDir: string
    globalRulesDir: string
    rules: RuleFile[]
    loadedRuleIds: Set<string>
    visibleRuleIds: Set<string>
}

const runtime: RuntimeState = {
    repoRoot: project.resolveRootDir(process.cwd()),
    projectRulesDir: path.join(project.resolveProjectAgentsDir(process.cwd()), RULES_SUBDIR),
    globalRulesDir: path.join(getAgentDir(), RULES_SUBDIR),
    rules: [],
    loadedRuleIds: new Set(),
    visibleRuleIds: new Set(),
}

type ContentPart = TextContent | ImageContent

export default function (pi: ExtensionAPI) {
    const syncState = (ctx: ExtensionContext) => {
        refreshRuntimeState(ctx)
    }

    const syncAndMarkVisible = (ctx: ExtensionContext) => {
        syncState(ctx)
        markVisibleRulesFromLoadedState()
    }

    const announceStartup = (ctx: ExtensionContext) => {
        const alwaysOn = runtime.rules.filter((r) => r.patterns.length === 0)
        const conditional = runtime.rules.filter((r) => r.patterns.length > 0)
        if (alwaysOn.length === 0 && conditional.length === 0) {
            ctx.ui.setWidget(`${EXTENSION}:startup`, undefined)
            return
        }
        const lines: string[] = []
        if (alwaysOn.length > 0) {
            lines.push("Always-on:")
            for (const rule of alwaysOn) lines.push(`- ${rule.displayPath}`)
        }
        if (conditional.length > 0) {
            if (alwaysOn.length > 0) lines.push("")
            lines.push("Conditional:")
            for (const rule of conditional) lines.push(`- ${rule.displayPath}`)
        }
        ctx.ui.setWidget(`${EXTENSION}:startup`, lines)
    }

    pi.on("session_start", async (_event, ctx) => {
        syncAndMarkVisible(ctx)
        announceStartup(ctx)
    })
    pi.on("session_tree", async (_event, ctx) => syncAndMarkVisible(ctx))
    pi.on("session_compact", async () => {
        runtime.loadedRuleIds.clear()
        runtime.visibleRuleIds.clear()
        pi.appendEntry(RULES_STATE_ENTRY, { ids: [] })
    })
    pi.on("turn_start", async (_event, ctx) => syncAndMarkVisible(ctx))

    pi.registerCommand("rules", {
        description: "Show discovered rules and current activation state",
        handler: async (_args, ctx) => {
            syncState(ctx)
            await ctx.ui.editor("Rules", formatRulesReport())
        },
    })

    pi.on("before_agent_start", async (event, ctx) => {
        syncAndMarkVisible(ctx)
        persistLoadedRuleState(pi)

        const prompt = buildRulesSystemPrompt()
        if (!prompt) return

        return {
            systemPrompt: event.systemPrompt + prompt,
        }
    })

    pi.on("tool_call", async (event, ctx) => {
        if (event.toolName !== "edit" && event.toolName !== "write") return

        syncState(ctx)

        const rawPath = (event.input as { path?: string }).path
        if (typeof rawPath !== "string" || !rawPath.trim()) return

        const targetPath = resolveToolPath(rawPath, ctx.cwd)
        const missingRules = getConditionalRulesForTarget(targetPath).filter(
            (rule) => !runtime.visibleRuleIds.has(rule.id),
        )
        if (missingRules.length === 0) return

        return {
            block: true,
            reason: [
                `Blocked by rules extension before ${event.toolName} ${targetPath}.`,
                "Read the matching rule file(s) first:",
                ...missingRules.map((rule) => `- ${rule.filePath}`),
            ].join("\n"),
        }
    })

    pi.on("tool_result", async (event, ctx) => {
        if (event.toolName !== "read" || event.isError) return

        syncState(ctx)

        const rawPath = (event.input as { path?: string }).path
        if (typeof rawPath !== "string" || !rawPath.trim()) return

        const targetPath = resolveToolPath(rawPath, ctx.cwd)
        const matchingRules = runtime.rules.filter(
            (rule) => rule.patterns.length > 0 && (rule.filePath === targetPath || matchesRule(rule, targetPath)),
        )

        if (matchingRules.length === 0) return

        const newRules = matchingRules.filter((rule) => !runtime.loadedRuleIds.has(rule.id))
        const existingRules = matchingRules.filter((rule) => runtime.loadedRuleIds.has(rule.id))

        if (newRules.length > 0) {
            for (const rule of newRules) {
                runtime.loadedRuleIds.add(rule.id)
                runtime.visibleRuleIds.add(rule.id)
            }
            persistLoadedRuleState(pi)

            ctx.ui.setWidget(
                `${EXTENSION}:load`,
                newRules.map((rule) => normalizePosixPath(path.relative(runtime.repoRoot, rule.filePath))),
            )
        }

        const fullRules = newRules.filter((rule) => rule.filePath !== targetPath)
        const parts: string[] = []
        if (fullRules.length > 0) parts.push(buildFullReminder(fullRules))
        if (existingRules.length > 0) parts.push(buildCompactReminder(existingRules))

        if (parts.length === 0) return

        return {
            content: appendTextContent(event.content, parts.join("\n\n")),
        }
    })
}

function restoreLoadedRuleIds(ctx: ExtensionContext, rules: RuleFile[]): Set<string> {
    const allowedIds = new Set(rules.map((rule) => rule.id))
    let ids: string[] = []

    for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "custom" || entry.customType !== RULES_STATE_ENTRY) continue
        const data = (entry as { data?: { ids?: unknown } }).data
        if (!Array.isArray(data?.ids)) continue
        ids = data.ids.filter((id): id is string => typeof id === "string")
    }

    return new Set(ids.filter((id) => allowedIds.has(id)))
}

function refreshRuntimeState(ctx: ExtensionContext) {
    const scanned = scanRules(ctx.cwd)
    const allowedIds = new Set(scanned.rules.map((rule) => rule.id))

    runtime.repoRoot = scanned.repoRoot
    runtime.projectRulesDir = scanned.projectRulesDir
    runtime.globalRulesDir = scanned.globalRulesDir
    runtime.rules = scanned.rules
    runtime.loadedRuleIds = restoreLoadedRuleIds(ctx, scanned.rules)
    runtime.visibleRuleIds = new Set([...runtime.visibleRuleIds].filter((id) => allowedIds.has(id)))
}

function markVisibleRulesFromLoadedState() {
    runtime.visibleRuleIds = new Set(runtime.loadedRuleIds)
}

function persistLoadedRuleState(pi: ExtensionAPI) {
    if (runtime.loadedRuleIds.size === 0) return
    pi.appendEntry(RULES_STATE_ENTRY, { ids: Array.from(runtime.loadedRuleIds).sort() })
}

function getActiveRules(): RuleFile[] {
    return runtime.rules.filter((rule) => rule.patterns.length === 0 || runtime.loadedRuleIds.has(rule.id))
}

function getUnloadedConditionalRules(): RuleFile[] {
    return runtime.rules.filter((rule) => rule.patterns.length > 0 && !runtime.loadedRuleIds.has(rule.id))
}

function getConditionalRulesForTarget(targetPath: string): RuleFile[] {
    return runtime.rules.filter((rule) => rule.patterns.length > 0 && matchesRule(rule, targetPath))
}

function scanRules(cwd: string): Omit<RuntimeState, "loadedRuleIds" | "visibleRuleIds"> {
    const repoRoot = project.resolveRootDir(cwd)
    const projectRulesDir = path.join(project.resolveProjectAgentsDir(cwd), RULES_SUBDIR)
    const globalRulesDir = path.join(getAgentDir(), RULES_SUBDIR)

    const rules = [
        ...findMarkdownFiles(globalRulesDir)
            .map((filePath) => parseRuleFile(filePath, "global", repoRoot))
            .filter((rule): rule is RuleFile => Boolean(rule)),
        ...findMarkdownFiles(projectRulesDir)
            .map((filePath) => parseRuleFile(filePath, "project", repoRoot))
            .filter((rule): rule is RuleFile => Boolean(rule)),
    ].sort((a, b) => {
        if (a.source !== b.source) return a.source === "global" ? -1 : 1
        return a.displayPath.localeCompare(b.displayPath)
    })

    return { repoRoot, projectRulesDir, globalRulesDir, rules }
}

function parseRuleFile(filePath: string, source: RuleSource, repoRoot: string): RuleFile | undefined {
    const raw = fs.readFileSync(filePath, "utf-8")
    const { frontmatter, body } = parseFrontmatter<RuleFrontmatter>(raw)
    const trimmedBody = body.trim()
    if (!trimmedBody) return undefined

    return {
        id: path.resolve(filePath),
        source,
        filePath: path.resolve(filePath),
        displayPath: formatDisplayPath(path.resolve(filePath), source, repoRoot),
        patterns: normalizeRulePatterns(frontmatter.paths),
        body: trimmedBody,
    }
}

function findMarkdownFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return []

    const results: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            results.push(...findMarkdownFiles(fullPath))
            continue
        }
        if (entry.isFile() && entry.name.endsWith(".md")) {
            results.push(path.resolve(fullPath))
        }
    }

    return results.sort((a, b) => a.localeCompare(b))
}

function normalizeRulePatterns(input: unknown): string[] {
    const values = Array.isArray(input) ? input : typeof input === "string" ? [input] : []
    return values
        .map((value) => normalizePosixPath(String(value).trim()).replace(/^\.\//, "").replace(/^\/+/, ""))
        .filter(Boolean)
}

function buildRulesSystemPrompt(): string {
    const alwaysOnRules = runtime.rules.filter((rule) => rule.patterns.length === 0)
    const conditionalRules = runtime.rules.filter((rule) => rule.patterns.length > 0)

    if (alwaysOnRules.length === 0 && conditionalRules.length === 0) return ""

    const lines: string[] = []
    lines.push("## Rules")
    lines.push("Follow the active rules below when working in this project.")

    if (alwaysOnRules.length > 0) {
        lines.push("")
        lines.push("### Active rules")
        for (const rule of alwaysOnRules) {
            lines.push("")
            lines.push(`#### ${rule.displayPath}`)
            lines.push("")
            lines.push(rule.body)
        }
    }

    if (conditionalRules.length > 0) {
        lines.push("")
        lines.push(
            "Some rules are path-scoped and are loaded automatically when you read a matching file. Always read file using read tool before editing using write or edit tool.",
        )
    }

    return `\n\n${lines.join("\n")}`
}

function buildFullReminder(rules: RuleFile[]): string {
    const lines: string[] = []
    lines.push("<system-reminder>")

    for (const rule of rules) {
        const pathPatterns = rule.patterns.join(", ")
        lines.push("")
        lines.push(
            `You must follow these path-scoped rules when editing or writing any file matching the following path patterns ${pathPatterns}:`,
        )
        lines.push("")
        lines.push(`#### Rules for paths: ${pathPatterns}`)
        lines.push(rule.body)
    }

    lines.push("</system-reminder>")
    return lines.join("\n")
}

function buildCompactReminder(rules: RuleFile[]): string {
    const patterns = rules.map((rule) => rule.patterns.join(", ")).join(", ")
    return `<system-reminder>This file matches path-scoped rules for paths ${patterns} - you loaded them earlier. Follow the loaded rules.</system-reminder>`
}

function formatRulesReport(): string {
    const activeRuleIds = new Set(getActiveRules().map((rule) => rule.id))
    const unloadedRules = getUnloadedConditionalRules()

    const lines: string[] = []
    lines.push(`Repo root: ${runtime.repoRoot}`)
    lines.push(`Project rules dir: ${runtime.projectRulesDir}`)
    lines.push(`Global rules dir: ${runtime.globalRulesDir}`)
    lines.push("")

    lines.push(`Rules: ${runtime.rules.length}`)
    lines.push(`Active: ${activeRuleIds.size}`)
    lines.push(`Unloaded conditional: ${unloadedRules.length}`)
    lines.push("")

    lines.push("Active rules")
    if (activeRuleIds.size === 0) {
        lines.push("  (none)")
    } else {
        for (const rule of getActiveRules()) {
            const applies = rule.patterns.length > 0 ? ` [${rule.patterns.join(", ")}]` : ""
            lines.push(`  - ${rule.displayPath}${applies}`)
            lines.push(`    ${rule.filePath}`)
        }
    }

    lines.push("")
    lines.push("Unloaded conditional rules")
    if (unloadedRules.length === 0) {
        lines.push("  (none)")
    } else {
        for (const rule of unloadedRules) {
            lines.push(`  - ${rule.displayPath} [${rule.patterns.join(", ")}]`)
            lines.push(`    ${rule.filePath}`)
        }
    }

    return lines.join("\n")
}

function normalizePosixPath(value: string): string {
    return value.replace(/\\/g, "/")
}

function stripLeadingAt(value: string): string {
    return value.startsWith("@") ? value.slice(1) : value
}

function isWithinDir(target: string, dir: string): boolean {
    const relativePath = path.relative(dir, target)
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

function resolveToolPath(rawPath: string, cwd: string): string {
    const cleaned = stripLeadingAt(rawPath.trim())
    if (!cleaned) return path.resolve(cwd)
    return path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(cwd, cleaned)
}

function formatDisplayPath(filePath: string, source: RuleSource, repoRoot: string): string {
    if (source === "project") {
        const relativePath = normalizePosixPath(path.relative(repoRoot, filePath))
        return relativePath || path.basename(filePath)
    }
    return filePath
}

function getMatchCandidate(targetPath: string): string | undefined {
    if (!isWithinDir(targetPath, runtime.repoRoot)) return undefined
    return normalizePosixPath(path.relative(runtime.repoRoot, targetPath))
}

function matchesRule(rule: RuleFile, targetPath: string): boolean {
    const candidate = getMatchCandidate(targetPath)
    if (!candidate) return false
    return rule.patterns.some((pattern) => matchesGlob(pattern, candidate))
}

function matchesGlob(pattern: string, value: string): boolean {
    return expandBraces(pattern).some((candidate) => globToRegExp(candidate).test(value))
}

function expandBraces(pattern: string): string[] {
    const match = pattern.match(/\{([^{}]+)\}/)
    if (!match || match.index === undefined) return [pattern]

    const [token, body] = match
    const idx = match.index
    return body
        .split(",")
        .map((part) => part.trim())
        .flatMap((part) => expandBraces(pattern.slice(0, idx) + part + pattern.slice(idx + token.length)))
}

function globToRegExp(pattern: string): RegExp {
    const normalized = normalizePosixPath(pattern).replace(/^\.\//, "").replace(/^\/+/, "")
    let regex = "^"

    for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i]

        if (char === "*") {
            const next = normalized[i + 1]
            if (next === "*") {
                i += 1
                if (normalized[i + 1] === "/") {
                    regex += "(?:.*\\/)?"
                    i += 1
                } else {
                    regex += ".*"
                }
            } else {
                regex += "[^/]*"
            }
            continue
        }

        if (char === "?") {
            regex += "[^/]"
            continue
        }

        regex += escapeRegex(char)
    }

    regex += "$"
    return new RegExp(regex)
}

function escapeRegex(value: string): string {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function appendTextContent(content: unknown, text: string): ContentPart[] {
    const parts: ContentPart[] = Array.isArray(content)
        ? content.map((part: unknown) => ({ ...(part as ContentPart) }))
        : []

    for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i]
        if (part.type !== "text") continue
        parts[i] = { ...part, text: `${part.text}\n\n${text}` }
        return parts
    }

    parts.push({ type: "text", text })
    return parts
}
