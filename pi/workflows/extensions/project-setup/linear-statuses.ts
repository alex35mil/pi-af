import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import { LifecycleStateSchema, type LifecycleState } from "../__lib/domain.js"
import {
    LINEAR_ISSUE_STATUS_TYPES,
    LINEAR_PROJECT_STATUS_TYPES,
    LinearApiError,
    type LinearClient,
    linearClientFor,
    type LinearStatus,
    type LinearStatusDefinition,
    type LinearTeam,
} from "../integrations/tracker/linear.js"
import { planHash } from "./label-catalog.js"

const LIFECYCLE_ORDER = LifecycleStateSchema.enum as readonly LifecycleState[]

const EnvironmentNameSchema = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" })
const NameSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })

function choiceSchema(types: readonly string[]) {
    return Type.Union([
        Type.Object(
            { existing: Type.String({ minLength: 1, description: "An existing status's exact name" }) },
            { additionalProperties: false },
        ),
        Type.Object(
            {
                create: Type.Object(
                    {
                        name: NameSchema,
                        type: Type.Enum([...types], { type: "string" }),
                        color: Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" }),
                        description: Type.String(),
                    },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
    ])
}

function mappingSchema(types: readonly string[]) {
    const choice = choiceSchema(types)
    return Type.Object(
        {
            backlog: choice,
            todo: choice,
            inProgress: choice,
            inReview: choice,
            done: choice,
            canceled: choice,
        },
        { additionalProperties: false },
    )
}

const statusSetupProperties = {
    credentialEnv: EnvironmentNameSchema,
    team: Type.String({ minLength: 1, description: "The configured Linear team's name, key, or ID" }),
    statuses: Type.Object(
        {
            issues: mappingSchema(LINEAR_ISSUE_STATUS_TYPES),
            projects: mappingSchema(LINEAR_PROJECT_STATUS_TYPES),
        },
        {
            additionalProperties: false,
            description:
                "For each lifecycle key, the existing status to use or the new status to create; issue statuses in the team, Project statuses at workspace level",
        },
    ),
}

export const PreviewLinearStatusSetupSchema = Type.Object(statusSetupProperties, { additionalProperties: false })
export const ApplyLinearStatusSetupSchema = Type.Object(
    { ...statusSetupProperties, approvedPlanHash: Type.String({ pattern: "^[a-f0-9]{64}$" }) },
    { additionalProperties: false },
)

type PreviewInput = Static<typeof PreviewLinearStatusSetupSchema>
type ApplyInput = Static<typeof ApplyLinearStatusSetupSchema>
type Desired = PreviewInput["statuses"]
type Scope = keyof Desired
type Choice = Desired[Scope][LifecycleState]

/** The scopes in apply order: workspace-level Project statuses first, the likelier permission failure. */
const SCOPES: readonly Scope[] = ["projects", "issues"]

export interface StatusCreate extends LinearStatusDefinition {
    scope: Scope
    key: LifecycleState
    position: number
}

interface Catalog {
    issues: LinearStatus[]
    projects: LinearStatus[]
}

interface ViewerRole {
    admin: boolean
    owner: boolean
}

type StatusConfiguration = Record<Scope, Record<LifecycleState, string>>

/** A status on the scope's board: existing (with its ID) or planned, and the lifecycle key mapped to it. */
interface Positioned {
    id: string | null
    key: LifecycleState | null
    position: number
}

export type StatusPlan =
    | { state: "blocked"; problems: string[] }
    | {
          state: "ready"
          creates: StatusCreate[]
          existing: Array<{ scope: Scope; key: LifecycleState; name: string }>
          statuses: StatusConfiguration
          permissionWarning?: string
      }

const PERMISSION_WARNING =
    "You aren't a workspace admin or owner. Linear may reject the Project status creates unless the workspace lets your role manage Project statuses."

/** Plans the creates without calling Linear. Every problem is reported, not just the first. */
export function planStatuses(desired: Desired, catalog: Catalog, viewer: ViewerRole): StatusPlan {
    const problems: string[] = []
    const creates: StatusCreate[] = []
    const existing: Array<{ scope: Scope; key: LifecycleState; name: string }> = []
    const statuses = { issues: {}, projects: {} } as StatusConfiguration

    for (const scope of SCOPES) {
        const label = scope === "issues" ? "issue" : "Project"
        const present = catalog[scope]
        const names = new Map<string, LifecycleState>()
        const positioned: Positioned[] = present.map((status) => ({
            id: status.id,
            key: null,
            position: status.position,
        }))
        for (const key of LIFECYCLE_ORDER) {
            const choice: Choice = desired[scope][key]
            const name = "existing" in choice ? choice.existing : choice.create.name
            const folded = name.toLowerCase()
            const duplicate = names.get(folded)
            if (duplicate) problems.push(`${label} statuses for ${duplicate} and ${key} must use distinct names`)
            names.set(folded, key)
            statuses[scope][key] = name

            if ("existing" in choice) {
                const matches = present.filter((status) => status.name === choice.existing)
                if (matches.length !== 1) {
                    problems.push(
                        `${label} status ${JSON.stringify(choice.existing)} for ${key} matches ${matches.length} statuses, not exactly one`,
                    )
                    continue
                }
                existing.push({ scope, key, name })
                for (const item of positioned) if (item.id === matches[0].id) item.key = key
                continue
            }

            if (present.some((status) => status.name.toLowerCase() === folded)) {
                problems.push(`${label} status ${JSON.stringify(name)} for ${key} already exists; select it instead`)
                continue
            }
            const position = positionFor(key, positioned)
            positioned.push({ id: null, key, position })
            creates.push({ scope, key, ...choice.create, color: choice.create.color.toUpperCase(), position })
        }
    }

    if (problems.length > 0) return { state: "blocked", problems }
    const createsProjects = creates.some((create) => create.scope === "projects")
    return {
        state: "ready",
        creates,
        existing,
        statuses,
        ...(createsProjects && !viewer.admin && !viewer.owner ? { permissionWarning: PERMISSION_WARNING } : {}),
    }
}

/**
 * Right after the highest-positioned status mapped to an earlier lifecycle key, halfway to the next
 * status. With no earlier key, before the first status. Existing statuses keep their positions.
 */
function positionFor(key: LifecycleState, positioned: readonly Positioned[]) {
    const earlier = new Set(LIFECYCLE_ORDER.slice(0, LIFECYCLE_ORDER.indexOf(key)))
    const anchors = positioned.filter((item) => item.key !== null && earlier.has(item.key))
    const positions = positioned.map((item) => item.position)
    if (anchors.length === 0) return positions.length === 0 ? 0 : Math.min(...positions) - 1
    const anchor = Math.max(...anchors.map((item) => item.position))
    const after = positions.filter((position) => position > anchor)
    return after.length === 0 ? anchor + 1 : (anchor + Math.min(...after)) / 2
}

export interface LinearStatusSetupOptions {
    fetch?: typeof fetch
    env?: NodeJS.ProcessEnv
    signal?: AbortSignal
}

async function readCatalog(client: LinearClient, team: LinearTeam): Promise<Catalog> {
    const [issues, projects] = await Promise.all([client.listTeamIssueStatuses(team.id), client.listProjectStatuses()])
    // A Project uses workspace statuses plus any its lead team defines; other teams' statuses don't apply.
    return { issues, projects: projects.filter((status) => status.team === null || status.team.id === team.id) }
}

async function previewFor(client: LinearClient, input: PreviewInput) {
    const team = await client.resolveTeam(input.team)
    const [catalog, viewer] = await Promise.all([readCatalog(client, team), client.getViewerRole()])
    const plan = planStatuses(input.statuses, catalog, viewer)
    const hash = planHash({ team: team.id, desired: input.statuses, catalog, viewer, plan })
    return { team, plan, planHash: hash }
}

export async function previewLinearStatusSetup(rawInput: unknown, options: LinearStatusSetupOptions = {}) {
    const input = Value.Parse(PreviewLinearStatusSetupSchema, rawInput)
    const { team, plan, planHash } = await previewFor(linearClientFor(input.credentialEnv, options), input)
    const described = { key: team.key, name: team.name }
    switch (plan.state) {
        case "blocked":
            return { team: described, ...plan }
        case "ready":
            return { team: described, ...plan, planHash }
    }
}

export async function applyLinearStatusSetup(rawInput: unknown, options: LinearStatusSetupOptions = {}) {
    const { approvedPlanHash, ...input } = Value.Parse(ApplyLinearStatusSetupSchema, rawInput) as ApplyInput
    const client = linearClientFor(input.credentialEnv, options)
    const { team, plan, planHash } = await previewFor(client, input)
    if (plan.state !== "ready") throw new Error(`Linear status setup is blocked: ${plan.problems.join("; ")}`)
    if (planHash !== approvedPlanHash)
        throw new Error("Linear status setup changed after approval; preview and approve the new exact plan")

    const applied: StatusCreate[] = []
    const recovered: StatusCreate[] = []
    const pending = SCOPES.flatMap((scope) => plan.creates.filter((create) => create.scope === scope))
    for (const [index, create] of pending.entries()) {
        try {
            await createStatus(client, team, create)
            applied.push(create)
        } catch (error) {
            const remaining = pending.slice(index + 1)
            if (error instanceof LinearApiError && error.reason === "unauthorized")
                throw new Error(
                    `${describe(create)} was rejected: ${error.message}. Creating statuses needs a Linear API key with write access (full access or the Admin permission) that isn't limited to other teams; Project statuses also need a workspace admin or a role the workspace allows. ${progress(applied, remaining)}`,
                )
            let catalog: Catalog
            try {
                catalog = await readCatalog(client, team)
            } catch {
                throw failure(error, create, applied, remaining)
            }
            const matches = catalog[create.scope].filter(
                (status) => status.name === create.name && status.type === create.type,
            )
            if (matches.length !== 1) throw failure(error, create, applied, remaining)
            applied.push(create)
            recovered.push(create)
        }
    }

    verify(plan.statuses, await readCatalog(client, team))
    return {
        state: "applied" as const,
        team: { key: team.key, name: team.name },
        created: applied.map(describe),
        ...(recovered.length > 0 ? { recovered: recovered.map(describe) } : {}),
        statuses: plan.statuses,
    }
}

async function createStatus(client: LinearClient, team: LinearTeam, create: StatusCreate) {
    const definition = {
        name: create.name,
        type: create.type,
        color: create.color,
        description: create.description,
        position: create.position,
    }
    switch (create.scope) {
        case "issues":
            return client.createIssueStatus({ ...definition, teamId: team.id })
        case "projects":
            return client.createProjectStatus(definition)
    }
}

function verify(statuses: StatusConfiguration, catalog: Catalog): void {
    const problems: string[] = []
    for (const scope of SCOPES) {
        for (const key of LIFECYCLE_ORDER) {
            const name = statuses[scope][key]
            const matches = catalog[scope].filter((status) => status.name === name).length
            if (matches !== 1) problems.push(`${scope} ${key} ${JSON.stringify(name)}: ${matches} matching statuses`)
        }
    }
    if (problems.length > 0) throw new Error(`Linear status setup verification failed: ${problems.join("; ")}`)
}

function describe(create: StatusCreate): string {
    const scope = create.scope === "issues" ? "issue status" : "workspace Project status"
    return `${scope} ${JSON.stringify(create.name)} (${create.type}) for ${create.key}`
}

function progress(applied: readonly StatusCreate[], remaining: readonly StatusCreate[]): string {
    const list = (items: readonly StatusCreate[]) => (items.length === 0 ? "none" : items.map(describe).join(", "))
    return `Created: ${list(applied)}. Not attempted: ${list(remaining)}.`
}

function failure(error: unknown, create: StatusCreate, applied: StatusCreate[], remaining: StatusCreate[]): Error {
    const message = error instanceof Error ? error.message : String(error)
    return new Error(
        `${describe(create)} failed and isn't confirmed applied: ${message}. ${progress(applied, remaining)}`,
    )
}
