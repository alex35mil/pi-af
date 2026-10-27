import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, Type } from "typebox"

import { getMcpToolName, isMcpTool, mcpResponsePayload, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import { type LifecycleState, PRIORITY_NOT_SET } from "../__lib/domain.js"
import {
    readEntityStatus,
    readEpicTaskDirectories,
    resolveEntityDirectory,
    type EntityStatus,
} from "../__lib/entity.js"
import { type EpicTask, readEpicTasks, tagEpicTask } from "../__lib/epic-tasks.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { assertConfiguredPriority, loadIntegrationConfig, type TrackerConfig } from "./config.js"
import { assertEntityEnvironment, resolveWorkflowEnvironment } from "./policy.js"
import { linearPriorityNumber } from "./records.js"
import { EvidenceSchema } from "./resource-id-tool.js"

const OneLineSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })

// Fresh native facts for one child issue of the Epic: a GitHub sub-issue with its
// configured Project item fields, or a Linear issue in the Epic's Project.
export const EpicChildIssueSchema = Type.Object(
    {
        marker: Type.String({ description: "`#N` on GitHub, `ENG-N` on Linear" }),
        title: OneLineSchema,
        onBoard: Type.Boolean({
            description: "GitHub: the issue has an item in the configured Project. Linear: always true.",
        }),
        closed: Type.Boolean({ description: "GitHub: the issue state is closed. Linear: always false." }),
        // Omit only an observed empty leaf.
        status: Type.Optional(
            Type.String({
                minLength: 1,
                pattern: "^[^\\r\\n]+$",
                description: "Native Status name; omit when empty or off the board",
            }),
        ),
        priority: Type.Optional(
            Type.String({
                minLength: 1,
                pattern: "^[^\\r\\n]+$",
                description: "Native Priority name; omit when empty",
            }),
        ),
    },
    { additionalProperties: false },
)
export type EpicChildIssue = Static<typeof EpicChildIssueSchema>

export const PlanEpicTaskIssuesSchema = Type.Object(
    {
        entityDir: Type.String({ minLength: 1 }),
        epicPriority: Type.String({
            minLength: 1,
            description: "The Epic's native Priority, read fresh, or `not set`",
        }),
        children: Type.Array(EpicChildIssueSchema, {
            description:
                "Every child issue of the Epic, read fresh with complete pagination: GitHub sub-issues with their configured Project Status and Priority, or Linear issues in the Epic's Project",
        }),
    },
    { additionalProperties: false },
)
export type PlanEpicTaskIssuesInput = Static<typeof PlanEpicTaskIssuesSchema>

export const RecordEpicTaskIssueSchema = Type.Object(
    {
        entityDir: Type.String({ minLength: 1 }),
        title: OneLineSchema,
        marker: Type.String({ minLength: 1 }),
        // The clear-success create call; omitted when tagging a matched existing child.
        evidence: Type.Optional(EvidenceSchema),
    },
    { additionalProperties: false },
)
export type RecordEpicTaskIssueInput = Static<typeof RecordEpicTaskIssueSchema>

type Mutation = { tool: string; arguments: Record<string, unknown> }
export type EpicTaskIssueStep =
    | { title: string; effect: "create"; mutation: Mutation }
    | { title: string; marker: string; effect: "tag" }
    | {
          title: string
          marker: string
          effect: "addToProject" | "setStatus" | "setPriority" | "cancel" | "close"
          mutation: Mutation
      }
export type EpicTaskIssuePlan =
    | { state: "complete" }
    | { state: "steps-needed"; steps: EpicTaskIssueStep[] }
    | { state: "blocked"; steps: EpicTaskIssueStep[]; task: string; reason: string }

interface Context {
    root: string
    directory: string
    status: EntityStatus
    tracker: TrackerConfig
    tools: McpToolCatalog
}

function context(cwd: string, entityDir: string, tools: McpToolCatalog): Context {
    const root = project.resolveRootDir(cwd)
    assertArtifactPersistencePrepared(root)
    const environment = resolveWorkflowEnvironment(loadIntegrationConfig(root))
    const directory = resolveEntityDirectory(root, cwd, entityDir)
    const status = readEntityStatus(directory)
    if (status.entity !== "epic") throw new Error("Task issue processing requires an Epic")
    assertEntityEnvironment(status, environment)
    if (!fs.existsSync(path.join(directory, "epic.md"))) throw new Error("Epic has no accepted epic.md")
    return { root, directory, status, tracker: environment.tracker, tools }
}

