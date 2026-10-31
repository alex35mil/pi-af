import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import type { McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import {
    DeliverableKindSchema,
    EPIC_ROOT,
    entityName,
    type EntityType,
    formatBranchName,
    GIG_ROOT,
    readyBranch,
    type ReadyBranchContract,
    slugify,
    trackerReferenceLabel,
} from "../__lib/domain.js"
import {
    ENTITY_METADATA_FILE,
    entityLabel,
    LOCAL_DESIGNS_DIR,
    LOCAL_NOTES_FILE,
    LOCAL_PENDING_FILE,
    LOCAL_REVIEWS_DIR,
    LOCAL_SCRATCH_DIR,
    type EntityStatus,
    EntityStatusSchema,
    readEntityStatus,
    readEpicTaskDirectories,
    resolveEntityDirectory,
    writeEntityStatus,
} from "../__lib/entity.js"
import { type EpicTask, readEpicRouting, readEpicTasks } from "../__lib/epic-tasks.js"
import type { ResourceIds } from "../integrations/resource-ids.js"
import { resourceIdsFromTrackerObject } from "./resource-ids.js"
import * as Git from "../__lib/git.js"
import {
    assertArtifactPersistencePrepared,
    assertSandboxArtifactsLinked,
    type ProjectConfig,
} from "../__lib/project-config.js"
import { resolveWorkflowEnvironment, type WorkflowEnvironment } from "../integrations/policy.js"
import { loadIntegrationConfig } from "../integrations/config.js"
import {
    GitHubTrackerObjectSchema,
    LinearGigIssueObjectSchema,
    LinearProjectObjectSchema,
    LinearTaskIssueObjectSchema,
    type TrackerObject,
    trackerRecordFromObject,
    trackerReference,
} from "../integrations/records.js"

const OneLineSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })

const baseProperties = {
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
}
// A Task always starts from the queued issue its parent Epic's issue processing created
// or linked. The issue's marker selects the plan Task, which also supplies the Kind.
export const TaskInitializationPropertiesSchema = Type.Object(
    {
        ...baseProperties,
        parentEpicDir: OneLineSchema,
    },
    { additionalProperties: false },
)
const gigProperties = { kind: DeliverableKindSchema }

// The read-only checks that run before a new Epic or Gig tracker object is created.
export const EpicPreflightSchema = Type.Object(
    { ...baseProperties, entity: Type.Literal("epic") },
    { additionalProperties: false },
)
export const GigPreflightSchema = Type.Object(
    { ...baseProperties, ...gigProperties, entity: Type.Literal("gig") },
    { additionalProperties: false },
)
export const PreflightSchema = Type.Union([EpicPreflightSchema, GigPreflightSchema])
export type PreflightInput = Static<typeof PreflightSchema>

// Initialization records an existing tracker object, created or adopted, as the entity.
export const EntityInitializationSchema = Type.Union([
    Type.Object(
        {
            ...EpicPreflightSchema.properties,
            object: Type.Union([GitHubTrackerObjectSchema, LinearProjectObjectSchema]),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...TaskInitializationPropertiesSchema.properties,
            entity: Type.Literal("task"),
            object: Type.Union([GitHubTrackerObjectSchema, LinearTaskIssueObjectSchema]),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...GigPreflightSchema.properties,
            object: Type.Union([GitHubTrackerObjectSchema, LinearGigIssueObjectSchema]),
        },
        { additionalProperties: false },
    ),
])
export type EntityInitialization = Static<typeof EntityInitializationSchema>
type TaskInitialization = Extract<EntityInitialization, { entity: "task" }>

export interface InitializeEntityOptions {
    cwd: string
    now?: Date
    tools?: McpToolCatalog
}

export interface InitializedEntity {
    directory: string
    status: EntityStatus
    resourceIds: ResourceIds[]
}

interface Prepared {
    root: string
    projectConfig: ProjectConfig
    environment: WorkflowEnvironment
    slug: string
    start: string
    parent?: ParentEpic
}

function prepare(input: PreflightInput | EntityInitialization, options: InitializeEntityOptions): Prepared {
    const root = project.resolveRootDir(options.cwd)
    assertGitRepository(root)
    const projectConfig = assertArtifactPersistencePrepared(root)
    assertSandboxArtifactsLinked(root)
    const environment = resolveWorkflowEnvironment(loadIntegrationConfig(root))
    const slug = slugify(input.slug)
    const parent = input.entity === "task" ? readParentEpic(root, input) : undefined
    const start = parent ? parent.branch : resolveDefaultBranch(root)
    assertCloneBranch(root, start)
    return { root, projectConfig, environment, slug, start, parent }
}

