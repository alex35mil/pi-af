import { createHash } from "node:crypto"

import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import { GitHubTrackerSchema } from "../integrations/config.js"

const OneLineSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })
const ServerNameSchema = Type.String({ minLength: 1, pattern: "^[A-Za-z0-9_.-]+$" })
const EnvironmentNameSchema = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" })
const ColorSchema = Type.Union([
    Type.Literal("gray"),
    Type.Literal("blue"),
    Type.Literal("green"),
    Type.Literal("yellow"),
    Type.Literal("orange"),
    Type.Literal("red"),
    Type.Literal("pink"),
    Type.Literal("purple"),
])

const OptionSchema = Type.Object(
    {
        name: OneLineSchema,
        description: Type.String(),
        color: ColorSchema,
    },
    { additionalProperties: false },
)

const PhaseOptionsSchema = Type.Object(
    { planning: OptionSchema, execution: OptionSchema, selfReview: OptionSchema },
    { additionalProperties: false },
)

const StatusOptionsSchema = Type.Object(
    {
        backlog: OptionSchema,
        todo: OptionSchema,
        inProgress: OptionSchema,
        inReview: OptionSchema,
        done: OptionSchema,
        canceled: OptionSchema,
    },
    { additionalProperties: false },
)

const RepositoryLabelSchema = Type.Object(
    {
        name: OneLineSchema,
        color: Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" }),
        description: Type.String(),
    },
    { additionalProperties: false },
)

const DeliverableKindLabelsSchema = Type.Object(
    {
        feature: RepositoryLabelSchema,
        bugfix: RepositoryLabelSchema,
        research: RepositoryLabelSchema,
        refactor: RepositoryLabelSchema,
        audit: RepositoryLabelSchema,
        chore: RepositoryLabelSchema,
    },
    { additionalProperties: false },
)

const ProjectOwnerSchema = Type.Object(
    { login: OneLineSchema, type: Type.Union([Type.Literal("user"), Type.Literal("org")]) },
    { additionalProperties: false },
)
const RepositorySchema = Type.Object({ owner: OneLineSchema, repo: OneLineSchema }, { additionalProperties: false })
const ProjectSourceSchema = Type.Union([
    Type.Object(
        {
            mode: Type.Literal("new"),
            title: OneLineSchema,
            visibility: Type.Union([Type.Literal("private"), Type.Literal("public")]),
            associateRepository: Type.Boolean(),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            mode: Type.Literal("existing"),
            number: Type.Integer({ minimum: 1 }),
            visibility: Type.Union([Type.Literal("private"), Type.Literal("public")]),
            associateRepository: Type.Boolean(),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            mode: Type.Literal("resume-created"),
            number: Type.Integer({ minimum: 1 }),
            visibility: Type.Union([Type.Literal("private"), Type.Literal("public")]),
            associateRepository: Type.Boolean(),
        },
        { additionalProperties: false },
    ),
])

