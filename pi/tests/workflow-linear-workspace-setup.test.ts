import "./host-runtime.ts"

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { inspectLinearWorkspace, LINEAR_STATUS_DEFAULTS } from "../workflows/extensions/integrations/tracker/linear.ts"
import {
    applyLinearStatusSetup,
    previewLinearStatusSetup,
} from "../workflows/extensions/project-setup/linear-statuses.ts"

class FakeLinear {
    readonly authorizationHeaders: string[] = []
    readonly queries: string[] = []
    acceptedAuthorization = "linear-api-key"
    graphError: string | undefined

    readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        assert.equal(String(input), "https://api.linear.app/graphql")
        assert.equal(init?.method, "POST")
        const authorization = new Headers(init?.headers).get("Authorization") ?? ""
        this.authorizationHeaders.push(authorization)
        if (authorization !== this.acceptedAuthorization) return json({ message: "Unauthorized" }, 401)

        const body = JSON.parse(String(init?.body)) as { query: string; variables: { after: string | null } }
        this.queries.push(body.query)
        assert.doesNotMatch(body.query, /mutation/i)
        if (this.graphError) return graph({}, [{ message: this.graphError }])

        if (body.query.includes("query WorkspaceSetup")) {
            return graph({
                viewer: { id: "viewer-1", name: "Alex Example", displayName: "alex" },
                organization: {
                    id: "workspace-1",
                    name: "Acme",
                    urlKey: "acme",
                    projectStatuses: [
                        {
                            id: "project-started",
                            name: "In Progress",
                            type: "started",
                            color: "#f2c94c",
                            position: 2,
                            team: null,
                        },
                        {
                            id: "project-planned",
                            name: "Planned",
                            type: "planned",
                            color: "#5e6ad2",
                            position: 1,
                            team: null,
                        },
                        {
                            id: "alpha-review",
                            name: "Alpha Review",
                            type: "started",
                            color: "#8a5cf5",
                            position: 3,
                            team: { id: "team-alpha", key: "ALP", name: "Alpha" },
                        },
                    ],
                },
            })
        }
        if (body.query.includes("query WorkspaceTeams")) {
            if (body.variables.after === null) {
                return graph({
                    teams: {
                        nodes: [{ id: "team-zeta", key: "ZET", name: "Zeta" }],
                        pageInfo: { hasNextPage: true, endCursor: "team-page-2" },
                    },
                })
            }
            return graph({
                teams: {
                    nodes: [{ id: "team-alpha", key: "ALP", name: "Alpha" }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                },
            })
        }
        if (body.query.includes("query IssueStatuses")) {
            return graph({
                workflowStates: {
                    nodes: [
                        {
                            id: "alpha-started",
                            name: "In Progress",
                            type: "started",
                            color: "#f2c94c",
                            position: 2,
                            team: { id: "team-alpha", key: "ALP", name: "Alpha" },
                        },
                        {
                            id: "alpha-backlog",
                            name: "Backlog",
                            type: "backlog",
                            color: "#6b7280",
                            position: 1,
                            team: { id: "team-alpha", key: "ALP", name: "Alpha" },
                        },
                        {
                            id: "zeta-done",
                            name: "Done",
                            type: "completed",
                            color: "#5e6ad2",
                            position: 1,
                            team: { id: "team-zeta", key: "ZET", name: "Zeta" },
                        },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                },
            })
        }
        return graph({}, [{ message: "unexpected GraphQL operation" }])
    }
}

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })
}

function graph(data: unknown, errors?: unknown[]): Response {
    return json({ data, ...(errors ? { errors } : {}) })
}

