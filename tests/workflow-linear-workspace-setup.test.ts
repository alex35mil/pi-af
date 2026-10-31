import "./host-runtime.ts"

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { inspectLinearWorkspace } from "../workflows/extensions/integrations/tracker/linear.ts"

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
