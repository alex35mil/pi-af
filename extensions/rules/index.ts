/**
 * Always-on rules enter the system prompt; path-scoped rules stay lazy.
 * Reads queue full reminders, including nested reads. Only a successful model
 * response after context delivery establishes visibility for edit/write gates.
 * Visible rule versions follow the session branch; compaction clears them.
 * Glob matching supports *, **, ?, and brace expansion ({a,b}).
 */

import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

import {
    convertToLlm,
    getAgentDir,
    parseFrontmatter,
    type ExtensionAPI,
    type ExtensionContext,
    type ContextWithSystemEvent,
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

interface RuleInventory {
    repoRoot: string
    projectRulesDir: string
    globalRulesDir: string
    rules: RuleFile[]
}

interface RuntimeState extends RuleInventory {
    pendingRuleIds: Set<string>
    deliveryRuleIds: Set<string>
    visibleRuleIds: Set<string>
}

type ContentPart = TextContent | ImageContent

export default function (pi: ExtensionAPI) {
    const runtime: RuntimeState = {
        ...scanRules(process.cwd()),
        pendingRuleIds: new Set(),
        deliveryRuleIds: new Set(),
        visibleRuleIds: new Set(),
    }
    const syncState = (ctx: ExtensionContext) => refreshRuntimeState(runtime, ctx)
    const resetState = (ctx: ExtensionContext) => {
        runtime.pendingRuleIds.clear()
        runtime.deliveryRuleIds.clear()
        syncState(ctx)
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
        resetState(ctx)
        announceStartup(ctx)
    })
    pi.on("session_tree", async (_event, ctx) => resetState(ctx))
    pi.on("session_compact", async () => {
        runtime.pendingRuleIds.clear()
        runtime.deliveryRuleIds.clear()
        runtime.visibleRuleIds.clear()
        persistVisibleRuleState(pi, runtime)
    })
    pi.on("turn_start", async (_event, ctx) => syncState(ctx))

    pi.registerCommand("rules", {
        description: "Show discovered rules and current activation state",
        handler: async (_args, ctx) => {
            syncState(ctx)
            await ctx.ui.editor("Rules", formatRulesReport(runtime))
        },
    })

    pi.on("before_agent_start", async (event, ctx) => {
        runtime.deliveryRuleIds.clear()
        syncState(ctx)
        const prompt = buildRulesSystemPrompt(runtime)
        if (!prompt) return
        return { systemPrompt: event.systemPrompt + prompt }
    })

    pi.on("turn_end", (event, ctx) => {
        syncState(ctx)
        const text = modelText(event.context.contextMessages)
        const missing = runtime.rules.filter(
            (rule) => runtime.pendingRuleIds.has(rule.id) && !text.some((part) => part.includes(buildRuleText(rule))),
        )
        if (missing.length === 0) return
        return {
            entries: [
                {
                    type: "custom_message" as const,
                    customType: "rules-delivery",
                    display: false,
                    content: buildFullReminder(missing),
                    details: { rulesDelivery: { ids: missing.map((rule) => rule.id) } },
                },
            ],
        }
    })

    pi.on("context_with_system", (event, ctx) => {
        syncState(ctx)
        const text = modelText(event.messages)
        runtime.deliveryRuleIds = new Set(
            runtime.rules
                .filter(
                    (rule) =>
                        runtime.pendingRuleIds.has(rule.id) && text.some((part) => part.includes(buildRuleText(rule))),
                )
                .map((rule) => rule.id),
        )
    })

    pi.on("message_end", (event, ctx) => {
        if (event.message.role !== "assistant") return
        const delivered = new Set(runtime.deliveryRuleIds)
        runtime.deliveryRuleIds.clear()
        if (event.message.stopReason === "error" || event.message.stopReason === "aborted") return
        syncState(ctx)
        let changed = false
        for (const rule of runtime.rules) {
            if (!delivered.has(rule.id) || runtime.visibleRuleIds.has(rule.id)) continue
            runtime.visibleRuleIds.add(rule.id)
            runtime.pendingRuleIds.delete(rule.id)
            changed = true
        }
        if (changed) persistVisibleRuleState(pi, runtime)
    })

    pi.on("tool_call", async (event, ctx) => {
        if (event.toolName !== "edit" && event.toolName !== "write") return

        syncState(ctx)

        const rawPath = (event.input as { path?: string }).path
        if (typeof rawPath !== "string" || !rawPath.trim()) return

        const targetPath = resolveToolPath(rawPath, ctx.cwd)
        const missingRules = getConditionalRulesForTarget(runtime, targetPath).filter(
            (rule) => !runtime.visibleRuleIds.has(rule.id),
        )
        if (missingRules.length === 0) return

        return {
            block: true,
            reason: [
                `Blocked by rules extension before ${event.toolName} ${targetPath}.`,
                "Read a matching file, then return to the model before editing or composing an editing script. Matching rule files:",
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
            (rule) =>
                rule.patterns.length > 0 &&
                (rule.filePath === targetPath || matchesRule(rule, targetPath, runtime.repoRoot)),
        )

        if (matchingRules.length === 0) return

        const newRules = matchingRules.filter((rule) => !runtime.visibleRuleIds.has(rule.id))
        const existingRules = matchingRules.filter((rule) => runtime.visibleRuleIds.has(rule.id))
        for (const rule of newRules) runtime.pendingRuleIds.add(rule.id)
        if (newRules.length > 0) {
            ctx.ui.setWidget(
                `${EXTENSION}:load`,
                newRules.map((rule) => normalizePosixPath(path.relative(runtime.repoRoot, rule.filePath))),
            )
        }
        const parts: string[] = []
        if (newRules.length > 0) parts.push(buildFullReminder(newRules))
        if (existingRules.length > 0) parts.push(buildCompactReminder(existingRules))
        return {
            content: appendTextContent(event.content, parts.join("\n\n")),
            details: {
                ...(typeof event.details === "object" && event.details !== null ? event.details : {}),
                rulesDelivery: { ids: newRules.map((rule) => rule.id) },
            },
        }
    })
}

function ruleIds(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
}

function restoreRuleState(ctx: ExtensionContext, rules: RuleFile[]) {
    const allowed = new Set(rules.map((rule) => rule.id))
    let visible = new Set<string>()
    const pending = new Set<string>()
    for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === "compaction") {
            visible.clear()
            pending.clear()
        } else if (entry.type === "custom" && entry.customType === RULES_STATE_ENTRY) {
            const data = entry.data
            if (!data || typeof data !== "object" || !("visible" in data)) continue
            visible = new Set(ruleIds(data.visible).filter((id) => allowed.has(id)))
            for (const id of visible) pending.delete(id)
        }
        const details =
            entry.type === "custom_message" && entry.customType === "rules-delivery"
                ? entry.details
                : entry.type === "message" &&
                    entry.message.role === "toolResult" &&
                    entry.message.toolName === "read" &&
                    !entry.message.isError
                  ? entry.message.details
                  : undefined
        if (!details || typeof details !== "object" || !("rulesDelivery" in details)) continue
        const delivery = details.rulesDelivery
        if (!delivery || typeof delivery !== "object" || !("ids" in delivery)) continue
        for (const id of ruleIds(delivery.ids)) {
            if (allowed.has(id) && !visible.has(id)) pending.add(id)
        }
    }
    return { visible, pending }
}