describe("Linear workspace setup inspection", () => {
    it("discovers workspace configuration without mutation", async () => {
        const fake = new FakeLinear()
        const result = await inspectLinearWorkspace(
            { credentialEnv: "LINEAR_TEST_KEY" },
            { fetch: fake.fetch, env: { LINEAR_TEST_KEY: "linear-api-key" } },
        )

        assert.deepEqual(result.workspace, { id: "workspace-1", name: "Acme", urlKey: "acme" })
        assert.deepEqual(result.viewer, { id: "viewer-1", name: "Alex Example", username: "alex" })
        assert.deepEqual(
            result.teams.map((team) => ({
                name: team.name,
                statuses: team.issueStatuses.map((status) => status.name),
            })),
            [
                { name: "Alpha", statuses: ["Backlog", "In Progress"] },
                { name: "Zeta", statuses: ["Done"] },
            ],
        )
        assert.deepEqual(
            result.projectStatuses.map((status) => ({ name: status.name, team: status.team?.name ?? null })),
            [
                { name: "Planned", team: null },
                { name: "In Progress", team: null },
                { name: "Alpha Review", team: "Alpha" },
            ],
        )
        assert.equal("branchFormat" in result, false)
        assert.ok(fake.queries.length >= 3)
        assert.ok(fake.queries.every((query) => !/mutation/i.test(query)))
        assert.ok(fake.authorizationHeaders.every((header) => header === "linear-api-key"))
    })

    it("supports both documented Linear API authentication headers", async () => {
        const fake = new FakeLinear()
        fake.acceptedAuthorization = "Bearer oauth-token"

        await inspectLinearWorkspace(
            { credentialEnv: "LINEAR_OAUTH_TOKEN" },
            { fetch: fake.fetch, env: { LINEAR_OAUTH_TOKEN: "oauth-token" } },
        )

        assert.deepEqual(fake.authorizationHeaders.slice(0, 2), ["oauth-token", "Bearer oauth-token"])
        assert.ok(fake.authorizationHeaders.slice(2).every((header) => header === "Bearer oauth-token"))
    })

    it("fails clearly when the credential environment variable is absent", async () => {
        await assert.rejects(
            inspectLinearWorkspace({ credentialEnv: "MISSING_LINEAR_KEY" }, { env: {} }),
            /environment variable MISSING_LINEAR_KEY is not set/,
        )
    })

    it("rejects GraphQL errors instead of using partial setup data", async () => {
        const fake = new FakeLinear()
        fake.graphError = "Not authorized to read workspace settings"
        await assert.rejects(
            inspectLinearWorkspace(
                { credentialEnv: "LINEAR_TEST_KEY" },
                { fetch: fake.fetch, env: { LINEAR_TEST_KEY: "linear-api-key" } },
            ),
            /Linear GraphQL failed: Not authorized to read workspace settings/,
        )
    })
})

interface FakeStatus {
    id: string
    name: string
    type: string
    color: string
    position: number
    description?: string
}

/** A stateful Linear double for status setup: team issue statuses, workspace Project statuses, and their creates. */
class FakeLinearStatuses {
    issues: FakeStatus[] = [
        { id: "s-backlog", name: "Backlog", type: "backlog", color: "#bec2c8", position: 0 },
        { id: "s-todo", name: "Todo", type: "unstarted", color: "#e2e2e2", position: 1 },
        { id: "s-progress", name: "In Progress", type: "started", color: "#f2c94c", position: 2 },
        { id: "s-done", name: "Done", type: "completed", color: "#5e6ad2", position: 3 },
        { id: "s-canceled", name: "Canceled", type: "canceled", color: "#95a2b3", position: 4 },
        { id: "s-duplicate", name: "Duplicate", type: "duplicate", color: "#95a2b3", position: 5 },
    ]
    projects: FakeStatus[] = [
        { id: "p-backlog", name: "Backlog", type: "backlog", color: "#F2994A", position: 0 },
        { id: "p-planned", name: "Planned", type: "planned", color: "#D7D8DB", position: 1 },
        { id: "p-progress", name: "In Progress", type: "started", color: "#F2C94C", position: 2 },
        { id: "p-completed", name: "Completed", type: "completed", color: "#5E6AD2", position: 3 },
        { id: "p-canceled", name: "Canceled", type: "canceled", color: "#8A8F98", position: 4 },
    ]
    viewer = { admin: true, owner: false }
    readonly creates: Array<{ mutation: string; input: Record<string, unknown> }> = []
    /** Rejects the next create with this GraphQL error, after optionally applying it. */
    failNextCreate: { extensions: Record<string, unknown>; applied: boolean } | undefined
    nextId = 1

