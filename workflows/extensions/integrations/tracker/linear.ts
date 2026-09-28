import type { McpToolCatalog } from "../../../../extensions/__lib/mcp.js"
import * as project from "../../../../extensions/__lib/project.js"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import { type EntityIdentity, qualifyId } from "../../__lib/domain.js"
import { type EntityStatus, readEntityStatus, resolveEntityDirectory, writeEntityStatus } from "../../__lib/entity.js"
import * as Git from "../../__lib/git.js"
import { assertArtifactPersistencePrepared } from "../../__lib/project-config.js"
import type { EntityInitialization } from "../../init/entity.js"
import { loadIntegrationConfig, type LinearTracker } from "../config.js"
import { registeredCredentialEnvironment } from "../mcp.js"
import { type IntegrationOperation, type ToolRequirement, validateRequirements } from "../capabilities.js"

const LinearApiRecordSchema = Type.Record(Type.String(), Type.Unknown())

export interface FinalizeLinearBranchOptions {
    cwd: string
    afterProvisioningCheckpoint?: () => void
    afterBranchCreated?: () => void
}

export function finalizeLinearBranch(rawEntityDirectory: string, options: FinalizeLinearBranchOptions): EntityStatus {
    const root = project.resolveRootDir(options.cwd)
    Git.run(root, ["rev-parse", "--show-toplevel"])
    assertArtifactPersistencePrepared(root)
    const entityDirectory = resolveEntityDirectory(root, options.cwd, rawEntityDirectory)
    let status = readEntityStatus(entityDirectory)
    if (status.entity === "epic") throw new Error("Linear Projects do not supply workflow branch names")
    const tracker = status.integrations.find(
        (integration) =>
            integration.role === "tracker" &&
            integration.provider === "linear" &&
            integration.resource !== "project" &&
            (integration.state === "bound" || integration.state === "bound-pending"),
    )
    if (!tracker) throw new Error("branch finalization requires a bound Linear issue tracker record")

    if (status.branch.state === "ready") return status

    if (status.branch.state === "tracker-pending") {
        const name = tracker.external.gitBranchName
        Git.run(root, ["check-ref-format", "--branch", name])
        Git.run(root, ["show-ref", "--verify", `refs/heads/${status.branch.start}`])
        if (Git.succeeds(root, ["show-ref", "--verify", `refs/heads/${name}`])) {
            throw new Error(`workflow branch already exists: ${name}`)
        }
        const provisioning = {
            state: "provisioning" as const,
            provider: "linear" as const,
            name,
            start: status.branch.start,
            target: status.branch.target,
            startCommit: Git.run(root, ["rev-parse", `refs/heads/${status.branch.start}`]),
        }
        writeEntityStatus(entityDirectory, { ...status, branch: provisioning })
        status = readEntityStatus(entityDirectory)
        options.afterProvisioningCheckpoint?.()
    }

    if (status.branch.state !== "provisioning") throw new Error("branch is not ready for Linear provisioning")
    const existingCommit = Git.tryRun(root, ["rev-parse", `refs/heads/${status.branch.name}`])
    if (existingCommit && existingCommit !== status.branch.startCommit) {
        throw new Error(`workflow branch collision at a different commit: ${status.branch.name}`)
    }
    if (!existingCommit) Git.run(root, ["branch", status.branch.name, status.branch.startCommit])
    options.afterBranchCreated?.()

    const ready = {
        state: "ready" as const,
        name: status.branch.name,
        start: status.branch.start,
        target: status.branch.target,
        source: "tracker" as const,
    }
    writeEntityStatus(entityDirectory, { ...status, branch: ready })
    return readEntityStatus(entityDirectory)
}

const EnvironmentNameSchema = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" })

export const LinearWorkspaceInspectionToolSchema = Type.Object(
    { credentialEnv: EnvironmentNameSchema },
    { additionalProperties: false },
)