// Reconciles the whole accepted plan against fresh tracker facts. It keeps no saved
// progress, so a first run and every retry apply the same rules to each Task in order.
export function planEpicTaskIssues(
    cwd: string,
    input: PlanEpicTaskIssuesInput,
    tools: McpToolCatalog,
): EpicTaskIssuePlan {
    const ctx = context(cwd, input.entityDir, tools)
    assertConfiguredPriority(ctx.tracker, input.epicPriority)
    const tasks = readEpicTasks(path.join(ctx.directory, "epic.md"))
    const started = readEpicTaskDirectories(ctx.directory)
    const children = new Map<string, EpicChildIssue>()
    for (const child of input.children) {
        if (children.has(child.marker)) throw new Error(`children list repeats ${child.marker}`)
        children.set(child.marker, child)
    }
    const planned = new Set(tasks.flatMap((task) => (task.marker ? [task.marker] : [])))
    const native = nativeCalls(ctx, input.epicPriority)

    const steps: EpicTaskIssueStep[] = []
    for (const task of tasks) {
        try {
            steps.push(...reconcileTask(task, { children, planned, started, native, lifecycle: lifecycleOf(ctx) }))
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            return { state: "blocked", steps, task: task.title, reason }
        }
    }
    return steps.length ? { state: "steps-needed", steps } : { state: "complete" }
}

interface Reconciliation {
    children: Map<string, EpicChildIssue>
    planned: Set<string>
    started: Map<string, string>
    native: NativeCalls
    lifecycle: (status: string | undefined) => LifecycleState | undefined
}

function reconcileTask(task: EpicTask, r: Reconciliation): EpicTaskIssueStep[] {
    if (!task.marker) {
        // A child whose marker the plan already carries belongs to another Task.
        const matches = [...r.children.values()].filter(
            (child) => !r.planned.has(child.marker) && child.title === task.title,
        )
        if (matches.length > 1)
            throw new Error(`several child issues match this title: ${matches.map((m) => m.marker).join(", ")}`)
        if (matches.length === 0) return [{ title: task.title, effect: "create", mutation: r.native.create(task) }]
        // Check the match before tagging, so a started issue is never linked.
        const marker = matches[0].marker
        const repairs = queuedChild(task.title, marker, r)
        r.planned.add(marker)
        return [{ title: task.title, marker, effect: "tag" }, ...repairs]
    }
    const marker = task.marker
    if (task.canceled) {
        const child = requireChild(marker, r)
        const lifecycle = r.lifecycle(child.status)
        if (lifecycle === "canceled") return r.native.closeIfOpen(task.title, child)
        if (lifecycle !== "backlog" && lifecycle !== "todo")
            throw new Error(`${marker} is ${child.status ?? "off the board"}; only a queued Task can be canceled`)
        return r.native.cancel(task.title, marker)
    }
    const child = requireChild(marker, r)
    // The tracker decides whether a Task has started; it may have started in another clone.
    const lifecycle = r.lifecycle(child.status)
    if (lifecycle === "inProgress" || lifecycle === "inReview" || lifecycle === "done") return []
    if (r.started.has(marker))
        throw new Error(`${marker} has a local Task directory but its issue is ${child.status ?? "off the board"}`)
    return queuedChild(task.title, marker, r)
}

// A tagged Task that hasn't started: a child of this Epic, with its board setup
// completed, still queued or already canceled.
function queuedChild(title: string, marker: string, r: Reconciliation): EpicTaskIssueStep[] {
    const child = requireChild(marker, r)
    const lifecycle = r.lifecycle(child.status)
    // Canceled on the tracker is a terminal outcome; never pull it back into Todo.
    if (lifecycle === "canceled") return []
    if (lifecycle !== undefined && lifecycle !== "backlog" && lifecycle !== "todo")
        throw new Error(`${marker} is ${child.status} and can't be linked as a queued Task`)
    return r.native.repairBoard(title, child)
}

