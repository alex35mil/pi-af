import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

const LinearApiRecordSchema = Type.Record(Type.String(), Type.Unknown())

const EnvironmentNameSchema = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" })

export const LinearWorkspaceInspectionToolSchema = Type.Object(
    { credentialEnv: EnvironmentNameSchema },
    { additionalProperties: false },
)

export type LinearWorkspaceInspectionInput = Static<typeof LinearWorkspaceInspectionToolSchema>

export interface LinearTeam {
    id: string
    key: string
    name: string
}

/** Native categories Linear accepts for a new issue status (Duplicate and Triage are system-managed). */
export const LINEAR_ISSUE_STATUS_TYPES = ["backlog", "unstarted", "started", "completed", "canceled"] as const
/** Native categories Linear accepts for a new Project status. */
export const LINEAR_PROJECT_STATUS_TYPES = ["backlog", "planned", "started", "paused", "completed", "canceled"] as const

/** What setup sends to create a status. */
export interface LinearStatusDefinition {
    name: string
    type: string
    color: string
    description: string
}

const STATUS_DESCRIPTIONS = {
    backlog: "Potential work we may do later but have not committed to doing.",
    todo: "Queued work we have committed to doing and can pick up next.",
    inProgress: "Work being planned, executed, or reviewed locally.",
    inReview: "Submitted work waiting for external human review.",
    done: "Approved work confirmed delivered.",
    canceled: "Canceled work.",
} as const

/**
 * Suggested definitions for each lifecycle key, offered like the default Kind label group. They're
 * editable suggestions for statuses the user chooses to create; setup never matches them to
 * existing statuses on its own.
 */
export const LINEAR_STATUS_DEFAULTS = {
    issues: {
        backlog: { name: "Backlog", type: "backlog", color: "#BEC2C8", description: STATUS_DESCRIPTIONS.backlog },
        todo: { name: "Todo", type: "unstarted", color: "#E2E2E2", description: STATUS_DESCRIPTIONS.todo },
        inProgress: {
            name: "In Progress",
            type: "started",
            color: "#F2C94C",
            description: STATUS_DESCRIPTIONS.inProgress,
        },
        inReview: { name: "In Review", type: "started", color: "#8250DF", description: STATUS_DESCRIPTIONS.inReview },
        done: { name: "Done", type: "completed", color: "#5E6AD2", description: STATUS_DESCRIPTIONS.done },
        canceled: { name: "Canceled", type: "canceled", color: "#95A2B3", description: STATUS_DESCRIPTIONS.canceled },
    },
    projects: {
        backlog: { name: "Backlog", type: "backlog", color: "#F2994A", description: STATUS_DESCRIPTIONS.backlog },
        todo: { name: "Todo", type: "planned", color: "#D7D8DB", description: STATUS_DESCRIPTIONS.todo },
        inProgress: {
            name: "In Progress",
            type: "started",
            color: "#F2C94C",
            description: STATUS_DESCRIPTIONS.inProgress,
        },
        inReview: { name: "In Review", type: "started", color: "#8250DF", description: STATUS_DESCRIPTIONS.inReview },
        done: { name: "Completed", type: "completed", color: "#5E6AD2", description: STATUS_DESCRIPTIONS.done },
        canceled: { name: "Canceled", type: "canceled", color: "#8A8F98", description: STATUS_DESCRIPTIONS.canceled },
    },
} as const satisfies Record<"issues" | "projects", Record<keyof typeof STATUS_DESCRIPTIONS, LinearStatusDefinition>>

export interface LinearStatus {
    id: string
    name: string
    type: string
    color: string
    position: number
}

interface LinearIssueStatus extends LinearStatus {
    team: LinearTeam
}

export interface LinearProjectStatus extends LinearStatus {
    team: LinearTeam | null
}

export interface LinearWorkspaceInspection {
    workspace: {
        id: string
        name: string
        urlKey: string
    }
    viewer: {
        id: string
        name: string
        username: string
    }
    teams: Array<LinearTeam & { issueStatuses: LinearStatus[] }>
    projectStatuses: LinearProjectStatus[]
    statusDefaults: typeof LINEAR_STATUS_DEFAULTS
}