export type LinearWorkspaceInspectionInput = Static<typeof LinearWorkspaceInspectionToolSchema>

export const LINEAR_BRANCH_TEMPLATES = [
    "{username}/{issueIdentifier}-{issueTitle}",
    "{username}/{issueIdentifier}",
    "{username}-{issueIdentifier}-{issueTitle}",
    "{username}-{issueIdentifier}",
    "{issueIdentifier}-{issueTitle}",
    "{issueTitle}-{issueIdentifier}",
    "{issueIdentifier}",
] as const
export type LinearBranchTemplate = (typeof LINEAR_BRANCH_TEMPLATES)[number]
const LINEAR_BRANCH_TEMPLATE_SET = new Set<string>(LINEAR_BRANCH_TEMPLATES)

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
    branchFormat:
        | { state: "supported"; template: LinearBranchTemplate }
        | { state: "unsupported"; template: string | null }
}

export interface LinearTrackerBranchContext {
    template: LinearBranchTemplate
    username: string
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
        branchFormat: resolveLinearBranchFormat(workspace.gitBranchFormat),
    }
}

export async function inspectLinearTrackerBranch(
    rawInput: unknown,
    options: LinearWorkspaceInspectionOptions = {},
): Promise<LinearTrackerBranchContext> {
    const input = Value.Parse(LinearWorkspaceInspectionToolSchema, rawInput)
    const token = (options.env ?? process.env)[input.credentialEnv]
    if (!token) throw new Error(`environment variable ${input.credentialEnv} is not set`)

    const settings = await new LinearClient(options.fetch ?? fetch, token, options.signal).getTrackerBranchSettings()
    const branchFormat = resolveLinearBranchFormat(settings.gitBranchFormat)
    if (branchFormat.state === "unsupported") {
        throw new Error(
            `Linear tracker branch format is unsupported: ${branchFormat.template === null ? "null" : JSON.stringify(branchFormat.template)}`,
        )
    }
    return {
        template: branchFormat.template,
        username: settings.viewer.username,
    }
}

export async function resolveLinearTrackerBranchRendererForInitialization(
    cwd: string,
    input: EntityInitialization,
    signal?: AbortSignal,
    options: Omit<LinearWorkspaceInspectionOptions, "signal"> = {},
) {
    if (input.entity !== "epic") return undefined
    const projectConfig = assertArtifactPersistencePrepared(cwd)
    if (projectConfig.branches.format !== "tracker") return undefined

    const loaded = loadIntegrationConfig(cwd)
    if (loaded.state !== "enabled" || loaded.config.tracker?.provider !== "linear") return undefined
    const tracker = loaded.config.tracker
    const credentialEnv = registeredCredentialEnvironment(cwd, tracker.mcpServer, "linear")
    const context = await inspectLinearTrackerBranch({ credentialEnv }, { ...options, signal })
    return (identity: EntityIdentity) => formatLinearTrackerBranch(identity, context)
}

export function resolveLinearBranchFormat(template: string | null): LinearWorkspaceInspection["branchFormat"] {
    if (template === null || !LINEAR_BRANCH_TEMPLATE_SET.has(template)) return { state: "unsupported", template }
    return { state: "supported", template: template as LinearBranchTemplate }
}

