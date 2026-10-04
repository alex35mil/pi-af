import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import {
    DeliverableKindSchema,
    entityDirectoryName,
    EPIC_ROOT,
    type EntityIdentity,
    formatBranchName,
    generateRawId,
    GIG_ROOT,
    normalizePriority,
    type Priority,
    PrioritySchema,
    PROJECT_ROOT,
    qualifyId,
    type RawId,
    readyBranch,
    type ReadyBranchContract,
    slugify,
} from "../__lib/domain.js"
import {
    assertEntityBranchReady,
    type BranchContract,
    ENTITY_LOCAL_DIR,
    ENTITY_METADATA_FILE,
    LOCAL_DESIGNS_DIR,
    LOCAL_NOTES_FILE,
    LOCAL_PENDING_FILE,
    LOCAL_REVIEWS_DIR,
    LOCAL_SCRATCH_DIR,
    type EntityStatus,
    EntityStatusSchema,
    readEntityStatus,
    readOrderedTaskEntries,
    resolveEntityDirectory,
    writeEntityStatus,
} from "../__lib/entity.js"
import { writeTextAtomically } from "../__lib/files.js"
import type { ResourceIds } from "../integrations/resource-ids.js"
import { resourceIdsFromAdoption } from "./resource-ids.js"
import * as Git from "../__lib/git.js"
import { assertArtifactPersistencePrepared, type ProjectConfig } from "../__lib/project-config.js"
import { resolveWorkflowEnvironment, resolveWorkflowPolicy, type WorkflowEnvironment } from "../integrations/policy.js"
import { assertConfiguredPriority, INTEGRATION_CONFIG_PATH, loadIntegrationConfig } from "../integrations/config.js"
import {
    assertTaskSourceProject,
    boundTrackerProjectId,
    createInitialIntegrationRecords,
    createTrackerBranchContract,
    GitHubInitializationSourceSchema,
    type InitializationSource,
    LinearGigInitializationSourceSchema,
    LinearProjectInitializationSourceSchema,
    LinearTaskInitializationSourceSchema,
    NewInitializationSourceSchema,
} from "../integrations/records.js"

const OneLineSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })

const baseInitializationProperties = {
    title: Type.String({
        minLength: 1,
        pattern: "^[^\\r\\n]+$",
        description:
            "User-approved cleaned title; correct accidental spelling, capitalization, punctuation, and formatting without changing meaning or exact technical literals",
    }),
    slug: OneLineSchema,
    request: Type.String({
        minLength: 1,
        description:
            "User-approved durable Request; preserve meaning while correcting grammar, spelling, capitalization, punctuation, and formatting; use the workflow command argument for new work or the tracker item's title/name and description for adopted work, plus agreed clarifications",
    }),
    priority: PrioritySchema,
}

export const EpicInitializationSchema = Type.Object(
    {
        ...baseInitializationProperties,
        entity: Type.Literal("epic"),
        source: Type.Union([
            NewInitializationSourceSchema,
            GitHubInitializationSourceSchema,
            LinearProjectInitializationSourceSchema,
        ]),
    },
    { additionalProperties: false },
)
export type EpicInitialization = Static<typeof EpicInitializationSchema>

export const TaskInitializationSchema = Type.Object(
    {
        ...baseInitializationProperties,
        entity: Type.Literal("task"),
        source: Type.Union([
            NewInitializationSourceSchema,
            GitHubInitializationSourceSchema,
            LinearTaskInitializationSourceSchema,
        ]),
        kind: DeliverableKindSchema,
        parentEpicDir: OneLineSchema,
        epicItemTitle: OneLineSchema,
    },
    { additionalProperties: false },
)
export type TaskInitialization = Static<typeof TaskInitializationSchema>

export const GigInitializationSchema = Type.Object(
    {
        ...baseInitializationProperties,
        entity: Type.Literal("gig"),
        source: Type.Union([
            NewInitializationSourceSchema,
            GitHubInitializationSourceSchema,
            LinearGigInitializationSourceSchema,
        ]),
        kind: DeliverableKindSchema,
    },
    { additionalProperties: false },
)
export type GigInitialization = Static<typeof GigInitializationSchema>

export const EntityInitializationSchema = Type.Union([
    EpicInitializationSchema,
    TaskInitializationSchema,
    GigInitializationSchema,
])
export type EntityInitialization = Static<typeof EntityInitializationSchema>