export interface LinearWorkspaceInspectionOptions {
    fetch?: typeof fetch
    env?: NodeJS.ProcessEnv
    signal?: AbortSignal
}

export function linearClientFor(credentialEnv: string, options: LinearWorkspaceInspectionOptions = {}): LinearClient {
    const token = (options.env ?? process.env)[credentialEnv]
    if (!token) throw new Error(`environment variable ${credentialEnv} is not set`)
    return new LinearClient(options.fetch ?? fetch, token, options.signal)
}

export async function inspectLinearWorkspace(
    rawInput: unknown,
    options: LinearWorkspaceInspectionOptions = {},
): Promise<LinearWorkspaceInspection> {
    const input = Value.Parse(LinearWorkspaceInspectionToolSchema, rawInput)
    const client = linearClientFor(input.credentialEnv, options)
    const workspace = await client.getWorkspace()
    const [teams, issueStatuses] = await Promise.all([client.listTeams(), client.listIssueStatuses()])
    const statusesByTeam = new Map<string, LinearStatus[]>()
    for (const status of issueStatuses) {
        const statuses = statusesByTeam.get(status.team.id) ?? []
        statuses.push(statusWithoutTeam(status))
        statusesByTeam.set(status.team.id, statuses)
    }

    return {
        workspace: workspace.workspace,
        viewer: workspace.viewer,
        teams: teams.map((team) => ({
            ...team,
            issueStatuses: sortStatuses(statusesByTeam.get(team.id) ?? []),
        })),
        projectStatuses: sortProjectStatuses(workspace.projectStatuses),
        statusDefaults: LINEAR_STATUS_DEFAULTS,
    }
}

/** Linear's public GraphQL API, authenticated with an environment-backed key. */
export class LinearClient {
    readonly fetchImpl: typeof fetch
    readonly token: string
    readonly signal?: AbortSignal
    private authorizationHeader?: string

    constructor(fetchImpl: typeof fetch, token: string, signal?: AbortSignal) {
        this.fetchImpl = fetchImpl
        this.token = token
        this.signal = signal
    }

    async getWorkspace(): Promise<{
        workspace: LinearWorkspaceInspection["workspace"]
        viewer: LinearWorkspaceInspection["viewer"]
        projectStatuses: LinearProjectStatus[]
    }> {
        const data = await this.graphql(`query WorkspaceSetup {
            viewer { id name displayName }
            organization {
                id
                name
                urlKey
                projectStatuses {
                    id
                    name
                    type
                    color
                    position
                    team { id key name }
                }
            }
        }`)
        const organization = record(data.organization, "Linear organization")
        return {
            workspace: {
                id: text(organization.id, "organization id"),
                name: text(organization.name, "organization name"),
                urlKey: text(organization.urlKey, "organization urlKey"),
            },
            viewer: viewerFields(data.viewer),
            projectStatuses: array(organization.projectStatuses, "project statuses").map((rawStatus) => {
                const status = record(rawStatus, "project status")
                return {
                    ...statusFields(status, "project status"),
                    team: status.team === null ? null : teamFields(record(status.team, "project status team")),
                }
            }),
        }
    }

    async getViewerRole(): Promise<{ admin: boolean; owner: boolean }> {
        const data = await this.graphql(`query ViewerRole { viewer { admin owner } }`)
        const viewer = record(data.viewer, "Linear viewer")
        return { admin: viewer.admin === true, owner: viewer.owner === true }
    }

    async listProjectStatuses(): Promise<LinearProjectStatus[]> {
        return (await this.getWorkspace()).projectStatuses
    }

    async listTeamIssueStatuses(teamId: string): Promise<LinearStatus[]> {
        let after: string | null = null
        const statuses: LinearStatus[] = []
        do {
            const data = await this.graphql(
                `query TeamIssueStatuses($teamId: String!, $after: String) {
                    team(id: $teamId) {
                        states(first: 100, after: $after) {
                            nodes { id name type color position }
                            pageInfo { hasNextPage endCursor }
                        }
                    }
                }`,
                { teamId, after },
            )
            const connection = record(record(data.team, "Linear team").states, "Linear team issue statuses")
            for (const rawStatus of array(connection.nodes, "Linear team issue status nodes")) {
                statuses.push(statusFields(record(rawStatus, "Linear issue status"), "issue status"))
            }
            after = nextCursor(connection.pageInfo, "Linear team issue statuses")
        } while (after)
        return sortStatuses(statuses)
    }

