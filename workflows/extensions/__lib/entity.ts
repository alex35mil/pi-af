import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, type TProperties, Type } from "typebox"
import { Value } from "typebox/value"

import {
    DeliverableKindSchema,
    ReadyBranchContractSchema,
    EPIC_ROOT,
    GIG_ROOT,
    type InitializedLifecycleState,
    InitializedLifecycleStateSchema,
    PrioritySchema,
    PROJECT_ROOT,
    qualifyId,
    RawIdSchema,
    type ReadyBranchContract,
    slugify,
    WorkStageSchema,
} from "./domain.js"
import { writeTextAtomically } from "./files.js"
import {
    assertIntegrationInvariants,
    assertTaskIntegrationParent,
    IntegrationRecordSchema,
    ProvisioningBranchContractSchema,
    TrackerNamedBranchContractSchema,
    TrackerPendingBranchContractSchema,
    TrackerProviderSchema,
} from "../integrations/records.js"

const OneLineSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })

export function resolveEntityPath(root: string, cwd: string, raw: string): string {
    const resolved = path.isAbsolute(raw)
        ? path.resolve(raw)
        : raw === PROJECT_ROOT || raw.startsWith(`${PROJECT_ROOT}${path.sep}`)
          ? path.resolve(root, raw)
          : path.resolve(cwd, raw)
    const allowedRoots = [path.join(root, EPIC_ROOT), path.join(root, GIG_ROOT)]
    if (!allowedRoots.some((allowed) => resolved.startsWith(`${allowed}${path.sep}`))) {
        throw new Error(`entity directory must be inside ${EPIC_ROOT} or ${GIG_ROOT}`)
    }
    return resolved
}

export function resolveEntityDirectory(root: string, cwd: string, raw: string): string {
    const resolved = resolveEntityPath(root, cwd, raw)
    if (!fs.existsSync(resolved)) throw new Error(`entity directory does not exist: ${path.relative(root, resolved)}`)
    return resolved
}

export const ENTITY_METADATA_FILE = "metadata.json"
export const ENTITY_LOCAL_DIR = ".local"
export const LOCAL_STATUS_FILE = path.join(ENTITY_LOCAL_DIR, "status.md")
export const LOCAL_DRAFT_FILE = path.join(ENTITY_LOCAL_DIR, "draft.md")
export const LOCAL_NOTES_FILE = path.join(ENTITY_LOCAL_DIR, "notes.md")
export const LOCAL_PENDING_FILE = path.join(ENTITY_LOCAL_DIR, "pending.md")
export const LOCAL_REVIEWS_DIR = path.join(ENTITY_LOCAL_DIR, "reviews")
export const LOCAL_SCRATCH_DIR = path.join(ENTITY_LOCAL_DIR, "scratch")
export const LOCAL_DESIGNS_DIR = path.join(ENTITY_LOCAL_DIR, "designs")

export interface PendingEntry {
    line: number
    text: string
}

export function readPendingEntries(entityDirectory: string): PendingEntry[] {
    const pendingPath = path.join(entityDirectory, LOCAL_PENDING_FILE)
    if (!fs.existsSync(pendingPath)) return []
    return fs
        .readFileSync(pendingPath, "utf-8")
        .split(/\r?\n/)
        .flatMap((line, index) =>
            /^\s*(?:[-*+]|\d+[.)])\s+\[\s\](?:\s+.*)?$/.test(line) ? [{ line: index + 1, text: line.trim() }] : [],
        )
}

export const BranchContractSchema = Type.Union([
    ReadyBranchContractSchema,
    TrackerPendingBranchContractSchema,
    TrackerNamedBranchContractSchema,
    ProvisioningBranchContractSchema,
])
export type BranchContract = Static<typeof BranchContractSchema>

const WorkflowAuthoritySchema = Type.Object(
    { kind: Type.Literal("workflow"), priority: PrioritySchema },
    { additionalProperties: false },
)
const TrackerAuthoritySchema = Type.Union([
    Type.Object({ kind: Type.Literal("tracker"), provider: TrackerProviderSchema }, { additionalProperties: false }),
    Type.Object(
        {
            kind: Type.Literal("tracker"),
            provider: TrackerProviderSchema,
            desired: Type.Object(
                { lifecycle: InitializedLifecycleStateSchema, priority: PrioritySchema },
                { additionalProperties: false },
            ),
        },
        { additionalProperties: false },
    ),
])
export type WorkflowAuthority = Static<typeof WorkflowAuthoritySchema>
export type TrackerAuthority = Static<typeof TrackerAuthoritySchema>