function requireChild(marker: string, r: Reconciliation): EpicChildIssue {
    const child = r.children.get(marker)
    if (!child) throw new Error(`${marker} is not a child issue of this Epic`)
    return child
}

function lifecycleOf(ctx: Context) {
    const values = ctx.tracker.provider === "github" ? ctx.tracker.fields.status.values : ctx.tracker.statuses.issues
    return (status: string | undefined): LifecycleState | undefined => {
        if (status === undefined) return undefined
        const match = Object.entries(values).find(([, name]) => name === status)
        if (!match) throw new Error(`Status ${JSON.stringify(status)} is not a configured lifecycle value`)
        return match[0] as LifecycleState
    }
}

interface NativeCalls {
    create(task: EpicTask): Mutation
    repairBoard(title: string, child: EpicChildIssue): EpicTaskIssueStep[]
    cancel(title: string, marker: string): EpicTaskIssueStep[]
    closeIfOpen(title: string, child: EpicChildIssue): EpicTaskIssueStep[]
}

function nativeCalls(ctx: Context, epicPriority: string): NativeCalls {
    const tracker = ctx.tracker
    const call = (operation: string, args: Record<string, unknown>): Mutation => ({
        tool: getMcpToolName(tracker.mcpServer, operation, ctx.tools),
        arguments: args,
    })
    if (tracker.provider === "github") {
        if (ctx.status.tracker.provider !== "github") throw new Error("Epic is not bound to a GitHub issue")
        const epicNumber = ctx.status.tracker.external.issueNumber
        const repository = tracker.repository
        const board = {
            owner: tracker.project.owner,
            owner_type: tracker.project.ownerType,
            project_number: tracker.project.number,
        }
        const issueNumber = (marker: string) => Number(marker.slice(1))
        const item = (marker: string) => ({
            ...board,
            item_owner: repository.owner,
            item_repo: repository.repo,
            issue_number: issueNumber(marker),
        })
        const setField = (marker: string, name: string, value: string) =>
            call("projects_write", { method: "update_project_item", ...item(marker), updated_field: { name, value } })
        const priority = tracker.fields.priority
        const setPriority = (marker: string): Mutation =>
            priority.scope === "project"
                ? setField(marker, priority.field, epicPriority)
                : call("issue_write", {
                      method: "update",
                      ...repository,
                      issue_number: issueNumber(marker),
                      issue_fields: [{ field_name: priority.field, field_option_name: epicPriority }],
                  })
        const close = (title: string, marker: string): EpicTaskIssueStep => ({
            title,
            marker,
            effect: "close",
            mutation: call("issue_write", {
                method: "update",
                ...repository,
                issue_number: issueNumber(marker),
                state: "closed",
                state_reason: "not_planned",
            }),
        })
        const kindLabel = (task: EpicTask) => tracker.labels?.kind.deliverableKinds[task.kind]
        return {
            create: (task) => {
                const label = kindLabel(task)
                return call("issue_write", {
                    method: "create",
                    ...repository,
                    title: task.title,
                    body: task.description,
                    ...(label ? { labels: [label] } : {}),
                    parent_issue_number: epicNumber,
                })
            },
            repairBoard(title, child) {
                const steps: EpicTaskIssueStep[] = []
                const marker = child.marker
                if (!child.onBoard)
                    steps.push({
                        title,
                        marker,
                        effect: "addToProject",
                        mutation: call("projects_write", {
                            method: "add_project_item",
                            ...board,
                            item_owner: repository.owner,
                            item_repo: repository.repo,
                            item_type: "issue",
                            issue_number: issueNumber(marker),
                        }),
                    })
                // Automations may add the issue first, e.g. as Backlog with no Priority.
                if (child.status === undefined || child.status === tracker.fields.status.values.backlog)
                    steps.push({
                        title,
                        marker,
                        effect: "setStatus",
                        mutation: setField(marker, tracker.fields.status.field, tracker.fields.status.values.todo),
                    })
                if (child.priority === undefined && epicPriority !== PRIORITY_NOT_SET)
                    steps.push({ title, marker, effect: "setPriority", mutation: setPriority(marker) })
                return steps
            },
            cancel: (title, marker) => [
                {
                    title,
                    marker,
                    effect: "cancel",
                    mutation: setField(marker, tracker.fields.status.field, tracker.fields.status.values.canceled),
                },
                // A closed sub-issue counts toward GitHub's sub-issue progress.
                close(title, marker),
            ],
            // Finishes an interrupted cancel whose Status write landed before the close.
            closeIfOpen: (title, child) => (child.closed ? [] : [close(title, child.marker)]),
        }
    }
    if (ctx.status.tracker.provider !== "linear" || ctx.status.tracker.resource !== "project")
        throw new Error("Epic is not bound to a Linear Project")
    const projectId = ctx.status.tracker.external.projectId
    const statuses = tracker.statuses.issues
    return {
        create: (task) =>
            call("save_issue", {
                team: tracker.team,
                title: task.title,
                description: task.description,
                project: projectId,
                state: statuses.todo,
                priority: linearPriorityNumber(epicPriority),
            }),
        repairBoard(title, child) {
            const backlog = child.status === undefined || child.status === statuses.backlog
            const priority = child.priority === undefined && epicPriority !== PRIORITY_NOT_SET
            if (!backlog && !priority) return []
            return [
                {
                    title,
                    marker: child.marker,
                    effect: backlog ? "setStatus" : "setPriority",
                    mutation: call("save_issue", {
                        id: child.marker,
                        ...(backlog ? { state: statuses.todo } : {}),
                        ...(priority ? { priority: linearPriorityNumber(epicPriority) } : {}),
                    }),
                },
            ]
        },
        cancel: (title, marker) => [
            { title, marker, effect: "cancel", mutation: call("save_issue", { id: marker, state: statuses.canceled }) },
        ],
        closeIfOpen: () => [],
    }
}