export interface InitializeEntityOptions {
    cwd: string
    now?: Date
    renderTrackerBranch?: (identity: EntityIdentity) => string
}

export interface InitializedEntity {
    directory: string
    status: EntityStatus
    adoptionResourceIds: ResourceIds[]
}

export function initializeEntity(input: EntityInitialization, options: InitializeEntityOptions): InitializedEntity {
    if (!Value.Check(EntityInitializationSchema, input)) {
        const details = [...Value.Errors(EntityInitializationSchema, input)]
            .map((error) => `${error.instancePath || "/"}: ${error.message}`)
            .join("; ")
        throw new Error(`invalid entity initialization: ${details}`)
    }

    const root = project.resolveRootDir(options.cwd)
    assertGitRepository(root)
    const projectConfig = assertArtifactPersistencePrepared(root)
    const timestamp = options.now ?? new Date()
    const slug = slugify(input.slug)
    const priority = normalizePriority(input.priority)
    const loadedIntegration = loadIntegrationConfig(root)
    const integrationConfig = loadedIntegration.state === "enabled" ? loadedIntegration.config : undefined
    const environment = resolveWorkflowEnvironment(projectConfig, integrationConfig)
    const policy = resolveWorkflowPolicy(environment)
    const tracker = environment.tracker.kind === "none" ? undefined : environment.tracker.config
    if (input.source.mode === "external" && (!tracker || tracker.provider !== input.source.provider)) {
        throw new Error(`cannot reuse external tracker work without a matching tracker in ${INTEGRATION_CONFIG_PATH}`)
    }
    if (tracker) assertConfiguredPriority(tracker, priority)

    const parent =
        input.entity === "task"
            ? readParentEpic(root, input.parentEpicDir, input.epicItemTitle, projectConfig)
            : undefined
    assertTaskSourceProject(input, parent?.trackerProjectId)
    const startBranch = input.entity === "task" ? parent!.branch : resolveDefaultBranch(root)
    const format = projectConfig.branches.format
    const rawId = generateRawId(timestamp)
    if (rawIdExists(path.join(root, PROJECT_ROOT), rawId)) {
        throw new Error(`workflow ID already exists for this timestamp: ${rawId}`)
    }

    const identity = { entity: input.entity, rawId, slug } as const
    const adoptionResourceIds = resourceIdsFromAdoption(input, environment, qualifyId(input.entity, rawId))
    const contract: BranchContract =
        format === "tracker"
            ? createTrackerBranchContract(
                  input,
                  identity,
                  startBranch,
                  environment.tracker,
                  options.renderTrackerBranch,
              )
            : readyBranch(formatBranchName(identity, format, projectConfig.branches.username), startBranch, "generated")
    const relativeDirectory =
        input.entity === "task"
            ? path.join(parent!.directory, "tasks", entityDirectoryName(identity, timestamp))
            : path.join(input.entity === "epic" ? EPIC_ROOT : GIG_ROOT, entityDirectoryName(identity, timestamp))
    const absoluteDirectory = path.join(root, relativeDirectory)

    let createdBranch: string | undefined
    let parentEpicUpdated = false
    let initializedStatus: EntityStatus | undefined
    try {
        if (contract.state === "ready") {
            assertBranchAvailable(root, contract)
            createBranch(root, contract)
            createdBranch = contract.name
        }
        createEntityArtifacts(
            absoluteDirectory,
            relativeDirectory,
            input,
            rawId,
            slug,
            priority,
            contract,
            timestamp,
            environment,
            policy.systemMetadataProjection,
            parent,
        )
        if (input.entity === "task") {
            writeTextAtomically(
                parent!.epicPath,
                annotateEpicPlanItem(parent!.epicContent, parent!.epicItemLine, qualifyId("task", rawId)),
            )
            parentEpicUpdated = true
        }
        initializedStatus = readEntityStatus(absoluteDirectory)
    } catch (error) {
        if (parentEpicUpdated) writeTextAtomically(parent!.epicPath, parent!.epicContent)
        fs.rmSync(absoluteDirectory, { recursive: true, force: true })
        if (createdBranch) deleteCreatedBranch(root, createdBranch)
        throw error
    }

    return { directory: relativeDirectory, status: initializedStatus!, adoptionResourceIds }
}