// Runs every local check that doesn't need the tracker object, so a failure stops
// before anything is created on the tracker. Changes nothing.
export function preflightEntity(input: PreflightInput, options: InitializeEntityOptions) {
    Value.Parse(PreflightSchema, input)
    const prepared = prepare(input, options)
    const { environment, projectConfig, slug } = prepared
    const tracker = environment.tracker
    if (projectConfig.branches.format === "tracker" && tracker.provider !== "linear")
        throw new Error("the tracker branch format requires a Linear tracker")
    return {
        state: "ready" as const,
        entity: input.entity,
        tracker: tracker.provider,
        resource: tracker.provider === "linear" && input.entity === "epic" ? ("project" as const) : ("issue" as const),
        start: prepared.start,
        next: "Create only the tracker object with the approved title and Request, then call the matching init tool with its evidence.",
    }
}

export function initializeEntity(input: EntityInitialization, options: InitializeEntityOptions): InitializedEntity {
    if (!Value.Check(EntityInitializationSchema, input)) {
        const details = [...Value.Errors(EntityInitializationSchema, input)]
            .map((error) => `${error.instancePath || "/"}: ${error.message}`)
            .join("; ")
        throw new Error(`invalid entity initialization: ${details}`)
    }
    const prepared = prepare(input, options)
    const { root, environment, slug, start, parent } = prepared
    const object = trackerObject(input, environment)
    if (
        object.provider === "linear" &&
        object.resource === "task-issue" &&
        object.projectId !== parent?.trackerProjectId
    )
        throw new Error("Linear Task issue does not belong to the parent Epic Project")

    const reference = trackerReference(object)
    // The marker selects the plan Task. Issue processing verified that the issue is a
    // queued child of this Epic before it tagged the plan; adoption re-reads it.
    const plannedTask = parent ? plannedTaskFor(parent, trackerReferenceLabel(reference)!) : undefined
    const name = entityName(reference, slug)
    const relativeDirectory =
        input.entity === "task"
            ? path.join(parent!.directory, "tasks", name)
            : path.join(input.entity === "epic" ? EPIC_ROOT : GIG_ROOT, name)
    const absoluteDirectory = path.join(root, relativeDirectory)
    if (fs.existsSync(absoluteDirectory)) throw new Error(`entity directory already exists: ${relativeDirectory}`)
    const branch = branchFor(prepared, name, object)
    assertBranchAvailable(root, branch, start)
    const contract = readyBranch(
        branch,
        start,
        prepared.projectConfig.branches.format === "tracker" ? "tracker" : "generated",
    )
    const tracker = trackerRecordFromObject(
        object,
        environment.tracker.provider === "github" ? environment.tracker.repository : undefined,
    )

    let createdBranch: string | undefined
    try {
        createBranch(root, contract)
        createdBranch = contract.name
        const common = {
            slug,
            title: input.title.trim(),
            createdAt: (options.now ?? new Date()).toISOString(),
            phase: "planning" as const,
            branch: contract,
            tracker,
        }
        const status = Value.Parse(
            EntityStatusSchema,
            input.entity === "epic"
                ? { ...common, entity: "epic" }
                : { ...common, entity: input.entity, kind: input.entity === "task" ? plannedTask!.kind : input.kind },
        )
        createEntityArtifacts(absoluteDirectory, input, status)
        return {
            directory: relativeDirectory,
            status: readEntityStatus(absoluteDirectory),
            resourceIds: resourceIdsFromTrackerObject(object, environment, name),
        }
    } catch (error) {
        fs.rmSync(absoluteDirectory, { recursive: true, force: true })
        if (createdBranch) deleteCreatedBranch(root, createdBranch)
        throw error
    }
}

function trackerObject(input: EntityInitialization, environment: WorkflowEnvironment): TrackerObject {
    const provider = environment.tracker.provider
    if (provider === "github") {
        if (!Value.Check(GitHubTrackerObjectSchema, input.object))
            throw new Error("initialization requires a GitHub issue for the configured GitHub tracker")
        return { provider, ...input.object }
    }
    const resource = resourceFor(input.entity)
    const schema =
        resource === "project"
            ? LinearProjectObjectSchema
            : resource === "task-issue"
              ? LinearTaskIssueObjectSchema
              : LinearGigIssueObjectSchema
    if (!Value.Check(schema, input.object))
        throw new Error(`initialization requires a Linear ${resource} for the configured Linear tracker`)
    return { provider, resource, ...input.object } as TrackerObject
}

function resourceFor(entity: EntityType) {
    return entity === "epic"
        ? ("project" as const)
        : entity === "task"
          ? ("task-issue" as const)
          : ("gig-issue" as const)
}

function branchFor(prepared: Prepared, name: string, object: TrackerObject): string {
    const format = prepared.projectConfig.branches.format
    if (format !== "tracker") return formatBranchName(name, format, prepared.projectConfig.branches.username)
    // Linear names issue branches; a Project has none, so an Epic uses its dated name.
    if (object.provider === "linear" && object.resource === "project") return name
    if (object.provider !== "linear" || !object.gitBranchName)
        throw new Error("the tracker branch format requires the Linear issue's gitBranchName")
    return object.gitBranchName
}