const baseMetadataProperties = {
    id: OneLineSchema,
    rawId: RawIdSchema,
    slug: OneLineSchema,
    title: OneLineSchema,
    createdAt: OneLineSchema,
    workStage: WorkStageSchema,
    branch: BranchContractSchema,
    integrations: Type.Array(IntegrationRecordSchema),
}
const epicProperties = {
    entity: Type.Literal("epic"),
    taskTarget: Type.Union([Type.Literal("epic"), Type.Literal("default")]),
}
const gigProperties = { entity: Type.Literal("gig"), kind: DeliverableKindSchema }
const taskProperties = { entity: Type.Literal("task"), kind: DeliverableKindSchema }

function entitySchemas<P extends TProperties>(properties: P) {
    const common = { ...baseMetadataProperties, ...properties }
    const workflow = Type.Object({ ...common, authority: WorkflowAuthoritySchema }, { additionalProperties: false })
    const tracker = Type.Object({ ...common, authority: TrackerAuthoritySchema }, { additionalProperties: false })
    return {
        metadata: [workflow, tracker] as const,
        status: [
            Type.Object(
                { ...workflow.properties, state: InitializedLifecycleStateSchema },
                { additionalProperties: false },
            ),
            tracker,
        ] as const,
    }
}

const epicSchemas = entitySchemas(epicProperties)
const gigSchemas = entitySchemas(gigProperties)
const taskSchemas = entitySchemas(taskProperties)
export const EntityMetadataSchema = Type.Union([
    ...epicSchemas.metadata,
    ...gigSchemas.metadata,
    ...taskSchemas.metadata,
])
export type EntityMetadata = Static<typeof EntityMetadataSchema>

export const EntityStatusSchema = Type.Union([...epicSchemas.status, ...gigSchemas.status, ...taskSchemas.status])
export type EntityStatus = Static<typeof EntityStatusSchema>

const LocalStatusSchema = Type.Object({ state: InitializedLifecycleStateSchema }, { additionalProperties: false })

const ActiveTaskLifecycleSchema = Type.Union([Type.Literal("inProgress"), Type.Literal("inReview")])
const ProgressTaskSchema = Type.Object(
    {
        id: OneLineSchema,
        directory: OneLineSchema,
    },
    { additionalProperties: false },
)
export const EpicTaskProgressSchema = Type.Object(
    {
        epicId: OneLineSchema,
        items: Type.Array(
            Type.Union([
                Type.Object(
                    { state: Type.Literal("prospective"), display: OneLineSchema },
                    { additionalProperties: false },
                ),
                Type.Object(
                    {
                        state: Type.Literal("initialized"),
                        display: OneLineSchema,
                        lifecycle: ActiveTaskLifecycleSchema,
                        task: ProgressTaskSchema,
                    },
                    { additionalProperties: false },
                ),
                Type.Object(
                    { state: Type.Literal("complete"), display: OneLineSchema, task: ProgressTaskSchema },
                    { additionalProperties: false },
                ),
                Type.Object(
                    { state: Type.Literal("canceled"), display: OneLineSchema, task: ProgressTaskSchema },
                    { additionalProperties: false },
                ),
            ]),
        ),
    },
    { additionalProperties: false },
)
export type EpicTaskProgress = Static<typeof EpicTaskProgressSchema>

export function readEntityStatus(entityDirectory: string): EntityStatus {
    const metadataPath = path.join(entityDirectory, ENTITY_METADATA_FILE)
    const statusPath = path.join(entityDirectory, LOCAL_STATUS_FILE)
    const metadata = readJson(metadataPath, "entity metadata")
    if (!Value.Check(EntityMetadataSchema, metadata)) {
        const details = [...Value.Errors(EntityMetadataSchema, metadata)]
            .map((error) => `${error.instancePath || "/"}: ${error.message}`)
            .join("; ")
        throw new Error(
            `invalid entity metadata in ${metadataPath}: ${details}; see workflows/MIGRATIONS.md to convert this entity to the current format`,
        )
    }

    let value: unknown = metadata
    if (metadata.authority.kind === "workflow") {
        if (!fs.existsSync(statusPath)) throw new Error(`missing authoritative local status: ${statusPath}`)
        const markdown = fs.readFileSync(statusPath, "utf-8")
        const match = /^```json\s*\n([\s\S]*?)\n```/m.exec(markdown)
        if (!match) throw new Error(`missing JSON status block: ${statusPath}`)
        let localStatus: unknown
        try {
            localStatus = JSON.parse(match[1])
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`invalid JSON status block in ${statusPath}: ${message}`)
        }
        if (!Value.Check(LocalStatusSchema, localStatus)) {
            const details = [...Value.Errors(LocalStatusSchema, localStatus)]
                .map((error) => `${error.instancePath || "/"}: ${error.message}`)
                .join("; ")
            throw new Error(`invalid local status in ${statusPath}: ${details}`)
        }
        value = { ...metadata, ...localStatus }
    } else if (fs.existsSync(statusPath)) {
        throw new Error(`tracker-backed entity must not have local lifecycle state: ${statusPath}`)
    }

    if (!Value.Check(EntityStatusSchema, value)) throw new Error(`invalid combined entity status: ${entityDirectory}`)
    assertEntityStatusInvariants(value, entityDirectory)
    return value
}

