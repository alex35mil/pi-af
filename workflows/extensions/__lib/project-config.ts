import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, type TSchema, Type } from "typebox"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import { requireRuntime } from "../../../extensions/__lib/runtime.js"
import { type BranchFormat, BranchFormatSchema, PROJECT_LOCAL_ROOT, PROJECT_ROOT } from "./domain.js"
import * as Git from "./git.js"

export { BranchFormatSchema }
export type { BranchFormat }

export const PROJECT_CONFIG_PATH = `${PROJECT_ROOT}/config.json`
export const LOCAL_PROJECT_CONFIG_PATH = `${PROJECT_ROOT}/config.local.json`
export const GLOBAL_WORKFLOW_SETTINGS_NAME = "workflows"
export const LOCAL_PROJECT_CONFIG_EXCLUDE = `/${LOCAL_PROJECT_CONFIG_PATH}`
// The single repository rule that keeps every workflow entity and private evidence out of Git.
// No trailing slash, so it also matches a worker's symlink to its source checkout's directory.
export const PROJECT_LOCAL_IGNORE = `/${PROJECT_LOCAL_ROOT}`
// The rule setup wrote before workers existed; it matches only a real directory.
export const LEGACY_PROJECT_LOCAL_IGNORE = `/${PROJECT_LOCAL_ROOT}/`

const BranchConfigurationSchema = Type.Object({ format: BranchFormatSchema }, { additionalProperties: false })
const ReviewConfigurationSchema = Type.Object(
    { userConfirmationAfter: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false },
)

export const ProjectConfigSchema = Type.Object(
    {
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
            `invalid branch configuration: username is required in ${LOCAL_PROJECT_CONFIG_PATH} or global workflows.json`,
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
    const { excludePath, missing } = inspectArtifactPersistence(cwd)
    if (missing) {
        appendExcludeEntry(excludePath, missing.comment, missing.entry)
        assertArtifactPersistencePrepared(cwd)
    }
    // A configured project always has the folder, so worker tooling can link it before the first entity.
    // Created only after the ignore check passed, so Git already ignores it.
    const localRoot = path.join(project.resolveRootDir(cwd), PROJECT_LOCAL_ROOT)
    if (!fs.existsSync(localRoot) && !isSymbolicLink(localRoot)) fs.mkdirSync(localRoot, { recursive: true })
    return { state: "ready" as const, excludePath }
}

export function assertArtifactPersistencePrepared(cwd: string): ProjectConfig {
    const { config, missing } = inspectArtifactPersistence(cwd)
    if (missing) throw new Error(`${missing.label} are not prepared; call prepare_artifacts before continuing`)
    return config
}

/**
 * In a sandboxed worker, workflow artifacts must reach the source checkout through the
 * `.project/.local` symlink. A missing or real directory would keep them only in the
 * disposable copy, so they'd be lost when the worker is deleted.
 */
export function assertSandboxArtifactsLinked(cwd: string): void {
    if (requireRuntime() !== "sandbox") return
    const localRoot = path.join(project.resolveRootDir(cwd), PROJECT_LOCAL_ROOT)
    if (isSymbolicLink(localRoot) && isDirectory(localRoot)) return
    throw new Error(
        `this worker's ${PROJECT_LOCAL_ROOT} isn't linked to its source checkout, so workflow artifacts would be lost when the worker is deleted; run project setup in the source checkout, then recreate the worker`,
    )
}

function isDirectory(file: string): boolean {
    try {
        return fs.statSync(file).isDirectory()
    } catch {
        return false
    }
}

function inspectArtifactPersistence(cwd: string) {
    const root = project.resolveRootDir(cwd)
    const config = loadProjectConfig(root)
    const before = persistenceInputs(root, config)
    const excludePath = before.excludePath
    if (before.key === validatedPersistenceInputs) return { config, excludePath, missing: undefined }
    validatedPersistenceInputs = undefined

    assertProjectLocalIgnored(root)
    assertLocalProjectConfigOutsideGit(root)
    assertProjectLocalOutsideGit(root)
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
            // The ignore check depends on whether the local root is a symlink.
            linkedLocalRoot: isSymbolicLink(path.join(root, PROJECT_LOCAL_ROOT)),
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

// Ask Git, so the answer matches what Git will actually stage. Only the committed root .gitignore
// counts: .git/info/exclude and global excludes are local to one clone.
function assertProjectLocalIgnored(root: string): void {
    const linked = isSymbolicLink(path.join(root, PROJECT_LOCAL_ROOT))
    // A trailing-slash rule applies only to paths Git knows are directories. Query a missing or real
    // directory in directory form, so the legacy rule still covers fresh clones; a symlink is a file to Git.
    const query = linked ? PROJECT_LOCAL_ROOT : `${PROJECT_LOCAL_ROOT}/`
    const match = Git.tryRun(root, ["check-ignore", "--verbose", "--no-index", "--", query])
    const source = match.split("\t")[0]?.split(":")[0]
    if (source === ".gitignore") return
    throw new Error(
        linked
            ? `${PROJECT_LOCAL_ROOT} is a symlink, which requires ${PROJECT_LOCAL_IGNORE} (no trailing slash) in .gitignore; update it through project setup before continuing`
            : `workflow artifacts require ${PROJECT_LOCAL_IGNORE} in .gitignore; add it through project setup before continuing`,
    )
}

function isSymbolicLink(file: string): boolean {
    try {
        return fs.lstatSync(file).isSymbolicLink()
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
        throw error
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

function assertProjectLocalOutsideGit(root: string): void {
    const inGit = Git.run(root, ["ls-files", "--cached", "--", PROJECT_LOCAL_ROOT])
    const staged = Git.run(root, ["diff", "--cached", "--name-only", "--", PROJECT_LOCAL_ROOT])
    if (inGit || staged) {
        throw new Error(
            `${PROJECT_LOCAL_ROOT}/ must remain outside Git; remove it from the index with git rm --cached before continuing`,
        )
    }
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
