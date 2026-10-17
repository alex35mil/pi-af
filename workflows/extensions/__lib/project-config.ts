import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, type TSchema, Type } from "typebox"
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

const BranchSettingsSchema = Type.Object(
    { username: Type.String({ minLength: 1, pattern: "^[^/\\r\\n]+$" }) },
    { additionalProperties: false },
)
const LocalWorkflowSettingsSchema = Type.Object({ branches: BranchSettingsSchema }, { additionalProperties: false })
const WorkflowSettingsSchema = Type.Object(
    {
        branches: Type.Optional(BranchSettingsSchema),
        workflowProject: Type.Optional(Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })),
    },
    { additionalProperties: false, minProperties: 1 },
)

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
    const globalSettings = loadWorkflowSettings(settingsPaths.global, WorkflowSettingsSchema)
    const localSettings = loadWorkflowSettings(settingsPaths.local, LocalWorkflowSettingsSchema)
    const username = localSettings?.branches.username ?? globalSettings?.branches?.username
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

export function resolveWorkflowProject(cwd: string, options: { globalSettingsPath?: string } = {}): string {
    const settingsPath = getWorkflowSettingsPaths(cwd, options).global
    const configured = loadWorkflowSettings(settingsPath, WorkflowSettingsSchema)?.workflowProject
    const instruction = `Set workflowProject to the absolute workflow source repository root in ${settingsPath}.`
    if (!configured) throw new Error(instruction)
    if (!path.isAbsolute(configured)) throw new Error(instruction)
    try {
        const root = fs.realpathSync(configured)
        if (!fs.statSync(root).isDirectory()) throw new Error("path is not a directory")
        const repositoryRoot = fs.realpathSync(Git.run(root, ["rev-parse", "--show-toplevel"]))
        if (root !== repositoryRoot) throw new Error("path is not the repository root")
        return root
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Invalid workflowProject ${JSON.stringify(configured)}: ${message}. ${instruction}`)
    }
}

let validatedPersistenceInputs: string | undefined

export function prepareArtifactPersistence(cwd: string) {
    validatedPersistenceInputs = undefined
    const { config, excludePath, missing } = inspectArtifactPersistence(cwd)
    if (missing) {
        appendExcludeEntry(excludePath, missing.comment, missing.entry)
        assertArtifactPersistencePrepared(cwd)
    }
    return { mode: config.artifacts, state: "ready" as const, excludePath }
}

export function assertArtifactPersistencePrepared(cwd: string): ProjectConfig {
    const { config, missing } = inspectArtifactPersistence(cwd)
    if (missing) throw new Error(`${missing.label} are not prepared; call prepare_artifacts before continuing`)
    return config
}

function inspectArtifactPersistence(cwd: string) {
    const root = project.resolveRootDir(cwd)
    const config = loadProjectConfig(root)
    const before = persistenceInputs(root, config)
    const excludePath = before.excludePath
    if (before.key === validatedPersistenceInputs) return { config, excludePath, missing: undefined }
    validatedPersistenceInputs = undefined
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
    // Cache only the inputs actually inspected, never inputs changed during the scan.
    if (persistenceInputs(root, config).key === before.key) validatedPersistenceInputs = before.key
    return { config, excludePath, missing: undefined }
}

function persistenceInputs(root: string, config: ProjectConfig) {
    const paths = Git.run(root, [
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--absolute-git-dir",
        "--git-path",
        "index",
        "--git-path",
        "info/exclude",
    ]).split("\n")
    const [repository, gitDirectory, indexPath, excludePath] = paths
    if (paths.length !== 4) throw new Error("could not resolve artifact persistence Git paths")
    const commit = Git.tryRun(root, ["rev-parse", "--verify", "HEAD"])
    const head = commit
        ? { kind: "commit", commit }
        : { kind: "unborn", reference: Git.run(root, ["symbolic-ref", "--quiet", "HEAD"]) }
    const files = [
        indexPath,
        excludePath,
        path.join(root, ".gitignore"),
        path.join(root, PROJECT_CONFIG_PATH),
        path.join(root, LOCAL_PROJECT_CONFIG_PATH),
    ]
    return {
        excludePath,
        key: JSON.stringify({
            repository,
            gitDirectory,
            indexPath,
            excludePath,
            head,
            config,
            files: files.map(fileFingerprint),
        }),
    }
}

function fileFingerprint(file: string): string | null {
    try {
        return createHash("sha256").update(fs.readFileSync(file)).digest("hex")
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
        throw error
    }
}

function loadWorkflowSettings<S extends TSchema>(filePath: string, schema: S): Static<S> | undefined {
    if (!fs.existsSync(filePath)) return undefined
    let input: unknown
    try {
        input = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`invalid ${filePath}: ${message}`)
    }
    if (!Value.Check(schema, input)) {
        const details = [...Value.Errors(schema, input)]
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

function relativeOrAbsolute(root: string, target: string): string {
    const relative = path.relative(root, target)
    return relative && !relative.startsWith("..") ? relative : target
}