function createEntityArtifacts(absoluteDirectory: string, input: EntityInitialization, status: EntityStatus): void {
    const directories =
        input.entity === "epic"
            ? [LOCAL_REVIEWS_DIR, LOCAL_SCRATCH_DIR, "tasks"]
            : [LOCAL_REVIEWS_DIR, LOCAL_SCRATCH_DIR, LOCAL_DESIGNS_DIR]
    fs.mkdirSync(path.dirname(absoluteDirectory), { recursive: true })
    fs.mkdirSync(absoluteDirectory, { recursive: false })
    for (const directory of directories) fs.mkdirSync(path.join(absoluteDirectory, directory))
    fs.writeFileSync(path.join(absoluteDirectory, "brief.md"), `# Brief\n\n${input.request.trim()}\n`)
    fs.writeFileSync(path.join(absoluteDirectory, LOCAL_NOTES_FILE), "# Notes\n")
    if (input.entity !== "epic") fs.writeFileSync(path.join(absoluteDirectory, LOCAL_PENDING_FILE), "# Pending\n")
    writeEntityStatus(absoluteDirectory, status)
}

function plannedTaskFor(parent: ParentEpic, marker: string): EpicTask {
    const task = parent.tasks.find((candidate) => candidate.marker === marker)
    if (!task)
        throw new Error(
            `parent Epic has no Task tagged ${marker}; finish the Epic's issue processing before starting it`,
        )
    if (task.canceled) throw new Error(`parent Epic Task ${marker} is canceled and can't be started`)
    return task
}

interface ParentEpic {
    label: string
    directory: string
    branch: string
    trackerProjectId?: string
    tasks: EpicTask[]
}

function readParentEpic(root: string, input: TaskInitialization): ParentEpic {
    const { parentEpicDir: rawDirectory } = input
    const epicsRoot = path.join(root, EPIC_ROOT)
    const directory = path.resolve(root, rawDirectory)
    if (!directory.startsWith(`${epicsRoot}${path.sep}`)) {
        throw new Error(`parent Epic directory must be inside ${EPIC_ROOT}`)
    }

    const status = readEntityStatus(directory)
    if (status.entity !== "epic") throw new Error(`parent directory is not an Epic: ${rawDirectory}`)
    const epicPath = path.join(directory, "epic.md")
    if (!fs.existsSync(epicPath)) throw new Error(`parent Epic has no accepted epic.md: ${rawDirectory}`)
    const tasks = readEpicTasks(epicPath)
    const routing = readEpicRouting(epicPath)
    if (routing.epicBranch !== status.branch.name)
        throw new Error(
            `epic.md says \`Epic branch: ${routing.epicBranch}\`, but the Epic's branch is ${status.branch.name}`,
        )
    // A default-target Task needs nothing from the Epic branch; an Epic-target Task starts from it.
    const taskBranch = routing.taskTarget === "epic" ? status.branch.name : status.branch.target
    if (routing.taskTarget === "epic" && !cloneBranchExists(root, taskBranch))
        throw new Error(`Epic-target Tasks start from the Epic branch ${taskBranch}; fetch or create it locally first`)
    if (status.tracker.provider === "linear" && status.tracker.resource !== "project")
        throw new Error("parent Epic must be bound to a Linear Project")
    const started = readEpicTaskDirectories(directory)
    const trackerProjectId =
        status.tracker.provider === "linear" && status.tracker.resource === "project"
            ? status.tracker.external.projectId
            : undefined

    return {
        label: entityLabel(status),
        directory: path.relative(root, directory),
        branch: taskBranch,
        ...(trackerProjectId ? { trackerProjectId } : {}),
        // A Task that already has a directory can't be started again.
        tasks: tasks.filter((task) => !task.marker || !started.has(task.marker)),
    }
}

export function resolveDefaultBranch(root: string): string {
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
    name: string
    start: string
    target: string
}

// Reads only the branch facts default-branch discovery needs, without strict
// validation; readEntityStatus owns that for the entity being operated on.
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
        name: path.basename(entityDirectory),
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
                throw new Error(`${facts.name} has inconsistent default-branch start and target`)
            }
            branches.add(facts.start)
        }
    }
    return [...branches]
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

function assertBranchAvailable(root: string, branch: string, start: string): void {
    assertCloneBranch(root, start)
    if (cloneBranchExists(root, branch)) throw new Error(`workflow branch already exists: ${branch}`)
    Git.run(root, ["check-ref-format", "--branch", branch])
}

function createBranch(root: string, contract: ReadyBranchContract): void {
    Git.run(root, ["branch", contract.name, contract.start])
}

function deleteCreatedBranch(root: string, branch: string): void {
    if (!Git.succeeds(root, ["show-ref", "--verify", `refs/heads/${branch}`])) return
    Git.tryRun(root, ["branch", "-D", branch])
}