function createEntityArtifacts(
    absoluteDirectory: string,
    relativeDirectory: string,
    input: EntityInitialization,
    rawId: RawId,
    slug: string,
    priority: Priority,
    contract: BranchContract,
    timestamp: Date,
    environment: WorkflowEnvironment,
    exposesSystemTraces: boolean,
    parent?: ParentEpic,
): void {
    const integrations = createInitialIntegrationRecords(
        input,
        environment,
        exposesSystemTraces,
        parent?.trackerProjectId,
    )
    const authority =
        environment.tracker.kind === "none"
            ? ({ kind: "workflow", priority } as const)
            : ({
                  kind: "tracker",
                  provider: environment.tracker.kind,
                  desired: { lifecycle: "inProgress", priority },
              } as const)
    const common = {
        id: qualifyId(input.entity, rawId),
        rawId,
        slug,
        title: input.title.trim(),
        createdAt: timestamp.toISOString(),
        workStage: "planning" as const,
        branch: contract,
        integrations,
        authority,
        ...(authority.kind === "workflow" ? { state: "inProgress" as const } : {}),
    }
    const candidate =
        input.entity === "epic"
            ? { ...common, entity: "epic" as const, taskTarget: "epic" as const }
            : input.entity === "gig"
              ? { ...common, entity: "gig" as const, kind: input.kind }
              : { ...common, entity: "task" as const, kind: input.kind }
    const status = Value.Parse(EntityStatusSchema, candidate)

    const directories =
        input.entity === "epic"
            ? [ENTITY_LOCAL_DIR, LOCAL_REVIEWS_DIR, LOCAL_SCRATCH_DIR, "tasks"]
            : [ENTITY_LOCAL_DIR, LOCAL_REVIEWS_DIR, LOCAL_SCRATCH_DIR, LOCAL_DESIGNS_DIR]
    fs.mkdirSync(path.dirname(absoluteDirectory), { recursive: true })
    fs.mkdirSync(absoluteDirectory, { recursive: false })
    for (const directory of directories) fs.mkdirSync(path.join(absoluteDirectory, directory))

    fs.writeFileSync(path.join(absoluteDirectory, "brief.md"), `# Brief\n\n${input.request.trim()}\n`)
    fs.writeFileSync(path.join(absoluteDirectory, LOCAL_NOTES_FILE), "# Notes\n")
    if (input.entity !== "epic") fs.writeFileSync(path.join(absoluteDirectory, LOCAL_PENDING_FILE), "# Pending\n")
    writeEntityStatus(absoluteDirectory, status)

    if (!Value.Check(EntityStatusSchema, status)) {
        throw new Error(`generated invalid status for ${relativeDirectory}`)
    }
}

type OrderedTaskEntry = ReturnType<typeof readOrderedTaskEntries>[number]

function orderedTaskTitle(entry: OrderedTaskEntry): string {
    const match = /^\*\*(\S(?:.*\S)?)\*\*\s+—\s+\S/.exec(entry.display)
    if (!match) {
        throw new Error(`Epic Ordered Tasks entry must use **Title** — description: ${JSON.stringify(entry.line)}`)
    }
    return match[1]
}

function annotateEpicPlanItem(content: string, planItem: string, taskId: string): string {
    const newline = content.includes("\r\n") ? "\r\n" : "\n"
    const lines = content.split(/\r?\n/)
    const matches = lines.flatMap((line, index) => (line.trim() === planItem.trim() ? [index] : []))
    if (matches.length !== 1) throw new Error(`selected Epic plan item changed during Task initialization`)
    const index = matches[0]
    if (!/^\s*\d+\.\s+/.test(lines[index])) throw new Error(`selected Epic plan item is not ordered`)
    lines[index] = lines[index].replace(/^(\s*\d+\.\s+)/, `$1[${taskId}] `)
    return lines.join(newline)
}

interface ParentEpic {
    id: string
    rawId: RawId
    directory: string
    branch: string
    trackerProjectId?: string
    epicPath: string
    epicContent: string
    epicItemLine: string
}

