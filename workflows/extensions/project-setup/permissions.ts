import * as fs from "node:fs"
import * as path from "node:path"

import { Type } from "typebox"
import { Value } from "typebox/value"

import { type PermissionSettings, validatePermissionSettings } from "../../../extensions/permission/index.js"
import { getExtensionSettingsPaths, resolveRootDir } from "../../../extensions/__lib/project.js"
import { ensureLocalSettingsExclusion } from "./local-settings.js"

export const LOCAL_PERMISSION_SETTINGS_EXCLUDE = "/.agents/permission.settings.local.json"

const SettingsTargetSchema = Type.Union([Type.Literal("project"), Type.Literal("local")])
const PermissionRuleSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })

export const ProjectPermissionConfigurationSchema = Type.Object(
    {
        target: SettingsTargetSchema,
        rules: Type.Array(PermissionRuleSchema, { minItems: 1, uniqueItems: true }),
    },
    { additionalProperties: false },
)

export function configureProjectPermissions(cwd: string, input: unknown) {
    const parsed = Value.Parse(ProjectPermissionConfigurationSchema, input)
    const root = resolveRootDir(cwd)
    const paths = getExtensionSettingsPaths("permission", root)
    const settingsPath = paths[parsed.target]
    const existing = readPermissionSettings(settingsPath)
    const existingRules = new Set(existing.ask ?? [])
    const addedRules = parsed.rules.filter((rule) => !existingRules.has(rule))
    const settings = validatePermissionSettings({
        ...existing,
        ask: [...(existing.ask ?? []), ...addedRules],
    })

    const exclusion =
        parsed.target === "local"
            ? ensureLocalSettingsExclusion(
                  root,
                  ".agents/permission.settings.local.json",
                  LOCAL_PERMISSION_SETTINGS_EXCLUDE,
              )
            : undefined

    if (addedRules.length > 0) {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
        fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 4)}\n`)
    }

    return {
        target: parsed.target,
        file: path.relative(root, settingsPath),
        addedRules,
        changed: addedRules.length > 0,
        localExclusionChanged: exclusion?.changed ?? false,
    }
}

function readPermissionSettings(settingsPath: string): PermissionSettings {
    if (!fs.existsSync(settingsPath)) return {}

    let value: unknown
    try {
        value = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`invalid permission settings ${settingsPath}: ${message}`)
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`invalid permission settings ${settingsPath}: expected an object`)
    }
    return validatePermissionSettings(value as PermissionSettings)
}