function assertEntityStatusInvariants(status: EntityStatus, entityDirectory: string): void {
    const fail = (message: string): never => {
        throw new Error(`invalid entity metadata in ${path.join(entityDirectory, ENTITY_METADATA_FILE)}: ${message}`)
    }
    if (status.id !== qualifyId(status.entity, status.rawId)) fail("qualified ID does not match entity and rawId")
    if (slugify(status.slug) !== status.slug) fail("slug is not normalized")
    if ("state" in status) {
        if (status.workStage === "planning" && status.state !== "inProgress" && status.state !== "canceled") {
            fail("planning work stage requires In Progress or Canceled lifecycle")
        }
        if (status.state !== "inProgress" && status.state !== "canceled" && status.workStage !== "execution") {
            fail("In Review and Done lifecycle require execution work stage")
        }
    }

    const expectedDirectorySuffix = `.${status.id}.${status.slug}`
    if (!path.basename(entityDirectory).endsWith(expectedDirectorySuffix)) {
        fail("directory name does not match entity metadata")
    }
    assertIntegrationInvariants(status, fail)

    const expectedBase =
        status.entity === "task"
            ? (() => {
                  const tasksDirectory = path.dirname(path.resolve(entityDirectory))
                  const actualParentDirectory = path.dirname(tasksDirectory)
                  if (
                      path.basename(tasksDirectory) !== "tasks" ||
                      path.basename(path.dirname(actualParentDirectory)) !== "epics" ||
                      path.basename(path.dirname(path.dirname(actualParentDirectory))) !== PROJECT_ROOT
                  ) {
                      fail(`Task is not contained under ${EPIC_ROOT}/<epic>/tasks`)
                  }
                  const actualParent = readEntityStatus(actualParentDirectory)
                  if (status.entity !== "task") return fail("Task status lost its entity discriminator")
                  if (actualParent.entity !== "epic") fail("Task container is not an Epic")
                  assertTaskIntegrationParent(status, actualParent, fail)
                  const actualParentBranch = actualParent.branch
                  if (actualParentBranch.state !== "ready") return fail("Task parent Epic branch is not ready")
                  if (
                      status.branch.start !== actualParentBranch.name &&
                      status.branch.start !== actualParentBranch.target
                  ) {
                      fail("Task base is neither the containing Epic branch nor its default target")
                  }
                  if (status.branch.start !== status.branch.target) {
                      fail("Task start and target must use the same containing-Epic base")
                  }
                  const parentEpicPath = path.join(actualParentDirectory, "epic.md")
                  if (!fs.existsSync(parentEpicPath)) fail("Task parent has no accepted epic.md")
                  const matchingMarkers = readOrderedTaskEntries(parentEpicPath).filter(
                      (entry) => entry.state === "initialized" && entry.taskId === status.id,
                  )
                  if (matchingMarkers.length !== 1) {
                      fail(`Task parent epic.md must contain exactly one marker for ${status.id}`)
                  }
                  return status.branch.start
              })()
            : status.branch.start

    if (status.branch.start !== expectedBase || status.branch.target !== expectedBase) {
        fail("branch start/target do not match the entity branch contract")
    }
}

