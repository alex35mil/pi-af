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

const StatusOptionsSchema = Type.Object(
    {
        backlog: OptionSchema,
        todo: OptionSchema,
        inProgress: OptionSchema,
        inReview: OptionSchema,
        done: OptionSchema,
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

const DeliverableTypeOptionsSchema = Type.Object(
    {
        feature: OptionSchema,
        bugfix: OptionSchema,
        research: OptionSchema,
        refactor: OptionSchema,
        audit: OptionSchema,
        chore: OptionSchema,
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
const ProjectTypeSchema = Type.Object(
    {
        scope: Type.Literal("project"),
        field: OneLineSchema,
        epic: OptionSchema,
        deliverableKinds: DeliverableTypeOptionsSchema,
    },
    { additionalProperties: false },
)
const IssueTypeSchema = Type.Object(
    {
        scope: Type.Literal("issue"),
        epic: OptionSchema,
        deliverableKinds: DeliverableTypeOptionsSchema,
        provisionMissing: Type.Boolean(),
    },
    { additionalProperties: false },
)

export const GitHubProjectSpecificationSchema = Type.Object(
    {
        credentialEnv: EnvironmentNameSchema,
        mcpServer: ServerNameSchema,
        repository: RepositorySchema,
        projectOwner: ProjectOwnerSchema,
        project: ProjectSourceSchema,
        labels: Type.Object({ planning: RepositoryLabelSchema }, { additionalProperties: false }),
        fields: Type.Object(
            {
                status: Type.Object(
                    { field: OneLineSchema, options: StatusOptionsSchema },
                    { additionalProperties: false },
                ),
                priority: Type.Union([ProjectPrioritySchema, IssuePrioritySchema]),
                internalId: Type.Union([ProjectInternalIdSchema, IssueInternalIdSchema]),
                type: Type.Union([ProjectTypeSchema, IssueTypeSchema]),
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
    Type.Object({ operation: Type.Literal("inspect"), ...inspectProperties }, { additionalProperties: false }),
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
    labels: {
        planning: {
            name: "Planning",
            color: "#0969DA",
            description: "Work is currently being planned.",
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
                description: "Approved work currently being planned or executed.",
                color: "yellow",
            },
            inReview: {
                name: "In Review",
                description: "Implementation under review or awaiting delivery.",
                color: "purple",
            },
            done: { name: "Done", description: "Approved work confirmed delivered.", color: "green" },
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
    type: {
        field: "Kind",
        epic: { name: "Epic", description: "A multi-deliverable initiative.", color: "purple" },
        deliverableKinds: {
            feature: { name: "Feature", description: "New user-visible or system capability.", color: "blue" },
            bugfix: { name: "Bugfix", description: "Correction of defective behavior.", color: "red" },
            research: {
                name: "Research",
                description: "Investigation producing evidence and conclusions.",
                color: "green",
            },
            refactor: {
                name: "Refactor",
                description: "Behavior-preserving structural improvement.",
                color: "orange",
            },
            audit: { name: "Audit", description: "Evidence-based assessment and recommendations.", color: "yellow" },
            chore: { name: "Chore", description: "Maintenance or operational work.", color: "gray" },
        },
    },
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
    id: string
    name: string
    dataType: string
    options?: Array<{ id: string; name: string; description: string; color: string }>
}
interface ProjectDetails extends ProjectSummary {
    itemCount: number
    fields: ProjectField[]
    repositoryIds: string[]
}
interface IssueField {
    id: number
    name: string
    dataType: string
    options?: Array<{ id: number; name: string; description?: string; color: string; priority?: number }>
}
interface IssueType {
    id: number
    name: string
    description?: string
    color?: string | null
    enabled?: boolean
}
interface RepositoryDetails {
    id: string
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
          details: { existing: ProjectField; desired: ProjectFieldDefinition }
      }
    | { kind: "create-project-field"; details: ProjectFieldDefinition }
)
type OrganizationAction = { description: string } & (
    | { kind: "create-issue-field"; details: ReturnType<typeof desiredOrganizationFields>[number] }
    | { kind: "create-issue-type"; details: Static<typeof OptionSchema> }
)
type ProvisioningAction =
    | ProjectFieldAction
    | OrganizationAction
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
    if (input.operation === "inspect") {
        const client = clientFor(input.credentialEnv, options)
        const [repository, owner] = await Promise.all([
            client.getRepository(input.repository),
            client.listOwnerProjects(input.projectOwner),
        ])
        const organizationMetadata =
            input.includeOrganizationMetadata && repository.ownerType === "org"
                ? {
                      issueFields: await client.listIssueFields(input.repository.owner),
                      issueTypes: await client.listIssueTypes(input.repository.owner),
                  }
                : undefined
        return {
            repository: { ...input.repository, ownerType: repository.ownerType },
            projectOwner: input.projectOwner,
            projects: owner.projects,
            ...(organizationMetadata ? { organizationMetadata } : {}),
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
        return {
            id: text(result.node_id, "repository node_id"),
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
                                    ... on ProjectV2FieldCommon { id name dataType }
                                    ... on ProjectV2SingleSelectField {
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
                fields.push({
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

    async createProject(ownerId: string, title: string, repositoryId: string | undefined): Promise<ProjectSummary> {
        const data = await this.graphql(
            `mutation($ownerId: ID!, $title: String!, $repositoryId: ID) {
                createProjectV2(input: { ownerId: $ownerId, title: $title, repositoryId: $repositoryId }) {
                    projectV2 { id number title url public closed }
                }
            }`,
            { ownerId, title, repositoryId: repositoryId ?? null },
        )
        return projectSummary(record(record(data.createProjectV2, "createProjectV2").projectV2, "created Project"))
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

    async listIssueTypes(organization: string): Promise<IssueType[]> {
        const result = await this.rest("GET", `/orgs/${encodeURIComponent(organization)}/issue-types`)
        return array(result, "organization issue types").map((rawType) => {
            const issueType = record(rawType, "organization issue type")
            return {
                id: number(issueType.id, "issue type id"),
                name: text(issueType.name, "issue type name"),
                description: typeof issueType.description === "string" ? issueType.description : undefined,
                color: typeof issueType.color === "string" ? issueType.color : null,
                enabled: typeof issueType.is_enabled === "boolean" ? issueType.is_enabled : undefined,
            }
        })
    }

    async createIssueType(organization: string, option: Static<typeof OptionSchema>): Promise<void> {
        await this.rest("POST", `/orgs/${encodeURIComponent(organization)}/issue-types`, {
            name: option.name,
            description: option.description,
            color: option.color,
            is_enabled: true,
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
        actions,
        conflicts,
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
        const decision = planProjectField(desired, specification.fields.status.field, project, allowStatusReplacement)
        actions.push(...decision.actions)
        conflicts.push(...decision.conflicts)
    }
}

function planProjectField(
    desired: ProjectFieldDefinition,
    statusField: string,
    project: ProjectDetails,
    allowStatusUpdate: boolean,
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
            if (!allowStatusUpdate || project.itemCount > 0) {
                conflicts.push(`Project field ${JSON.stringify(existing.name)} has incompatible type or options`)
            } else if (existing.dataType.toUpperCase() !== "SINGLE_SELECT") {
                conflicts.push("Project native Status field is not a single-select field")
            } else {
                actions.push({
                    kind: "update-native-status",
                    description: `Update native Status field ${existing.id} in place as ${JSON.stringify(desired.name)} with the complete configured options`,
                    details: { existing, desired },
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

async function planRepositoryLabel(
    specification: GitHubProjectSpecification,
    client: GitHubClient,
    actions: ProvisioningAction[],
    conflicts: string[],
): Promise<void> {
    const desired = specification.labels.planning
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
    }
    return { actions, conflicts }
}

function planOrganizationType(
    desired: Static<typeof OptionSchema>,
    existingTypes: IssueType[],
    provisionMissing: boolean,
) {
    const actions: OrganizationAction[] = []
    const conflicts: string[] = []
    const existing = existingTypes.find((issueType) => issueType.name === desired.name)
    if (!existing) {
        if (provisionMissing)
            actions.push({
                kind: "create-issue-type",
                description: `Create enabled organization issue type ${JSON.stringify(desired.name)}`,
                details: desired,
            })
        else conflicts.push(`organization issue type ${JSON.stringify(desired.name)} is missing`)
    } else if (existing.enabled === false)
        conflicts.push(`organization issue type ${JSON.stringify(desired.name)} is disabled`)
    return { actions, conflicts }
}

async function planOrganizationMetadata(
    specification: GitHubProjectSpecification,
    repository: RepositoryDetails,
    client: GitHubClient,
    actions: ProvisioningAction[],
    conflicts: string[],
): Promise<void> {
    const usesIssueFields =
        specification.fields.priority.scope === "issue" || specification.fields.internalId.scope === "issue"
    const usesIssueTypes = specification.fields.type.scope === "issue"
    if (!usesIssueFields && !usesIssueTypes) return
    if (repository.ownerType !== "org") {
        conflicts.push("issue-scoped fields and types require a repository owned by an organization")
        return
    }
    const organization = specification.repository.owner
    if (usesIssueFields) {
        const existingFields = await client.listIssueFields(organization)
        for (const desired of desiredOrganizationFields(specification)) {
            const decision = planOrganizationField(desired, existingFields)
            actions.push(...decision.actions)
            conflicts.push(...decision.conflicts)
        }
    }
    if (usesIssueTypes && specification.fields.type.scope === "issue") {
        const existingTypes = await client.listIssueTypes(organization)
        for (const desired of uniqueOptions([
            specification.fields.type.epic,
            ...Object.values(specification.fields.type.deliverableKinds),
        ])) {
            const decision = planOrganizationType(desired, existingTypes, specification.fields.type.provisionMissing)
            actions.push(...decision.actions)
            conflicts.push(...decision.conflicts)
        }
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
    if (specification.project.mode === "new") {
        const projectSource = specification.project
        let created: ProjectSummary
        try {
            created = await client.createProject(
                owner.ownerId,
                projectSource.title,
                projectSource.associateRepository ? repository.id : undefined,
            )
        } catch (error) {
            const candidates = (await client.listOwnerProjects(specification.projectOwner)).projects.filter(
                (candidate) => candidate.title === projectSource.title,
            )
            if (candidates.length === 1) created = candidates[0]
            else if (candidates.length === 0) throw error
            else {
                throw new Error(
                    `GitHub Project creation could not be reconciled because multiple exact-title Projects exist: ${candidates.map((candidate) => `${candidate.number} ${candidate.url}`).join(", ")}`,
                    { cause: error },
                )
            }
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
        trackerConfig: trackerConfigFor(specification, verified.number),
        approvedPlanHash: approvedPlan.planHash,
    }
}

async function provisionProjectFields(
    specification: GitHubProjectSpecification,
    project: ProjectDetails,
    client: GitHubClient,
    allowStatusReplacement: boolean,
): Promise<void> {
    let current = project
    for (const desired of desiredProjectFields(specification)) {
        const decision = planProjectField(desired, specification.fields.status.field, current, allowStatusReplacement)
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
        const updatedNativeStatus = decision.actions.some((action) => action.kind === "update-native-status")
        if (
            !existing ||
            !(updatedNativeStatus ? exactProjectField(existing, desired) : compatibleProjectField(existing, desired))
        ) {
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
    const action = actions.find((candidate) => candidate.kind === "create-repository-label")
    if (action?.kind === "create-repository-label") {
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
    const verified = await client.getRepositoryLabel(specification.repository, specification.labels.planning.name)
    if (!verified || !compatibleRepositoryLabel(verified, specification.labels.planning)) {
        throw new Error(
            `GitHub did not persist repository label ${JSON.stringify(specification.labels.planning.name)} exactly`,
        )
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
        await applyOrganizationActions(client, organization, decision)
    }
    if (specification.fields.type.scope === "issue") {
        let current = await client.listIssueTypes(organization)
        for (const option of uniqueOptions([
            specification.fields.type.epic,
            ...Object.values(specification.fields.type.deliverableKinds),
        ])) {
            const decision = planOrganizationType(option, current, specification.fields.type.provisionMissing)
            await applyOrganizationActions(client, organization, decision)
            if (decision.actions.length > 0) current = await client.listIssueTypes(organization)
        }
    }
}

async function applyOrganizationActions(
    client: GitHubClient,
    organization: string,
    decision: { actions: OrganizationAction[]; conflicts: string[] },
): Promise<void> {
    if (decision.conflicts.length > 0) throw new Error(decision.conflicts.join("; "))
    for (const action of decision.actions) {
        switch (action.kind) {
            case "create-issue-field":
                await client.createIssueField(organization, action.details)
                break
            case "create-issue-type":
                await client.createIssueType(organization, action.details)
                break
        }
    }
}

function desiredProjectFields(specification: GitHubProjectSpecification): ProjectFieldDefinition[] {
    return [
        {
            name: specification.fields.status.field,
            dataType: "SINGLE_SELECT",
            options: Object.values(specification.fields.status.options),
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
        ...(specification.fields.type.scope === "project"
            ? [
                  {
                      name: specification.fields.type.field,
                      dataType: "SINGLE_SELECT" as const,
                      options: uniqueOptions([
                          specification.fields.type.epic,
                          ...Object.values(specification.fields.type.deliverableKinds),
                      ]),
                  },
              ]
            : []),
    ]
}

function assertSpecification(specification: GitHubProjectSpecification): void {
    const statusNames = Object.values(specification.fields.status.options).map((option) => option.name)
    if (new Set(statusNames).size !== statusNames.length) throw new Error("GitHub Status option names must be distinct")
    const priorityNames = specification.fields.priority.options.map((option) => option.name)
    if (new Set(priorityNames).size !== priorityNames.length)
        throw new Error("GitHub Priority option names must be distinct")
    if (priorityNames.includes("not set")) throw new Error("GitHub Priority must not contain exact option `not set`")
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
    const type = specification.fields.type
    const config = {
        provider: "github",
        mcpServer: specification.mcpServer,
        repository: specification.repository,
        project: {
            owner: specification.projectOwner.login,
            ownerType: specification.projectOwner.type,
            number: projectNumber,
        },
        labels: { planning: specification.labels.planning.name },
        fields: {
            status: {
                field: specification.fields.status.field,
                values: Object.fromEntries(
                    Object.entries(specification.fields.status.options).map(([key, option]) => [key, option.name]),
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
            type:
                type.scope === "project"
                    ? {
                          scope: "project",
                          field: type.field,
                          epic: type.epic.name,
                          deliverableKinds: Object.fromEntries(
                              Object.entries(type.deliverableKinds).map(([key, option]) => [key, option.name]),
                          ),
                      }
                    : {
                          scope: "issue",
                          epic: type.epic.name,
                          deliverableKinds: Object.fromEntries(
                              Object.entries(type.deliverableKinds).map(([key, option]) => [key, option.name]),
                          ),
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

function uniqueOptions(options: Static<typeof OptionSchema>[]): Static<typeof OptionSchema>[] {
    const seen = new Set<string>()
    return options.filter((option) => (seen.has(option.name) ? false : (seen.add(option.name), true)))
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
