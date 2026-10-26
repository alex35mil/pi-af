import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

const LinearApiRecordSchema = Type.Record(Type.String(), Type.Unknown())

const EnvironmentNameSchema = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" })

export const LinearWorkspaceInspectionToolSchema = Type.Object(
    { credentialEnv: EnvironmentNameSchema },
    { additionalProperties: false },
)

export type LinearWorkspaceInspectionInput = Static<typeof LinearWorkspaceInspectionToolSchema>

interface LinearTeam {
    id: string
    key: string
    name: string
}

interface LinearStatus {
    id: string
    name: string
    type: string
    color: string
    position: number
}

interface LinearIssueStatus extends LinearStatus {
    team: LinearTeam
}

interface LinearProjectStatus extends LinearStatus {
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
}

export interface LinearWorkspaceInspectionOptions {
    fetch?: typeof fetch
    env?: NodeJS.ProcessEnv
    signal?: AbortSignal
}

export async function inspectLinearWorkspace(
    rawInput: unknown,
    options: LinearWorkspaceInspectionOptions = {},
): Promise<LinearWorkspaceInspection> {
    const input = Value.Parse(LinearWorkspaceInspectionToolSchema, rawInput)
    const token = (options.env ?? process.env)[input.credentialEnv]
    if (!token) throw new Error(`environment variable ${input.credentialEnv} is not set`)

    const client = new LinearClient(options.fetch ?? fetch, token, options.signal)
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
    }
}

class LinearClient {
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

    private async graphql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
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
                const messages = root.errors
                    .map((error) => String(record(error, "Linear GraphQL error").message))
                    .join("; ")
                throw new Error(`Linear GraphQL failed: ${messages}`)
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

function linearHttpError(status: number, value: unknown): Error {
    const message =
        Value.Check(LinearApiRecordSchema, value) && typeof value.error === "string"
            ? value.error
            : Value.Check(LinearApiRecordSchema, value) && typeof value.message === "string"
              ? value.message
              : `HTTP ${status}`
    return new Error(`Linear API request failed (${status}): ${message}`)
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