    /** The one team whose ID, key, or name equals the reference exactly. */
    async resolveTeam(reference: string): Promise<LinearTeam> {
        const matches = (await this.listTeams()).filter(
            (team) => team.id === reference || team.key === reference || team.name === reference,
        )
        if (matches.length !== 1)
            throw new Error(`Linear team ${JSON.stringify(reference)} matches ${matches.length} teams, not exactly one`)
        return matches[0]
    }

    async createIssueStatus(
        input: LinearStatusDefinition & { teamId: string; position: number },
    ): Promise<LinearStatus> {
        const data = await this.graphql(
            `mutation IssueStatusCreate($input: WorkflowStateCreateInput!) {
                workflowStateCreate(input: $input) { success workflowState { id name type color position } }
            }`,
            { input },
        )
        const payload = record(data.workflowStateCreate, "workflowStateCreate payload")
        return statusFields(record(payload.workflowState, "created issue status"), "created issue status")
    }

    /** Creates a workspace-level Project status: no `teamId` is ever sent. */
    async createProjectStatus(input: LinearStatusDefinition & { position: number }): Promise<LinearStatus> {
        const data = await this.graphql(
            `mutation ProjectStatusCreate($input: ProjectStatusCreateInput!) {
                projectStatusCreate(input: $input) { success status { id name type color position } }
            }`,
            { input },
        )
        const payload = record(data.projectStatusCreate, "projectStatusCreate payload")
        return statusFields(record(payload.status, "created Project status"), "created Project status")
    }

    async listTeams(): Promise<LinearTeam[]> {
        let after: string | null = null
        const teams: LinearTeam[] = []
        do {
            const data = await this.graphql(
                `query WorkspaceTeams($after: String) {
                    teams(first: 50, after: $after, includeArchived: false) {
                        nodes { id key name }
                        pageInfo { hasNextPage endCursor }
                    }
                }`,
                { after },
            )
            const connection = record(data.teams, "Linear teams")
            for (const rawTeam of array(connection.nodes, "Linear team nodes")) {
                teams.push(teamFields(record(rawTeam, "Linear team")))
            }
            after = nextCursor(connection.pageInfo, "Linear teams")
        } while (after)
        return teams.sort(compareTeams)
    }

    async listIssueStatuses(): Promise<LinearIssueStatus[]> {
        let after: string | null = null
        const statuses: LinearIssueStatus[] = []
        do {
            const data = await this.graphql(
                `query IssueStatuses($after: String) {
                    workflowStates(first: 50, after: $after, includeArchived: false) {
                        nodes {
                            id
                            name
                            type
                            color
                            position
                            team { id key name }
                        }
                        pageInfo { hasNextPage endCursor }
                    }
                }`,
                { after },
            )
            const connection = record(data.workflowStates, "Linear issue statuses")
            for (const rawStatus of array(connection.nodes, "Linear issue status nodes")) {
                const status = record(rawStatus, "Linear issue status")
                statuses.push({
                    ...statusFields(status, "issue status"),
                    team: teamFields(record(status.team, "issue status team")),
                })
            }
            after = nextCursor(connection.pageInfo, "Linear issue statuses")
        } while (after)
        return statuses
    }

    async graphql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        const authorizationHeaders = this.authorizationHeader
            ? [this.authorizationHeader]
            : [this.token, `Bearer ${this.token}`]
        let lastResponse: Response | undefined
        let lastResult: unknown

        for (const authorization of authorizationHeaders) {
            const response = await this.fetchImpl("https://api.linear.app/graphql", {
                method: "POST",
                headers: {
                    Authorization: authorization,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ query, variables }),
                signal: this.signal,
            })
            const result = await responseJson(response)
            lastResponse = response
            lastResult = result
            if (response.status === 401 && authorization !== authorizationHeaders.at(-1)) continue
            if (!response.ok) throw linearHttpError(response.status, result)
            const root = record(result, "Linear GraphQL response")
            if (Array.isArray(root.errors) && root.errors.length > 0) {
                const errors = root.errors.map((error) => record(error, "Linear GraphQL error"))
                const messages = errors.map((error) => String(error.message)).join("; ")
                throw new LinearApiError(
                    `Linear GraphQL failed: ${messages}`,
                    errors.some(isAuthorizationError) ? "unauthorized" : "failed",
                )
            }
            this.authorizationHeader = authorization
            return record(root.data, "Linear GraphQL data")
        }

        throw linearHttpError(lastResponse?.status ?? 401, lastResult)
    }
}