// Tags one untagged plan Task with its issue's marker: a clear-success create, or the
// single matching existing child the plan reconciliation reported.
export function recordEpicTaskIssue(cwd: string, input: RecordEpicTaskIssueInput, tools: McpToolCatalog) {
    const ctx = context(cwd, input.entityDir, tools)
    const epicPath = path.join(ctx.directory, "epic.md")
    const task = readEpicTasks(epicPath).find((candidate) => candidate.title === input.title)
    if (!task) throw new Error(`Epic has no Task titled ${JSON.stringify(input.title)}`)
    if (input.evidence) {
        const created = createdMarker(ctx, task, input.evidence)
        if (created !== input.marker) throw new Error(`create evidence returned ${created}, not ${input.marker}`)
    }
    const result = tagEpicTask(epicPath, input.title, input.marker)
    return { state: result, title: input.title, marker: input.marker }
}

function createdMarker(ctx: Context, task: EpicTask, evidence: Static<typeof EvidenceSchema>): string {
    const tracker = ctx.tracker
    const operation = tracker.provider === "github" ? "issue_write" : "save_issue"
    if (!isMcpTool(evidence.tool, tracker.mcpServer, operation, ctx.tools))
        throw new Error("create evidence is not from the configured registered tool")
    const args = evidence.arguments
    if (args.title !== task.title) throw new Error("create evidence is for another Task title")
    const response = mcpResponsePayload(evidence.response)
    if (tracker.provider === "github") {
        const parent = ctx.status.tracker.provider === "github" ? ctx.status.tracker.external.issueNumber : undefined
        if (args.method !== "create" || args.parent_issue_number !== parent)
            throw new Error("create evidence is not a sub-issue create under this Epic")
        const url = typeof response.url === "string" ? response.url : response.html_url
        const number = typeof url === "string" ? /\/issues\/([1-9][0-9]*)$/.exec(url)?.[1] : undefined
        if (!number) throw new Error("create response lacks the new issue's URL")
        return `#${number}`
    }
    const projectId =
        ctx.status.tracker.provider === "linear" && ctx.status.tracker.resource === "project"
            ? ctx.status.tracker.external.projectId
            : undefined
    if (Object.hasOwn(args, "id") || args.project !== projectId)
        throw new Error("create evidence is not an issue create in this Epic's Project")
    const identifier = response.identifier ?? response.id
    if (typeof identifier !== "string" || !/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(identifier))
        throw new Error("create response lacks the new issue's identifier")
    return identifier
}