function refreshRuntimeState(runtime: RuntimeState, ctx: ExtensionContext) {
    const scanned = scanRules(ctx.cwd)
    const restored = restoreRuleState(ctx, scanned.rules)
    const allowed = new Set(scanned.rules.map((rule) => rule.id))
    Object.assign(runtime, scanned)
    runtime.visibleRuleIds = restored.visible
    runtime.pendingRuleIds = new Set(
        [...runtime.pendingRuleIds, ...restored.pending].filter((id) => allowed.has(id) && !restored.visible.has(id)),
    )
}

function persistVisibleRuleState(pi: ExtensionAPI, runtime: RuntimeState) {
    pi.appendEntry(RULES_STATE_ENTRY, { visible: [...runtime.visibleRuleIds].sort() })
}

function modelText(messages: ContextWithSystemEvent["messages"]): string[] {
    return convertToLlm(messages).flatMap((message) =>
        typeof message.content === "string"
            ? [message.content]
            : message.content.filter((part) => part.type === "text").map((part) => part.text),
    )
}

function getActiveRules(runtime: RuntimeState): RuleFile[] {
    return runtime.rules.filter((rule) => rule.patterns.length === 0 || runtime.visibleRuleIds.has(rule.id))
}

function getUnloadedConditionalRules(runtime: RuntimeState): RuleFile[] {
    return runtime.rules.filter((rule) => rule.patterns.length > 0 && !runtime.visibleRuleIds.has(rule.id))
}