const ProjectPrioritySchema = Type.Object(
    {
        scope: Type.Literal("project"),
        field: OneLineSchema,
        options: Type.Array(OptionSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
)
const IssuePrioritySchema = Type.Object(
    {
        scope: Type.Literal("issue"),
        field: OneLineSchema,
        options: Type.Array(OptionSchema, { minItems: 1 }),
        provisionMissing: Type.Boolean(),
        visibility: Type.Union([Type.Literal("organization_members_only"), Type.Literal("all")]),
    },
    { additionalProperties: false },
)
const ProjectInternalIdSchema = Type.Object(
    { scope: Type.Literal("project"), field: OneLineSchema },
    { additionalProperties: false },
)
const IssueInternalIdSchema = Type.Object(
    {
        scope: Type.Literal("issue"),
        field: OneLineSchema,
        provisionMissing: Type.Boolean(),
        visibility: Type.Union([Type.Literal("organization_members_only"), Type.Literal("all")]),
    },
    { additionalProperties: false },
)
const LayoutSchema = Type.Union([Type.Literal("table"), Type.Literal("board"), Type.Literal("roadmap")])
const ViewTargetSchema = Type.Union([
    Type.Object({ mode: Type.Literal("initial") }, { additionalProperties: false }),
    Type.Object({ mode: Type.Literal("selected"), viewId: OneLineSchema }, { additionalProperties: false }),
])
const VisibleFieldSchema = Type.Union([
    Type.Object({ kind: Type.Literal("field"), name: OneLineSchema }, { additionalProperties: false }),
    Type.Object(
        {
            kind: Type.Literal("workflow"),
            field: Type.Union([Type.Literal("status"), Type.Literal("priority"), Type.Literal("phase")]),
        },
        { additionalProperties: false },
    ),
])
const PresentationSchema = Type.Object(
    {
        target: ViewTargetSchema,
        name: OneLineSchema,
        layout: LayoutSchema,
        visibleFields: Type.Array(VisibleFieldSchema),
    },
    { additionalProperties: false },
)
const DefaultRepositorySchema = Type.Union([Type.Literal("setup-repository"), Type.Literal("unmanaged")])

export const GitHubProjectSpecificationSchema = Type.Object(
    {
        credentialEnv: EnvironmentNameSchema,
        mcpServer: ServerNameSchema,
        repository: RepositorySchema,
        projectOwner: ProjectOwnerSchema,
        project: ProjectSourceSchema,
        presentation: PresentationSchema,
        defaultRepository: DefaultRepositorySchema,
        labels: Type.Object(
            {
                kind: Type.Object(
                    {
                        epic: RepositoryLabelSchema,
                        deliverableKinds: DeliverableKindLabelsSchema,
                    },
                    { additionalProperties: false },
                ),
            },
            { additionalProperties: false },
        ),
        fields: Type.Object(
            {
                status: Type.Object(
                    { field: OneLineSchema, options: StatusOptionsSchema },
                    { additionalProperties: false },
                ),
                phase: Type.Object(
                    { field: OneLineSchema, options: PhaseOptionsSchema },
                    { additionalProperties: false },
                ),
                priority: Type.Union([ProjectPrioritySchema, IssuePrioritySchema]),
                internalId: Type.Union([ProjectInternalIdSchema, IssueInternalIdSchema]),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
)
export type GitHubProjectSpecification = Static<typeof GitHubProjectSpecificationSchema>

const inspectProperties = {
    credentialEnv: EnvironmentNameSchema,
    repository: RepositorySchema,
    projectOwner: ProjectOwnerSchema,
    includeOrganizationMetadata: Type.Boolean(),
}

export const GitHubProjectSetupToolSchema = Type.Union([
    Type.Object(
        {
            operation: Type.Literal("inspectRepository"),
            credentialEnv: EnvironmentNameSchema,
            repository: RepositorySchema,
        },
        { additionalProperties: false },
    ),
    Type.Object({ operation: Type.Literal("inspect"), ...inspectProperties }, { additionalProperties: false }),
    Type.Object(
        {
            operation: Type.Literal("inspectProject"),
            credentialEnv: EnvironmentNameSchema,
            projectOwner: ProjectOwnerSchema,
            projectNumber: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        { operation: Type.Literal("preview"), specification: GitHubProjectSpecificationSchema },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            operation: Type.Literal("apply"),
            specification: GitHubProjectSpecificationSchema,
            approvedPlanHash: Type.String({ minLength: 64, maxLength: 64, pattern: "^[a-f0-9]+$" }),
        },
        { additionalProperties: false },
    ),
])
export type GitHubProjectSetupToolInput = Static<typeof GitHubProjectSetupToolSchema>

export const GITHUB_PROJECT_DEFAULTS = {
    associateRepository: true,
    defaultRepository: "setup-repository",
    presentation: {
        name: "Board",
        layout: "board",
        visibleFields: [
            { kind: "field", name: "Title" },
            { kind: "field", name: "Assignees" },
            { kind: "workflow", field: "status" },
            { kind: "field", name: "Linked pull requests" },
            { kind: "field", name: "Sub-issues progress" },
            { kind: "field", name: "Labels" },
            { kind: "workflow", field: "priority" },
            { kind: "workflow", field: "phase" },
        ],
    },
    board: {
        columnBy: "status",
        swimlanes: "none",
        sortBy: { field: "priority", order: "configured-option-order" },
        fieldSum: "count",
        sliceBy: "none",
    },
    labels: {
        kind: {
            epic: {
                name: "Kind: Epic",
                color: "#8250DF",
                description: "A multi-deliverable initiative.",
            },
            deliverableKinds: {
                feature: {
                    name: "Kind: Feature",
                    color: "#0969DA",
                    description: "New user-visible or system capability.",
                },
                bugfix: {
                    name: "Kind: Bugfix",
                    color: "#CF222E",
                    description: "Correction of defective behavior.",
                },
                research: {
                    name: "Kind: Research",
                    color: "#1A7F37",
                    description: "Investigation producing evidence and conclusions.",
                },
                refactor: {
                    name: "Kind: Refactor",
                    color: "#BC4C00",
                    description: "Behavior-preserving structural improvement.",
                },
                audit: {
                    name: "Kind: Audit",
                    color: "#9A6700",
                    description: "Evidence-based assessment and recommendations.",
                },
                chore: {
                    name: "Kind: Chore",
                    color: "#57606A",
                    description: "Maintenance or operational work.",
                },
            },
        },
    },
    status: {
        field: "Status",
        options: {
            backlog: {
                name: "Backlog",
                description: "Potential work we may do later but have not committed to doing.",
                color: "gray",
            },
            todo: {
                name: "Todo",
                description: "Queued work we have committed to doing and can pick up next.",
                color: "blue",
            },
            inProgress: {
                name: "In Progress",
                description: "Work being planned, executed, or reviewed locally.",
                color: "yellow",
            },
            inReview: {
                name: "In Review",
                description: "Submitted work waiting for external human review.",
                color: "purple",
            },
            done: { name: "Done", description: "Approved work confirmed delivered.", color: "green" },
            canceled: { name: "Canceled", description: "Canceled work.", color: "gray" },
        },
    },
    phase: {
        field: "Phase",
        options: {
            planning: { name: "Planning", description: "Preparing the plan.", color: "blue" },
            execution: { name: "Execution", description: "Executing work or correcting findings.", color: "yellow" },
            selfReview: { name: "Self-Review", description: "Adversarial or local user review.", color: "purple" },
        },
    },
    priority: {
        field: "Priority",
        options: [
            { name: "Urgent", description: "Requires immediate attention.", color: "red" },
            { name: "High", description: "Important work to prioritize.", color: "orange" },
            { name: "Medium", description: "Normal priority.", color: "yellow" },
            { name: "Low", description: "Can be scheduled after higher-priority work.", color: "blue" },
        ],
    },
    internalId: { field: "Internal ID" },
} as const

interface ProjectSummary {
    id: string
    number: number
    title: string
    url: string
    public: boolean
    closed: boolean
}
interface ProjectField {
    databaseId: number | null
    id: string
    name: string
    dataType: string
    isIssueField: boolean
    options?: Array<{ id: string; name: string; description: string; color: string }>
}
interface ProjectDetails extends ProjectSummary {
    itemCount: number
    fields: ProjectField[]
    repositoryIds: string[]
}
interface ProjectView {
    id: string
    number: number
    name: string
    layout: Static<typeof LayoutSchema>
    filter: string | null
    visibleFieldIds: string[]
    groupBy: Array<{ id: string; name: string }>
    verticalGroupBy: Array<{ id: string; name: string }>
    sortBy: Array<{ field: { id: string; name: string }; direction: string }>
}
interface DesiredView {
    name: string
    layout: Static<typeof LayoutSchema>
    fields: Array<{ name: string; source: "project" | "issue" | "any" }>
}
interface ManualStep {
    setting: string
    desired: string
    instructions: string
    verification: string
}
interface IssueField {
    id: number
    name: string
    dataType: string
    options?: Array<{ id: number; name: string; description?: string; color: string; priority?: number }>
}
interface RepositoryDetails {
    id: string
    owner: string
    repo: string
    ownerType: "user" | "org"
}
interface RepositoryLabel {
    name: string
    color: string
    description: string
}

interface ProjectFieldDefinition {
    name: string
    dataType: "SINGLE_SELECT" | "TEXT"
    options?: Static<typeof OptionSchema>[]
}
type ProjectFieldAction = { description: string } & (
    | {
          kind: "update-native-status"
          details: {
              existing: ProjectField
              desired: ProjectFieldDefinition
              verification: "exact" | "compatible"
          }
      }
    | { kind: "create-project-field"; details: ProjectFieldDefinition }
)
type OrganizationAction = { description: string } & {
    kind: "create-issue-field"
    details: ReturnType<typeof desiredOrganizationFields>[number]
}
type ProvisioningAction =
    | ProjectFieldAction
    | OrganizationAction
    | { kind: "configure-initial-view"; description: string; details: DesiredView }
    | {
          kind: "create-board-view"
          description: string
          details: { view: DesiredView; columns: string; priority: string; optionOrder: string[] }
      }
    | {
          kind: "delete-created-default-view"
          description: string
          details: { only: "captured-unchanged-default"; after: "verified-board" }
      }
    | { kind: "update-project-view"; description: string; details: { current: ProjectView; desired: DesiredView } }
    | ({ description: string } & (
          | {
                kind: "create-project"
                details: Extract<GitHubProjectSpecification["project"], { mode: "new" }> & {
                    owner: Static<typeof ProjectOwnerSchema>
                }
            }
          | { kind: "configure-native-status"; details: ProjectFieldDefinition }
          | { kind: "create-repository-label"; details: Static<typeof RepositoryLabelSchema> }
          | { kind: "set-project-visibility"; details: { visibility: "private" | "public" } }
          | {
                kind: "associate-repository" | "remove-repository-association"
                details: Static<typeof RepositorySchema> | { repositoryId: string; associated: boolean }
            }
      ))

interface GitHubProjectPlan {
    state: "ready" | "blocked"
    specification: GitHubProjectSpecification
    project?: ProjectSummary
    candidates?: ProjectSummary[]
    actions: ProvisioningAction[]
    conflicts: string[]
    manualSteps: ManualStep[]
    trackerConfig?: Record<string, unknown>
    planHash: string
}

export interface GitHubProjectSetupOptions {
    fetch?: typeof fetch
    env?: NodeJS.ProcessEnv
    signal?: AbortSignal
}

export async function runGitHubProjectSetup(
    rawInput: unknown,
    options: GitHubProjectSetupOptions = {},
): Promise<Record<string, unknown>> {
    const input = Value.Parse(GitHubProjectSetupToolSchema, rawInput)
    if (input.operation === "inspectRepository") {
        const repository = await clientFor(input.credentialEnv, options).getRepository(input.repository)
        return {
            repository: { owner: repository.owner, repo: repository.repo, ownerType: repository.ownerType },
            suggestedProjectTitle: repository.repo,
        }
    }
    if (input.operation === "inspect") {
        const client = clientFor(input.credentialEnv, options)
        const [repository, owner] = await Promise.all([
            client.getRepository(input.repository),
            client.listOwnerProjects(input.projectOwner),
        ])
        const organizationMetadata =
            input.includeOrganizationMetadata && repository.ownerType === "org"
                ? { issueFields: await client.listIssueFields(input.repository.owner) }
                : undefined
        return {
            repository: { owner: repository.owner, repo: repository.repo, ownerType: repository.ownerType },
            suggestedProjectTitle: repository.repo,
            projectOwner: input.projectOwner,
            projects: owner.projects,
            ...(organizationMetadata ? { organizationMetadata } : {}),
            defaults: GITHUB_PROJECT_DEFAULTS,
        }
    }

    if (input.operation === "inspectProject") {
        const client = clientFor(input.credentialEnv, options)
        const owner = await client.listOwnerProjects(input.projectOwner)
        const selected = owner.projects.find((project) => project.number === input.projectNumber)
        if (!selected) throw new Error(`Project ${input.projectNumber} is not owned by ${input.projectOwner.login}`)
        return {
            project: await client.getProject(selected.id),
            views: await client.listProjectViews(selected.id),
            unavailableSettings: ["defaultRepository", "fieldSum", "sliceBy"],
            defaults: GITHUB_PROJECT_DEFAULTS,
        }
    }

    const specification = Value.Parse(GitHubProjectSpecificationSchema, input.specification)
    const client = clientFor(specification.credentialEnv, options)
    const plan = await previewGitHubProject(specification, client)
    if (input.operation === "preview") return plan as unknown as Record<string, unknown>
    if (plan.planHash !== input.approvedPlanHash) {
        throw new Error("GitHub Project provisioning changed after approval; preview and approve the new exact plan")
    }
    if (plan.state !== "ready") throw new Error(`GitHub Project provisioning is blocked: ${plan.conflicts.join("; ")}`)
    return applyGitHubProject(specification, client, plan)
}

class GitHubClient {
    readonly fetchImpl: typeof fetch
    readonly token: string
    readonly signal?: AbortSignal

    constructor(fetchImpl: typeof fetch, token: string, signal?: AbortSignal) {
        this.fetchImpl = fetchImpl
        this.token = token
        this.signal = signal
    }

    async getRepository(repository: Static<typeof RepositorySchema>): Promise<RepositoryDetails> {
        const result = record(
            await this.rest(
                "GET",
                `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`,
            ),
            "repository",
        )
        const owner = record(result.owner, "repository owner")
        if (owner.type !== "Organization" && owner.type !== "User") throw new Error("unsupported repository owner type")
        return {
            id: text(result.node_id, "repository node_id"),
            owner: text(owner.login, "repository owner login"),
            repo: text(result.name, "repository name"),
            ownerType: owner.type === "Organization" ? "org" : "user",
        }
    }

    async listOwnerProjects(
        owner: Static<typeof ProjectOwnerSchema>,
    ): Promise<{ ownerId: string; projects: ProjectSummary[] }> {
        let after: string | null = null
        let ownerId = ""
        const projects: ProjectSummary[] = []
        do {
            const root = owner.type === "org" ? "organization" : "user"
            const data = await this.graphql(
                `query($login: String!, $after: String) {
                    ${root}(login: $login) {
                        id
                        projectsV2(first: 50, after: $after) {
                            nodes { id number title url public closed }
                            pageInfo { hasNextPage endCursor }
                        }
                    }
                }`,
                { login: owner.login, after },
            )
            const ownerData = record(data[root], `${owner.type} ${owner.login}`)
            ownerId ||= text(ownerData.id, "project owner id")
            const connection = record(ownerData.projectsV2, "projectsV2")
            for (const node of array(connection.nodes, "projectsV2 nodes")) projects.push(projectSummary(node))
            const pageInfo = record(connection.pageInfo, "projectsV2 pageInfo")
            after = pageInfo.hasNextPage === true ? text(pageInfo.endCursor, "projectsV2 endCursor") : null
        } while (after)
        return { ownerId, projects }
    }

    async getProject(id: string): Promise<ProjectDetails> {
        const fields: ProjectField[] = []
        let after: string | null = null
        let summary: ProjectSummary | undefined
        let itemCount = 0
        do {
            const data = await this.graphql(
                `query($id: ID!, $after: String) {
                    node(id: $id) {
                        ... on ProjectV2 {
                            id number title url public closed
                            items(first: 1) { totalCount }
                            fields(first: 50, after: $after) {
                                nodes {
                                    __typename
                                    ... on ProjectV2FieldCommon { id name dataType isIssueField }
                                    ... on ProjectV2Field { databaseId }
                                    ... on ProjectV2IterationField { databaseId }
                                    ... on ProjectV2SingleSelectField {
                                        databaseId
                                        options { id name description color }
                                    }
                                }
                                pageInfo { hasNextPage endCursor }
                            }
                        }
                    }
                }`,
                { id, after },
            )
            const node = record(data.node, `Project ${id}`)
            summary ??= projectSummary(node)
            itemCount = number(record(node.items, "project items").totalCount, "project item count")
            const connection = record(node.fields, "project fields")
            for (const rawField of array(connection.nodes, "project field nodes")) {
                const field = record(rawField, "project field")
                if (field.__typename === "ProjectV2Repository" || field.__typename === "ProjectV2Milestone") continue
                if (typeof field.isIssueField !== "boolean") throw new Error("invalid Project field origin")
                fields.push({
                    databaseId: typeof field.databaseId === "number" ? field.databaseId : null,
                    isIssueField: field.isIssueField,
                    id: text(field.id, "project field id"),
                    name: text(field.name, "project field name"),
                    dataType: text(field.dataType, "project field dataType"),
                    ...(Array.isArray(field.options)
                        ? {
                              options: field.options.map((rawOption) => {
                                  const option = record(rawOption, "project field option")
                                  return {
                                      id: text(option.id, "project option id"),
                                      name: text(option.name, "project option name"),
                                      description: typeof option.description === "string" ? option.description : "",
                                      color: text(option.color, "project option color").toLowerCase(),
                                  }
                              }),
                          }
                        : {}),
                })
            }
            const pageInfo = record(connection.pageInfo, "project fields pageInfo")
            after = pageInfo.hasNextPage === true ? text(pageInfo.endCursor, "project fields endCursor") : null
        } while (after)

        const repositoryIds: string[] = []
        let repositoryAfter: string | null = null
        do {
            const data = await this.graphql(
                `query($id: ID!, $after: String) {
                    node(id: $id) {
                        ... on ProjectV2 {
                            repositories(first: 50, after: $after) {
                                nodes { id }
                                pageInfo { hasNextPage endCursor }
                            }
                        }
                    }
                }`,
                { id, after: repositoryAfter },
            )
            const node = record(data.node, `Project ${id}`)
            const connection = record(node.repositories, "Project repositories")
            for (const rawRepository of array(connection.nodes, "Project repository nodes")) {
                repositoryIds.push(text(record(rawRepository, "Project repository").id, "Project repository id"))
            }
            const pageInfo = record(connection.pageInfo, "Project repositories pageInfo")
            repositoryAfter =
                pageInfo.hasNextPage === true ? text(pageInfo.endCursor, "Project repositories endCursor") : null
        } while (repositoryAfter)

        return { ...summary!, itemCount, fields, repositoryIds }
    }

    async listProjectViews(projectId: string): Promise<ProjectView[]> {
        const ids: string[] = []
        let after: string | null = null
        do {
            const data = await this.graphql(
                `query($projectId: ID!, $after: String) {
                    node(id: $projectId) { ... on ProjectV2 {
                        views(first: 50, after: $after) {
                            nodes { id }
                            pageInfo { hasNextPage endCursor }
                        }
                    } }
                }`,
                { projectId, after },
            )
            const connection = record(record(data.node, "Project").views, "Project views")
            for (const node of array(connection.nodes, "view nodes")) ids.push(text(record(node, "view").id, "view id"))
            const page = record(connection.pageInfo, "views pageInfo")
            after = page.hasNextPage === true ? text(page.endCursor, "views endCursor") : null
        } while (after)
        return Promise.all(ids.map((id) => this.getProjectView(id, projectId)))
    }

    private async getProjectView(id: string, projectId: string): Promise<ProjectView> {
        const keys = ["visible", "groups", "columns", "sorts"] as const
        const cursors: Record<(typeof keys)[number], string | null> = {
            visible: null,
            groups: null,
            columns: null,
            sorts: null,
        }
        const nodes: Record<(typeof keys)[number], unknown[]> = { visible: [], groups: [], columns: [], sorts: [] }
        const finished = new Set<string>()
        let view: Record<string, unknown>
        do {
            const data = await this.graphql(
                `query($viewId: ID!, $visible: String, $groups: String, $columns: String, $sorts: String) {
                    node(id: $viewId) { ... on ProjectV2View {
                        id number name layout filter project { id }
                        configuration { visibleFields(first: 50, after: $visible) {
                            nodes { ... on ProjectV2FieldCommon { id name } }
                            pageInfo { hasNextPage endCursor }
                        } }
                        groupByFields(first: 50, after: $groups) {
                            nodes { ... on ProjectV2FieldCommon { id name } }
                            pageInfo { hasNextPage endCursor }
                        }
                        verticalGroupByFields(first: 50, after: $columns) {
                            nodes { ... on ProjectV2FieldCommon { id name } }
                            pageInfo { hasNextPage endCursor }
                        }
                        sortByFields(first: 50, after: $sorts) {
                            nodes { direction field { ... on ProjectV2FieldCommon { id name } } }
                            pageInfo { hasNextPage endCursor }
                        }
                    } }
                }`,
                { viewId: id, ...cursors },
            )
            view = record(data.node, `Project view ${id}`)
            if (text(record(view.project, "view Project").id, "view Project id") !== projectId) {
                throw new Error(`View ${id} does not belong to Project ${projectId}`)
            }
            const connections = {
                visible: record(view.configuration, "view configuration").visibleFields,
                groups: view.groupByFields,
                columns: view.verticalGroupByFields,
                sorts: view.sortByFields,
            }
            for (const key of keys) {
                if (finished.has(key)) continue
                const connection = record(connections[key], `view ${key}`)
                nodes[key].push(...array(connection.nodes, `view ${key} nodes`))
                const page = record(connection.pageInfo, `view ${key} pageInfo`)
                if (page.hasNextPage === true) cursors[key] = text(page.endCursor, `view ${key} endCursor`)
                else finished.add(key)
            }
        } while (finished.size < keys.length)
        const field = (raw: unknown) => {
            const value = record(raw, "view field")
            return { id: text(value.id, "view field id"), name: text(value.name, "view field name") }
        }
        return {
            id: text(view.id, "view id"),
            number: number(view.number, "view number"),
            name: text(view.name, "view name"),
            layout: Value.Parse(
                LayoutSchema,
                text(view.layout, "view layout")
                    .replace(/_LAYOUT$/, "")
                    .toLowerCase(),
            ),
            filter: typeof view.filter === "string" ? view.filter : null,
            visibleFieldIds: nodes.visible.map((node) => field(node).id),
            groupBy: nodes.groups.map(field),
            verticalGroupBy: nodes.columns.map(field),
            sortBy: nodes.sorts.map((raw) => {
                const sort = record(raw, "view sort")
                return { field: field(sort.field), direction: text(sort.direction, "sort direction") }
            }),
        }
    }

    async createProjectView(projectId: string, desired: DesiredView, visibleFieldIds: string[]): Promise<string> {
        const data = await this.graphql(
            `mutation($input: CreateProjectV2ViewInput!) {
                createProjectV2View(input: $input) { projectV2View { id } }
            }`,
            {
                input: {
                    projectId,
                    name: desired.name,
                    layout: `${desired.layout.toUpperCase()}_LAYOUT`,
                    configuration: { visibleFieldIds },
                },
            },
        )
        return text(
            record(record(data.createProjectV2View, "createProjectV2View").projectV2View, "created view").id,
            "created view id",
        )
    }

    async updateProjectView(viewId: string, desired: DesiredView, visibleFieldIds: string[]): Promise<void> {
        await this.graphql(
            `mutation($input: UpdateProjectV2ViewInput!) {
                updateProjectV2View(input: $input) { projectV2View { id } }
            }`,
            {
                input: {
                    viewId,
                    name: desired.name,
                    layout: `${desired.layout.toUpperCase()}_LAYOUT`,
                    configuration: { visibleFieldIds },
                },
            },
        )
    }

    async createBoardView(
        owner: Static<typeof ProjectOwnerSchema>,
        project: ProjectDetails,
        configuration: BoardConfiguration,
    ): Promise<string> {
        let route: string
        if (owner.type === "org") route = `/orgs/${encodeURIComponent(owner.login)}`
        else {
            const user = record(await this.rest("GET", `/users/${encodeURIComponent(owner.login)}`), "Project owner")
            route = `/users/${databaseId(user.id, "Project owner")}`
        }
        const numericId = (id: string) =>
            databaseId(project.fields.find((field) => field.id === id)?.databaseId, "Project field")
        const result = record(
            await this.rest("POST", `${route}/projectsV2/${project.number}/views`, {
                name: configuration.view.name,
                layout: "board",
                visible_fields: configuration.visibleIds.map(numericId),
                vertical_group_by: [numericId(configuration.columnId)],
                group_by: [],
                sort_by: [[numericId(configuration.priorityId), configuration.direction]],
            }),
            "created Board response",
        )
        return text(record(result.value, "created Board").node_id, "created Board node_id")
    }

    async deleteProjectView(viewId: string): Promise<void> {
        await this.graphql(
            `mutation($viewId: ID!) {
                deleteProjectV2View(input: { viewId: $viewId }) { projectV2View { id } }
            }`,
            { viewId },
        )
    }

    async createProject(
        ownerId: string,
        title: string,
        repositoryId: string | undefined,
    ): Promise<{ project: ProjectSummary; initialViewIds: string[] }> {
        const data = await this.graphql(
            `mutation($ownerId: ID!, $title: String!, $repositoryId: ID) {
                createProjectV2(input: { ownerId: $ownerId, title: $title, repositoryId: $repositoryId }) {
                    projectV2 { id number title url public closed
                        views(first: 50) { nodes { id } pageInfo { hasNextPage } }
                    }
                }
            }`,
            { ownerId, title, repositoryId: repositoryId ?? null },
        )
        const created = record(record(data.createProjectV2, "createProjectV2").projectV2, "created Project")
        const views = record(created.views, "created Project views")
        if (record(views.pageInfo, "created views pageInfo").hasNextPage !== false)
            throw new Error("created Project initial views require explicit inspection")
        return {
            project: projectSummary(created),
            initialViewIds: array(views.nodes, "created view nodes").map((node) =>
                text(record(node, "created view").id, "created view id"),
            ),
        }
    }

    async setProjectVisibility(projectId: string, visible: boolean): Promise<void> {
        await this.graphql(
            `mutation($projectId: ID!, $public: Boolean!) {
                updateProjectV2(input: { projectId: $projectId, public: $public }) { projectV2 { id } }
            }`,
            { projectId, public: visible },
        )
    }

    async setRepositoryAssociation(projectId: string, repositoryId: string, associated: boolean): Promise<void> {
        if (associated) {
            await this.graphql(
                `mutation($projectId: ID!, $repositoryId: ID!) {
                    linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
                        repository { id }
                    }
                }`,
                { projectId, repositoryId },
            )
            return
        }
        await this.graphql(
            `mutation($projectId: ID!, $repositoryId: ID!) {
                unlinkProjectV2FromRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
                    repository { id }
                }
            }`,
            { projectId, repositoryId },
        )
    }

    async updateNativeStatus(existing: ProjectField, desired: ProjectFieldDefinition): Promise<void> {
        const existingOptions = new Map((existing.options ?? []).map((option) => [option.name, option]))
        await this.graphql(
            `mutation($fieldId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
                updateProjectV2Field(input: {
                    fieldId: $fieldId,
                    name: $name,
                    singleSelectOptions: $options
                }) { projectV2Field { ... on ProjectV2FieldCommon { id } } }
            }`,
            {
                fieldId: existing.id,
                name: desired.name,
                options: (desired.options ?? []).map((option) => ({
                    ...(existingOptions.get(option.name)?.id ? { id: existingOptions.get(option.name)!.id } : {}),
                    name: option.name,
                    description: option.description,
                    color: option.color.toUpperCase(),
                })),
            },
        )
    }

    async createProjectField(projectId: string, definition: ProjectFieldDefinition): Promise<void> {
        await this.graphql(
            `mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
                createProjectV2Field(input: {
                    projectId: $projectId,
                    name: $name,
                    dataType: $dataType,
                    singleSelectOptions: $options
                }) { projectV2Field { ... on ProjectV2FieldCommon { id } } }
            }`,
            {
                projectId,
                name: definition.name,
                dataType: definition.dataType,
                options:
                    definition.options?.map((option) => ({
                        name: option.name,
                        description: option.description,
                        color: option.color.toUpperCase(),
                    })) ?? null,
            },
        )
    }

    async getRepositoryLabel(
        repository: Static<typeof RepositorySchema>,
        name: string,
    ): Promise<RepositoryLabel | undefined> {
        const result = await this.rest(
            "GET",
            `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/labels/${encodeURIComponent(name)}`,
            undefined,
            true,
        )
        return result === undefined ? undefined : repositoryLabel(result)
    }

    async createRepositoryLabel(
        repository: Static<typeof RepositorySchema>,
        label: Static<typeof RepositoryLabelSchema>,
    ): Promise<void> {
        await this.rest(
            "POST",
            `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/labels`,
            {
                name: label.name,
                color: label.color.slice(1),
                description: label.description,
            },
        )
    }

    async listIssueFields(organization: string): Promise<IssueField[]> {
        const result = await this.rest("GET", `/orgs/${encodeURIComponent(organization)}/issue-fields`)
        return array(result, "organization issue fields").map((rawField) => {
            const field = record(rawField, "organization issue field")
            return {
                id: number(field.id, "issue field id"),
                name: text(field.name, "issue field name"),
                dataType: text(field.data_type, "issue field data_type"),
                ...(Array.isArray(field.options)
                    ? {
                          options: field.options.map((rawOption) => {
                              const option = record(rawOption, "issue field option")
                              return {
                                  id: number(option.id, "issue field option id"),
                                  name: text(option.name, "issue field option name"),
                                  description: typeof option.description === "string" ? option.description : undefined,
                                  color: text(option.color, "issue field option color"),
                                  priority: typeof option.priority === "number" ? option.priority : undefined,
                              }
                          }),
                      }
                    : {}),
            }
        })
    }

    async createIssueField(
        organization: string,
        field: {
            name: string
            dataType: "text" | "single_select"
            visibility: string
            options?: Static<typeof OptionSchema>[]
        },
    ): Promise<void> {
        await this.rest("POST", `/orgs/${encodeURIComponent(organization)}/issue-fields`, {
            name: field.name,
            description: `Workflow ${field.name}`,
            data_type: field.dataType,
            visibility: field.visibility,
            ...(field.options
                ? {
                      options: field.options.map((option, index) => ({
                          name: option.name,
                          description: option.description,
                          color: option.color,
                          priority: index + 1,
                      })),
                  }
                : {}),
        })
    }

    private async graphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
        const response = await this.fetchImpl("https://api.github.com/graphql", {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ query, variables }),
            signal: this.signal,
        })
        const result = await responseJson(response)
        if (!response.ok) throw githubError(response.status, result)
        const root = record(result, "GitHub GraphQL response")
        if (Array.isArray(root.errors) && root.errors.length > 0) {
            const messages = root.errors.map((error) => String(record(error, "GraphQL error").message)).join("; ")
            throw new Error(`GitHub GraphQL failed: ${messages}`)
        }
        return record(root.data, "GitHub GraphQL data")
    }

    private async rest(
        method: string,
        pathname: string,
        body?: Record<string, unknown>,
        allowNotFound = false,
    ): Promise<unknown> {
        const response = await this.fetchImpl(`https://api.github.com${pathname}`, {
            method,
            headers: this.headers(),
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: this.signal,
        })
        const result = response.status === 204 ? null : await responseJson(response)
        if (allowNotFound && response.status === 404) return undefined
        if (!response.ok) throw githubError(response.status, result)
        return result
    }

    private headers(): Record<string, string> {
        return {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2026-03-10",
        }
    }
}

function clientFor(credentialEnv: string, options: GitHubProjectSetupOptions): GitHubClient {
    const token = (options.env ?? process.env)[credentialEnv]
    if (!token) throw new Error(`environment variable ${credentialEnv} is not set`)
    return new GitHubClient(options.fetch ?? fetch, token, options.signal)
}

async function previewGitHubProject(
    specification: GitHubProjectSpecification,
    client: GitHubClient,
): Promise<GitHubProjectPlan> {
    assertSpecification(specification)
    const [repository, owner] = await Promise.all([
        client.getRepository(specification.repository),
        client.listOwnerProjects(specification.projectOwner),
    ])
    const actions: ProvisioningAction[] = []
    const conflicts: string[] = []
    let project: ProjectDetails | undefined
    let candidates: ProjectSummary[] | undefined
    let view: ProjectView | undefined

    if (!specification.project.associateRepository && specification.defaultRepository === "setup-repository") {
        conflicts.push(
            "setting the default repository also links it; enable association or leave the default repository unmanaged",
        )
    }

    if (specification.project.mode === "new") {
        const projectSource = specification.project
        candidates = owner.projects.filter((candidate) => candidate.title === projectSource.title)
        if (candidates.length > 0) {
            conflicts.push("one or more exact-title Projects already exist; select one explicitly before provisioning")
        } else {
            actions.push({
                kind: "create-project",
                description: `Create ${projectSource.visibility} Project ${JSON.stringify(projectSource.title)} owned by ${specification.projectOwner.type} ${specification.projectOwner.login}`,
                details: { ...projectSource, owner: specification.projectOwner },
            })
            if (projectSource.associateRepository) {
                actions.push({
                    kind: "associate-repository",
                    description: `Associate repository ${specification.repository.owner}/${specification.repository.repo}`,
                    details: specification.repository,
                })
            }
            actions.push({
                kind: "configure-native-status",
                description: `Update the new empty Project's native Status in place as ${JSON.stringify(specification.fields.status.field)} with the complete configured options`,
                details: desiredProjectFields(specification)[0],
            })
        }
    } else {
        const projectSource = specification.project
        const selected = owner.projects.find((candidate) => candidate.number === projectSource.number)
        if (!selected)
            conflicts.push(`Project ${projectSource.number} is not owned by ${specification.projectOwner.login}`)
        else {
            project = await client.getProject(selected.id)
            planProjectSettings(projectSource, project, repository, actions)
            planProjectFields(
                specification,
                project,
                specification.project.mode === "resume-created",
                actions,
                conflicts,
            )
            const orderConflict = projectPrioritySortConflict(specification, project.fields)
            if (orderConflict) conflicts.push(orderConflict)
        }
    }

    await planRepositoryLabel(specification, client, actions, conflicts)
    await planOrganizationMetadata(specification, repository, client, actions, conflicts)
    if (specification.project.mode === "new" && conflicts.length === 0) {
        for (const field of desiredProjectFields(specification)) {
            if (field.name === specification.fields.status.field) continue
            actions.push({
                kind: "create-project-field",
                description: describeProjectField(field),
                details: field,
            })
        }
    }

    const desired = desiredView(specification)
    if (specification.project.mode === "new" && conflicts.length === 0) {
        if (isFreshBoard(specification)) {
            actions.push(
                {
                    kind: "create-board-view",
                    description: `Create Board ${JSON.stringify(desired.name)} through REST with visible fields ${desired.fields.map((field) => field.name).join(", ")}; columns: ${specification.fields.status.field}; no swimlanes; sole sort: ${specification.fields.priority.field}, ${specification.fields.priority.options.map((option) => option.name).join(" → ")}`,
                    details: {
                        view: desired,
                        columns: specification.fields.status.field,
                        priority: specification.fields.priority.field,
                        optionOrder: specification.fields.priority.options.map((option) => option.name),
                    },
                },
                {
                    kind: "delete-created-default-view",
                    description:
                        "After verifying the new Board, delete only the captured, unchanged automatically generated default view of this newly created empty Project; preserve all other views",
                    details: { only: "captured-unchanged-default", after: "verified-board" },
                },
            )
        } else
            actions.push({
                kind: "configure-initial-view",
                description: `Configure the unique initial view, or create one when absent, as ${JSON.stringify(desired.name)} (${desired.layout}) with visible fields ${desired.fields.map((field) => field.name).join(", ")}`,
                details: desired,
            })
    } else if (project && specification.presentation.target.mode === "selected") {
        const target = specification.presentation.target
        view = (await client.listProjectViews(project.id)).find((candidate) => candidate.id === target.viewId)
        if (!view) conflicts.push("selected view is missing or does not belong to the selected Project")
        else {
            const pendingNames = actions.flatMap((action) =>
                action.kind === "create-project-field"
                    ? [action.details.name]
                    : action.kind === "update-native-status"
                      ? [action.details.desired.name]
                      : [],
            )
            try {
                const ids = resolveViewFields(desired, project.fields, pendingNames)
                if (!matchesView(view, desired, ids)) {
                    actions.push({
                        kind: "update-project-view",
                        description: `Update view ${view.id} from ${JSON.stringify(view.name)} (${view.layout}) to ${JSON.stringify(desired.name)} (${desired.layout}); visible fields: ${desired.fields.map((field) => field.name).join(", ")}`,
                        details: { current: view, desired },
                    })
                }
            } catch (error) {
                conflicts.push(error instanceof Error ? error.message : String(error))
            }
        }
    }

    const trackerConfig =
        conflicts.length === 0 && project
            ? trackerConfigFor(specification, project.number)
            : specification.project.mode === "new" && conflicts.length === 0
              ? undefined
              : undefined
    const unsigned = {
        state: conflicts.length === 0 ? ("ready" as const) : ("blocked" as const),
        specification,
        ...(project ? { project: projectSummary(project) } : {}),
        ...(candidates && candidates.length > 0 ? { candidates } : {}),
        ...(view ? { view } : {}),
        actions,
        conflicts,
        manualSteps: manualStepsFor(specification),
        ...(trackerConfig ? { trackerConfig } : {}),
    }
    return { ...unsigned, planHash: hash(unsigned) }
}

function planProjectSettings(
    source: GitHubProjectSpecification["project"],
    project: ProjectDetails,
    repository: RepositoryDetails,
    actions: ProvisioningAction[],
): void {
    const desiredPublic = source.visibility === "public"
    if (project.public !== desiredPublic) {
        actions.push({
            kind: "set-project-visibility",
            description: `Change Project visibility to ${source.visibility}`,
            details: { visibility: source.visibility },
        })
    }
    const associated = project.repositoryIds.includes(repository.id)
    if (associated !== source.associateRepository) {
        actions.push({
            kind: source.associateRepository ? "associate-repository" : "remove-repository-association",
            description: `${source.associateRepository ? "Associate" : "Remove association with"} repository ${repository.id}`,
            details: { repositoryId: repository.id, associated: source.associateRepository },
        })
    }
}

function planProjectFields(
    specification: GitHubProjectSpecification,
    project: ProjectDetails,
    allowStatusReplacement: boolean,
    actions: ProvisioningAction[],
    conflicts: string[],
): void {
    for (const desired of desiredProjectFields(specification)) {
        const decision = planProjectField(
            desired,
            specification.fields.status.field,
            project,
            allowStatusReplacement,
            specification.fields.status.options.canceled,
        )
        actions.push(...decision.actions)
        conflicts.push(...decision.conflicts)
    }
}

function planProjectField(
    desired: ProjectFieldDefinition,
    statusField: string,
    project: ProjectDetails,
    allowStatusUpdate: boolean,
    canceledStatus: Static<typeof OptionSchema>,
) {
    const actions: ProjectFieldAction[] = []
    const conflicts: string[] = []
    if (desired.name === statusField) {
        const configured = project.fields.filter((field) => field.name === desired.name)
        if (configured.length > 1) {
            conflicts.push(`Project has multiple fields named ${JSON.stringify(desired.name)}`)
            return { actions, conflicts }
        }
        const existing = configured[0] ?? project.fields.find((field) => field.name === "Status")
        if (!existing) {
            conflicts.push("Project native Status field is missing")
        } else if (!compatibleProjectField(existing, desired)) {
            const additive = additiveCanceledStatus(existing, desired, canceledStatus)
            if (additive) {
                actions.push({
                    kind: "update-native-status",
                    description: `Append Status option ${JSON.stringify(canceledStatus.name)} to native Status field ${existing.id}`,
                    details: { existing, desired: additive, verification: "compatible" },
                })
            } else if (!allowStatusUpdate || project.itemCount > 0) {
                conflicts.push(`Project field ${JSON.stringify(existing.name)} has incompatible type or options`)
            } else if (existing.dataType.toUpperCase() !== "SINGLE_SELECT") {
                conflicts.push("Project native Status field is not a single-select field")
            } else {
                actions.push({
                    kind: "update-native-status",
                    description: `Update native Status field ${existing.id} in place as ${JSON.stringify(desired.name)} with the complete configured options`,
                    details: { existing, desired, verification: "exact" },
                })
            }
        }
        return { actions, conflicts }
    }

    const existing = project.fields.filter((field) => field.name === desired.name)
    if (existing.length > 1) {
        conflicts.push(`Project has multiple fields named ${JSON.stringify(desired.name)}`)
    } else if (existing.length === 0) {
        actions.push({
            kind: "create-project-field",
            description: describeProjectField(desired),
            details: desired,
        })
    } else if (!compatibleProjectField(existing[0], desired)) {
        conflicts.push(`Project field ${JSON.stringify(desired.name)} has incompatible type or options`)
    }
    return { actions, conflicts }
}

function desiredRepositoryLabels(specification: GitHubProjectSpecification) {
    return [specification.labels.kind.epic, ...Object.values(specification.labels.kind.deliverableKinds)]
}

async function planRepositoryLabel(
    specification: GitHubProjectSpecification,
    client: GitHubClient,
    actions: ProvisioningAction[],
    conflicts: string[],
): Promise<void> {
    for (const desired of desiredRepositoryLabels(specification)) {
        const existing = await client.getRepositoryLabel(specification.repository, desired.name)
        if (!existing) {
            actions.push({
                kind: "create-repository-label",
                description: `Create repository label ${JSON.stringify(desired.name)} with color ${desired.color} and description ${JSON.stringify(desired.description)}`,
                details: desired,
            })
        } else if (!compatibleRepositoryLabel(existing, desired)) {
            conflicts.push(`repository label ${JSON.stringify(desired.name)} has incompatible color or description`)
        }
    }
}

function desiredOrganizationFields(specification: GitHubProjectSpecification) {
    return [
        ...(specification.fields.priority.scope === "issue"
            ? [
                  {
                      name: specification.fields.priority.field,
                      dataType: "single_select" as const,
                      options: specification.fields.priority.options,
                      visibility: specification.fields.priority.visibility,
                      provisionMissing: specification.fields.priority.provisionMissing,
                  },
              ]
            : []),
        ...(specification.fields.internalId.scope === "issue"
            ? [
                  {
                      name: specification.fields.internalId.field,
                      dataType: "text" as const,
                      visibility: specification.fields.internalId.visibility,
                      provisionMissing: specification.fields.internalId.provisionMissing,
                  },
              ]
            : []),
    ]
}

function planOrganizationField(desired: ReturnType<typeof desiredOrganizationFields>[number], existing: IssueField[]) {
    const actions: OrganizationAction[] = []
    const conflicts: string[] = []
    const matching = existing.filter((field) => field.name === desired.name)
    if (matching.length > 1)
        conflicts.push(`organization has multiple issue fields named ${JSON.stringify(desired.name)}`)
    else if (matching.length === 0) {
        if (desired.provisionMissing)
            actions.push({
                kind: "create-issue-field",
                description: `Create organization issue field ${JSON.stringify(desired.name)} (${desired.dataType})`,
                details: desired,
            })
        else conflicts.push(`organization issue field ${JSON.stringify(desired.name)} is missing`)
    } else if (
        !compatibleIssueField(matching[0], desired.dataType, "options" in desired ? desired.options : undefined)
    ) {
        conflicts.push(`organization issue field ${JSON.stringify(desired.name)} has incompatible type or options`)
    } else if (desired.dataType === "single_select") {
        const requestedNames = new Set(desired.options.map((option) => option.name))
        const options = matching[0].options!.filter((option) => requestedNames.has(option.name))
        const ranks = options.map((option) => option.priority)
        if (ranks.includes(undefined) || new Set(ranks).size !== ranks.length) {
            conflicts.push(
                `cannot verify organization Priority order for ${JSON.stringify(desired.name)}: saved option priorities are missing or ambiguous; inspect and correct the organization Issue Field settings before approval`,
            )
        } else {
            const saved = [...options]
                .sort((left, right) => left.priority! - right.priority!)
                .map((option) => option.name)
            const orderConflict = priorityOrderConflict(
                { field: desired.name, scope: "issue", options: desired.options },
                saved,
            )
            if (orderConflict) conflicts.push(orderConflict)
        }
    }
    return { actions, conflicts }
}

async function planOrganizationMetadata(
    specification: GitHubProjectSpecification,
    repository: RepositoryDetails,
    client: GitHubClient,
    actions: ProvisioningAction[],
    conflicts: string[],
): Promise<void> {
    const desiredFields = desiredOrganizationFields(specification)
    if (desiredFields.length === 0) return
    if (repository.ownerType !== "org") {
        conflicts.push("issue-scoped fields require a repository owned by an organization")
        return
    }
    const existingFields = await client.listIssueFields(specification.repository.owner)
    for (const desired of desiredFields) {
        const decision = planOrganizationField(desired, existingFields)
        actions.push(...decision.actions)
        conflicts.push(...decision.conflicts)
    }
}

async function applyGitHubProject(
    specification: GitHubProjectSpecification,
    client: GitHubClient,
    approvedPlan: GitHubProjectPlan,
): Promise<Record<string, unknown>> {
    const repository = await client.getRepository(specification.repository)
    const owner = await client.listOwnerProjects(specification.projectOwner)
    let project: ProjectDetails
    let initialViews: ProjectView[] = []
    if (specification.project.mode === "new") {
        const projectSource = specification.project
        let created: ProjectSummary
        let initialViewIds: string[] = []
        try {
            const creation = await client.createProject(
                owner.ownerId,
                projectSource.title,
                projectSource.associateRepository ? repository.id : undefined,
            )
            created = creation.project
            initialViewIds = creation.initialViewIds
        } catch (error) {
            const candidates = (await client.listOwnerProjects(specification.projectOwner)).projects.filter(
                (candidate) => candidate.title === projectSource.title,
            )
            if (candidates.length === 1) {
                if (isFreshBoard(specification))
                    throw new Error(
                        `Project creation response was uncertain; inspect ${candidates[0].url} and select it as resume-created. Default-view provenance is unavailable; no views were deleted.`,
                        { cause: error },
                    )
                created = candidates[0]
            } else if (candidates.length === 0) throw error
            else {
                throw new Error(
                    `GitHub Project creation could not be reconciled because multiple exact-title Projects exist: ${candidates.map((candidate) => `${candidate.number} ${candidate.url}`).join(", ")}`,
                    { cause: error },
                )
            }
        }
        if (isFreshBoard(specification)) {
            if (initialViewIds.length > 1)
                throw new Error(
                    "new Project has multiple initial views; inspect and select one explicitly before resuming",
                )
            const views = await client.listProjectViews(created.id)
            initialViews = initialViewIds.map((id) => {
                const view = views.find((view) => view.id === id)
                if (!view) throw new Error("captured initial view is missing; inspect the Project before resuming")
                return view
            })
        }
        await client.setProjectVisibility(created.id, projectSource.visibility === "public")
        project = await client.getProject(created.id)
    } else {
        const projectSource = specification.project
        const selected = owner.projects.find((candidate) => candidate.number === projectSource.number)
        if (!selected) throw new Error(`Project ${projectSource.number} is no longer available`)
        project = await client.getProject(selected.id)
        if (project.public !== (projectSource.visibility === "public")) {
            await client.setProjectVisibility(project.id, projectSource.visibility === "public")
        }
        const associated = project.repositoryIds.includes(repository.id)
        if (associated !== projectSource.associateRepository) {
            await client.setRepositoryAssociation(project.id, repository.id, projectSource.associateRepository)
        }
        project = await client.getProject(project.id)
    }

    await provisionProjectFields(
        specification,
        project,
        client,
        specification.project.mode === "new" || specification.project.mode === "resume-created",
    )
    await provisionRepositoryLabel(specification, client)
    await provisionOrganizationMetadata(specification, repository, client)

    const currentProject = await client.getProject(project.id)
    const configuredView = isFreshBoard(specification)
        ? await provisionFreshBoard(specification, currentProject, initialViews, client)
        : await provisionProjectView(specification, currentProject, client)
    const verified = await client.getProject(project.id)
    const verificationActions: ProvisioningAction[] = []
    const conflicts: string[] = []
    planProjectSettings(specification.project, verified, repository, verificationActions)
    planProjectFields(specification, verified, false, verificationActions, conflicts)
    await planRepositoryLabel(specification, client, verificationActions, conflicts)
    await planOrganizationMetadata(specification, repository, client, verificationActions, conflicts)
    if (conflicts.length > 0 || verificationActions.length > 0) {
        throw new Error(
            `GitHub Project post-write verification failed: ${[...conflicts, ...verificationActions.map((action) => action.description)].join("; ")}`,
        )
    }
    return {
        state: "provisioned",
        project: projectSummary(verified),
        view: configuredView,
        verification: { api: "verified", manual: "requires-user-confirmation" },
        manualSteps: manualStepsFor(specification, `${verified.url}/views/${configuredView.number}`),
        trackerConfig: trackerConfigFor(specification, verified.number),
        approvedPlanHash: approvedPlan.planHash,
    }
}

function desiredView(specification: GitHubProjectSpecification): DesiredView {
    return {
        name: specification.presentation.name,
        layout: specification.presentation.layout,
        fields: specification.presentation.visibleFields.map((field) => {
            if (field.kind === "field") return { name: field.name, source: "any" }
            return {
                name: specification.fields[field.field].field,
                source: field.field === "priority" ? specification.fields.priority.scope : "project",
            }
        }),
    }
}

function resolveViewFields(desired: DesiredView, fields: ProjectField[], pendingNames: string[] = []): string[] {
    return desired.fields.map(({ name, source }) => {
        const matching = fields.filter(
            (field) => field.name === name && (source === "any" || field.isIssueField === (source === "issue")),
        )
        if (matching.length > 1) throw new Error(`visible field ${JSON.stringify(name)} is ambiguous on the Project`)
        if (source !== "issue" && pendingNames.includes(name)) return `pending:${name}`
        if (matching.length === 0)
            throw new Error(
                `visible field ${JSON.stringify(name)} is not exposed on the Project; expose it or explicitly change the visible-field selection`,
            )
        return matching[0].id
    })
}

function projectPrioritySortConflict(
    specification: GitHubProjectSpecification,
    fields: ProjectField[],
): string | undefined {
    const priority = specification.fields.priority
    if (priority.scope !== "project") return undefined
    const matching = fields.filter((field) => field.name === priority.field && !field.isIssueField)
    // Missing, ambiguous, and structurally incompatible fields have their own provisioning checks.
    if (matching.length !== 1 || !matching[0].options) return undefined
    return priorityOrderConflict(
        priority,
        matching[0].options.map((option) => option.name),
    )
}

function priorityOrderConflict(
    priority: Pick<GitHubProjectSpecification["fields"]["priority"], "field" | "scope" | "options">,
    savedNames: string[],
): string | undefined {
    const desired = priority.options.map((option) => option.name)
    const desiredNames = new Set(desired)
    const saved = savedNames.filter((name) => desiredNames.has(name))
    if (saved.length !== desired.length) return undefined
    const order = JSON.stringify(desired)
    if (JSON.stringify(saved) === order || JSON.stringify([...saved].reverse()) === order) return undefined
    const settings =
        priority.scope === "project"
            ? `Project Settings → ${JSON.stringify(priority.field)}`
            : `the organization Issue Field settings for ${JSON.stringify(priority.field)}`
    return `Priority option order ${saved.join(" → ")} cannot produce ${desired.join(" → ")} by changing sort direction. Open ${settings} and explicitly align the existing option order, or change the requested Priority order, then inspect and preview again. Reordering is field-wide and needs separate approval; preserve all option values.`
}

function matchesView(view: ProjectView, desired: DesiredView, ids: string[]): boolean {
    return (
        view.name === desired.name &&
        view.layout === desired.layout &&
        JSON.stringify(view.visibleFieldIds) === JSON.stringify(ids)
    )
}

interface BoardConfiguration {
    view: DesiredView
    visibleIds: string[]
    columnId: string
    priorityId: string
    direction: "asc" | "desc"
}

function isFreshBoard(specification: GitHubProjectSpecification): boolean {
    return specification.project.mode === "new" && specification.presentation.layout === "board"
}

function databaseId(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
        throw new Error(`${label} has no usable numeric database ID; inspect provider metadata before provisioning`)
    return value
}

async function boardConfiguration(
    specification: GitHubProjectSpecification,
    project: ProjectDetails,
    client: GitHubClient,
): Promise<BoardConfiguration> {
    const view = desiredView(specification)
    const priority = specification.fields.priority
    const [columnId, priorityId] = resolveViewFields(
        {
            ...view,
            fields: [
                { name: specification.fields.status.field, source: "project" },
                { name: priority.field, source: priority.scope },
            ],
        },
        project.fields,
    )
    let savedNames: string[]
    if (priority.scope === "project")
        savedNames = (project.fields.find((field) => field.id === priorityId)!.options ?? []).map(
            (option) => option.name,
        )
    else {
        const fields = await client.listIssueFields(specification.repository.owner)
        const desired = desiredOrganizationFields(specification).find((field) => field.name === priority.field)!
        const decision = planOrganizationField(desired, fields)
        if (decision.conflicts.length || decision.actions.length)
            throw new Error("cannot verify organization Priority order: " + decision.conflicts.join("; "))
        savedNames = [...fields.find((field) => field.name === priority.field)!.options!]
            .sort((left, right) => left.priority! - right.priority!)
            .map((option) => option.name)
    }
    const requested = priority.options.map((option) => option.name)
    const saved = savedNames.filter((name) => requested.includes(name))
    const conflict = priorityOrderConflict(priority, saved)
    if (conflict) throw new Error(conflict)
    if (saved.length !== requested.length)
        throw new Error("cannot verify configured Priority options before Board creation")
    return {
        view,
        visibleIds: resolveViewFields(view, project.fields),
        columnId,
        priorityId,
        direction: JSON.stringify(saved) === JSON.stringify(requested) ? "asc" : "desc",
    }
}

function matchesBoard(view: ProjectView, desired: BoardConfiguration): boolean {
    return (
        matchesView(view, desired.view, desired.visibleIds) &&
        view.groupBy.length === 0 &&
        view.verticalGroupBy.length === 1 &&
        view.verticalGroupBy[0].id === desired.columnId &&
        view.sortBy.length === 1 &&
        view.sortBy[0].field.id === desired.priorityId &&
        view.sortBy[0].direction.toLowerCase() === desired.direction
    )
}

function viewFingerprint(view: ProjectView): string {
    return JSON.stringify({
        name: view.name,
        layout: view.layout,
        filter: view.filter,
        visible: view.visibleFieldIds,
        groups: view.groupBy.map((field) => field.id),
        columns: view.verticalGroupBy.map((field) => field.id),
        sorts: view.sortBy.map((sort) => [sort.field.id, sort.direction]),
    })
}

async function provisionFreshBoard(
    specification: GitHubProjectSpecification,
    project: ProjectDetails,
    initialViews: ProjectView[],
    client: GitHubClient,
): Promise<ProjectView> {
    if (project.itemCount !== 0) throw new Error("new Project is no longer empty; inspect before creating its Board")
    const desired = await boardConfiguration(specification, project, client)
    const before = await client.listProjectViews(project.id)
    const beforeIds = new Set(before.map((view) => view.id))
    let viewId: string
    try {
        viewId = await client.createBoardView(specification.projectOwner, project, desired)
    } catch (error) {
        const recovered = (await client.listProjectViews(project.id)).filter(
            (view) => !beforeIds.has(view.id) && matchesBoard(view, desired),
        )
        if (recovered.length !== 1) throw error
        viewId = recovered[0].id
    }
    const views = await client.listProjectViews(project.id)
    const verified = views.find((view) => view.id === viewId)
    if (!verified || beforeIds.has(viewId) || !matchesBoard(verified, desired))
        throw new Error("GitHub Board post-write verification failed; default view preserved")
    if ((await client.getProject(project.id)).itemCount !== 0)
        throw new Error("new Project is no longer empty; default view preserved")
    for (const initial of initialViews) {
        const current = views.find((view) => view.id === initial.id)
        if (!current || viewFingerprint(current) !== viewFingerprint(initial))
            throw new Error("captured default view changed; inspect the Project before cleanup; no views deleted")
        try {
            await client.deleteProjectView(initial.id)
        } catch (error) {
            if ((await client.listProjectViews(project.id)).some((view) => view.id === initial.id)) throw error
        }
    }
    const after = await client.listProjectViews(project.id)
    const board = after.find((view) => view.id === viewId)
    if (
        !board ||
        !matchesBoard(board, desired) ||
        after.some((view) => initialViews.some((initial) => initial.id === view.id))
    )
        throw new Error("GitHub Board/default-view cleanup verification failed; inspect the Project before resuming")
    return board
}

async function provisionProjectView(
    specification: GitHubProjectSpecification,
    project: ProjectDetails,
    client: GitHubClient,
): Promise<ProjectView> {
    const orderConflict = projectPrioritySortConflict(specification, project.fields)
    if (orderConflict) throw new Error(orderConflict)
    const desired = desiredView(specification)
    const ids = resolveViewFields(desired, project.fields)
    const views = await client.listProjectViews(project.id)
    const target = specification.presentation.target
    let viewId: string
    if (target.mode === "selected") {
        const view = views.find((candidate) => candidate.id === target.viewId)
        if (!view) throw new Error("selected view is missing or does not belong to the selected Project")
        viewId = view.id
    } else {
        if (views.length > 1)
            throw new Error("new Project has multiple initial views; inspect and select one explicitly before resuming")
        if (views.length === 1) viewId = views[0].id
        else {
            try {
                viewId = await client.createProjectView(project.id, desired, ids)
            } catch (error) {
                const recovered = await client.listProjectViews(project.id)
                if (recovered.length !== 1 || !matchesView(recovered[0], desired, ids)) throw error
                viewId = recovered[0].id
            }
        }
    }
    const current = views.find((candidate) => candidate.id === viewId)
    if (current && !matchesView(current, desired, ids)) {
        try {
            await client.updateProjectView(viewId, desired, ids)
        } catch (error) {
            const recovered = (await client.listProjectViews(project.id)).find((candidate) => candidate.id === viewId)
            if (!recovered || !matchesView(recovered, desired, ids)) throw error
        }
    }
    const verified = (await client.listProjectViews(project.id)).find((candidate) => candidate.id === viewId)
    if (!verified || !matchesView(verified, desired, ids))
        throw new Error("GitHub Project view post-write verification failed")
    return verified
}

function manualStepsFor(specification: GitHubProjectSpecification, viewUrl?: string): ManualStep[] {
    const location = viewUrl ?? "the selected Project view (link returned after provisioning)"
    const priority = specification.fields[GITHUB_PROJECT_DEFAULTS.board.sortBy.field]
    const priorityOrder = priority.options.map((option) => option.name).join(" → ")
    const steps: ManualStep[] = []
    if (specification.presentation.layout === "board") {
        steps.push({
            setting: "columnBy",
            desired: specification.fields.status.field,
            instructions: `Open ${location} → View → Column by (Column field); select ${specification.fields.status.field}.`,
            verification: "Save the view and reopen View options to confirm the column field.",
        })
    }
    steps.push(
        {
            setting: "swimlanes",
            desired: GITHUB_PROJECT_DEFAULTS.board.swimlanes,
            instructions: `Open ${location} → View → Swimlanes (Group by) → No grouping.`,
            verification: "Save the view and reopen View options to confirm no swimlanes.",
        },
        {
            setting: "sortBy",
            desired: `${priority.field}: ${priorityOrder}`,
            instructions: `Open ${location} → View → Sort by; remove other sorts and select ${priority.field}. Choose the direction matching ${priorityOrder}.`,
            verification: `Save the view, reopen Sort by, and confirm ${priorityOrder} in the actual item order rather than inferring it from an icon.`,
        },
        {
            setting: "fieldSum",
            desired: GITHUB_PROJECT_DEFAULTS.board.fieldSum,
            instructions: `Open ${location} → View → Field sum; select Count only.`,
            verification:
                "Save the view and reopen the menu to confirm Count only; user confirmation or a screenshot is required.",
        },
        {
            setting: "sliceBy",
            desired: GITHUB_PROJECT_DEFAULTS.board.sliceBy,
            instructions: `Open ${location} → View → Slice by → No slicing.`,
            verification:
                "Save the view and reopen the menu to confirm no slicing; user confirmation or a screenshot is required.",
        },
    )
    if (specification.defaultRepository === "setup-repository") {
        const repository = `${specification.repository.owner}/${specification.repository.repo}`
        steps.push({
            setting: "defaultRepository",
            desired: repository,
            instructions: `Open Project menu → Settings → Default repository; select ${repository} → Save changes. This also links the repository.`,
            verification:
                "Reload Settings and confirm the saved default repository; user confirmation or a screenshot is required. Repository association alone is not proof.",
        })
    }
    return isFreshBoard(specification)
        ? steps.filter((step) => !["columnBy", "swimlanes", "sortBy"].includes(step.setting))
        : steps
}

async function provisionProjectFields(
    specification: GitHubProjectSpecification,
    project: ProjectDetails,
    client: GitHubClient,
    allowStatusReplacement: boolean,
): Promise<void> {
    let current = project
    for (const desired of desiredProjectFields(specification)) {
        const decision = planProjectField(
            desired,
            specification.fields.status.field,
            current,
            allowStatusReplacement,
            specification.fields.status.options.canceled,
        )
        if (decision.conflicts.length > 0) throw new Error(decision.conflicts.join("; "))
        if (decision.actions.length === 0) continue
        for (const action of decision.actions) {
            switch (action.kind) {
                case "update-native-status":
                    await client.updateNativeStatus(action.details.existing, action.details.desired)
                    break
                case "create-project-field":
                    await client.createProjectField(current.id, action.details)
                    break
            }
        }
        current = await client.getProject(current.id)
        const existing = current.fields.find((field) => field.name === desired.name)
        if (!existing) throw new Error(`GitHub did not persist Project field ${JSON.stringify(desired.name)} exactly`)
        const statusUpdate = decision.actions.find((action) => action.kind === "update-native-status")
        const persisted = statusUpdate
            ? statusUpdate.details.verification === "exact"
                ? exactProjectField(existing, statusUpdate.details.desired)
                : compatibleProjectField(existing, desired)
            : compatibleProjectField(existing, desired)
        if (!persisted) {
            throw new Error(`GitHub did not persist Project field ${JSON.stringify(desired.name)} exactly`)
        }
    }
}

async function provisionRepositoryLabel(
    specification: GitHubProjectSpecification,
    client: GitHubClient,
): Promise<void> {
    const actions: ProvisioningAction[] = []
    const conflicts: string[] = []
    await planRepositoryLabel(specification, client, actions, conflicts)
    if (conflicts.length > 0) throw new Error(conflicts.join("; "))
    for (const action of actions) {
        if (action.kind !== "create-repository-label") continue
        try {
            await client.createRepositoryLabel(specification.repository, action.details)
        } catch (error) {
            const existing = await client.getRepositoryLabel(specification.repository, action.details.name)
            if (!existing) throw error
            if (!compatibleRepositoryLabel(existing, action.details)) {
                throw new Error(`repository label ${JSON.stringify(action.details.name)} has incompatible state`, {
                    cause: error,
                })
            }
        }
    }
    for (const desired of desiredRepositoryLabels(specification)) {
        const verified = await client.getRepositoryLabel(specification.repository, desired.name)
        if (!verified || !compatibleRepositoryLabel(verified, desired)) {
            throw new Error(`GitHub did not persist repository label ${JSON.stringify(desired.name)} exactly`)
        }
    }
}

async function provisionOrganizationMetadata(
    specification: GitHubProjectSpecification,
    repository: RepositoryDetails,
    client: GitHubClient,
): Promise<void> {
    if (repository.ownerType !== "org") return
    const organization = specification.repository.owner
    for (const desired of desiredOrganizationFields(specification)) {
        const decision = planOrganizationField(desired, await client.listIssueFields(organization))
        if (decision.conflicts.length > 0) throw new Error(decision.conflicts.join("; "))
        for (const action of decision.actions) await client.createIssueField(organization, action.details)
    }
}

function desiredProjectFields(specification: GitHubProjectSpecification): ProjectFieldDefinition[] {
    return [
        {
            name: specification.fields.status.field,
            dataType: "SINGLE_SELECT",
            options: Object.values(specification.fields.status.options),
        },
        {
            name: specification.fields.phase.field,
            dataType: "SINGLE_SELECT",
            options: Object.values(specification.fields.phase.options),
        },
        ...(specification.fields.priority.scope === "project"
            ? [
                  {
                      name: specification.fields.priority.field,
                      dataType: "SINGLE_SELECT" as const,
                      options: specification.fields.priority.options,
                  },
              ]
            : []),
        ...(specification.fields.internalId.scope === "project"
            ? [{ name: specification.fields.internalId.field, dataType: "TEXT" as const }]
            : []),
    ]
}

function assertSpecification(specification: GitHubProjectSpecification): void {
    const initial = specification.presentation.target.mode === "initial"
    if (initial !== (specification.project.mode === "new")) {
        throw new Error(
            "new Projects require an initial view target; existing/resumed Projects require an exact selected view",
        )
    }
    const desired = desiredView(specification)
    const visibleNames = desired.fields.map((field) => field.name)
    if (new Set(visibleNames).size !== visibleNames.length) throw new Error("visible field names must be distinct")
    if (desired.layout === "roadmap" && visibleNames.length > 0)
        throw new Error("roadmap views do not support visible fields")
    if (desired.layout !== "roadmap" && visibleNames.length === 0)
        throw new Error("board/table views require an explicit visible-field selection")
    const statusNames = Object.values(specification.fields.status.options).map((option) => option.name)
    if (new Set(statusNames).size !== statusNames.length) throw new Error("GitHub Status option names must be distinct")
    const phaseNames = Object.values(specification.fields.phase.options).map((option) => option.name)
    if (new Set(phaseNames).size !== phaseNames.length) throw new Error("GitHub Phase option names must be distinct")
    const priorityNames = specification.fields.priority.options.map((option) => option.name)
    if (new Set(priorityNames).size !== priorityNames.length)
        throw new Error("GitHub Priority option names must be distinct")
    if (priorityNames.includes("not set")) throw new Error("GitHub Priority must not contain exact option `not set`")
    const labelNames = desiredRepositoryLabels(specification).map((label) => label.name.toLowerCase())
    if (new Set(labelNames).size !== labelNames.length) {
        throw new Error("GitHub Kind label names must be distinct case-insensitively")
    }
    const projectFieldNames = desiredProjectFields(specification).map((field) => field.name)
    if (new Set(projectFieldNames).size !== projectFieldNames.length) {
        throw new Error("GitHub Project field names must be distinct")
    }
}

function compatibleProjectField(existing: ProjectField, desired: ProjectFieldDefinition): boolean {
    if (existing.name !== desired.name || existing.dataType.toUpperCase() !== desired.dataType) return false
    if (!desired.options) return true
    const names = new Set((existing.options ?? []).map((option) => option.name))
    return desired.options.every((option) => names.has(option.name))
}

function additiveCanceledStatus(
    existing: ProjectField,
    desired: ProjectFieldDefinition,
    canceled: Static<typeof OptionSchema>,
): ProjectFieldDefinition | undefined {
    if (
        existing.name !== desired.name ||
        existing.dataType.toUpperCase() !== "SINGLE_SELECT" ||
        desired.dataType !== "SINGLE_SELECT" ||
        !desired.options
    ) {
        return undefined
    }
    const existingOptions = existing.options ?? []
    const existingNames = new Set(existingOptions.map((option) => option.name))
    const missing = desired.options.filter((option) => !existingNames.has(option.name))
    if (missing.length !== 1 || missing[0].name !== canceled.name) return undefined
    const retained = existingOptions.map((option) =>
        Value.Parse(OptionSchema, {
            name: option.name,
            description: option.description,
            color: option.color.toLowerCase(),
        }),
    )
    return { ...desired, options: [...retained, canceled] }
}

function exactProjectField(existing: ProjectField, desired: ProjectFieldDefinition): boolean {
    if (existing.name !== desired.name || existing.dataType.toUpperCase() !== desired.dataType) return false
    if (!desired.options) return existing.options === undefined
    const options = existing.options ?? []
    return (
        options.length === desired.options.length &&
        options.every((option, index) => {
            const expected = desired.options![index]
            return (
                option.name === expected.name &&
                option.description === expected.description &&
                option.color.toLowerCase() === expected.color
            )
        })
    )
}

function compatibleRepositoryLabel(existing: RepositoryLabel, desired: Static<typeof RepositoryLabelSchema>): boolean {
    return (
        existing.name === desired.name &&
        existing.color.toLowerCase() === desired.color.toLowerCase() &&
        existing.description === desired.description
    )
}

function compatibleIssueField(
    existing: IssueField,
    dataType: "text" | "single_select",
    options?: Static<typeof OptionSchema>[],
): boolean {
    if (existing.dataType !== dataType) return false
    if (!options) return true
    const names = new Set((existing.options ?? []).map((option) => option.name))
    return options.every((option) => names.has(option.name))
}

function trackerConfigFor(specification: GitHubProjectSpecification, projectNumber: number): Record<string, unknown> {
    const config = {
        provider: "github",
        mcpServer: specification.mcpServer,
        repository: specification.repository,
        project: {
            owner: specification.projectOwner.login,
            ownerType: specification.projectOwner.type,
            number: projectNumber,
        },
        labels: {
            kind: {
                epic: specification.labels.kind.epic.name,
                deliverableKinds: Object.fromEntries(
                    Object.entries(specification.labels.kind.deliverableKinds).map(([key, label]) => [key, label.name]),
                ),
            },
        },
        fields: {
            status: {
                field: specification.fields.status.field,
                values: Object.fromEntries(
                    Object.entries(specification.fields.status.options).map(([key, option]) => [key, option.name]),
                ),
            },
            phase: {
                field: specification.fields.phase.field,
                values: Object.fromEntries(
                    Object.entries(specification.fields.phase.options).map(([key, option]) => [key, option.name]),
                ),
            },
            priority: {
                scope: specification.fields.priority.scope,
                field: specification.fields.priority.field,
                values: specification.fields.priority.options.map((option) => option.name),
            },
            internalId: {
                scope: specification.fields.internalId.scope,
                field: specification.fields.internalId.field,
            },
        },
    }
    if (!Value.Check(GitHubTrackerSchema, config)) {
        const details = [...Value.Errors(GitHubTrackerSchema, config)]
            .map((error) => `${error.instancePath || "/"}: ${error.message}`)
            .join("; ")
        throw new Error(`generated invalid GitHub tracker configuration: ${details}`)
    }
    return config
}

function describeProjectField(field: ProjectFieldDefinition): string {
    return `Create Project field ${JSON.stringify(field.name)} (${field.dataType})${field.options ? ` with options ${field.options.map((option) => JSON.stringify(option.name)).join(", ")}` : ""}`
}

function projectSummary(raw: unknown): ProjectSummary {
    const value = record(raw, "Project")
    return {
        id: text(value.id, "Project id"),
        number: number(value.number, "Project number"),
        title: text(value.title, "Project title"),
        url: text(value.url, "Project url"),
        public: value.public === true,
        closed: value.closed === true,
    }
}

function repositoryLabel(raw: unknown): RepositoryLabel {
    const value = record(raw, "repository label")
    return {
        name: text(value.name, "repository label name"),
        color: `#${text(value.color, "repository label color")}`,
        description: typeof value.description === "string" ? value.description : "",
    }
}

function hash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

async function responseJson(response: Response): Promise<unknown> {
    const text = await response.text()
    if (!text) return null
    try {
        return JSON.parse(text)
    } catch {
        throw new Error(`GitHub returned invalid JSON with status ${response.status}`)
    }
}

function githubError(status: number, result: unknown): Error {
    const detail =
        result && typeof result === "object" && "message" in result ? String(result.message) : JSON.stringify(result)
    return new Error(`GitHub API failed with status ${status}: ${detail}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid ${label}`)
    return value as Record<string, unknown>
}
function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`invalid ${label}`)
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
