import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import { type BranchFormat, BranchFormatSchema, PROJECT_ROOT } from "./domain.js"
import * as Git from "./git.js"

export { BranchFormatSchema }
export type { BranchFormat }

export const PROJECT_CONFIG_PATH = `${PROJECT_ROOT}/config.json`
export const LOCAL_PROJECT_CONFIG_PATH = `${PROJECT_ROOT}/config.local.json`
export const GLOBAL_WORKFLOW_SETTINGS_NAME = "workflows"
export const UNVERSIONED_PROJECT_EXCLUDE = `/${PROJECT_ROOT}/`
export const LOCAL_PROJECT_CONFIG_EXCLUDE = `/${LOCAL_PROJECT_CONFIG_PATH}`
export const ENTITY_LOCAL_IGNORE = `${PROJECT_ROOT}/**/.local/`
const ENTITY_LOCAL_PATHSPEC = `:(glob)${PROJECT_ROOT}/**/.local/**`

const BranchConfigurationSchema = Type.Object({ format: BranchFormatSchema }, { additionalProperties: false })
const ReviewConfigurationSchema = Type.Object(
    { userConfirmationAfter: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false },
)

export const ProjectConfigSchema = Type.Object(
    {
        artifacts: Type.Union([Type.Literal("versioned"), Type.Literal("unversioned")]),
        branches: BranchConfigurationSchema,
        reviews: Type.Optional(ReviewConfigurationSchema),
    },
    { additionalProperties: false },
)

type PersistedProjectConfig = Static<typeof ProjectConfigSchema>
export type ProjectConfig = PersistedProjectConfig & {
    branches: PersistedProjectConfig["branches"] & { username?: string }
}

const WorkflowSettingsSchema = Type.Object(
    {
        branches: Type.Object(
            { username: Type.String({ minLength: 1, pattern: "^[^/\\r\\n]+$" }) },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
)
type WorkflowSettings = Static<typeof WorkflowSettingsSchema>

export function loadProjectConfig(cwd: string, options: { globalSettingsPath?: string } = {}): ProjectConfig {
    const root = project.resolveRootDir(cwd)
    const configPath = path.join(root, PROJECT_CONFIG_PATH)
    if (!fs.existsSync(configPath)) {
        throw new Error(`missing required ${PROJECT_CONFIG_PATH}`)
    }

    let input: unknown
    try {
        input = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`invalid ${PROJECT_CONFIG_PATH}: ${message}`)
    }
    if (!Value.Check(ProjectConfigSchema, input)) {
        const details = [...Value.Errors(ProjectConfigSchema, input)]
            .map((error) => `${error.instancePath || "/"}: ${error.message}`)
            .join("; ")
        throw new Error(`invalid ${PROJECT_CONFIG_PATH}: ${details}`)
    }

    if (!formatUsesUsername(input.branches.format)) return input

    const settingsPaths = getWorkflowSettingsPaths(root, options)
    const globalSettings = loadWorkflowSettings(settingsPaths.global)
    const localSettings = loadWorkflowSettings(settingsPaths.local)
    const username = localSettings?.branches.username ?? globalSettings?.branches.username
    if (!username) {
        throw new Error(
            `invalid branch configuration: username is required in ${LOCAL_PROJECT_CONFIG_PATH} or global workflows.settings.json`,
        )
    }

    return {
        ...input,
        branches: { ...input.branches, username },
    }
}

export function getWorkflowSettingsPaths(cwd: string, options: { globalSettingsPath?: string } = {}) {
    const root = project.resolveRootDir(cwd)
    const global = project.getExtensionSettingsPaths(GLOBAL_WORKFLOW_SETTINGS_NAME, root).global
    return {
        global: options.globalSettingsPath ?? global,
        local: path.join(root, LOCAL_PROJECT_CONFIG_PATH),
    }
}

export function prepareArtifactPersistence(cwd: string) {
    const { config, excludePath, missing } = inspectArtifactPersistence(cwd)
    if (missing) appendExcludeEntry(excludePath, missing.comment, missing.entry)
    return { mode: config.artifacts, state: "ready" as const, excludePath }
}

export function assertArtifactPersistencePrepared(cwd: string): ProjectConfig {
    const { config, missing } = inspectArtifactPersistence(cwd)
    if (missing) throw new Error(`${missing.label} are not prepared; call prepare_artifacts before continuing`)
    return config
}

function inspectArtifactPersistence(cwd: string) {
    const root = project.resolveRootDir(cwd)
    assertGitRepository(root)
    const config = loadProjectConfig(root)
    const excludePath = gitExcludePath(root)
    const hasExclude = hasUnversionedProjectExclude(excludePath)

    if (config.artifacts === "versioned") {
        if (hasExclude) {
            throw new Error(
                `${PROJECT_CONFIG_PATH} uses versioned artifacts but ${UNVERSIONED_PROJECT_EXCLUDE} remains in ${relativeOrAbsolute(root, excludePath)}; remove it manually`,
            )
        }
        assertVersionedLocalStateIgnored(root)
        assertLocalProjectConfigOutsideGit(root)
        assertEntityLocalStateOutsideGit(root)
        if (
            fs.existsSync(path.join(root, LOCAL_PROJECT_CONFIG_PATH)) &&
            !hasExcludeEntry(excludePath, LOCAL_PROJECT_CONFIG_EXCLUDE)
        ) {
            return {
                config,
                excludePath,
                missing: {
                    entry: LOCAL_PROJECT_CONFIG_EXCLUDE,
                    comment: "# local workflow settings",
                    label: "local workflow settings",
                },
            }
        }
    } else {
        assertNoProjectPathsInGit(root)
        if (!hasExclude) {
            return {
                config,
                excludePath,
                missing: {
                    entry: UNVERSIONED_PROJECT_EXCLUDE,
                    comment: "# unversioned workflow artifacts",
                    label: "unversioned artifacts",
                },
            }
        }
    }
    return { config, excludePath, missing: undefined }
}

function loadWorkflowSettings(filePath: string): WorkflowSettings | undefined {
    if (!fs.existsSync(filePath)) return undefined
    let input: unknown
    try {
        input = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`invalid ${filePath}: ${message}`)
    }
    if (!Value.Check(WorkflowSettingsSchema, input)) {
        const details = [...Value.Errors(WorkflowSettingsSchema, input)]
            .map((error) => `${error.instancePath || "/"}: ${error.message}`)
            .join("; ")
        throw new Error(`invalid ${filePath}: ${details}`)
    }
    return input
}