function getConditionalRulesForTarget(runtime: RuntimeState, targetPath: string): RuleFile[] {
    return runtime.rules.filter((rule) => rule.patterns.length > 0 && matchesRule(rule, targetPath, runtime.repoRoot))
}

function scanRules(cwd: string): RuleInventory {
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

    const patterns = normalizeRulePatterns(frontmatter.paths)
    return {
        id: createHash("sha256")
            .update(JSON.stringify([path.resolve(filePath), patterns, trimmedBody]))
            .digest("hex"),
        source,
        filePath: path.resolve(filePath),
        displayPath: formatDisplayPath(path.resolve(filePath), source, repoRoot),
        patterns,
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

function buildRulesSystemPrompt(runtime: RuntimeState): string {
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
            "Some rules are path-scoped. Read relevant files before composing an editing script. A read queues their rules for the next model response; a nested read or a read in the same pre-authored tool batch does not authorize edits. Return from the script to receive new rules before editing that scope. Already-visible scopes need no extra rule-loading round trip.",
        )
    }

    return `\n\n${lines.join("\n")}`
}

function buildRuleText(rule: RuleFile): string {
    const patterns = rule.patterns.join(", ")
    return `You must follow these path-scoped rules when reviewing, editing, or writing any file matching the following path patterns ${patterns}:\n\n#### Rules for paths: ${patterns}\n${rule.body}`
}

function buildFullReminder(rules: RuleFile[]): string {
    return `<system-reminder>\n\n${rules.map(buildRuleText).join("\n\n")}\n</system-reminder>`
}

function buildCompactReminder(rules: RuleFile[]): string {
    const patterns = rules.map((rule) => rule.patterns.join(", ")).join(", ")
    return `<system-reminder>This file matches path-scoped rules for paths ${patterns} - you loaded them earlier. Follow the loaded rules.</system-reminder>`
}

function formatRulesReport(runtime: RuntimeState): string {
    const activeRuleIds = new Set(getActiveRules(runtime).map((rule) => rule.id))
    const unloadedRules = getUnloadedConditionalRules(runtime)

    const lines: string[] = []
    lines.push(`Repo root: ${runtime.repoRoot}`)
    lines.push(`Project rules dir: ${runtime.projectRulesDir}`)
    lines.push(`Global rules dir: ${runtime.globalRulesDir}`)
    lines.push("")

    lines.push(`Rules: ${runtime.rules.length}`)
    lines.push(`Active: ${activeRuleIds.size}`)
    lines.push(`Awaiting model delivery: ${runtime.pendingRuleIds.size}`)
    lines.push(`Unloaded conditional: ${unloadedRules.length}`)
    lines.push("")

    lines.push("Active rules")
    if (activeRuleIds.size === 0) {
        lines.push("  (none)")
    } else {
        for (const rule of getActiveRules(runtime)) {
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

function getMatchCandidate(targetPath: string, repoRoot: string): string | undefined {
    if (!isWithinDir(targetPath, repoRoot)) return undefined
    return normalizePosixPath(path.relative(repoRoot, targetPath))
}

function matchesRule(rule: RuleFile, targetPath: string, repoRoot: string): boolean {
    const candidate = getMatchCandidate(targetPath, repoRoot)
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
