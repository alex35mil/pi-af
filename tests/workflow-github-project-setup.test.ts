import "./host-runtime.ts"

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { inspect } from "node:util"

import { GITHUB_PROJECT_DEFAULTS, runGitHubProjectSetup } from "../workflows/extensions/project-setup/github-project.ts"

interface FakeField {
    databaseId?: number | null
    id: string
    name: string
    dataType: string
    isIssueField?: boolean
    options?: Array<{ id: string; name: string; description: string; color: string }>
}
interface FakeProject {
    shortDescription: string | null
    id: string
    number: number
    title: string
    url: string
    public: boolean
    closed: boolean
    itemCount: number
    fields: FakeField[]
    repositoryIds: string[]
}

interface FakeView {
    id: string
    number: number
    name: string
    layout: string
    filter: string
    visibleFieldIds: string[]
    groupBy: FakeField[]
    columns: FakeField[]
    sortBy: Array<{ field: FakeField; direction: string }>
}

const builtins = ["Title", "Assignees", "Linked pull requests", "Sub-issues progress", "Labels"].map((name) => ({
    id: `builtin-${name}`,
    name,
    dataType: "TEXT",
}))
const allFields = (project: FakeProject): FakeField[] => [...builtins, ...project.fields]

class FakeGitHub {
    projects: FakeProject[] = []
    views = new Map<string, FakeView[]>()
    viewWrites: Array<Record<string, any>> = []
    projectWrites: Array<Record<string, unknown>> = []
    initialViewCount = 1
    pageSize = 50
    loseNextViewCreateResponse = false
    loseNextViewUpdateResponse = false
    ignoreViewUpdate = false
    issueFields: Array<Record<string, unknown>> = []
    repositoryLabels: Array<{ name: string; color: string; description: string }> = []
    authorizationHeaders: string[] = []
    deleteProjectFieldAttempts = 0
    loseNextProjectCreateResponse = false
    loseNextRepositoryLabelCreateResponse = false
    nextField = 10
    repositoryOwnerType = "Organization"
    restRequests: string[] = []
    onBoardCreate?: (project: FakeProject, view: FakeView) => void
    onProjectCreate?: (project: FakeProject) => void
    loseNextViewDeleteResponse = false
    failViewDelete = false
    ignoreViewDelete = false

    readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(input)
        const headers = new Headers(init?.headers)
        this.authorizationHeaders.push(headers.get("Authorization") ?? "")
        if (url.endsWith("/graphql")) return this.graphql(String(init?.body ?? ""))
        this.restRequests.push(`${init?.method ?? "GET"} ${url}`)
        if (url.endsWith("/repos/acme/example")) {
            return json({
                node_id: "repo-node",
                name: "example",
                owner: { login: "acme", type: this.repositoryOwnerType },
            })
        }
        // Verified against the personal REST API: numeric owner POST 404; login POST 201.
        const route = /\/(users\/alex|orgs\/acme)\/projectsV2\/(\d+)\/views$/.exec(url)
        if (route && init?.method === "POST") {
            const project = this.projects.find((project) => project.number === Number(route[2]))!
            const fields = details(project).fields.nodes
            const field = (id: number) => {
                assert.equal(typeof id, "number")
                const result = fields.find((field) => field.databaseId === id)
                assert.ok(result, `unknown numeric field ${id}`)
                return result
            }
            const body = JSON.parse(String(init.body))
            const views = this.projectViews(project)
            const view = this.defaultView(project, Math.max(0, ...views.map((view) => view.number)) + 1)
            Object.assign(view, {
                name: body.name,
                layout: `${body.layout.toUpperCase()}_LAYOUT`,
                visibleFieldIds: body.visible_fields.map((id: number) => field(id).id),
                columns: body.vertical_group_by.map(field),
                groupBy: body.group_by.map(field),
                sortBy: body.sort_by.map(([id, direction]: [number, string]) => ({
                    field: field(id),
                    direction: direction.toUpperCase(),
                })),
            })
            views.push(view)
            this.viewWrites.push({ operation: "rest-create", route: route[1], ...body })
            this.onBoardCreate?.(project, view)
            if (this.loseNextViewCreateResponse) {
                this.loseNextViewCreateResponse = false
                return json({ message: "response lost after view creation" }, 500)
            }
            return json({ value: { node_id: view.id, id: view.number, number: view.number, ...body } }, 201)
        }
        if (url.endsWith("/repos/acme/example/labels")) {
            if (init?.method !== "POST") return json({ message: "method not allowed" }, 405)
            const body = JSON.parse(String(init.body)) as { name: string; color: string; description: string }
            if (this.repositoryLabels.some((label) => label.name === body.name)) {
                return json({ message: "Validation Failed" }, 422)
            }
            this.repositoryLabels.push(body)
            if (this.loseNextRepositoryLabelCreateResponse) {
                this.loseNextRepositoryLabelCreateResponse = false
                return json({ message: "response lost after repository label creation" }, 500)
            }
            return json(body, 201)
        }
        if (url.includes("/repos/acme/example/labels/")) {
            const name = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1))
            const label = this.repositoryLabels.find((candidate) => candidate.name === name)
            return label ? json(label) : json({ message: "Not Found" }, 404)
        }
        if (url.endsWith("/orgs/acme/issue-fields")) {
            if (init?.method === "POST") {
                const body = JSON.parse(String(init.body)) as Record<string, unknown>
                const rawOptions = body.options as Array<Record<string, unknown>> | undefined
                const field = {
                    id: this.issueFields.length + 1,
                    node_id: `issue-field-${this.issueFields.length + 1}`,
                    name: body.name,
                    data_type: body.data_type,
                    options: rawOptions?.map((option, index) => ({
                        ...option,
                        id: index + 1,
                        priority: index + 1,
                    })),
                }
                this.issueFields.push(field)
                return json(field)
            }
            return json(this.issueFields)
        }
        return json({ message: `unexpected request ${init?.method ?? "GET"} ${url}` }, 404)
    }

    private graphql(rawBody: string): Response {
        const body = JSON.parse(rawBody) as { query: string; variables: Record<string, unknown> }
        const { query, variables } = body
        if (query.includes("createProjectV2View(")) {
            const input = variables.input as Record<string, any>
            const project = this.project(input.projectId)
            const views = this.projectViews(project)
            const view = this.defaultView(project, views.length + 1)
            Object.assign(view, {
                name: input.name,
                layout: input.layout,
                visibleFieldIds: input.configuration.visibleFieldIds,
            })
            views.push(view)
            this.viewWrites.push({ operation: "create", ...input })
            if (this.loseNextViewCreateResponse) {
                this.loseNextViewCreateResponse = false
                return graph(undefined, [{ message: "response lost after view creation" }])
            }
            return graph({ createProjectV2View: { projectV2View: { id: view.id } } })
        }
        if (query.includes("updateProjectV2View(")) {
            const input = variables.input as Record<string, any>
            const view = [...this.views.values()].flat().find((view) => view.id === input.viewId)!
            this.viewWrites.push({ operation: "update", ...input })
            if (!this.ignoreViewUpdate)
                Object.assign(view, {
                    name: input.name,
                    layout: input.layout,
                    visibleFieldIds: input.configuration.visibleFieldIds,
                })
            if (this.loseNextViewUpdateResponse) {
                this.loseNextViewUpdateResponse = false
                return graph(undefined, [{ message: "response lost after view update" }])
            }
            return graph({ updateProjectV2View: { projectV2View: { id: view.id } } })
        }
        if (query.includes("deleteProjectV2View(")) {
            this.viewWrites.push({ operation: "delete", viewId: variables.viewId })
            if (this.failViewDelete) return graph(undefined, [{ message: "view deletion forbidden" }])
            if (!this.ignoreViewDelete)
                for (const [projectId, views] of this.views) {
                    this.views.set(
                        projectId,
                        views.filter((view) => view.id !== variables.viewId),
                    )
                }
            if (this.loseNextViewDeleteResponse) {
                this.loseNextViewDeleteResponse = false
                return graph(undefined, [{ message: "response lost after deletion" }])
            }
            return graph({ deleteProjectV2View: { projectV2View: { id: variables.viewId } } })
        }
        if (query.includes("views(first: 50") && !query.includes("createProjectV2(")) {
            const project = this.project(String(variables.projectId))
            return graph({
                node: {
                    views: this.page(
                        this.projectViews(project).map(({ id }) => ({ id })),
                        variables.after,
                    ),
                },
            })
        }
        if (query.includes("... on ProjectV2View")) {
            const project = this.projects.find((project) =>
                this.projectViews(project).some((view) => view.id === variables.viewId),
            )!
            const view = this.projectViews(project).find((view) => view.id === variables.viewId)!
            return graph({
                node: {
                    id: view.id,
                    number: view.number,
                    name: view.name,
                    layout: view.layout,
                    filter: view.filter,
                    project: { id: project.id },
                    configuration: {
                        visibleFields: this.page(
                            view.visibleFieldIds.map((id) => allFields(project).find((field) => field.id === id)),
                            variables.visible,
                        ),
                    },
                    groupByFields: this.page(view.groupBy, variables.groups),
                    verticalGroupByFields: this.page(view.columns, variables.columns),
                    sortByFields: this.page(view.sortBy, variables.sorts),
                },
            })
        }
        if (query.includes("createProjectV2(")) {
            const project: FakeProject = {
                id: `project-${this.projects.length + 1}`,
                number: this.projects.length + 1,
                title: String(variables.title),
                shortDescription: null,
                url: `https://github.com/users/alex/projects/${this.projects.length + 1}`,
                public: false,
                closed: false,
                itemCount: 0,
                fields: [
                    {
                        id: "default-status",
                        name: "Status",
                        dataType: "SINGLE_SELECT",
                        options: options("Todo", "In Progress", "Done"),
                    },
                ],
                repositoryIds: variables.repositoryId ? [String(variables.repositoryId)] : [],
            }
            this.projects.push(project)
            this.onProjectCreate?.(project)
            const initialViews = this.projectViews(project).map(({ id }) => ({ id }))
            if (this.loseNextProjectCreateResponse) {
                this.loseNextProjectCreateResponse = false
                return graph(undefined, [{ message: "response lost after Project creation" }])
            }
            return graph({
                createProjectV2: {
                    projectV2: {
                        ...summary(project),
                        views: { nodes: initialViews, pageInfo: { hasNextPage: false } },
                    },
                },
            })
        }
        if (query.includes("updateProjectV2(")) {
            const project = this.project(String(variables.projectId))
            this.projectWrites.push(variables)
            if ("public" in variables) project.public = variables.public === true
            if ("shortDescription" in variables) project.shortDescription = String(variables.shortDescription)
            return graph({ updateProjectV2: { projectV2: { id: project.id } } })
        }
        if (query.includes("linkProjectV2ToRepository(")) {
            const project = this.project(String(variables.projectId))
            if (!project.repositoryIds.includes(String(variables.repositoryId))) {
                project.repositoryIds.push(String(variables.repositoryId))
            }
            return graph({ linkProjectV2ToRepository: { repository: { id: variables.repositoryId } } })
        }
        if (query.includes("unlinkProjectV2FromRepository(")) {
            const project = this.project(String(variables.projectId))
            project.repositoryIds = project.repositoryIds.filter((id) => id !== variables.repositoryId)
            return graph({ unlinkProjectV2FromRepository: { repository: { id: variables.repositoryId } } })
        }
        if (query.includes("deleteProjectV2Field(")) {
            this.deleteProjectFieldAttempts++
            return graph(undefined, [{ message: "Only custom fields can be deleted." }])
        }
        if (query.includes("updateProjectV2Field(")) {
            const project = this.projects.find((candidate) =>
                candidate.fields.some((field) => field.id === variables.fieldId),
            )
            if (!project) throw new Error(`missing fake field ${String(variables.fieldId)}`)
            const field = project.fields.find((candidate) => candidate.id === variables.fieldId)!
            const rawOptions = variables.options as Array<Record<string, unknown>>
            field.name = String(variables.name)
            field.options = rawOptions.map((option, index) => ({
                id: typeof option.id === "string" ? option.id : `updated-${this.nextField}-${index}`,
                name: String(option.name),
                description: String(option.description),
                color: String(option.color),
            }))
            return graph({ updateProjectV2Field: { projectV2Field: { id: field.id } } })
        }
        if (query.includes("createProjectV2Field(")) {
            const project = this.project(String(variables.projectId))
            const rawOptions = variables.options as Array<Record<string, unknown>> | null
            const field: FakeField = {
                id: `field-${this.nextField++}`,
                name: String(variables.name),
                dataType: String(variables.dataType),
                ...(rawOptions
                    ? {
                          options: rawOptions.map((option, index) => ({
                              id: `option-${this.nextField}-${index}`,
                              name: String(option.name),
                              description: String(option.description),
                              color: String(option.color),
                          })),
                      }
                    : {}),
            }
            project.fields.push(field)
            return graph({ createProjectV2Field: { projectV2Field: { id: field.id } } })
        }
        if (query.includes("repositories(first: 50")) {
            const project = this.project(String(variables.id))
            return graph({
                node: {
                    repositories: {
                        nodes: project.repositoryIds.map((id) => ({ id })),
                        pageInfo: { hasNextPage: false, endCursor: null },
                    },
                },
            })
        }
        if (query.includes("node(id: $id)")) {
            const project = this.project(String(variables.id))
            const result = details(project)
            return graph({ node: { ...result, fields: this.page(result.fields.nodes, variables.after) } })
        }
        if (query.includes("projectsV2(first: 50")) {
            const root = query.includes("organization(login") ? "organization" : "user"
            return graph({
                [root]: {
                    id: root === "organization" ? "org-owner" : "user-owner",
                    projectsV2: {
                        nodes: this.projects.map(summary),
                        pageInfo: { hasNextPage: false, endCursor: null },
                    },
                },
            })
        }
        return graph(undefined, [{ message: "unexpected GraphQL operation" }])
    }

    projectViews(project: FakeProject): FakeView[] {
        if (!this.views.has(project.id))
            this.views.set(
                project.id,
                Array.from({ length: this.initialViewCount }, (_, index) => this.defaultView(project, index + 1)),
            )
        return this.views.get(project.id)!
    }

    private defaultView(project: FakeProject, number: number): FakeView {
        return {
            id: `view-${project.number}-${number}`,
            number,
            name: `View ${number}`,
            layout: "TABLE_LAYOUT",
            filter: "",
            visibleFieldIds: [builtins[0].id],
            groupBy: [],
            columns: [],
            sortBy: [],
        }
    }

    private page<T>(nodes: T[], after: unknown) {
        const start = after ? Number(after) : 0
        const end = Math.min(start + this.pageSize, nodes.length)
        return {
            nodes: nodes.slice(start, end),
            pageInfo: { hasNextPage: end < nodes.length, endCursor: end < nodes.length ? String(end) : null },
        }
    }

    private project(id: string): FakeProject {
        const project = this.projects.find((candidate) => candidate.id === id)
        if (!project) throw new Error(`missing fake Project ${id}`)
        return project
    }
}

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })
}
function graph(data: unknown, errors?: unknown[]): Response {
    return json({ data, ...(errors ? { errors } : {}) })
}
function summary(project: FakeProject) {
    return {
        id: project.id,
        number: project.number,
        title: project.title,
        url: project.url,
        public: project.public,
        closed: project.closed,
    }
}
function details(project: FakeProject) {
    return {
        ...summary(project),
        shortDescription: project.shortDescription,
        items: { totalCount: project.itemCount },
        fields: {
            nodes: allFields(project).map((field, index) => ({
                databaseId: field.databaseId === undefined ? 100 + index : field.databaseId,
                __typename: field.dataType === "SINGLE_SELECT" ? "ProjectV2SingleSelectField" : "ProjectV2Field",
                isIssueField: false,
                ...field,
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
        },
    }
}
function options(...names: string[]) {
    return names.map((name, index) => ({ id: `default-${index}`, name, description: "", color: "GRAY" }))
}

function defaultRepositoryLabels() {
    const labels = GITHUB_PROJECT_DEFAULTS.labels
    return [labels.kind.epic, ...Object.values(labels.kind.deliverableKinds)].map((label) => ({
        name: label.name,
        color: label.color.slice(1),
        description: label.description,
    }))
}

function projectContained(source: Record<string, unknown>) {
    const defaults = structuredClone(GITHUB_PROJECT_DEFAULTS)
    return {
        credentialEnv: "GITHUB_TOKEN_FOR_TEST",
        mcpServer: "github",
        repository: { owner: "acme", repo: "example" },
        projectOwner: { login: "alex", type: "user" },
        project: source,
        presentation: {
            ...defaults.presentation,
            target:
                source.mode === "new" ? { mode: "initial" } : { mode: "selected", viewId: `view-${source.number}-1` },
        },
        defaultRepository: source.associateRepository ? "setup-repository" : "unmanaged",
        labels: defaults.labels,
        fields: {
            status: defaults.status,
            phase: defaults.phase,
            priority: { scope: "project", ...defaults.priority },
        },
    }
}

function organizationNative(source: Record<string, unknown>) {
    const defaults = structuredClone(GITHUB_PROJECT_DEFAULTS)
    return {
        credentialEnv: "GITHUB_TOKEN_FOR_TEST",
        mcpServer: "github",
        repository: { owner: "acme", repo: "example" },
        projectOwner: { login: "acme", type: "org" },
        project: source,
        presentation: {
            ...defaults.presentation,
            // Metadata-only scenarios use the existing table path; their issue Priority is not exposed on the Project.
            layout: "table",
            visibleFields: defaults.presentation.visibleFields.filter(
                (field) => !(field.kind === "workflow" && field.field === "priority"),
            ),
            target:
                source.mode === "new" ? { mode: "initial" } : { mode: "selected", viewId: `view-${source.number}-1` },
        },
        defaultRepository: source.associateRepository ? "setup-repository" : "unmanaged",
        labels: defaults.labels,
        fields: {
            status: defaults.status,
            phase: defaults.phase,
            priority: {
                scope: "issue",
                ...defaults.priority,
                provisionMissing: true,
                visibility: "all",
            },
        },
    }
}

const setupOptions = (github: FakeGitHub) => ({
    fetch: github.fetch as typeof fetch,
    env: { GITHUB_TOKEN_FOR_TEST: "secret-token" },
})

describe("GitHub Project setup", () => {
    it("creates and verifies a self-contained personal Project", async () => {
        const github = new FakeGitHub()
        const specification = projectContained({
            mode: "new",
            title: "Example workflow",
            visibility: "private",
            associateRepository: true,
        })
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(preview.state, "ready")
        assert.match(String(preview.planHash), /^[a-f0-9]{64}$/)
        assert.equal(github.projects.length, 0)

        const applied = await runGitHubProjectSetup(
            { operation: "apply", specification, approvedPlanHash: preview.planHash },
            setupOptions(github),
        )
        assert.equal(applied.state, "provisioned")
        assert.equal(github.projects.length, 1)
        assert.deepEqual(
            github.projects[0].fields.map((field) => field.name),
            ["Status", "Phase", "Priority"],
        )
        const tracker = applied.trackerConfig as Record<string, any>
        assert.equal(tracker.project.number, 1)
        assert.equal(tracker.fields.status.values.todo, "Todo")
        assert.equal(tracker.fields.status.values.inReview, "In Review")
        assert.deepEqual(tracker.fields.phase.values, {
            planning: "Planning",
            execution: "Execution",
            selfReview: "Self-Review",
        })
        assert.equal(tracker.labels.kind.epic, "Kind: Epic")
        assert.equal(tracker.labels.kind.deliverableKinds.feature, "Kind: Feature")
        assert.deepEqual(tracker.fields.priority.values, ["Urgent", "High", "Medium", "Low"])
        assert.equal(tracker.fields.type, undefined)
        assert.deepEqual(github.repositoryLabels, defaultRepositoryLabels())
        const statusOptions = github.projects[0].fields[0].options!
        assert.equal(statusOptions.find((option) => option.name === "Todo")?.id, "default-0")
        assert.equal(statusOptions.find((option) => option.name === "In Progress")?.id, "default-1")
        assert.equal(statusOptions.find((option) => option.name === "Done")?.id, "default-2")
        assert.equal(github.deleteProjectFieldAttempts, 0)
        assert.ok(github.authorizationHeaders.every((header) => header === "Bearer secret-token"))
        assert.doesNotMatch(JSON.stringify(applied), /secret-token/)
    })

    it("preserves views and requires explicit recovery after a lost Project-create response", async () => {
        const github = new FakeGitHub()
        const specification = projectContained({
            mode: "new",
            title: "Recovered creation",
            visibility: "private",
            associateRepository: false,
        })
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        github.loseNextProjectCreateResponse = true
        await assert.rejects(
            runGitHubProjectSetup(
                { operation: "apply", specification, approvedPlanHash: preview.planHash },
                setupOptions(github),
            ),
            /select it as resume-created/,
        )
        assert.equal(github.projects.length, 1)
        assert.equal(github.projectViews(github.projects[0]).length, 1)
        assert.deepEqual(github.viewWrites, [])
    })

    it("reuses exact managed labels and blocks conflicting label metadata", async () => {
        const github = new FakeGitHub()
        const specification = projectContained({
            mode: "new",
            title: "Label validation",
            visibility: "private",
            associateRepository: false,
        })
        github.repositoryLabels.push({ name: "Kind: Epic", color: "ffffff", description: "Wrong" })
        const blocked = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(blocked.state, "blocked")
        assert.match(JSON.stringify(blocked.conflicts), /incompatible color or description/)

        github.repositoryLabels = defaultRepositoryLabels()
        const ready = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(ready.state, "ready")
        assert.doesNotMatch(JSON.stringify(ready.actions), /create-repository-label/)
    })

    it("rejects case-insensitive managed-label collisions before preview", async () => {
        const github = new FakeGitHub()
        const base = projectContained({
            mode: "new",
            title: "Label collision",
            visibility: "private",
            associateRepository: false,
        })
        const specification = {
            ...base,
            labels: {
                ...base.labels,
                kind: {
                    ...base.labels.kind,
                    deliverableKinds: {
                        ...base.labels.kind.deliverableKinds,
                        feature: { ...base.labels.kind.deliverableKinds.feature, name: "kind: epic" },
                    },
                },
            },
        }
        await assert.rejects(
            runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github)),
            /label names must be distinct case-insensitively/,
        )
        assert.equal(github.repositoryLabels.length, 0)
    })

    it("recovers an uncertain repository-label create from provider state", async () => {
        const github = new FakeGitHub()
        const specification = projectContained({
            mode: "new",
            title: "Recovered label",
            visibility: "private",
            associateRepository: false,
        })
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        github.loseNextRepositoryLabelCreateResponse = true
        const applied = await runGitHubProjectSetup(
            { operation: "apply", specification, approvedPlanHash: preview.planHash },
            setupOptions(github),
        )
        assert.equal(applied.state, "provisioned")
        assert.deepEqual(github.repositoryLabels, defaultRepositoryLabels())
    })

    it("provisions explicitly approved organization issue fields without managing native types", async () => {
        const github = new FakeGitHub()
        github.projects.push({
            id: "project-1",
            number: 1,
            title: "Organization workflow",
            shortDescription: null,
            url: "https://github.com/orgs/acme/projects/1",
            public: false,
            closed: false,
            itemCount: 0,
            fields: [
                {
                    id: "status",
                    name: "Status",
                    dataType: "SINGLE_SELECT",
                    options: Object.values(GITHUB_PROJECT_DEFAULTS.status.options).map((option, index) => ({
                        id: `status-${index}`,
                        name: option.name,
                        description: option.description,
                        color: option.color,
                    })),
                },
            ],
            repositoryIds: [],
        })
        const specification = organizationNative({
            mode: "existing",
            number: 1,
            visibility: "public",
            associateRepository: true,
        })
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(preview.state, "ready")
        assert.match(JSON.stringify(preview), /Change Project visibility to public/)
        assert.match(JSON.stringify(preview), /Associate.*repository repo-node/)
        assert.match(JSON.stringify(preview), /Create organization issue field.*Priority/)
        assert.doesNotMatch(JSON.stringify(preview), /issue type/i)

        const applied = await runGitHubProjectSetup(
            { operation: "apply", specification, approvedPlanHash: preview.planHash },
            setupOptions(github),
        )
        assert.equal(applied.state, "provisioned")
        assert.equal(github.projects[0].public, true)
        assert.deepEqual(github.projects[0].repositoryIds, ["repo-node"])
        assert.deepEqual(
            github.issueFields.map((field) => field.name),
            ["Priority"],
        )
        const tracker = applied.trackerConfig as Record<string, any>
        assert.equal(tracker.fields.priority.scope, "issue")
        assert.equal(tracker.fields.type, undefined)
    })

    it("appends Canceled to a populated compatible Status field", async () => {
        const github = new FakeGitHub()
        const existingOptions: NonNullable<FakeField["options"]> = Object.entries(
            GITHUB_PROJECT_DEFAULTS.status.options,
        )
            .filter(([key]) => key !== "canceled")
            .map(([, option], index) => ({
                id: `existing-${index}`,
                name: option.name,
                description: option.description,
                color: option.color,
            }))
        existingOptions.push({ id: "existing-extra", name: "Paused", description: "Custom", color: "pink" })
        github.projects.push({
            id: "project-1",
            number: 1,
            title: "Existing",
            url: "https://github.com/users/alex/projects/1",
            public: false,
            closed: false,
            shortDescription: null,
            itemCount: 3,
            fields: [{ id: "status", name: "Status", dataType: "SINGLE_SELECT", options: existingOptions }],
            repositoryIds: [],
        })
        const specification = projectContained({
            mode: "existing",
            number: 1,
            visibility: "private",
            associateRepository: false,
        })
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(preview.state, "ready")
        assert.match(JSON.stringify(preview.actions), /Append Status option.*Canceled/)

        await runGitHubProjectSetup(
            { operation: "apply", specification, approvedPlanHash: preview.planHash },
            setupOptions(github),
        )
        const updated = github.projects[0].fields[0].options!
        assert.deepEqual(
            updated.slice(0, existingOptions.length).map((option) => option.id),
            existingOptions.map((option) => option.id),
        )
        assert.equal(updated.find((option) => option.name === "Paused")?.id, "existing-extra")
        assert.equal(updated.find((option) => option.name === "Canceled")?.description, "Canceled work.")

        const repeated = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(repeated.state, "ready")
        assert.deepEqual(repeated.actions, [])
    })

    it("blocks incompatible existing fields and exact-title recreation", async () => {
        const github = new FakeGitHub()
        github.projects.push({
            id: "project-1",
            number: 1,
            title: "Existing",
            url: "https://github.com/users/alex/projects/1",
            public: false,
            closed: false,
            shortDescription: null,
            itemCount: 3,
            fields: [{ id: "status", name: "Status", dataType: "TEXT" }],
            repositoryIds: [],
        })
        const existing = await runGitHubProjectSetup(
            {
                operation: "preview",
                specification: projectContained({
                    mode: "existing",
                    number: 1,
                    visibility: "private",
                    associateRepository: false,
                }),
            },
            setupOptions(github),
        )
        assert.equal(existing.state, "blocked")
        assert.match(JSON.stringify(existing), /incompatible type or options/)

        const duplicate = await runGitHubProjectSetup(
            {
                operation: "preview",
                specification: projectContained({
                    mode: "new",
                    title: "Existing",
                    visibility: "private",
                    associateRepository: false,
                }),
            },
            setupOptions(github),
        )
        assert.equal(duplicate.state, "blocked")
        assert.deepEqual((duplicate.candidates as unknown[]).length, 1)
    })

    it("rejects apply when remote state changes after preview approval", async () => {
        const github = new FakeGitHub()
        const specification = projectContained({
            mode: "new",
            title: "Changed remotely",
            visibility: "private",
            associateRepository: false,
        })
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        github.projects.push({
            id: "project-remote",
            shortDescription: null,
            number: 9,
            title: "Changed remotely",
            url: "https://github.com/users/alex/projects/9",
            public: false,
            closed: false,
            itemCount: 0,
            fields: [],
            repositoryIds: [],
        })
        await assert.rejects(
            () =>
                runGitHubProjectSetup(
                    { operation: "apply", specification, approvedPlanHash: preview.planHash },
                    setupOptions(github),
                ),
            /changed after approval/,
        )
    })

    it("updates native Status in place only for empty resumed Projects", async () => {
        for (const mode of ["existing", "resume-created"] as const) {
            for (const itemCount of [0, 2]) {
                for (const statusName of ["Status", "Workflow Status"]) {
                    const github = new FakeGitHub()
                    github.projects.push({
                        id: "project-1",
                        number: 1,
                        title: "Resume",
                        shortDescription: null,
                        url: "https://github.com/users/alex/projects/1",
                        public: false,
                        closed: false,
                        itemCount,
                        repositoryIds: [],
                        fields: [
                            {
                                id: "default-status",
                                name: "Status",
                                dataType: "SINGLE_SELECT",
                                options: options("Todo"),
                            },
                        ],
                    })
                    const base = projectContained({
                        mode,
                        number: 1,
                        visibility: "private",
                        associateRepository: false,
                    })
                    const specification = {
                        ...base,
                        fields: { ...base.fields, status: { ...base.fields.status, field: statusName } },
                    }
                    const preview = await runGitHubProjectSetup(
                        { operation: "preview", specification },
                        setupOptions(github),
                    )
                    const ready = mode === "resume-created" && itemCount === 0
                    assert.equal(preview.state, ready ? "ready" : "blocked")
                    assert.equal(github.projects[0].fields.length, 1)
                    if (!ready) continue
                    await runGitHubProjectSetup(
                        { operation: "apply", specification, approvedPlanHash: preview.planHash },
                        setupOptions(github),
                    )
                    assert.ok(github.projects[0].fields.some((field) => field.name === statusName))
                    assert.equal(
                        github.projects[0].fields.some((field) => field.id === "default-status"),
                        true,
                    )
                    assert.equal(github.deleteProjectFieldAttempts, 0)
                    const repeated = await runGitHubProjectSetup(
                        { operation: "preview", specification },
                        setupOptions(github),
                    )
                    assert.equal(repeated.state, "ready")
                    assert.deepEqual(repeated.actions, [])
                }
            }
        }
    })

    it("renames compatible native Status only for an empty resumed Project", async () => {
        for (const mode of ["existing", "resume-created"] as const) {
            const github = new FakeGitHub()
            github.projects.push({
                id: "project-1",
                number: 1,
                title: "Compatible native Status",
                shortDescription: null,
                url: "https://github.com/users/alex/projects/1",
                public: false,
                closed: false,
                itemCount: 0,
                repositoryIds: [],
                fields: [
                    {
                        id: "default-status",
                        name: "Status",
                        dataType: "SINGLE_SELECT",
                        options: Object.values(GITHUB_PROJECT_DEFAULTS.status.options).map((option, index) => ({
                            id: `native-${index}`,
                            name: option.name,
                            description: option.description,
                            color: option.color,
                        })),
                    },
                ],
            })
            const base = projectContained({
                mode,
                number: 1,
                visibility: "private",
                associateRepository: false,
            })
            const specification = {
                ...base,
                fields: { ...base.fields, status: { ...base.fields.status, field: "Workflow Status" } },
            }
            const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            assert.equal(preview.state, mode === "resume-created" ? "ready" : "blocked")
            if (mode === "existing") continue
            assert.match(JSON.stringify(preview.actions), /update-native-status/)
            await runGitHubProjectSetup(
                { operation: "apply", specification, approvedPlanHash: preview.planHash },
                setupOptions(github),
            )
            assert.equal(github.projects[0].fields[0].name, "Workflow Status")
            assert.equal(github.projects[0].fields[0].id, "default-status")
        }
    })

    it("preserves organization metadata opt-in, compatibility, and mixed scopes", async () => {
        const github = new FakeGitHub()
        const base = organizationNative({
            mode: "new",
            title: "Mixed",
            visibility: "private",
            associateRepository: false,
        })
        const specification = {
            ...base,
            fields: { ...base.fields, priority: { ...base.fields.priority, provisionMissing: false } },
        }
        const blocked = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(blocked.state, "blocked")
        assert.equal(github.projects.length, 0)
        github.issueFields.push({ id: 1, name: "Priority", data_type: "text" })
        const incompatible = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(incompatible.state, "blocked")
        github.issueFields = []
        const mixed = {
            ...base,
            fields: {
                ...base.fields,
                priority: { scope: "project", ...structuredClone(GITHUB_PROJECT_DEFAULTS.priority) },
            },
        }
        const preview = await runGitHubProjectSetup(
            { operation: "preview", specification: mixed },
            setupOptions(github),
        )
        assert.equal(preview.state, "ready")
        await runGitHubProjectSetup(
            { operation: "apply", specification: mixed, approvedPlanHash: preview.planHash },
            setupOptions(github),
        )
        assert.deepEqual(github.issueFields, [])
        assert.deepEqual(
            github.projects[0].fields.map((field) => field.name),
            ["Status", "Phase", "Priority"],
        )
    })

    it("reuses compatible Phase metadata and blocks incompatible existing fields", async () => {
        const github = new FakeGitHub()
        const specification = projectContained({
            mode: "new",
            title: "Phase",
            visibility: "private",
            associateRepository: false,
        })
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        await runGitHubProjectSetup(
            { operation: "apply", specification, approvedPlanHash: preview.planHash },
            setupOptions(github),
        )
        const existing = projectContained({
            mode: "existing",
            number: 1,
            visibility: "private",
            associateRepository: false,
        })
        existing.presentation.target = { mode: "selected", viewId: github.projectViews(github.projects[0])[0].id }
        const reused = await runGitHubProjectSetup(
            { operation: "preview", specification: existing },
            setupOptions(github),
        )
        assert.equal(reused.state, "ready")
        assert.doesNotMatch(JSON.stringify(reused.actions), /create-project-field/)
        const phase = github.projects[0].fields.find((field) => field.name === "Phase")!
        const id = phase.id
        phase.options = phase.options!.filter((option) => option.name !== "Self-Review")
        const missing = await runGitHubProjectSetup(
            { operation: "preview", specification: existing },
            setupOptions(github),
        )
        assert.equal(missing.state, "blocked")
        assert.match(JSON.stringify(missing.conflicts), /Phase.*incompatible/)
        phase.dataType = "TEXT"
        const wrongType = await runGitHubProjectSetup(
            { operation: "preview", specification: existing },
            setupOptions(github),
        )
        assert.equal(wrongType.state, "blocked")
        assert.equal(phase.id, id)
        assert.equal(github.deleteProjectFieldAttempts, 0)
    })

    it("requires distinct Phase option and Project field names", async () => {
        const github = new FakeGitHub()
        const base = projectContained({
            mode: "new",
            title: "Phase",
            visibility: "private",
            associateRepository: false,
        })
        const duplicateField = { ...base, fields: { ...base.fields, phase: { ...base.fields.phase, field: "Status" } } }
        await assert.rejects(
            runGitHubProjectSetup({ operation: "preview", specification: duplicateField }, setupOptions(github)),
            /field names must be distinct/,
        )
        const duplicateOption = {
            ...base,
            fields: {
                ...base.fields,
                phase: {
                    ...base.fields.phase,
                    options: {
                        ...base.fields.phase.options,
                        selfReview: { ...base.fields.phase.options.selfReview, name: "Execution" },
                    },
                },
            },
        }
        await assert.rejects(
            runGitHubProjectSetup({ operation: "preview", specification: duplicateOption }, setupOptions(github)),
            /Phase option names must be distinct/,
        )
        assert.equal(github.projects.length, 0)
    })

    const newSpecification = () =>
        projectContained({ mode: "new", title: "Presentation", visibility: "private", associateRepository: true })
    const apply = async (github: FakeGitHub, specification: unknown) => {
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(preview.state, "ready", JSON.stringify(preview))
        return runGitHubProjectSetup(
            { operation: "apply", specification, approvedPlanHash: preview.planHash },
            setupOptions(github),
        )
    }
    const seed = async (github: FakeGitHub) => {
        const result = await apply(github, newSpecification())
        github.viewWrites = []
        const specification = projectContained({
            mode: "existing",
            number: 1,
            visibility: "private",
            associateRepository: true,
        })
        specification.presentation.target = { mode: "selected", viewId: (result.view as any).id }
        return specification
    }

    it("previews, writes, and inspects the setup repository description rather than the Project owner", async () => {
        const github = new FakeGitHub()
        const specification = newSpecification()
        const desired = "Repository: https://github.com/acme/example"
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        const action = (preview.actions as any[]).find((action) => action.kind === "set-project-description")
        assert.deepEqual(action.details, { current: null, desired })
        assert.match(action.description, /null.*Repository: https:\/\/github.com\/acme\/example/)
        assert.equal(github.projectWrites.length, 0)
        await apply(github, specification)
        assert.equal(github.projects[0].shortDescription, desired)
        assert.deepEqual(github.projectWrites, [
            { projectId: "project-1", public: false },
            { projectId: "project-1", shortDescription: desired },
        ])
        const inspected = await runGitHubProjectSetup(
            {
                operation: "inspectProject",
                credentialEnv: "GITHUB_TOKEN_FOR_TEST",
                projectOwner: specification.projectOwner,
                projectNumber: 1,
            },
            setupOptions(github),
        )
        assert.equal((inspected.project as any).shortDescription, desired)
    })

    it("replaces only differing descriptions on existing and resumed Projects", async () => {
        const desired = "Repository: https://github.com/acme/example"
        for (const mode of ["existing", "resume-created"]) {
            for (const current of [null, "", "Custom description", desired]) {
                const github = new FakeGitHub()
                const specification = await seed(github)
                specification.project.mode = mode
                const project = github.projects[0]
                project.shortDescription = current
                project.repositoryIds.push("another-repository")
                Object.assign(project, { readme: "Keep this README", itemValues: [{ status: "Todo" }] })
                const before = structuredClone(project)
                github.projectWrites = []
                const preview = await runGitHubProjectSetup(
                    { operation: "preview", specification },
                    setupOptions(github),
                )
                const actions = (preview.actions as any[]).filter((action) => action.kind === "set-project-description")
                assert.equal(actions.length, current === desired ? 0 : 1)
                if (actions.length) assert.deepEqual(actions[0].details, { current, desired })
                await apply(github, specification)
                assert.deepEqual(project, { ...before, shortDescription: desired })
                assert.deepEqual(
                    github.projectWrites,
                    current === desired ? [] : [{ projectId: project.id, shortDescription: desired }],
                )
                assert.equal(github.viewWrites.length, 0)
                assert.equal(github.projects.length, 1)
            }
        }
    })

    it("invalidates description replacement approval when the current text changes", async () => {
        const github = new FakeGitHub()
        const specification = await seed(github)
        github.projects[0].shortDescription = "First description"
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        github.projects[0].shortDescription = "Changed by the user"
        github.projectWrites = []
        await assert.rejects(
            runGitHubProjectSetup(
                { operation: "apply", specification, approvedPlanHash: preview.planHash },
                setupOptions(github),
            ),
            /changed after approval/,
        )
        assert.equal(github.projects[0].shortDescription, "Changed by the user")
        assert.deepEqual(github.projectWrites, [])
    })

    it("preserves partial Projects after failed or ignored description writes and resumes without replacement", async () => {
        for (const failure of ["denied", "ignored", "lost-response"]) {
            const github = new FakeGitHub()
            const specification = newSpecification()
            const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            const fetch: typeof globalThis.fetch = async (input, init) => {
                const body = init?.body ? JSON.parse(String(init.body)) : undefined
                if (body?.query?.includes("updateProjectV2(") && "shortDescription" in body.variables) {
                    if (failure === "lost-response") await github.fetch(input, init)
                    return failure === "ignored"
                        ? graph({ updateProjectV2: { projectV2: { id: "project-1" } } })
                        : json({ message: "description write failed secret-token" }, 503)
                }
                return github.fetch(input, init)
            }
            await assert.rejects(
                runGitHubProjectSetup(
                    { operation: "apply", specification, approvedPlanHash: preview.planHash },
                    { ...setupOptions(github), fetch },
                ),
                (error: Error) => {
                    assert.match(
                        error.message,
                        failure === "ignored"
                            ? /final verification.*short description/
                            : /Project creation\/settings.*POST \/graphql.*503/,
                    )
                    assert.doesNotMatch(inspect(error, { depth: 20 }), /secret-token|Authorization/)
                    return true
                },
            )
            assert.equal(github.projects.length, 1)
            const project = github.projects[0]
            const resumed = projectContained({
                mode: "resume-created",
                number: project.number,
                visibility: "private",
                associateRepository: true,
            })
            resumed.presentation.target = { mode: "selected", viewId: github.projectViews(project)[0].id }
            github.projectWrites = []
            await apply(github, resumed)
            assert.equal(github.projects.length, 1)
            assert.equal(project.shortDescription, "Repository: https://github.com/acme/example")
            assert.equal(github.projectWrites.length, failure === "lost-response" ? 0 : 1)
        }
    })

    it("returns a saved-state manual default-Status follow-up in every mode and layout, including repository opt-out", async () => {
        for (const mode of ["new", "existing", "resume-created"]) {
            for (const layout of ["board", "table", "roadmap"]) {
                for (const defaultRepository of ["setup-repository", "unmanaged"]) {
                    const github = new FakeGitHub()
                    const defaults = newSpecification()
                    const initial = {
                        ...defaults,
                        fields: {
                            ...defaults.fields,
                            status: {
                                ...defaults.fields.status,
                                field: "Work state",
                                options: {
                                    ...defaults.fields.status.options,
                                    backlog: { ...defaults.fields.status.options.backlog, name: "Ideas" },
                                },
                            },
                        },
                    }
                    const base =
                        mode === "new"
                            ? initial
                            : {
                                  ...projectContained({
                                      mode,
                                      number: 1,
                                      visibility: "private",
                                      associateRepository: true,
                                  }),
                                  fields: initial.fields,
                              }
                    if (mode !== "new") {
                        const seeded = await apply(github, initial)
                        base.presentation.target = { mode: "selected", viewId: (seeded.view as any).id }
                    }
                    const specification = {
                        ...base,
                        defaultRepository,
                        presentation: {
                            ...base.presentation,
                            layout,
                            visibleFields: layout === "roadmap" ? [] : base.presentation.visibleFields,
                        },
                    }
                    const preview = await runGitHubProjectSetup(
                        { operation: "preview", specification },
                        setupOptions(github),
                    )
                    const previewNote = (preview.manualSteps as any[]).find((step) => step.setting === "defaultStatus")
                    assert.equal(previewNote.desired, "Ideas")
                    const result = await apply(github, specification)
                    const note = (result.manualSteps as any[]).find((step) => step.setting === "defaultStatus")
                    assert.equal(note.desired, "Ideas")
                    assert.match(note.instructions, /not applied automatically.*do not expose a setter/)
                    assert.ok(
                        note.instructions.includes(
                            `${github.projects[0].url} → Project menu → Settings → Work state → Default value`,
                        ),
                    )
                    assert.doesNotMatch(note.instructions, /\/views\//)
                    assert.match(
                        note.verification,
                        /Reload.*Work state's saved default is Ideas.*user confirmation or a screenshot.*before full setup completion/,
                    )
                    assert.deepEqual(result.verification, { api: "verified", manual: "requires-user-confirmation" })
                    assert.equal((result.trackerConfig as any).defaultStatus, undefined)
                }
            }
        }
    })

    it("creates personal Boards once through the verified owner-login route without an owner lookup", async () => {
        const github = new FakeGitHub()
        const result = await apply(github, newSpecification())
        assert.equal(result.state, "provisioned")
        assert.equal(github.viewWrites[0].route, "users/alex")
        assert.deepEqual(
            github.restRequests.filter((request) => request.includes("/users/")),
            ["POST https://api.github.com/users/alex/projectsV2/1/views"],
        )
    })

    for (const responseKind of ["normal", "missing-envelope", "lost"])
        it(`accepts reordered Board visibility with a ${responseKind} create response`, async () => {
            const github = new FakeGitHub()
            github.onBoardCreate = (_project, view) => {
                view.visibleFieldIds.reverse()
            }
            github.loseNextViewCreateResponse = responseKind === "lost"
            const specification = newSpecification()
            const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            const fetch: typeof globalThis.fetch = async (input, init) => {
                const response = await github.fetch(input, init)
                // The live 201 response had no `value`; its complete shape was not retained.
                return responseKind === "missing-envelope" &&
                    String(input).endsWith("/views") &&
                    init?.method === "POST"
                    ? json({}, 201)
                    : response
            }
            const result = await runGitHubProjectSetup(
                { operation: "apply", specification, approvedPlanHash: preview.planHash },
                { ...setupOptions(github), fetch },
            )
            assert.equal(result.state, "provisioned")
            assert.deepEqual(
                github.viewWrites.map((write) => write.operation),
                ["rest-create", "delete"],
            )
            assert.equal(github.viewWrites[1].viewId, "view-1-1")
            assert.deepEqual(
                github.projectViews(github.projects[0]).map((view) => view.id),
                [(result.view as any).id],
            )
        })

    for (const failure of ["404", "403", "invalid-json", "network", "recovery-read"])
        it(`preserves partial setup and safe Board request context after ${failure}`, async () => {
            const github = new FakeGitHub()
            const specification = newSpecification()
            const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            let attempts = 0
            const fetch: typeof globalThis.fetch = async (input, init) => {
                if (String(input).endsWith("/views") && init?.method === "POST") {
                    attempts++
                    if (failure === "invalid-json") return new Response("not JSON secret-token", { status: 502 })
                    if (failure === "network") throw new TypeError("secret-token with raw request details")
                    return json({ message: "Board unavailable secret-token" }, failure === "403" ? 403 : 404)
                }
                if (attempts > 0 && failure === "recovery-read")
                    return json({ errors: [{ message: "Recovery unavailable secret-token" }] })
                return github.fetch(input, init)
            }
            await assert.rejects(
                runGitHubProjectSetup(
                    { operation: "apply", specification, approvedPlanHash: preview.planHash },
                    { ...setupOptions(github), fetch },
                ),
                (error: Error) => {
                    assert.match(error.message, /during Board setup/)
                    assert.match(error.message, /POST \/users\/alex\/projectsV2\/1\/views/)
                    if (failure === "invalid-json") assert.match(error.message, /invalid JSON.*502/)
                    else if (failure === "network") assert.match(error.message, /network request failed/)
                    else assert.match(error.message, failure === "403" ? /403/ : /404/)
                    if (failure === "recovery-read") {
                        assert.match(error.message, /recovery read failed/)
                        assert.match(error.message, /POST \/graphql/)
                        assert.match(error.message, /Recovery unavailable/)
                    }
                    assert.doesNotMatch(inspect(error, { depth: 20 }), /secret-token|Authorization|raw request details/)
                    return true
                },
            )
            assert.equal(attempts, 1)
            assert.equal(github.projects.length, 1)
            assert.equal(github.projectViews(github.projects[0]).length, 1)
            assert.equal(github.projectViews(github.projects[0])[0].name, "View 1")
            assert.deepEqual(github.viewWrites, [])
        })

    it("reports safe discovery HTTP errors with method, path and stage", async () => {
        await assert.rejects(
            runGitHubProjectSetup(
                {
                    operation: "inspectRepository",
                    credentialEnv: "GITHUB_TOKEN_FOR_TEST",
                    repository: { owner: "acme", repo: "example" },
                },
                {
                    env: { GITHUB_TOKEN_FOR_TEST: "secret-token" },
                    fetch: async () => json({ message: "Unavailable secret-token" }, 503),
                },
            ),
            (error: Error) => {
                assert.match(error.message, /during inspectRepository/)
                assert.match(error.message, /GET \/repos\/acme\/example/)
                assert.match(error.message, /503.*Unavailable/)
                assert.doesNotMatch(inspect(error, { depth: 20 }), /secret-token|Authorization/)
                return true
            },
        )
    })

    it("reports safe GraphQL errors during discovery", async () => {
        const github = new FakeGitHub()
        await assert.rejects(
            runGitHubProjectSetup(
                {
                    operation: "inspect",
                    credentialEnv: "GITHUB_TOKEN_FOR_TEST",
                    repository: { owner: "acme", repo: "example" },
                    projectOwner: { login: "alex", type: "user" },
                    includeOrganizationMetadata: false,
                },
                {
                    ...setupOptions(github),
                    fetch: async (input, init) =>
                        String(input).endsWith("/graphql")
                            ? json({ errors: [{ message: "Query unavailable secret-token" }] })
                            : github.fetch(input, init),
                },
            ),
            (error: Error) => {
                assert.match(error.message, /during inspect/)
                assert.match(error.message, /POST \/graphql.*Query unavailable/)
                assert.doesNotMatch(inspect(error, { depth: 20 }), /secret-token|Authorization/)
                return true
            },
        )
    })

    for (const stage of [
        "Project creation/settings",
        "Project fields",
        "repository labels",
        "organization metadata",
        "final verification",
    ])
        it(`identifies the ${stage} provisioning stage`, async () => {
            const github = new FakeGitHub()
            const specification =
                stage === "organization metadata"
                    ? organizationNative({
                          mode: "new",
                          title: "Probe",
                          visibility: "private",
                          associateRepository: false,
                      })
                    : newSpecification()
            const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            const fetch: typeof globalThis.fetch = async (input, init) => {
                const url = String(input)
                const query = url.endsWith("/graphql") ? JSON.parse(String(init?.body)).query : ""
                const fail =
                    (stage === "Project creation/settings" && query.includes("createProjectV2(")) ||
                    (stage === "Project fields" && query.includes("createProjectV2Field(")) ||
                    (stage === "repository labels" && init?.method === "POST" && url.endsWith("/labels")) ||
                    (stage === "organization metadata" && init?.method === "POST" && url.endsWith("/issue-fields")) ||
                    (stage === "final verification" &&
                        url.includes("/labels/") &&
                        github.viewWrites.some((write) => write.operation === "delete"))
                if (fail) return json({ message: "Unavailable secret-token" }, 503)
                return github.fetch(input, init)
            }
            await assert.rejects(
                runGitHubProjectSetup(
                    { operation: "apply", specification, approvedPlanHash: preview.planHash },
                    { ...setupOptions(github), fetch },
                ),
                (error: Error) => {
                    assert.ok(error.message.includes(`during ${stage}:`), error.message)
                    assert.match(error.message, /(?:GET|POST) \/.*503/)
                    assert.doesNotMatch(inspect(error, { depth: 20 }), /secret-token|Authorization/)
                    return true
                },
            )
        })

    it("encodes and verifies the confirmed Board defaults without claiming manual completion", async () => {
        const github = new FakeGitHub()
        const specification = newSpecification()
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(github.projects.length, 0)
        assert.equal(github.viewWrites.length, 0)
        assert.match(JSON.stringify(preview.actions), /create-board-view/)
        assert.match(JSON.stringify(preview.actions), /delete-created-default-view/)
        const result = await apply(github, specification)
        const view = result.view as Record<string, any>
        assert.equal(view.name, "Board")
        assert.equal(view.layout, "board")
        assert.deepEqual(
            view.visibleFieldIds
                .map((id: string) => allFields(github.projects[0]).find((field) => field.id === id)!.name)
                .sort(),
            [
                "Title",
                "Assignees",
                "Status",
                "Linked pull requests",
                "Sub-issues progress",
                "Labels",
                "Priority",
                "Phase",
            ].sort(),
        )
        assert.equal(
            github.projects[0].fields.some((field) => field.name === "Kind"),
            false,
        )
        assert.equal(github.deleteProjectFieldAttempts, 0)
        assert.deepEqual(result.verification, { api: "verified", manual: "requires-user-confirmation" })
        assert.deepEqual(
            (result.manualSteps as any[]).map((step) => step.setting),
            ["fieldSum", "sliceBy", "defaultRepository", "defaultStatus"],
        )
        assert.match(JSON.stringify(result.manualSteps), /Save changes/)
        assert.deepEqual(view.groupBy, [])
        assert.equal(view.verticalGroupBy[0].name, "Status")
        assert.equal(view.sortBy[0].field.name, "Priority")
        assert.equal(view.sortBy[0].direction, "ASC")
        assert.deepEqual(
            github.viewWrites.map((write) => write.operation),
            ["rest-create", "delete"],
        )
        assert.equal(github.viewWrites[1].viewId, "view-1-1")
        assert.deepEqual(
            github.projectViews(github.projects[0]).map((view) => view.id),
            [view.id],
        )
        assert.deepEqual(GITHUB_PROJECT_DEFAULTS.board, {
            columnBy: "status",
            swimlanes: "none",
            sortBy: { field: "priority", order: "configured-option-order" },
            fieldSum: "count",
            sliceBy: "none",
        })
        assert.match(JSON.stringify(result.manualSteps), /Count only/)
        assert.match(JSON.stringify(result.manualSteps), /No slicing/)
        assert.match(JSON.stringify(result.manualSteps), /acme\/example/)
        assert.equal((result.trackerConfig as any).presentation, undefined)
        assert.equal(GITHUB_PROJECT_DEFAULTS.associateRepository, true)
        assert.equal(GITHUB_PROJECT_DEFAULTS.defaultRepository, "setup-repository")
        assert.deepEqual(Object.keys(github.viewWrites[0]).sort(), [
            "group_by",
            "layout",
            "name",
            "operation",
            "route",
            "sort_by",
            "vertical_group_by",
            "visible_fields",
        ])
        assert.equal(github.viewWrites[0].route, "users/alex")
        assert.ok(github.viewWrites[0].visible_fields.every((id: unknown) => typeof id === "number"))
    })

    it("creates a missing initial view and reconciles a lost create response without duplication", async () => {
        const github = new FakeGitHub()
        github.initialViewCount = 0
        github.loseNextViewCreateResponse = true
        await apply(github, newSpecification())
        assert.equal(github.projectViews(github.projects[0]).length, 1)
        assert.equal(github.viewWrites.length, 1)
        assert.equal(github.viewWrites[0].operation, "rest-create")
    })

    it("preserves multiple initial views for explicit selection", async () => {
        const github = new FakeGitHub()
        github.initialViewCount = 2
        await assert.rejects(apply(github, newSpecification()), /multiple initial views/)
        assert.equal(github.projects.length, 1)
        assert.equal(github.projectViews(github.projects[0]).length, 2)
        assert.equal(github.viewWrites.length, 0)
    })

    it("updates only the selected view, preserving filters, grouping, sorting and other views", async () => {
        const github = new FakeGitHub()
        const specification = await seed(github)
        const views = github.projectViews(github.projects[0])
        const view = views[0]
        Object.assign(view, {
            name: "Old",
            layout: "TABLE_LAYOUT",
            filter: "is:open",
            groupBy: [github.projects[0].fields[0]],
            sortBy: [{ field: github.projects[0].fields[0], direction: "ASC" }],
        })
        views.push({ ...structuredClone(view), id: "other-view", number: 2 })
        const other = structuredClone(views[1])
        await apply(github, specification)
        assert.equal(view.filter, "is:open")
        assert.equal(view.groupBy.length, 1)
        assert.equal(view.sortBy[0].direction, "ASC")
        assert.deepEqual(views[1], other)
        assert.equal(github.viewWrites.length, 1)
        github.viewWrites = []
        await apply(github, specification)
        assert.equal(github.viewWrites.length, 0)
        const resumed = { ...specification, project: { ...specification.project, mode: "resume-created" } }
        await apply(github, resumed)
        assert.equal(github.viewWrites.length, 0)
    })

    it("reads every page of views, visible fields, grouping, columns and sorting without mutation", async () => {
        const github = new FakeGitHub()
        await seed(github)
        const project = github.projects[0]
        const view = github.projectViews(project)[0]
        view.groupBy = allFields(project).slice(0, 3)
        view.columns = allFields(project).slice(0, 4)
        view.sortBy = allFields(project)
            .slice(0, 5)
            .map((field) => ({ field, direction: "ASC" }))
        github.views.set(project.id, [
            view,
            { ...structuredClone(view), id: "view-two", number: 2 },
            { ...structuredClone(view), id: "view-three", number: 3 },
        ])
        github.pageSize = 2
        const result = await runGitHubProjectSetup(
            {
                operation: "inspectProject",
                credentialEnv: "GITHUB_TOKEN_FOR_TEST",
                projectOwner: { login: "alex", type: "user" },
                projectNumber: 1,
            },
            setupOptions(github),
        )
        const views = result.views as any[]
        assert.equal(views.length, 3)
        assert.equal(views[0].visibleFieldIds.length, 8)
        assert.equal(views[0].groupBy.length, 3)
        assert.equal(views[0].verticalGroupBy.length, 4)
        assert.equal(views[0].sortBy.length, 5)
        assert.equal((result.project as any).fields.length, 8)
        assert.equal(github.viewWrites.length, 0)
        assert.deepEqual(result.unavailableSettings, ["defaultRepository", "fieldSum", "sliceBy", "defaultStatus"])
    })

    it("blocks a missing or foreign view and requires explicit targets", async () => {
        const github = new FakeGitHub()
        const specification = await seed(github)
        const wrongView = {
            ...specification,
            presentation: { ...specification.presentation, target: { mode: "selected", viewId: "foreign-view" } },
        }
        const result = await runGitHubProjectSetup(
            { operation: "preview", specification: wrongView },
            setupOptions(github),
        )
        assert.equal(result.state, "blocked")
        assert.match(JSON.stringify(result.conflicts), /missing or does not belong/)
        await assert.rejects(
            runGitHubProjectSetup(
                {
                    operation: "preview",
                    specification: {
                        ...specification,
                        presentation: { ...specification.presentation, target: { mode: "initial" } },
                    },
                },
                setupOptions(github),
            ),
            /require an exact selected view/,
        )
        assert.equal(github.viewWrites.length, 0)
    })

    it("rejects duplicate selections and reports unavailable or ambiguous Project fields", async () => {
        const github = new FakeGitHub()
        const specification = await seed(github)
        const duplicate = {
            ...specification,
            presentation: {
                ...specification.presentation,
                visibleFields: [
                    { kind: "field", name: "Title" },
                    { kind: "field", name: "Title" },
                ],
            },
        }
        await assert.rejects(
            runGitHubProjectSetup({ operation: "preview", specification: duplicate }, setupOptions(github)),
            /visible field names must be distinct/,
        )
        const missing = {
            ...specification,
            presentation: {
                ...specification.presentation,
                visibleFields: [{ kind: "field", name: "Issue Priority not attached" }],
            },
        }
        const blocked = await runGitHubProjectSetup(
            { operation: "preview", specification: missing },
            setupOptions(github),
        )
        assert.equal(blocked.state, "blocked")
        assert.match(JSON.stringify(blocked.conflicts), /not exposed on the Project/)
        github.projects[0].fields.push({ id: "duplicate-title", name: "Title", dataType: "TEXT" })
        const ambiguous = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(ambiguous.state, "blocked")
        assert.match(JSON.stringify(ambiguous.conflicts), /ambiguous on the Project/)
        assert.equal(github.viewWrites.length, 0)
    })

    it("resolves configured workflow field names instead of hardcoding default names", async () => {
        const github = new FakeGitHub()
        const base = newSpecification()
        const specification = {
            ...base,
            fields: {
                ...base.fields,
                status: { ...base.fields.status, field: "Lifecycle" },
                priority: { ...base.fields.priority, field: "Urgency" },
                phase: { ...base.fields.phase, field: "Activity" },
            },
        }
        const result = await apply(github, specification)
        const view = result.view as any
        const names = view.visibleFieldIds.map(
            (id: string) => allFields(github.projects[0]).find((field) => field.id === id)!.name,
        )
        assert.ok(names.includes("Lifecycle"))
        assert.ok(names.includes("Urgency"))
        assert.ok(names.includes("Activity"))
        assert.equal(view.verticalGroupBy[0].name, "Lifecycle")
        assert.equal(view.sortBy[0].field.name, "Urgency")
    })

    it("blocks new Projects using incompatible organization Priority ordering", async () => {
        const github = new FakeGitHub()
        const specification = organizationNative({
            mode: "new",
            title: "Organization ordering",
            visibility: "private",
            associateRepository: true,
        })
        github.issueFields = [
            {
                id: 1,
                name: "Priority",
                data_type: "single_select",
                options: specification.fields.priority.options.map((option, index) => ({
                    ...option,
                    id: index + 1,
                    priority: [2, 1, 3, 4][index],
                })),
            },
        ]
        const original = structuredClone(github.issueFields)
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(preview.state, "blocked")
        assert.match(
            JSON.stringify(preview.conflicts),
            /High → Urgent → Medium → Low cannot produce Urgent → High → Medium → Low/,
        )
        await assert.rejects(
            runGitHubProjectSetup(
                { operation: "apply", specification, approvedPlanHash: preview.planHash },
                setupOptions(github),
            ),
            /provisioning is blocked/,
        )
        assert.equal(github.projects.length, 0)
        assert.equal(github.repositoryLabels.length, 0)
        assert.deepEqual(github.issueFields, original)
    })

    it("uses numeric organization option priorities rather than response-array order", async () => {
        const github = new FakeGitHub()
        const specification = organizationNative({
            mode: "new",
            title: "Numeric ordering",
            visibility: "private",
            associateRepository: true,
        })
        github.issueFields = [
            {
                id: 1,
                name: "Priority",
                data_type: "single_select",
                options: specification.fields.priority.options
                    .map((option, index) => ({ ...option, id: index + 1, priority: index + 1 }))
                    .reverse(),
            },
        ]
        const original = structuredClone(github.issueFields[0])
        const result = await apply(github, specification)
        assert.equal(result.state, "provisioned")
        assert.deepEqual(github.issueFields[0], original)
    })

    it("blocks unverifiable organization Priority ranks without guessing their order", async () => {
        for (const rank of [undefined, null, 1]) {
            const github = new FakeGitHub()
            const specification = organizationNative({
                mode: "new",
                title: "Unknown ordering",
                visibility: "private",
                associateRepository: true,
            })
            github.issueFields = [
                {
                    id: 1,
                    name: "Priority",
                    data_type: "single_select",
                    options: specification.fields.priority.options.map((option, index) => ({
                        ...option,
                        id: index + 1,
                        priority: rank,
                    })),
                },
            ]
            const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            assert.equal(preview.state, "blocked")
            assert.match(JSON.stringify(preview.conflicts), /cannot verify.*option priorities/)
            assert.equal(github.projects.length, 0)
        }
    })

    it("blocks incompatible saved Priority ordering before existing/resumed setup writes", async () => {
        for (const mode of ["existing", "resume-created"]) {
            for (const scope of ["project", "issue"]) {
                const github = new FakeGitHub()
                const base = await seed(github)
                const priority = github.projects[0].fields.find((field) => field.name === "Priority")!
                priority.isIssueField = scope === "issue"
                const [urgent, high, medium, low] = priority.options!
                priority.options = [high, urgent, medium, low]
                if (scope === "issue") {
                    github.issueFields = [
                        {
                            id: 1,
                            name: "Priority",
                            data_type: "single_select",
                            options: priority.options.map((option, index) => ({
                                ...option,
                                id: index + 1,
                                priority: index + 1,
                            })),
                        },
                    ]
                }
                const original = structuredClone(priority)
                const specification = {
                    ...base,
                    project: { ...base.project, mode },
                    fields: {
                        ...base.fields,
                        priority:
                            scope === "project"
                                ? base.fields.priority
                                : {
                                      ...base.fields.priority,
                                      scope: "issue",
                                      provisionMissing: true,
                                      visibility: "all",
                                  },
                    },
                }
                const preview = await runGitHubProjectSetup(
                    { operation: "preview", specification },
                    setupOptions(github),
                )
                assert.equal(preview.state, "blocked")
                assert.match(
                    JSON.stringify(preview.conflicts),
                    /High → Urgent → Medium → Low cannot produce Urgent → High → Medium → Low/,
                )
                assert.match(JSON.stringify(preview.conflicts), /field-wide and needs separate approval/)
                assert.match(
                    JSON.stringify(preview.conflicts),
                    scope === "project" ? /Project Settings/ : /organization Issue Field settings/,
                )
                await assert.rejects(
                    runGitHubProjectSetup(
                        { operation: "apply", specification, approvedPlanHash: preview.planHash },
                        setupOptions(github),
                    ),
                    /provisioning is blocked/,
                )
                assert.deepEqual(priority, original)
                assert.equal(github.viewWrites.length, 0)
            }
        }
    })

    it("accepts reversed Priority order and preserves unrelated options", async () => {
        for (const mode of ["existing", "resume-created"]) {
            const github = new FakeGitHub()
            const base = await seed(github)
            const priority = github.projects[0].fields.find((field) => field.name === "Priority")!
            priority.options!.reverse()
            priority.options!.splice(2, 0, {
                id: "extra",
                name: "Deferred",
                description: "Unmanaged option",
                color: "GRAY",
            })
            const original = structuredClone(priority)
            const result = await apply(github, { ...base, project: { ...base.project, mode } })
            assert.equal(
                (result.manualSteps as Array<{ setting: string; desired: string }>).find(
                    (step) => step.setting === "sortBy",
                )!.desired,
                "Priority: Urgent → High → Medium → Low",
            )
            assert.deepEqual(priority, original)
            assert.equal(github.viewWrites.length, 0)
        }
    })

    it("rejects stale view approval and read-back mismatches", async () => {
        const github = new FakeGitHub()
        const specification = await seed(github)
        const view = github.projectViews(github.projects[0])[0]
        view.name = "Before"
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        view.name = "After"
        await assert.rejects(
            runGitHubProjectSetup(
                { operation: "apply", specification, approvedPlanHash: preview.planHash },
                setupOptions(github),
            ),
            /changed after approval/,
        )
        assert.equal(github.viewWrites.length, 0)
        github.ignoreViewUpdate = true
        await assert.rejects(apply(github, specification), /view post-write verification failed/)
    })

    it("reconciles a lost update response from exact provider state", async () => {
        const github = new FakeGitHub()
        const specification = await seed(github)
        github.projectViews(github.projects[0])[0].name = "Old"
        github.loseNextViewUpdateResponse = true
        await apply(github, specification)
        assert.equal(github.viewWrites.length, 1)
    })

    it("keeps association and default-repository choices separate in every combination", async () => {
        for (const associateRepository of [true, false]) {
            for (const defaultRepository of ["setup-repository", "unmanaged"]) {
                const github = new FakeGitHub()
                const base = newSpecification()
                const specification = { ...base, project: { ...base.project, associateRepository }, defaultRepository }
                const preview = await runGitHubProjectSetup(
                    { operation: "preview", specification },
                    setupOptions(github),
                )
                if (!associateRepository && defaultRepository === "setup-repository") {
                    assert.equal(preview.state, "blocked")
                    assert.match(
                        JSON.stringify(preview.conflicts),
                        /enable association or leave the default repository unmanaged/,
                    )
                    assert.equal(github.projects.length, 0)
                } else {
                    const result = await apply(github, specification)
                    assert.equal(github.projects[0].repositoryIds.includes("repo-node"), associateRepository)
                    assert.equal(
                        (result.manualSteps as any[]).some((step) => step.setting === "defaultRepository"),
                        defaultRepository === "setup-repository",
                    )
                }
            }
        }
    })

    it("does not substitute a custom Project field for issue-scoped workflow metadata", async () => {
        const github = new FakeGitHub()
        const base = await seed(github)
        const specification = {
            ...base,
            fields: {
                ...base.fields,
                priority: {
                    ...structuredClone(GITHUB_PROJECT_DEFAULTS.priority),
                    scope: "issue",
                    provisionMissing: true,
                    visibility: "all",
                },
            },
        }
        const blocked = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(blocked.state, "blocked")
        assert.match(JSON.stringify(blocked.conflicts), /Priority.*not exposed/)
        assert.equal(github.viewWrites.length, 0)
        github.projects[0].fields.push({
            id: "issue-backed-priority",
            name: "Priority",
            dataType: "SINGLE_SELECT",
            isIssueField: true,
            options: options("Urgent", "High", "Medium", "Low"),
        })
        const result = await apply(github, specification)
        assert.ok((result.view as any).visibleFieldIds.includes("issue-backed-priority"))
        assert.equal(github.deleteProjectFieldAttempts, 0)
    })

    it("uses configured Priority option order for a fresh Board", async () => {
        const github = new FakeGitHub()
        const base = newSpecification()
        const names = ["Critical", "Important", "Routine", "Later"]
        const specification = {
            ...base,
            fields: {
                ...base.fields,
                priority: {
                    ...base.fields.priority,
                    field: "Urgency",
                    options: base.fields.priority.options.map((option, index) => ({ ...option, name: names[index] })),
                },
            },
        }
        const result = await apply(github, specification)
        const view = result.view as any
        assert.equal(view.sortBy[0].field.name, "Urgency")
        assert.equal(view.sortBy[0].direction, "ASC")
        assert.deepEqual(view.groupBy, [])
        const priority = github.projects[0].fields.find((field) => field.name === "Urgency")!
        assert.deepEqual(
            priority.options!.map((option) => option.name),
            names,
        )
    })

    it("supports table and roadmap layouts with their documented visible-field constraints", async () => {
        for (const layout of ["table", "roadmap"]) {
            const github = new FakeGitHub()
            const base = newSpecification()
            const specification = {
                ...base,
                presentation: {
                    ...base.presentation,
                    layout,
                    visibleFields: layout === "roadmap" ? [] : base.presentation.visibleFields,
                },
            }
            const result = await apply(github, specification)
            assert.equal((result.view as any).layout, layout)
            assert.equal(
                (result.manualSteps as any[]).some((step) => step.setting === "columnBy"),
                false,
            )
        }
        const github = new FakeGitHub()
        const base = newSpecification()
        await assert.rejects(
            runGitHubProjectSetup(
                {
                    operation: "preview",
                    specification: { ...base, presentation: { ...base.presentation, layout: "roadmap" } },
                },
                setupOptions(github),
            ),
            /roadmap views do not support visible fields/,
        )
        await assert.rejects(
            runGitHubProjectSetup(
                {
                    operation: "preview",
                    specification: { ...base, presentation: { ...base.presentation, visibleFields: [] } },
                },
                setupOptions(github),
            ),
            /explicit visible-field selection/,
        )
    })

    it("discovers canonical repository ownership and title without a Project owner", async () => {
        for (const ownerType of ["User", "Organization"]) {
            const github = new FakeGitHub()
            github.repositoryOwnerType = ownerType
            const inspected = await runGitHubProjectSetup(
                {
                    operation: "inspectRepository",
                    credentialEnv: "GITHUB_TOKEN_FOR_TEST",
                    repository: { owner: "acme", repo: "example" },
                },
                setupOptions(github),
            )
            assert.deepEqual(inspected, {
                repository: { owner: "acme", repo: "example", ownerType: ownerType === "User" ? "user" : "org" },
                suggestedProjectTitle: "example",
            })
            assert.deepEqual(github.restRequests, ["GET https://api.github.com/repos/acme/example"])
            for (const title of [inspected.suggestedProjectTitle, "Explicit title"]) {
                const base = newSpecification()
                const specification = { ...base, project: { ...base.project, title } }
                const preview = await runGitHubProjectSetup(
                    { operation: "preview", specification },
                    setupOptions(github),
                )
                assert.equal(
                    (preview.actions as any[]).find((action) => action.kind === "create-project").details.title,
                    title,
                )
            }
        }
    })

    it("rejects unsupported ownership and personal issue scope without organization discovery", async () => {
        const github = new FakeGitHub()
        github.repositoryOwnerType = "Unknown"
        await assert.rejects(
            runGitHubProjectSetup(
                {
                    operation: "inspectRepository",
                    credentialEnv: "GITHUB_TOKEN_FOR_TEST",
                    repository: { owner: "acme", repo: "example" },
                },
                setupOptions(github),
            ),
            /unsupported repository owner/,
        )
        github.repositoryOwnerType = "User"
        const specification = organizationNative({
            mode: "new",
            title: "Personal",
            visibility: "private",
            associateRepository: false,
        })
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        assert.equal(preview.state, "blocked")
        assert.match(JSON.stringify(preview.conflicts), /require a repository owned by an organization/)
        assert.ok(!github.restRequests.some((request) => request.includes("issue-fields")))
        assert.equal(github.projects.length, 0)
    })

    it("uses the organization REST route and sorts hidden reversed Priority without reordering it", async () => {
        const github = new FakeGitHub()
        const names = ["Low", "Medium", "High", "Urgent"]
        github.onProjectCreate = (project) =>
            project.fields.push({
                id: "priority",
                name: "Priority",
                dataType: "SINGLE_SELECT",
                options: options(...names),
            })
        const base = newSpecification()
        const specification = {
            ...base,
            projectOwner: { login: "acme", type: "org" },
            presentation: {
                ...base.presentation,
                visibleFields: base.presentation.visibleFields.filter(
                    (field) => !(field.kind === "workflow" && field.field === "priority"),
                ),
            },
        }
        const result = await apply(github, specification)
        assert.equal(github.viewWrites[0].route, "orgs/acme")
        assert.deepEqual(github.viewWrites[0].sort_by, [[106, "desc"]])
        assert.equal((result.view as any).sortBy[0].direction, "DESC")
        assert.ok(!(result.view as any).visibleFieldIds.includes("priority"))
        assert.deepEqual(
            github.projects[0].fields.find((field) => field.id === "priority")!.options!.map((option) => option.name),
            names,
        )
    })

    it("uses numeric organization option priorities for an issue-backed Board sort", async () => {
        const github = new FakeGitHub()
        const names = ["Low", "Medium", "High", "Urgent"]
        const nativeOptions = options(...names)
        github.issueFields = [
            {
                id: 1,
                name: "Priority",
                data_type: "single_select",
                options: nativeOptions
                    .map((option, index) => ({ ...option, id: index + 1, priority: index + 1 }))
                    .reverse(),
            },
        ]
        github.onProjectCreate = (project) =>
            project.fields.push({
                id: "issue-priority",
                name: "Priority",
                dataType: "SINGLE_SELECT",
                isIssueField: true,
                options: nativeOptions,
            })
        const base = organizationNative({
            mode: "new",
            title: "Issue Board",
            visibility: "private",
            associateRepository: false,
        })
        const result = await apply(github, { ...base, presentation: { ...base.presentation, layout: "board" } })
        assert.equal((result.view as any).sortBy[0].field.id, "issue-priority")
        assert.equal((result.view as any).sortBy[0].direction, "DESC")
        assert.equal(github.viewWrites[0].route, "orgs/acme")
    })

    it("preserves the default when numeric field identity is unavailable", async () => {
        const github = new FakeGitHub()
        github.onProjectCreate = (project) => {
            project.fields[0].databaseId = null
        }
        await assert.rejects(apply(github, newSpecification()), /no usable numeric database ID/)
        assert.deepEqual(github.viewWrites, [])
        assert.equal(github.projectViews(github.projects[0]).length, 1)
    })

    for (const [mismatch, diagnostic] of [
        ["columns", /columns expected/],
        ["swimlanes", /swimlanes expected none/],
        ["sort", /sort expected sole Priority field/],
        ["sort-field", /sort expected sole Priority field/],
        ["direction", /sort direction expected asc/],
        ["visible", /visible fields missing/],
        ["extra", /visible fields unexpected/],
        ["duplicate", /visible fields duplicate/],
        ["name", /name expected "Board"/],
        ["layout", /layout expected board/],
    ] as const)
        it(`preserves the default and explains Board ${mismatch} verification failure`, async () => {
            const github = new FakeGitHub()
            github.onBoardCreate = (project, view) => {
                if (mismatch === "columns") view.columns = []
                if (mismatch === "swimlanes") view.groupBy = [project.fields[0]]
                if (mismatch === "sort") view.sortBy = []
                if (mismatch === "sort-field") view.sortBy[0].field = project.fields[0]
                if (mismatch === "direction") view.sortBy[0].direction = "DESC"
                if (mismatch === "visible") view.visibleFieldIds = [builtins[0].id]
                if (mismatch === "extra") {
                    project.fields.push({ id: "field-extra", name: "Unselected", dataType: "TEXT" })
                    view.visibleFieldIds.push("field-extra")
                }
                if (mismatch === "duplicate") view.visibleFieldIds.push(view.visibleFieldIds[0])
                if (mismatch === "name") view.name = "secret-token unexpected name"
                if (mismatch === "layout") view.layout = "TABLE_LAYOUT"
            }
            await assert.rejects(apply(github, newSpecification()), (error: Error) => {
                assert.match(error.message, /during Board setup.*POST \/graphql.*Board post-write verification failed/)
                assert.match(error.message, diagnostic)
                assert.doesNotMatch(inspect(error, { depth: 20 }), /secret-token|Authorization/)
                return true
            })
            assert.deepEqual(
                github.viewWrites.map((write) => write.operation),
                ["rest-create"],
            )
            assert.equal(github.projectViews(github.projects[0]).length, 2)
        })

    it("preserves an edited default and a Project that gained an item", async () => {
        for (const change of ["edited", "nonempty"]) {
            const github = new FakeGitHub()
            github.onBoardCreate = (project) => {
                if (change === "edited") github.projectViews(project)[0].filter = "is:open"
                else project.itemCount = 1
            }
            await assert.rejects(apply(github, newSpecification()), /default view changed|no longer empty/)
            assert.equal(github.projectViews(github.projects[0]).length, 2)
            assert.deepEqual(
                github.viewWrites.map((write) => write.operation),
                ["rest-create"],
            )
        }
    })

    it("preserves unrelated new views and recovers lost Board-create and delete responses", async () => {
        const github = new FakeGitHub()
        github.loseNextViewCreateResponse = true
        github.loseNextViewDeleteResponse = true
        github.onBoardCreate = (project, view) =>
            github
                .projectViews(project)
                .push({ ...structuredClone(view), id: "user-view", number: 9, name: "User view", filter: "is:open" })
        const result = await apply(github, newSpecification())
        assert.deepEqual(
            github.viewWrites.map((write) => write.operation),
            ["rest-create", "delete"],
        )
        assert.deepEqual(
            github.projectViews(github.projects[0]).map((view) => view.id),
            [(result.view as any).id, "user-view"],
        )
    })

    it("preserves both views when deletion is denied or fails read-back", async () => {
        for (const failure of ["denied", "ignored"]) {
            const github = new FakeGitHub()
            github.failViewDelete = failure === "denied"
            github.ignoreViewDelete = failure === "ignored"
            await assert.rejects(apply(github, newSpecification()), (error: Error) => {
                assert.match(error.message, /during Board setup.*POST \/graphql/)
                assert.match(
                    error.message,
                    failure === "denied"
                        ? /deletion forbidden/
                        : /cleanup verification failed.*captured default views still present.*view-1-1/,
                )
                return true
            })
            assert.equal(github.projectViews(github.projects[0]).length, 2)
        }
    })

    for (const invalid of ["ownership", "layout"])
        it(`keeps safe request context for Board read-back ${invalid} errors`, async () => {
            const github = new FakeGitHub()
            const specification = newSpecification()
            const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            let created = false
            const fetch: typeof globalThis.fetch = async (input, init) => {
                const response = await github.fetch(input, init)
                if (String(input).endsWith("/views") && init?.method === "POST") created = true
                const body = JSON.parse(String(init?.body ?? "{}"))
                if (created && body.query?.includes("... on ProjectV2View")) {
                    const data = await response.json()
                    if (invalid === "ownership") data.data.node.project.id = "foreign-secret-token"
                    else data.data.node.layout = "secret-token"
                    return json(data)
                }
                return response
            }
            await assert.rejects(
                runGitHubProjectSetup(
                    { operation: "apply", specification, approvedPlanHash: preview.planHash },
                    { ...setupOptions(github), fetch },
                ),
                (error: Error) => {
                    assert.match(error.message, /during Board setup.*POST \/graphql/)
                    if (invalid === "ownership") assert.match(error.message, /does not belong to Project/)
                    assert.doesNotMatch(inspect(error, { depth: 20 }), /secret-token|Authorization/)
                    return true
                },
            )
            assert.deepEqual(
                github.viewWrites.map((write) => write.operation),
                ["rest-create"],
            )
            assert.equal(github.projectViews(github.projects[0]).length, 2)
        })

    for (const mode of ["existing", "resume-created"])
        it(`keeps equivalent Board visibility stable during ${mode} preview and apply`, async () => {
            const github = new FakeGitHub()
            const base = await seed(github)
            const specification = { ...base, project: { ...base.project, mode } }
            const view = github.projectViews(github.projects[0])[0]
            const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            view.visibleFieldIds.reverse()
            const repeated = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            assert.equal(repeated.planHash, preview.planHash)
            const result = await runGitHubProjectSetup(
                { operation: "apply", specification, approvedPlanHash: preview.planHash },
                setupOptions(github),
            )
            assert.equal(result.state, "provisioned")
            assert.deepEqual(github.viewWrites, [])
        })

    it("reconciles reordered Board visibility after an uncertain selected-view update", async () => {
        const github = new FakeGitHub()
        const specification = await seed(github)
        const view = github.projectViews(github.projects[0])[0]
        view.name = "Before"
        github.loseNextViewUpdateResponse = true
        const fetch: typeof globalThis.fetch = async (input, init) => {
            const response = await github.fetch(input, init)
            const body = JSON.parse(String(init?.body ?? "{}"))
            if (body.query?.includes("updateProjectV2View(")) view.visibleFieldIds.reverse()
            return response
        }
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        const result = await runGitHubProjectSetup(
            { operation: "apply", specification, approvedPlanHash: preview.planHash },
            { ...setupOptions(github), fetch },
        )
        assert.equal(result.state, "provisioned")
        assert.equal(github.viewWrites.length, 1)
    })

    it("retains table field-order reconciliation and order-sensitive approval", async () => {
        const github = new FakeGitHub()
        const base = await seed(github)
        const specification = { ...base, presentation: { ...base.presentation, layout: "table" } }
        await apply(github, specification)
        github.viewWrites = []
        const view = github.projectViews(github.projects[0])[0]
        const expected = [...view.visibleFieldIds]
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        view.visibleFieldIds.reverse()
        await assert.rejects(
            runGitHubProjectSetup(
                { operation: "apply", specification, approvedPlanHash: preview.planHash },
                setupOptions(github),
            ),
            /changed after approval/,
        )
        await apply(github, specification)
        assert.deepEqual(view.visibleFieldIds, expected)
        assert.equal(github.viewWrites.length, 1)
    })

    for (const layout of ["board", "table"])
        it(`uses ${layout} visibility semantics for captured-default cleanup`, async () => {
            const github = new FakeGitHub()
            github.onProjectCreate = (project) => {
                const initial = github.projectViews(project)[0]
                initial.layout = `${layout.toUpperCase()}_LAYOUT`
                initial.visibleFieldIds = builtins.slice(0, 3).map((field) => field.id)
            }
            github.onBoardCreate = (project) => {
                github.projectViews(project)[0].visibleFieldIds.reverse()
            }
            if (layout === "board") {
                await apply(github, newSpecification())
                assert.deepEqual(
                    github.viewWrites.map((write) => write.operation),
                    ["rest-create", "delete"],
                )
            } else {
                await assert.rejects(apply(github, newSpecification()), /captured default view changed/)
                assert.deepEqual(
                    github.viewWrites.map((write) => write.operation),
                    ["rest-create"],
                )
            }
        })

    for (const identity of ["missing", "pre-existing"])
        it(`reports a ${identity} returned Board identity without deleting views`, async () => {
            const github = new FakeGitHub()
            const specification = newSpecification()
            const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            const fetch: typeof globalThis.fetch = async (input, init) => {
                const response = await github.fetch(input, init)
                return String(input).endsWith("/views") && init?.method === "POST"
                    ? json({ value: { node_id: identity === "missing" ? "absent-view" : "view-1-1" } }, 201)
                    : response
            }
            await assert.rejects(
                runGitHubProjectSetup(
                    { operation: "apply", specification, approvedPlanHash: preview.planHash },
                    { ...setupOptions(github), fetch },
                ),
                (error: Error) => {
                    assert.match(
                        error.message,
                        /during Board setup.*POST \/graphql.*Board post-write verification failed/,
                    )
                    assert.match(
                        error.message,
                        identity === "missing" ? /view is missing/ : /already existed before creation/,
                    )
                    return true
                },
            )
            assert.deepEqual(
                github.viewWrites.map((write) => write.operation),
                ["rest-create"],
            )
            assert.equal(github.projectViews(github.projects[0]).length, 2)
        })

    for (const recovery of ["mismatch", "ambiguous", "read-failure"])
        it(`retains safe create-response context with ${recovery} recovery`, async () => {
            const github = new FakeGitHub()
            github.onBoardCreate = (project, view) => {
                if (recovery === "mismatch") view.name = "secret-token wrong name"
                if (recovery === "ambiguous")
                    github
                        .projectViews(project)
                        .push({ ...structuredClone(view), id: "second-secret-token", number: 3 })
            }
            const specification = newSpecification()
            const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
            let attempted = false
            const fetch: typeof globalThis.fetch = async (input, init) => {
                if (attempted && recovery === "read-failure")
                    return graph(undefined, [{ message: "secret-token recovery unavailable" }])
                const response = await github.fetch(input, init)
                if (String(input).endsWith("/views") && init?.method === "POST") {
                    attempted = true
                    return json({}, 201)
                }
                return response
            }
            await assert.rejects(
                runGitHubProjectSetup(
                    { operation: "apply", specification, approvedPlanHash: preview.planHash },
                    { ...setupOptions(github), fetch },
                ),
                (error: Error) => {
                    assert.match(error.message, /during Board setup/)
                    assert.match(error.message, /POST \/users\/alex\/projectsV2\/1\/views: invalid created Board/)
                    assert.match(error.message, /POST \/graphql/)
                    if (recovery === "mismatch") {
                        assert.match(error.message, /0 matching new views.*view-1-2.*name expected/)
                        assert.match(error.message, /resume-created.*creation not retried/)
                    }
                    if (recovery === "ambiguous")
                        assert.match(error.message, /2 matching new views.*view-1-2.*second-\[REDACTED\]/)
                    if (recovery === "read-failure")
                        assert.match(error.message, /recovery read failed.*recovery unavailable/)
                    assert.doesNotMatch(inspect(error, { depth: 20 }), /secret-token|Authorization|visible_fields/)
                    return true
                },
            )
            assert.deepEqual(
                github.viewWrites.map((write) => write.operation),
                ["rest-create"],
            )
            assert.equal(github.projects.length, 1)
        })

    it("resumes a failed Board setup only through the explicitly selected existing view", async () => {
        const github = new FakeGitHub()
        github.onBoardCreate = (_project, view) => {
            view.visibleFieldIds.pop()
        }
        await assert.rejects(apply(github, newSpecification()), /visible fields missing/)
        const inspection = await runGitHubProjectSetup(
            {
                operation: "inspectProject",
                credentialEnv: "GITHUB_TOKEN_FOR_TEST",
                projectOwner: { login: "alex", type: "user" },
                projectNumber: 1,
            },
            setupOptions(github),
        )
        const board = (inspection.views as any[]).find((view) => view.name === "Board")
        const views = github.projectViews(github.projects[0])
        const defaultView = structuredClone(views[0])
        views.push({ ...structuredClone(views[1]), id: "user-view", number: 9, name: "User view", filter: "is:open" })
        const unrelated = structuredClone(views[2])
        const base = newSpecification()
        const specification = {
            ...base,
            project: { mode: "resume-created", number: 1, visibility: "private", associateRepository: true },
            presentation: { ...base.presentation, target: { mode: "selected", viewId: board.id } },
        }
        const result = await apply(github, specification)
        assert.equal(result.state, "provisioned")
        assert.equal(github.projects.length, 1)
        assert.deepEqual(
            github.viewWrites.map((write) => write.operation),
            ["rest-create", "update"],
        )
        assert.equal(github.viewWrites[1].viewId, board.id)
        assert.deepEqual(views[0], defaultView)
        assert.deepEqual(views[2], unrelated)
        assert.equal(views.length, 3)
    })

    it("requires an environment-backed credential", async () => {
        const github = new FakeGitHub()
        await assert.rejects(
            () =>
                runGitHubProjectSetup(
                    {
                        operation: "inspect",
                        credentialEnv: "MISSING_TOKEN",
                        repository: { owner: "acme", repo: "example" },
                        projectOwner: { login: "alex", type: "user" },
                        includeOrganizationMetadata: false,
                    },
                    { fetch: github.fetch as typeof fetch, env: {} },
                ),
            /environment variable MISSING_TOKEN is not set/,
        )
    })
})