function readParentEpic(
    root: string,
    rawDirectory: string,
    epicItemTitle: string,
    projectConfig: ProjectConfig,
): ParentEpic {
    const epicsRoot = path.join(root, EPIC_ROOT)
    const directory = path.resolve(root, rawDirectory)
    if (!directory.startsWith(`${epicsRoot}${path.sep}`)) {
        throw new Error(`parent Epic directory must be inside ${EPIC_ROOT}`)
    }

    const status = readEntityStatus(directory)
    if (status.entity !== "epic") throw new Error(`parent directory is not an Epic: ${rawDirectory}`)
    if (status.branch.state !== "ready") throw new Error(`parent Epic branch is not ready: ${rawDirectory}`)
    const trackerProjectId = boundTrackerProjectId(status)
    const epicPath = path.join(directory, "epic.md")
    if (!fs.existsSync(epicPath)) throw new Error(`parent Epic has no accepted epic.md: ${rawDirectory}`)
    const epicContent = fs.readFileSync(epicPath, "utf-8")
    const taskBranch = status.taskTarget === "epic" ? status.branch.name : status.branch.target
    if (status.taskTarget === "default") {
        assertEpicBranchMerged(root, status.branch.name, status.branch.target)
        if (projectConfig.artifacts === "versioned") assertFileReachableFromBranch(root, epicPath, taskBranch)
    }
    const title = epicItemTitle.trim()
    const matches = readOrderedTaskEntries(epicPath).filter((entry) => orderedTaskTitle(entry) === title)
    if (matches.length > 1) {
        throw new Error(`parent Epic contains multiple ordered Task entries titled ${JSON.stringify(title)}`)
    }
    const selected = matches[0]
    if (!selected) {
        throw new Error(`parent Epic does not contain an ordered Task entry titled ${JSON.stringify(title)}`)
    }
    if (selected.state === "initialized") {
        throw new Error(`parent Epic item already has an initialized Task: ${JSON.stringify(title)}`)
    }

    return {
        id: status.id,
        rawId: status.rawId,
        directory: path.relative(root, directory),
        branch: taskBranch,
        ...(trackerProjectId ? { trackerProjectId } : {}),
        epicPath,
        epicContent,
        epicItemLine: selected.line,
    }
}

function assertEpicBranchMerged(root: string, epicBranch: string, targetBranch: string): void {
    assertCloneBranch(root, epicBranch)
    assertCloneBranch(root, targetBranch)
    if (
        !Git.succeeds(root, ["merge-base", "--is-ancestor", `refs/heads/${epicBranch}`, `refs/heads/${targetBranch}`])
    ) {
        throw new Error(`Epic branch ${epicBranch} has not been merged into ${targetBranch}`)
    }
}

function assertFileReachableFromBranch(root: string, filePath: string, branch: string): void {
    const relativePath = path.relative(root, filePath).split(path.sep).join("/")
    const branchBlob = Git.tryRun(root, ["rev-parse", `${branch}:${relativePath}`])
    const workingBlob = Git.run(root, ["hash-object", "--", filePath])
    if (!branchBlob || branchBlob !== workingBlob) {
        throw new Error(`accepted parent Epic artifacts are not reachable from default branch ${branch}`)
    }
}

function rawIdExists(projectRoot: string, rawId: RawId): boolean {
    if (!fs.existsSync(projectRoot)) return false
    const pending = [projectRoot]
    while (pending.length > 0) {
        const directory = pending.pop()!
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name.includes(rawId)) return true
            if (entry.isDirectory()) pending.push(path.join(directory, entry.name))
        }
    }
    return false
}

