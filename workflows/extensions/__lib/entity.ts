import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, type TProperties, Type } from "typebox"
import { Value } from "typebox/value"

import {
    DeliverableKindSchema,
    ReadyBranchContractSchema,
    EPIC_ROOT,
    entityName,
    GIG_ROOT,
    type LifecycleState,
    PROJECT_ROOT,
    slugify,
    PhaseSchema,
    trackerReferenceLabel,
} from "./domain.js"
import { readEpicTasks } from "./epic-tasks.js"
import { writeTextAtomically } from "./files.js"
import {
    assertTrackerRecordInvariants,
    ForgeRecordSchema,
    trackerReference,
    TrackerRecordSchema,
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

// Entity directories live under the never-committed local root, so their files are flat:
// no inner .local/ directory.
export const ENTITY_METADATA_FILE = "metadata.json"
export const LOCAL_DRAFT_FILE = "draft.md"
export const LOCAL_NOTES_FILE = "notes.md"
export const LOCAL_PENDING_FILE = "pending.md"
export const LOCAL_REVIEWS_DIR = "reviews"
export const LOCAL_SCRATCH_DIR = "scratch"
export const LOCAL_DESIGNS_DIR = "designs"

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

// Lifecycle and Priority always live on the tracker; metadata never caches them.
const baseMetadataProperties = {
    slug: OneLineSchema,
    title: OneLineSchema,
    createdAt: OneLineSchema,
    phase: PhaseSchema,
    branch: ReadyBranchContractSchema,
    tracker: TrackerRecordSchema,
    forge: Type.Optional(ForgeRecordSchema),
}
// Routing lives in the published plan (`Task target:` and `Epic branch:` in epic.md).
const epicProperties = { entity: Type.Literal("epic") }
const gigProperties = { entity: Type.Literal("gig"), kind: DeliverableKindSchema }
const taskProperties = { entity: Type.Literal("task"), kind: DeliverableKindSchema }

function entitySchema<P extends TProperties>(properties: P) {
    return Type.Object({ ...baseMetadataProperties, ...properties }, { additionalProperties: false })
}

export const EntityStatusSchema = Type.Union([
    entitySchema(epicProperties),
    entitySchema(gigProperties),
    entitySchema(taskProperties),
])
export type EntityStatus = Static<typeof EntityStatusSchema>

// Display reference for messages: `#12`, `ENG-7`, or the slug for a Linear Project.
export function entityLabel(status: EntityStatus): string {
    return trackerReferenceLabel(trackerReference(status.tracker)) ?? status.slug
}

// The directory name every entity must have, derived from its tracker identity.
export function expectedEntityDirectoryName(status: EntityStatus): string {
    return entityName(trackerReference(status.tracker), status.slug)
}

// The Epic plan marker that relates a Task to its plan section.
export function taskMarker(status: EntityStatus): string {
    const label = trackerReferenceLabel(trackerReference(status.tracker))
    if (!label || status.entity !== "task") throw new Error("only a Task has a plan marker")
    return label
}

// A tagged Task's issue and, once started, its local Task directory.
const ProgressTaskSchema = Type.Object(
    {
        marker: OneLineSchema,
        directory: Type.Optional(OneLineSchema),
    },
    { additionalProperties: false },
)
const strict = { additionalProperties: false } as const
export const EpicTaskProgressSchema = Type.Object(
    {
        epic: OneLineSchema,
        items: Type.Array(
            Type.Union([
                // Issue processing hasn't created or linked this Task's issue yet.
                Type.Object({ state: Type.Literal("unpublished"), title: OneLineSchema }, strict),
                Type.Object(
                    {
                        state: Type.Literal("queued"),
                        title: OneLineSchema,
                        lifecycle: Type.Union([Type.Literal("backlog"), Type.Literal("todo")]),
                        task: ProgressTaskSchema,
                    },
                    strict,
                ),
                Type.Object(
                    {
                        state: Type.Literal("initialized"),
                        title: OneLineSchema,
                        lifecycle: Type.Union([Type.Literal("inProgress"), Type.Literal("inReview")]),
                        task: ProgressTaskSchema,
                    },
                    strict,
                ),
                Type.Object(
                    { state: Type.Literal("complete"), title: OneLineSchema, task: ProgressTaskSchema },
                    strict,
                ),
                Type.Object(
                    { state: Type.Literal("canceled"), title: OneLineSchema, task: ProgressTaskSchema },
                    strict,
                ),
            ]),
        ),
    },
    { additionalProperties: false },
)
export type EpicTaskProgress = Static<typeof EpicTaskProgressSchema>

export function readEntityStatus(entityDirectory: string): EntityStatus {
    const metadataPath = path.join(entityDirectory, ENTITY_METADATA_FILE)
    const metadata = readJson(metadataPath, "entity metadata")
    if (!Value.Check(EntityStatusSchema, metadata)) {
        const details = [...Value.Errors(EntityStatusSchema, metadata)]
            .map((error) => `${error.instancePath || "/"}: ${error.message}`)
            .join("; ")
        throw new Error(`invalid entity metadata in ${metadataPath}: ${details}`)
    }
    assertEntityStatusInvariants(metadata, entityDirectory)
    return metadata
}

function assertEntityStatusInvariants(status: EntityStatus, entityDirectory: string): void {
    const fail = (message: string): never => {
        throw new Error(`invalid entity metadata in ${path.join(entityDirectory, ENTITY_METADATA_FILE)}: ${message}`)
    }
    if (slugify(status.slug) !== status.slug) fail("slug is not normalized")
    if (path.basename(entityDirectory) !== expectedEntityDirectoryName(status))
        fail("directory name does not match the tracker identity and slug")
    assertTrackerRecordInvariants(status.entity, status.tracker, fail)
    if (status.forge && (status.forge.head !== status.branch.name || status.forge.target !== status.branch.target))
        fail("forge association must match the branch contract")

    const expectedBase =
        status.entity === "task"
            ? (() => {
                  const tasksDirectory = path.dirname(path.resolve(entityDirectory))
                  const actualParentDirectory = path.dirname(tasksDirectory)
                  const epicsDirectory = path.dirname(actualParentDirectory)
                  if (
                      path.basename(tasksDirectory) !== "tasks" ||
                      !epicsDirectory.endsWith(`${path.sep}${path.join(...EPIC_ROOT.split("/"))}`)
                  ) {
                      fail(`Task is not contained under ${EPIC_ROOT}/<epic>/tasks`)
                  }
                  const parent = readEntityStatus(actualParentDirectory)
                  if (status.entity !== "task") return fail("Task status lost its entity discriminator")
                  if (parent.entity !== "epic") fail("Task container is not an Epic")
                  assertTaskTrackerParent(status, parent, fail)
                  if (status.branch.start !== parent.branch.name && status.branch.start !== parent.branch.target) {
                      fail("Task base is neither the containing Epic branch nor its default target")
                  }
                  if (status.branch.start !== status.branch.target) {
                      fail("Task start and target must use the same containing-Epic base")
                  }
                  // The tracker owns the Task's relationship; the local plan copy may lag.
                  return status.branch.start
              })()
            : status.branch.start

    if (status.branch.start !== expectedBase || status.branch.target !== expectedBase) {
        fail("branch start/target do not match the entity branch contract")
    }
}

function assertTaskTrackerParent(task: EntityStatus, parent: EntityStatus, fail: (message: string) => never): void {
    if (task.tracker.provider !== parent.tracker.provider) fail("Task and parent Epic use different trackers")
    if (
        task.tracker.provider === "linear" &&
        task.tracker.resource === "task-issue" &&
        parent.tracker.provider === "linear" &&
        parent.tracker.resource === "project" &&
        task.tracker.external.projectId !== parent.tracker.external.projectId
    )
        fail("Linear Task Project does not match its parent Epic Project")
}

// Progress for every planned Task, from the plan and fresh tracker lifecycle for every
// tagged marker. A local Task directory is optional detail: a Task may have started in
// another clone.
export function readEpicTaskProgress(
    epicDirectory: string,
    trackerLifecycle: Readonly<Record<string, LifecycleState>> = {},
): EpicTaskProgress {
    const epic = readEntityStatus(epicDirectory)
    if (epic.entity !== "epic") throw new Error(`Task progress requires an Epic directory: ${epicDirectory}`)
    const epicPath = path.join(epicDirectory, "epic.md")
    if (!fs.existsSync(epicPath)) throw new Error(`Epic has no accepted epic.md: ${epicDirectory}`)
    const planTasks = readEpicTasks(epicPath)
    const directories = readEpicTaskDirectories(epicDirectory)

    const progress: EpicTaskProgress = {
        epic: entityLabel(epic),
        items: planTasks.map((planTask) => {
            if (!planTask.marker) return { state: "unpublished" as const, title: planTask.title }
            const lifecycle =
                trackerLifecycle[planTask.marker] ??
                (() => {
                    throw new Error(`tracker lifecycle is required for ${planTask.marker}`)
                })()
            const directory = directories.get(planTask.marker)
            const task = { marker: planTask.marker, ...(directory ? { directory } : {}) }
            const title = planTask.title
            switch (lifecycle) {
                case "backlog":
                case "todo":
                    if (directory) throw new Error(`${planTask.marker} has a Task directory but is still queued`)
                    return { state: "queued" as const, title, lifecycle, task }
                case "inProgress":
                case "inReview":
                    return { state: "initialized" as const, title, lifecycle, task }
                case "done":
                    return { state: "complete" as const, title, task }
                case "canceled":
                    return { state: "canceled" as const, title, task }
            }
        }),
    }
    if (!Value.Check(EpicTaskProgressSchema, progress)) {
        throw new Error(`generated invalid Task progress for ${epicDirectory}`)
    }
    return progress
}

// The repo-relative directory of every started Task, keyed by its marker.
export function readEpicTaskDirectories(epicDirectory: string): Map<string, string> {
    const tasks = new Map<string, string>()
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
        const marker = taskMarker(task)
        if (tasks.has(marker)) throw new Error(`multiple Task directories use ${marker}`)
        tasks.set(marker, path.join(EPIC_ROOT, path.basename(epicDirectory), "tasks", entry.name))
    }
    return tasks
}

export function writeEntityStatus(entityDirectory: string, status: EntityStatus): void {
    if (!Value.Check(EntityStatusSchema, status))
        throw new Error(`cannot write invalid entity metadata: ${entityDirectory}`)
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