export function readEpicTaskProgress(
    epicDirectory: string,
    trackerLifecycle: Readonly<Record<string, InitializedLifecycleState>> = {},
): EpicTaskProgress {
    const epic = readEntityStatus(epicDirectory)
    if (epic.entity !== "epic") throw new Error(`Task progress requires an Epic directory: ${epicDirectory}`)
    const epicPath = path.join(epicDirectory, "epic.md")
    if (!fs.existsSync(epicPath)) throw new Error(`Epic has no accepted epic.md: ${epicDirectory}`)
    const planItems = readOrderedTaskEntries(epicPath)
    const tasks = new Map<string, { directory: string; lifecycle: InitializedLifecycleState }>()
    const tasksDirectory = path.join(epicDirectory, "tasks")
    const entries = fs.existsSync(tasksDirectory)
        ? fs
              .readdirSync(tasksDirectory, { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .sort((left, right) => left.name.localeCompare(right.name))
        : []
    for (const entry of entries) {
        const taskDirectory = path.join(tasksDirectory, entry.name)
        const task = readEntityStatus(taskDirectory)
        if (task.entity !== "task") throw new Error(`non-Task directory under Epic tasks: ${taskDirectory}`)
        if (tasks.has(task.id)) throw new Error(`multiple Task directories use ID ${task.id}`)
        const lifecycle =
            "state" in task
                ? task.state
                : (trackerLifecycle[task.id] ??
                  (() => {
                      throw new Error(`tracker lifecycle is required for ${task.id}`)
                  })())
        tasks.set(task.id, {
            directory: path.join(EPIC_ROOT, path.basename(epicDirectory), "tasks", entry.name),
            lifecycle,
        })
    }

    const referencedTaskIds = new Set<string>()
    const progress: EpicTaskProgress = {
        epicId: epic.id,
        items: planItems.map((planItem) => {
            if (planItem.state === "prospective") {
                return { state: "prospective" as const, display: planItem.display }
            }
            referencedTaskIds.add(planItem.taskId)
            const task = tasks.get(planItem.taskId)
            if (!task) throw new Error(`Epic plan item references missing Task ${planItem.taskId}`)
            const taskReference = { id: planItem.taskId, directory: task.directory }
            if (task.lifecycle === "done") {
                return { state: "complete" as const, display: planItem.display, task: taskReference }
            }
            if (task.lifecycle === "canceled") {
                return { state: "canceled" as const, display: planItem.display, task: taskReference }
            }
            return {
                state: "initialized" as const,
                display: planItem.display,
                lifecycle: task.lifecycle,
                task: taskReference,
            }
        }),
    }
    for (const taskId of tasks.keys()) {
        if (!referencedTaskIds.has(taskId)) throw new Error(`${taskId} is not referenced by an Epic plan item`)
    }
    if (!Value.Check(EpicTaskProgressSchema, progress)) {
        throw new Error(`generated invalid Task progress for ${epic.id}`)
    }
    return progress
}

export type OrderedTaskEntry =
    | { state: "prospective"; line: string; display: string }
    | { state: "initialized"; line: string; display: string; taskId: string }

export function readOrderedTaskEntries(epicPath: string): OrderedTaskEntry[] {
    const planLines = fs.readFileSync(epicPath, "utf-8").split(/\r?\n/)
    let inOrderedTasks = false
    const entries: OrderedTaskEntry[] = []
    for (const candidate of planLines) {
        const line = candidate.trim()
        if (/^##\s+/.test(line)) {
            inOrderedTasks = line === "## Ordered Tasks"
            continue
        }
        if (!inOrderedTasks) continue
        const ordered = /^\d+\.\s+(\S.*)$/.exec(line)
        if (!ordered) continue
        const marker = /^\[(TASK-[0-7][0-9A-HJKMNP-TV-Z]{9})\]\s+(\S.*)$/.exec(ordered[1])
        if (ordered[1].startsWith("[TASK-") && !marker) {
            throw new Error(`Epic contains an invalid Task ID marker: ${JSON.stringify(line)}`)
        }
        entries.push(
            marker
                ? { state: "initialized", line, taskId: marker[1], display: marker[2] }
                : { state: "prospective", line, display: ordered[1] },
        )
    }
    const taskIds = entries.flatMap((entry) => (entry.state === "initialized" ? [entry.taskId] : []))
    if (new Set(taskIds).size !== taskIds.length)
        throw new Error(`Epic contains duplicate Task ID markers: ${epicPath}`)
    return entries
}

export function assertEntityBranchReady(status: EntityStatus): asserts status is EntityStatus & {
    branch: ReadyBranchContract
} {
    if (status.branch.state !== "ready") {
        throw new Error(
            `${status.id} branch is ${status.branch.state}; finish tracker binding and branch provisioning first`,
        )
    }
}

export function writeEntityStatus(entityDirectory: string, status: EntityStatus): void {
    if (!Value.Check(EntityStatusSchema, status))
        throw new Error(`cannot write invalid entity status: ${entityDirectory}`)
    const statusPath = path.join(entityDirectory, LOCAL_STATUS_FILE)
    if (status.authority.kind === "workflow") {
        if (!("state" in status))
            throw new Error(`workflow-authority entity has no lifecycle state: ${entityDirectory}`)
        const { state, ...metadata } = status
        if (!Value.Check(EntityMetadataSchema, metadata)) {
            throw new Error(`cannot write invalid entity metadata: ${entityDirectory}`)
        }
        writeTextAtomically(path.join(entityDirectory, ENTITY_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`)
        writeTextAtomically(statusPath, `# Status\n\n\`\`\`json\n${JSON.stringify({ state }, null, 2)}\n\`\`\`\n`)
        return
    }
    if (fs.existsSync(statusPath)) {
        throw new Error(`tracker-backed entity must not have local lifecycle state: ${statusPath}`)
    }
    if (!Value.Check(EntityMetadataSchema, status)) {
        throw new Error(`cannot write invalid entity metadata: ${entityDirectory}`)
    }
    writeTextAtomically(path.join(entityDirectory, ENTITY_METADATA_FILE), `${JSON.stringify(status, null, 2)}\n`)
}

function readJson(filePath: string, label: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`invalid ${label} in ${filePath}: ${message}`)
    }
}