function viewerFields(value: unknown): LinearWorkspaceInspection["viewer"] {
    const viewer = record(value, "Linear viewer")
    return {
        id: text(viewer.id, "viewer id"),
        name: text(viewer.name, "viewer name"),
        username: text(viewer.displayName, "viewer displayName"),
    }
}

function statusFields(value: Record<string, unknown>, label: string): LinearStatus {
    return {
        id: text(value.id, `${label} id`),
        name: text(value.name, `${label} name`),
        type: text(value.type, `${label} type`),
        color: text(value.color, `${label} color`),
        position: number(value.position, `${label} position`),
    }
}

function statusWithoutTeam(status: LinearIssueStatus): LinearStatus {
    const { team: _team, ...fields } = status
    return fields
}

function teamFields(value: Record<string, unknown>): LinearTeam {
    return {
        id: text(value.id, "team id"),
        key: text(value.key, "team key"),
        name: text(value.name, "team name"),
    }
}

function nextCursor(value: unknown, label: string): string | null {
    const pageInfo = record(value, `${label} pageInfo`)
    return pageInfo.hasNextPage === true ? text(pageInfo.endCursor, `${label} endCursor`) : null
}

function sortStatuses(statuses: LinearStatus[]): LinearStatus[] {
    return statuses.sort((left, right) => left.position - right.position || compareText(left.name, right.name))
}

function sortProjectStatuses(statuses: LinearProjectStatus[]): LinearProjectStatus[] {
    return statuses.sort(
        (left, right) =>
            compareText(left.team?.name ?? "", right.team?.name ?? "") ||
            left.position - right.position ||
            compareText(left.name, right.name),
    )
}

function compareTeams(left: LinearTeam, right: LinearTeam): number {
    return compareText(left.name, right.name) || compareText(left.key, right.key)
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0
}

async function responseJson(response: Response): Promise<unknown> {
    const body = await response.text()
    if (!body) return null
    try {
        return JSON.parse(body)
    } catch {
        throw new Error(`Linear API returned invalid JSON with HTTP ${response.status}`)
    }
}

/** A Linear API failure. `unauthorized` means the credential or the user lacks permission. */
export class LinearApiError extends Error {
    readonly reason: "unauthorized" | "failed"

    constructor(message: string, reason: "unauthorized" | "failed") {
        super(message)
        this.name = "LinearApiError"
        this.reason = reason
    }
}

function isAuthorizationError(error: Record<string, unknown>): boolean {
    const extensions = Value.Check(LinearApiRecordSchema, error.extensions) ? error.extensions : {}
    const code = String(extensions.code ?? "").toUpperCase()
    const type = String(extensions.type ?? "").toLowerCase()
    return (
        code === "FORBIDDEN" ||
        code === "AUTHENTICATION_ERROR" ||
        type === "forbidden" ||
        type === "authentication error" ||
        extensions.statusCode === 401 ||
        extensions.statusCode === 403
    )
}

function linearHttpError(status: number, value: unknown): LinearApiError {
    const message =
        Value.Check(LinearApiRecordSchema, value) && typeof value.error === "string"
            ? value.error
            : Value.Check(LinearApiRecordSchema, value) && typeof value.message === "string"
              ? value.message
              : `HTTP ${status}`
    return new LinearApiError(
        `Linear API request failed (${status}): ${message}`,
        status === 401 || status === 403 ? "unauthorized" : "failed",
    )
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (!Value.Check(LinearApiRecordSchema, value)) throw new Error(`invalid ${label}: expected an object`)
    return value
}

function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`invalid ${label}: expected an array`)
    return value
}

function text(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) throw new Error(`invalid ${label}`)
    return value
}

function number(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid ${label}`)
    return value
}
