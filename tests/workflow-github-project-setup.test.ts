import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { GITHUB_PROJECT_DEFAULTS, runGitHubProjectSetup } from "../workflows/extensions/project-setup/github-project.ts"

interface FakeField {
    id: string
    name: string
    dataType: string
    options?: Array<{ id: string; name: string; description: string; color: string }>
}
interface FakeProject {
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

class FakeGitHub {
    projects: FakeProject[] = []
    issueFields: Array<Record<string, unknown>> = []
    repositoryLabels: Array<{ name: string; color: string; description: string }> = []
    authorizationHeaders: string[] = []
    deleteProjectFieldAttempts = 0
    loseNextProjectCreateResponse = false
    loseNextRepositoryLabelCreateResponse = false
    nextField = 10

    readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(input)
        const headers = new Headers(init?.headers)
        this.authorizationHeaders.push(headers.get("Authorization") ?? "")
        if (url.endsWith("/graphql")) return this.graphql(String(init?.body ?? ""))
        if (url.endsWith("/repos/acme/example")) {
            return json({ node_id: "repo-node", owner: { type: "Organization" } })
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
        if (query.includes("createProjectV2(")) {
            const project: FakeProject = {
                id: `project-${this.projects.length + 1}`,
                number: this.projects.length + 1,
                title: String(variables.title),
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
            if (this.loseNextProjectCreateResponse) {
                this.loseNextProjectCreateResponse = false
                return graph(undefined, [{ message: "response lost after Project creation" }])
            }
            return graph({ createProjectV2: { projectV2: summary(project) } })
        }
        if (query.includes("updateProjectV2(")) {
            const project = this.project(String(variables.projectId))
            project.public = variables.public === true
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
            return graph({ node: details(project) })
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
        items: { totalCount: project.itemCount },
        fields: {
            nodes: project.fields.map((field) => ({
                __typename: field.dataType === "SINGLE_SELECT" ? "ProjectV2SingleSelectField" : "ProjectV2Field",
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
    return [labels.planning, labels.kind.epic, ...Object.values(labels.kind.deliverableKinds)].map((label) => ({
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
        labels: defaults.labels,
        fields: {
            status: defaults.status,
            priority: { scope: "project", ...defaults.priority },
            internalId: { scope: "project", ...defaults.internalId },
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
        labels: defaults.labels,
        fields: {
            status: defaults.status,
            priority: {
                scope: "issue",
                ...defaults.priority,
                provisionMissing: true,
                visibility: "all",
            },
            internalId: {
                scope: "issue",
                ...defaults.internalId,
                provisionMissing: true,
                visibility: "organization_members_only",
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
            ["Status", "Priority", "Internal ID"],
        )
        const tracker = applied.trackerConfig as Record<string, any>
        assert.equal(tracker.project.number, 1)
        assert.equal(tracker.fields.status.values.todo, "Todo")
        assert.equal(tracker.fields.status.values.inReview, "In Review")
        assert.equal(tracker.labels.planning, "Planning")
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

    it("continues from provider state after a lost Project-create response", async () => {
        const github = new FakeGitHub()
        const specification = projectContained({
            mode: "new",
            title: "Recovered creation",
            visibility: "private",
            associateRepository: false,
        })
        const preview = await runGitHubProjectSetup({ operation: "preview", specification }, setupOptions(github))
        github.loseNextProjectCreateResponse = true
        const applied = await runGitHubProjectSetup(
            { operation: "apply", specification, approvedPlanHash: preview.planHash },
            setupOptions(github),
        )
        assert.equal(applied.state, "provisioned")
        assert.equal(github.projects.length, 1)
    })

    it("reuses exact managed labels and blocks conflicting label metadata", async () => {
        const github = new FakeGitHub()
        const specification = projectContained({
            mode: "new",
            title: "Label validation",
            visibility: "private",
            associateRepository: false,
        })
        github.repositoryLabels.push({ name: "Planning", color: "ffffff", description: "Wrong" })
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
                        feature: { ...base.labels.kind.deliverableKinds.feature, name: "planning" },
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
            ["Priority", "Internal ID"],
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
        assert.deepEqual(
            github.issueFields.map((field) => field.name),
            ["Internal ID"],
        )
        assert.deepEqual(
            github.projects[0].fields.map((field) => field.name),
            ["Status", "Priority"],
        )
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