function resolveDefaultBranch(root: string): string {
    const remoteHead = Git.tryRun(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
    if (remoteHead) {
        const branch = remoteHead.replace(/^origin\//, "")
        assertCloneBranch(root, branch)
        return branch
    }

    const recorded = recordedDefaultBranches(root)
    if (recorded.length === 1) {
        assertCloneBranch(root, recorded[0])
        return recorded[0]
    }
    if (recorded.length > 1) {
        throw new Error(`initialized work records conflicting repository default branches: ${recorded.join(", ")}`)
    }

    const currentBranch = Git.tryRun(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    if (currentBranch && cloneBranchExists(root, currentBranch)) return currentBranch

    const branches = Git.run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
        .split(/\r?\n/)
        .filter(Boolean)
    if (branches.length === 1) return branches[0]
    if (branches.length === 0) {
        throw new Error("repository has no commits; create the initial commit before initializing workflow work")
    }
    throw new Error(
        "repository default branch is ambiguous; check out the intended local branch before initializing work",
    )
}

interface RecordedBranchFacts {
    id: string
    start: string
    target: string
}

// Reads one entity's metadata.json without schema validation and extracts only the
// branch facts (id, start, target) that default-branch discovery needs. Intentionally
// format-blind in both directions: a done entity saved before a format change does not
// block new work, and this scan never signals staleness — that belongs to the entity's
// own operational read. Corrupt JSON or missing branch fields still throw. Strict
// operational validation stays in readEntityStatus.
function readRecordedBranchFacts(entityDirectory: string): RecordedBranchFacts | null {
    const metadataPath = path.join(entityDirectory, ENTITY_METADATA_FILE)
    if (!fs.existsSync(metadataPath)) return null
    let metadata: unknown
    try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
    } catch (cause) {
        throw new Error(`cannot parse ${metadataPath}: ${String(cause)}`)
    }
    if (typeof metadata !== "object" || metadata === null) {
        throw new Error(`invalid entity metadata in ${metadataPath}`)
    }
    const record = metadata as Record<string, unknown>
    if (record.entity !== "epic" && record.entity !== "gig") return null
    const branch = (record.branch ?? {}) as Record<string, unknown>
    if (typeof branch.start !== "string" || typeof branch.target !== "string") {
        throw new Error(`cannot read recorded branch in ${metadataPath}`)
    }
    return {
        id: typeof record.id === "string" ? record.id : path.basename(entityDirectory),
        start: branch.start,
        target: branch.target,
    }
}

function recordedDefaultBranches(root: string): string[] {
    const branches = new Set<string>()
    for (const relativeRoot of [EPIC_ROOT, GIG_ROOT]) {
        const entityRoot = path.join(root, relativeRoot)
        if (!fs.existsSync(entityRoot)) continue
        for (const entry of fs.readdirSync(entityRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            const facts = readRecordedBranchFacts(path.join(entityRoot, entry.name))
            if (!facts) continue
            if (facts.start !== facts.target) {
                throw new Error(`${facts.id} has inconsistent default-branch start and target`)
            }
            branches.add(facts.start)
        }
    }
    return [...branches]
}

export interface SetEpicTaskTargetOptions {
    cwd: string
}

export function setEpicTaskTarget(
    rawEntityDirectory: string,
    target: "epic" | "default",
    options: SetEpicTaskTargetOptions,
): EntityStatus {
    const root = project.resolveRootDir(options.cwd)
    assertGitRepository(root)
    assertArtifactPersistencePrepared(root)
    const entityDirectory = resolveEntityDirectory(root, options.cwd, rawEntityDirectory)
    const status = readEntityStatus(entityDirectory)
    if (status.entity !== "epic") throw new Error("Task target can only be changed for an Epic")
    assertEntityBranchReady(status)

    if (target === "default") {
        assertEpicBranchMerged(root, status.branch.name, status.branch.target)
    } else {
        assertCloneBranch(root, status.branch.name)
    }

    if (status.taskTarget === target) return status
    writeEntityStatus(entityDirectory, { ...status, taskTarget: target })
    return readEntityStatus(entityDirectory)
}

function assertGitRepository(root: string): void {
    Git.run(root, ["rev-parse", "--show-toplevel"])
}

function assertCloneBranch(root: string, branch: string): void {
    Git.run(root, ["show-ref", "--verify", `refs/heads/${branch}`])
}

function cloneBranchExists(root: string, branch: string): boolean {
    return Git.succeeds(root, ["show-ref", "--verify", `refs/heads/${branch}`])
}

function assertBranchAvailable(root: string, contract: ReadyBranchContract): void {
    assertCloneBranch(root, contract.start)
    const existing = Git.tryRun(root, ["show-ref", "--verify", `refs/heads/${contract.name}`])
    if (existing) throw new Error(`workflow branch already exists: ${contract.name}`)
    Git.run(root, ["check-ref-format", "--branch", contract.name])
}

function createBranch(root: string, contract: ReadyBranchContract): void {
    Git.run(root, ["branch", contract.name, contract.start])
}

function deleteCreatedBranch(root: string, branch: string): void {
    if (!Git.succeeds(root, ["show-ref", "--verify", `refs/heads/${branch}`])) return
    Git.tryRun(root, ["branch", "-D", branch])
}

export type { InitializationSource }