export function formatLinearTrackerBranch(identity: EntityIdentity, context: LinearTrackerBranchContext): string {
    return context.template
        .replaceAll("{username}", context.username)
        .replaceAll("{issueIdentifier}", qualifyId(identity.entity, identity.rawId).toLowerCase())
        .replaceAll("{issueTitle}", identity.slug)
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
        gitBranchFormat: string | null
    }> {
        const data = await this.graphql(`query WorkspaceSetup {
            viewer { id name displayName }
            organization {
                id
                name
                urlKey
                gitBranchFormat
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
            gitBranchFormat:
                organization.gitBranchFormat === null
                    ? null
                    : text(organization.gitBranchFormat, "organization gitBranchFormat"),
        }
    }

    async getTrackerBranchSettings(): Promise<{
        viewer: LinearWorkspaceInspection["viewer"]
        gitBranchFormat: string | null
    }> {
        const data = await this.graphql(`query TrackerBranchSettings {
            viewer { id name displayName }
            organization { gitBranchFormat }
        }`)
        const organization = record(data.organization, "Linear organization")
        return {
            viewer: viewerFields(data.viewer),
            gitBranchFormat:
                organization.gitBranchFormat === null
                    ? null
                    : text(organization.gitBranchFormat, "organization gitBranchFormat"),
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

const LinearProjectCandidateSchema = Type.Object(
    {
        projectId: Type.String({ minLength: 1 }),
        title: Type.String({ minLength: 1 }),
        url: Type.String({ minLength: 1 }),
        teams: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    },
    { additionalProperties: false },
)
const LinearIssueCandidateSchema = Type.Object(
    {
        issueId: Type.String({ minLength: 1 }),
        identifier: Type.String({ minLength: 1 }),
        title: Type.String({ minLength: 1 }),
        url: Type.String({ minLength: 1 }),
        team: Type.String({ minLength: 1 }),
        projectId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    },
    { additionalProperties: false },
)

export const LinearBacklogReconciliationSchema = Type.Union([
    Type.Object(
        {
            entity: Type.Literal("epic"),
            title: Type.String({ minLength: 1 }),
            team: Type.String({ minLength: 1 }),
            candidates: Type.Array(LinearProjectCandidateSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            entity: Type.Literal("task"),
            title: Type.String({ minLength: 1 }),
            team: Type.String({ minLength: 1 }),
            parentProjectId: Type.String({ minLength: 1 }),
            candidates: Type.Array(LinearIssueCandidateSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            entity: Type.Literal("gig"),
            title: Type.String({ minLength: 1 }),
            team: Type.String({ minLength: 1 }),
            candidates: Type.Array(LinearIssueCandidateSchema),
        },
        { additionalProperties: false },
    ),
])
export type LinearBacklogReconciliation = Static<typeof LinearBacklogReconciliationSchema>

export function reconcileLinearBacklogCandidates(input: LinearBacklogReconciliation) {
    const candidates = (() => {
        switch (input.entity) {
            case "epic":
                return input.candidates.filter(
                    (candidate) => candidate.title === input.title && candidate.teams.includes(input.team),
                )
            case "task":
                return input.candidates.filter(
                    (candidate) =>
                        candidate.title === input.title &&
                        candidate.team === input.team &&
                        candidate.projectId === input.parentProjectId,
                )
            case "gig":
                return input.candidates.filter(
                    (candidate) =>
                        candidate.title === input.title &&
                        candidate.team === input.team &&
                        candidate.projectId === null,
                )
        }
    })()
    const outcome = candidates.length === 0 ? "none" : candidates.length === 1 ? "one" : "multiple"
    return { outcome, candidates, requiresUserConfirmation: true as const }
}

export const LINEAR_TOOL_NAMES = {
    getWorkspace: "get_workspace",
    getTeam: "get_team",
    listIssueStatuses: "list_issue_statuses",
    getIssue: "get_issue",
    listIssues: "list_issues",
    saveIssue: "save_issue",
    getProject: "get_project",
    listProjects: "list_projects",
    saveProject: "save_project",
} as const

const COMMON_REQUIREMENTS: ToolRequirement[] = [
    { name: LINEAR_TOOL_NAMES.getWorkspace, properties: [] },
    { name: LINEAR_TOOL_NAMES.getTeam, properties: ["query"] },
]
const ISSUE_READ_REQUIREMENTS: ToolRequirement[] = [
    { name: LINEAR_TOOL_NAMES.listIssueStatuses, properties: ["team"] },
    { name: LINEAR_TOOL_NAMES.getIssue, properties: ["id", "includeRelations"] },
    {
        name: LINEAR_TOOL_NAMES.listIssues,
        properties: ["query", "team", "state", "project", "priority", "parentId", "fields"],
    },
]
const ISSUE_WRITE_REQUIREMENTS: ToolRequirement[] = [
    {
        name: LINEAR_TOOL_NAMES.saveIssue,
        properties: ["id", "title", "description", "patch", "team", "priority", "project", "state"],
    },
]
const PROJECT_READ_REQUIREMENTS: ToolRequirement[] = [
    { name: LINEAR_TOOL_NAMES.getProject, properties: ["query"] },
    {
        name: LINEAR_TOOL_NAMES.listProjects,
        properties: ["query", "state", "team", "fields"],
    },
]
const PROJECT_WRITE_REQUIREMENTS: ToolRequirement[] = [
    {
        name: LINEAR_TOOL_NAMES.saveProject,
        properties: ["id", "name", "description", "patch", "state", "priority", "addTeams", "setTeams"],
    },
]

export function resolveLinearTracker(
    catalog: McpToolCatalog,
    config: LinearTracker,
    operation: IntegrationOperation,
    entity?: EntityStatus,
) {
    try {
        const tools = validateLinearTrackerCapabilities(catalog, config, operation, entity?.entity)
        return {
            state: "enabled" as const,
            provider: "linear" as const,
            config,
            tools,
            remoteValidation: buildLinearRemoteValidationSteps(config, tools),
        }
    } catch (error) {
        return {
            state: "unavailable" as const,
            provider: "linear" as const,
            config,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

export function validateLinearTrackerCapabilities(
    catalog: McpToolCatalog,
    config: LinearTracker,
    operation: IntegrationOperation,
    entity?: EntityStatus["entity"],
) {
    return validateRequirements(catalog, config.mcpServer, "Linear", requirementsFor(operation, entity))
}

function requirementsFor(operation: IntegrationOperation, entity?: EntityStatus["entity"]): ToolRequirement[] {
    if (operation === "pullRequest") return COMMON_REQUIREMENTS
    if (operation === "inspect") {
        return [...COMMON_REQUIREMENTS, ...ISSUE_READ_REQUIREMENTS, ...PROJECT_READ_REQUIREMENTS]
    }
    if (operation === "backlog" || !entity) {
        return [
            ...COMMON_REQUIREMENTS,
            ...ISSUE_READ_REQUIREMENTS,
            ...ISSUE_WRITE_REQUIREMENTS,
            ...PROJECT_READ_REQUIREMENTS,
            ...PROJECT_WRITE_REQUIREMENTS,
        ]
    }
    if (entity === "epic") {
        return [...COMMON_REQUIREMENTS, ...PROJECT_READ_REQUIREMENTS, ...PROJECT_WRITE_REQUIREMENTS]
    }
    if (entity === "task") {
        return [
            ...COMMON_REQUIREMENTS,
            ...ISSUE_READ_REQUIREMENTS,
            ...ISSUE_WRITE_REQUIREMENTS,
            ...PROJECT_READ_REQUIREMENTS,
        ]
    }
    return [...COMMON_REQUIREMENTS, ...ISSUE_READ_REQUIREMENTS, ...ISSUE_WRITE_REQUIREMENTS]
}

function buildLinearRemoteValidationSteps(config: LinearTracker, tools: Record<string, string>): string[] {
    const steps: string[] = []
    if (tools.getWorkspace) steps.push(`Use ${tools.getWorkspace} to verify the authenticated Linear workspace.`)
    if (tools.getTeam) {
        steps.push(`Use ${tools.getTeam} query=${JSON.stringify(config.team)} and require one exact configured team.`)
    }
    if (tools.listIssueStatuses) {
        steps.push(
            `Use ${tools.listIssueStatuses} team=${JSON.stringify(config.team)} and require every configured issue lifecycle status name.`,
        )
    }
    return steps
}