function formatUsesUsername(format: BranchFormat): boolean {
    return format.startsWith("username")
}

function assertNoProjectPathsInGit(root: string): void {
    const inGit = Git.run(root, ["ls-files", "--cached", "--", PROJECT_ROOT])
    const staged = Git.run(root, ["diff", "--cached", "--name-only", "--", PROJECT_ROOT])
    if (inGit || staged) {
        throw new Error(
            `unversioned artifact mode cannot proceed while ${PROJECT_ROOT}/ paths are in Git or staged; removal from Git requires separate user approval`,
        )
    }
}

function assertVersionedLocalStateIgnored(root: string): void {
    if (!hasExcludeEntry(path.join(root, ".gitignore"), ENTITY_LOCAL_IGNORE)) {
        throw new Error(
            `versioned artifacts require ${ENTITY_LOCAL_IGNORE} in .gitignore; add it through project setup before continuing`,
        )
    }
}

function assertLocalProjectConfigOutsideGit(root: string): void {
    const inGit = Git.run(root, ["ls-files", "--cached", "--", LOCAL_PROJECT_CONFIG_PATH])
    const staged = Git.run(root, ["diff", "--cached", "--name-only", "--", LOCAL_PROJECT_CONFIG_PATH])
    if (inGit || staged) {
        throw new Error(
            `${LOCAL_PROJECT_CONFIG_PATH} must remain outside Git; remove it from the index before continuing`,
        )
    }
}

function assertEntityLocalStateOutsideGit(root: string): void {
    const inGit = Git.run(root, ["ls-files", "--cached", "--", ENTITY_LOCAL_PATHSPEC])
    const staged = Git.run(root, ["diff", "--cached", "--name-only", "--", ENTITY_LOCAL_PATHSPEC])
    if (inGit || staged) {
        throw new Error(
            `entity .local directories must remain outside Git; remove them from the index before continuing`,
        )
    }
}

function gitExcludePath(root: string): string {
    const value = Git.run(root, ["rev-parse", "--git-path", "info/exclude"])
    return path.resolve(root, value)
}

function hasUnversionedProjectExclude(excludePath: string): boolean {
    return hasExcludeEntry(excludePath, UNVERSIONED_PROJECT_EXCLUDE)
}

function hasExcludeEntry(excludePath: string, entry: string): boolean {
    if (!fs.existsSync(excludePath)) return false
    return fs
        .readFileSync(excludePath, "utf-8")
        .split(/\r?\n/)
        .some((line) => line === entry)
}

function appendExcludeEntry(excludePath: string, comment: string, entry: string): void {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true })
    const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf-8") : ""
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""
    fs.appendFileSync(excludePath, `${separator}${comment}\n${entry}\n`)
}

function assertGitRepository(root: string): void {
    Git.run(root, ["rev-parse", "--show-toplevel"])
}

function relativeOrAbsolute(root: string, target: string): string {
    const relative = path.relative(root, target)
    return relative && !relative.startsWith("..") ? relative : target
}
