import * as fs from "node:fs"
import * as path from "node:path"

import { Type } from "typebox"
import { Value } from "typebox/value"

import type { McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import { resolveRootDir } from "../../../extensions/__lib/project.js"
import {
    inspectMcpAllowRules,
    inspectPersistentPermissions,
    validatePermissionSettings,
} from "../../../extensions/permission/index.js"
import { ensureLocalSettingsExclusion } from "./local-settings.js"

export const LOCAL_PERMISSION_SETTINGS_EXCLUDE = "/.agents/permission.settings.local.json"

const SettingsTargetSchema = Type.Union([Type.Literal("project"), Type.Literal("local")])
const PermissionRuleSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })
const RulesSchema = Type.Array(PermissionRuleSchema, { uniqueItems: true })

export const PermissionInspectionSchema = Type.Object(
    { rules: Type.Array(PermissionRuleSchema, { minItems: 1, uniqueItems: true }) },
    { additionalProperties: false },
)

export const ProjectPermissionConfigurationSchema = Type.Object(
    { target: SettingsTargetSchema, allow: RulesSchema, ask: RulesSchema },
    { additionalProperties: false },
)

export function inspectProjectPermissions(cwd: string, input: unknown, catalog: McpToolCatalog) {
    const parsed = Value.Parse(PermissionInspectionSchema, input)
    const { sources } = inspectPersistentPermissions(cwd)
    return {
        scope: "Persistent global, project, and local settings only; excludes session overrides and skill-derived allows.",
        rules: inspectMcpAllowRules(parsed.rules, sources, catalog),
    }
}

export function configureProjectPermissions(cwd: string, input: unknown, catalog: McpToolCatalog) {
    const parsed = Value.Parse(ProjectPermissionConfigurationSchema, input)
    if (parsed.allow.length + parsed.ask.length === 0) throw new Error("request at least one allow or ask rule")
    validatePermissionSettings({ allow: parsed.allow, ask: parsed.ask })
    const root = resolveRootDir(cwd)
    const { sources } = inspectPersistentPermissions(root)
    const target = sources.find((source) => source.tier === parsed.target)!
    const settingsPath = target.path
    const existing = target.settings
    const added = { allow: [] as string[], ask: parsed.ask.filter((rule) => !(existing.ask ?? []).includes(rule)) }
    const skippedAsk = parsed.ask.filter((rule) => (existing.ask ?? []).includes(rule))
    const inspection = [] as ReturnType<typeof inspectMcpAllowRules>
    // Validate the complete request before changing even the in-memory settings.
    inspectMcpAllowRules(parsed.allow, sources, catalog)
    target.settings = { ...existing, ask: [...(existing.ask ?? []), ...added.ask] }
    for (const rule of parsed.allow) {
        const result = inspectMcpAllowRules([rule], sources, catalog)[0]
        inspection.push(result)
        if (result.status !== "available") continue
        added.allow.push(rule)
        target.settings = { ...target.settings, allow: [...(target.settings.allow ?? []), rule] }
    }
    const changed = added.allow.length + added.ask.length > 0
    const settings = validatePermissionSettings({
        ...existing,
        ...(added.allow.length > 0 ? { allow: [...(existing.allow ?? []), ...added.allow] } : {}),
        ...(added.ask.length > 0 ? { ask: [...(existing.ask ?? []), ...added.ask] } : {}),
    })
    const exclusion =
        changed && parsed.target === "local"
            ? ensureLocalSettingsExclusion(
                  root,
                  ".agents/permission.settings.local.json",
                  LOCAL_PERMISSION_SETTINGS_EXCLUDE,
              )
            : undefined
    if (changed) {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
        fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 4)}\n`)
    }
    return {
        target: parsed.target,
        file: path.relative(root, settingsPath),
        added,
        skipped: { allow: inspection.filter((result) => result.status !== "available"), ask: skippedAsk },
        inspection,
        changed,
        localExclusionChanged: exclusion?.changed ?? false,
    }
}