    readonly fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> }
        const query = body.query
        if (query.includes("query ViewerRole")) return graph({ viewer: this.viewer })
        if (query.includes("query WorkspaceTeams"))
            return graph({
                teams: {
                    nodes: [{ id: "team-ale", key: "ALE", name: "Alex35mil" }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                },
            })
        if (query.includes("query TeamIssueStatuses")) {
            assert.equal(body.variables.teamId, "team-ale")
            return graph({
                team: { states: { nodes: this.issues, pageInfo: { hasNextPage: false, endCursor: null } } },
            })
        }
        if (query.includes("query WorkspaceSetup"))
            return graph({
                viewer: { id: "viewer-1", name: "Alex", displayName: "alex" },
                organization: {
                    id: "org",
                    name: "Acme",
                    urlKey: "acme",
                    projectStatuses: this.projects.map((status) => ({ ...status, team: null })),
                },
            })
        const create = /mutation (IssueStatusCreate|ProjectStatusCreate)/.exec(query)?.[1]
        if (create) {
            const input = body.variables.input as Record<string, unknown>
            this.creates.push({ mutation: create, input })
            const status = {
                id: `new-${this.nextId++}`,
                name: String(input.name),
                type: String(input.type),
                color: String(input.color),
                position: Number(input.position),
            }
            const failure = this.failNextCreate
            this.failNextCreate = undefined
            if (failure && !failure.applied)
                return graph(null, [{ message: "rejected", extensions: failure.extensions }])
            ;(create === "IssueStatusCreate" ? this.issues : this.projects).push(status)
            if (failure) return graph(null, [{ message: "lost", extensions: failure.extensions }])
            return create === "IssueStatusCreate"
                ? graph({ workflowStateCreate: { success: true, workflowState: status } })
                : graph({ projectStatusCreate: { success: true, status } })
        }
        return graph({}, [{ message: `unexpected operation: ${query}` }])
    }

    options() {
        return { fetch: this.fetch, env: { LINEAR_TEST_KEY: "linear-api-key" } }
    }
}

type Mapping = Record<keyof typeof LINEAR_STATUS_DEFAULTS.issues, { existing: string } | { create: unknown }>

/** The default Linear workspace: map what exists and create In Review, and Todo and In Review for Projects. */
function defaultSetup(): { credentialEnv: string; team: string; statuses: { issues: Mapping; projects: Mapping } } {
    const d = LINEAR_STATUS_DEFAULTS
    return {
        credentialEnv: "LINEAR_TEST_KEY",
        team: "ALE",
        statuses: {
            issues: {
                backlog: { existing: "Backlog" },
                todo: { existing: "Todo" },
                inProgress: { existing: "In Progress" },
                inReview: { create: d.issues.inReview },
                done: { existing: "Done" },
                canceled: { existing: "Canceled" },
            },
            projects: {
                backlog: { existing: "Backlog" },
                todo: { create: d.projects.todo },
                inProgress: { existing: "In Progress" },
                inReview: { create: d.projects.inReview },
                done: { existing: "Completed" },
                canceled: { existing: "Canceled" },
            },
        },
    }
}

describe("Linear status setup", () => {
    it("inspection offers the default status set", async () => {
        const fake = new FakeLinear()
        const result = await inspectLinearWorkspace(
            { credentialEnv: "LINEAR_TEST_KEY" },
            { fetch: fake.fetch, env: { LINEAR_TEST_KEY: "linear-api-key" } },
        )
        assert.equal(result.statusDefaults.issues.inReview.type, "started")
        assert.equal(result.statusDefaults.projects.done.name, "Completed")
    })

    it("previews only the missing statuses, positioned after their lifecycle predecessor", async () => {
        const fake = new FakeLinearStatuses()
        const preview = await previewLinearStatusSetup(defaultSetup(), fake.options())
        assert.equal(preview.state, "ready")
        if (preview.state !== "ready") return
        assert.deepEqual(
            preview.creates.map(({ scope, key, name, type, position }) => ({ scope, key, name, type, position })),
            [
                // Right after Backlog, halfway to the unmapped Planned.
                { scope: "projects", key: "todo", name: "Todo", type: "planned", position: 0.5 },
                { scope: "projects", key: "inReview", name: "In Review", type: "started", position: 2.5 },
                { scope: "issues", key: "inReview", name: "In Review", type: "started", position: 2.5 },
            ],
        )
        assert.equal(preview.statuses.projects.done, "Completed")
        assert.equal(preview.statuses.issues.inReview, "In Review")
        assert.match(preview.planHash, /^[a-f0-9]{64}$/)
        assert.equal("permissionWarning" in preview, false)
        assert.equal(fake.creates.length, 0)
    })

    it("blocks unknown, colliding, and repeated names without writing", async () => {
        const fake = new FakeLinearStatuses()
        const setup = defaultSetup()
        setup.statuses.issues.backlog = { existing: "Icebox" }
        setup.statuses.issues.inReview = { create: { ...LINEAR_STATUS_DEFAULTS.issues.inReview, name: "done" } }
        setup.statuses.projects.todo = { existing: "Backlog" }
        const preview = await previewLinearStatusSetup(setup, fake.options())
        assert.equal(preview.state, "blocked")
        if (preview.state !== "blocked") return
        // "done" both exists already and repeats the done key's name.
        assert.equal(preview.problems.length, 4)
        assert.ok(preview.problems.some((problem) => problem.includes("Icebox")))
        assert.ok(preview.problems.some((problem) => problem.includes("already exists")))
        assert.ok(preview.problems.some((problem) => problem.includes("distinct")))
        assert.equal("planHash" in preview, false)
    })

    it("rejects an invalid type or color at the schema", async () => {
        const fake = new FakeLinearStatuses()
        const badType = defaultSetup()
        badType.statuses.issues.inReview = { create: { ...LINEAR_STATUS_DEFAULTS.issues.inReview, type: "planned" } }
        await assert.rejects(previewLinearStatusSetup(badType, fake.options()))
        const badColor = defaultSetup()
        badColor.statuses.projects.todo = { create: { ...LINEAR_STATUS_DEFAULTS.projects.todo, color: "purple" } }
        await assert.rejects(previewLinearStatusSetup(badColor, fake.options()))
    })

    it("warns a non-admin about Project status creates", async () => {
        const fake = new FakeLinearStatuses()
        fake.viewer = { admin: false, owner: false }
        const preview = await previewLinearStatusSetup(defaultSetup(), fake.options())
        assert.equal(preview.state, "ready")
        assert.ok("permissionWarning" in preview)
    })

    it("applies Project statuses first, never sends a team for them, and returns the configuration", async () => {
        const fake = new FakeLinearStatuses()
        const setup = defaultSetup()
        const preview = await previewLinearStatusSetup(setup, fake.options())
        assert.equal(preview.state, "ready")
        if (preview.state !== "ready") return
        const result = await applyLinearStatusSetup({ ...setup, approvedPlanHash: preview.planHash }, fake.options())
        assert.equal(result.state, "applied")
        assert.deepEqual(
            fake.creates.map((create) => create.mutation),
            ["ProjectStatusCreate", "ProjectStatusCreate", "IssueStatusCreate"],
        )
        assert.equal("teamId" in fake.creates[0].input, false)
        assert.equal(fake.creates[2].input.teamId, "team-ale")
        assert.deepEqual(result.statuses, preview.statuses)
    })

    it("verifies only when nothing is missing", async () => {
        const fake = new FakeLinearStatuses()
        fake.issues.push({ id: "s-review", name: "In Review", type: "started", color: "#8250DF", position: 2.5 })
        fake.projects.push(
            { id: "p-todo", name: "Todo", type: "planned", color: "#D7D8DB", position: 1.5 },
            { id: "p-review", name: "In Review", type: "started", color: "#8250DF", position: 2.5 },
        )
        const setup = defaultSetup()
        setup.statuses.issues.inReview = { existing: "In Review" }
        setup.statuses.projects.todo = { existing: "Todo" }
        setup.statuses.projects.inReview = { existing: "In Review" }
        const preview = await previewLinearStatusSetup(setup, fake.options())
        assert.equal(preview.state, "ready")
        if (preview.state !== "ready") return
        assert.deepEqual(preview.creates, [])
        const result = await applyLinearStatusSetup({ ...setup, approvedPlanHash: preview.planHash }, fake.options())
        assert.deepEqual(result.created, [])
        assert.equal(fake.creates.length, 0)
    })

    it("refuses a stale hash or a changed catalog", async () => {
        const fake = new FakeLinearStatuses()
        const setup = defaultSetup()
        const preview = await previewLinearStatusSetup(setup, fake.options())
        if (preview.state !== "ready") assert.fail("expected a ready preview")
        await assert.rejects(
            applyLinearStatusSetup({ ...setup, approvedPlanHash: "0".repeat(64) }, fake.options()),
            /changed after approval/,
        )
        fake.issues.push({ id: "s-qa", name: "QA", type: "started", color: "#000000", position: 2.2 })
        await assert.rejects(
            applyLinearStatusSetup({ ...setup, approvedPlanHash: preview.planHash }, fake.options()),
            /changed after approval/,
        )
        assert.equal(fake.creates.length, 0)
    })

    it("explains a permission rejection and stops before later creates", async () => {
        const fake = new FakeLinearStatuses()
        const setup = defaultSetup()
        const preview = await previewLinearStatusSetup(setup, fake.options())
        if (preview.state !== "ready") assert.fail("expected a ready preview")
        fake.failNextCreate = { extensions: { code: "FORBIDDEN", type: "forbidden" }, applied: false }
        await assert.rejects(
            applyLinearStatusSetup({ ...setup, approvedPlanHash: preview.planHash }, fake.options()),
            /workspace admin.*Created: none/s,
        )
        assert.equal(fake.creates.length, 1)
    })

    it("continues after a failed create that is confirmed applied, and stops when it isn't", async () => {
        const recovered = new FakeLinearStatuses()
        const setup = defaultSetup()
        const preview = await previewLinearStatusSetup(setup, recovered.options())
        if (preview.state !== "ready") assert.fail("expected a ready preview")
        recovered.failNextCreate = { extensions: { code: "INTERNAL" }, applied: true }
        const result = await applyLinearStatusSetup(
            { ...setup, approvedPlanHash: preview.planHash },
            recovered.options(),
        )
        assert.equal(result.recovered?.length, 1)
        assert.equal(recovered.creates.length, 3)

        const failed = new FakeLinearStatuses()
        failed.failNextCreate = { extensions: { code: "INTERNAL" }, applied: false }
        await assert.rejects(
            applyLinearStatusSetup({ ...setup, approvedPlanHash: preview.planHash }, failed.options()),
            /isn't confirmed applied.*Not attempted: workspace Project status "In Review"/s,
        )
        assert.equal(failed.creates.length, 1)
    })

    it("reports a verification failure", async () => {
        const fake = new FakeLinearStatuses()
        const setup = defaultSetup()
        const preview = await previewLinearStatusSetup(setup, fake.options())
        if (preview.state !== "ready") assert.fail("expected a ready preview")
        const original = fake.fetch
        let creates = 0
        const options = {
            ...fake.options(),
            fetch: async (input: string | URL | Request, init?: RequestInit) => {
                const response = await original(input, init)
                if (String(init?.body).includes("StatusCreate") && ++creates === 3)
                    fake.issues.push({ id: "dup", name: "In Review", type: "started", color: "#000000", position: 9 })
                return response
            },
        }
        await assert.rejects(
            applyLinearStatusSetup({ ...setup, approvedPlanHash: preview.planHash }, options),
            /verification failed/,
        )
    })
})
