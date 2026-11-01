import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { Value } from "typebox/value"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { buildIntegrationContext, IntegrationContextSchema } from "../workflows/extensions/integrations/index.ts"
import type { IncomingProjectContextInput } from "../workflows/extensions/integrations/forge/github/incoming-pr-project.ts"

import { minimalTracker } from "./workflow-phase-fixtures.ts"
import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"

const mcpTools = workflowMcpCatalog("forge", "board")

const repository = { owner: "upstream", repo: "app" }
const project = { owner: "board-owner", ownerType: "user", number: 2 }
const address = { owner: project.owner, owner_type: project.ownerType, project_number: project.number }
const statuses = {
    backlog: "Backlog",
    todo: "Todo",
    inProgress: "In Progress",
    inReview: "In Review",
    done: "Done",
    canceled: "Canceled",
}
function read() {
    return {
        tool: "mcp__forge__pull_request_read",
        arguments: { method: "get", ...repository, pullNumber: 12 },
        response: {
            number: 12,
            html_url: "https://github.com/upstream/app/pull/12",
            state: "open",
            draft: false,
            merged: false,
            merged_at: null as string | null,
            base: { ref: "main", sha: "a".repeat(40), repo: { full_name: "upstream/app" } },
            head: { ref: "feature", sha: "b".repeat(40), repo: { full_name: "contributor/app" } },
        },
    }
}
function field() {
    return {
        tool: "mcp__board__projects_get",
        arguments: { method: "get_project_field", ...address, field_id: 70 },
        response: {
            id: 70,
            name: "Status",
            data_type: "single_select",
            options: Object.values(statuses).map((raw, index) => ({ id: String(index), name: { raw } })),
        },
    }
}
function present(status: string | null = "Backlog") {
    return {
        state: "present" as const,
        evidence: {
            tool: "mcp__board__projects_get",
            arguments: { method: "get_project_item", ...address, item_id: 99, field_names: ["Status"] },
            response: {
                id: 99,
                content_type: "PullRequest",
                content: { repository: "upstream/app", number: 12 },
                fields: [
                    {
                        id: 70,
                        name: "Status",
                        data_type: "single_select",
                        value: status === null ? null : { name: status },
                    },
                ],
            },
        },
    }
}
function absent() {
    return {
        state: "absent" as const,
        lookup: [
            {
                tool: "mcp__board__projects_list",
                arguments: { method: "list_project_items", ...address, query: "repo:upstream/app is:pr" },
                response: { items: [] as any[], pageInfo: { hasNextPage: false } as any },
            },
        ],
    }
}
function added(status = "Backlog") {
    return {
        ...present(status),
        state: "added" as const,
        creation: {
            tool: "mcp__board__projects_write",
            arguments: {
                method: "add_project_item",
                ...address,
                item_owner: "upstream",
                item_repo: "app",
                item_type: "pull_request",
                pull_request_number: 12,
            },
            // Real add_project_item shape: `id` is the GraphQL node ID; `item_id` is the numeric item ID.
            response: {
                id: "PVTI_example",
                message: "Successfully added pull_request upstream/app#12 to project board-owner/2",
                full_database_id: "99",
                item_id: 99,
            },
        },
    }
}
function reconciled(status: string | null = "Backlog") {
    const { tool, arguments: args } = added().creation
    return {
        ...present(status),
        state: "reconciled" as const,
        attempt: { tool, arguments: args },
    }
}
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pr-project-")))
    const git = (...args: string[]) =>
        cp.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim()
    git("init", "-q", "-b", "main")
    fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
    git("add", ".")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture")
    fs.mkdirSync(path.join(root, ".project"))
    fs.writeFileSync(
        path.join(root, ".project/config.json"),
        JSON.stringify({ branches: { format: "identifier-title" } }),
    )
    const config = {
        forge: { provider: "github", mcpServer: "forge", repository },
        tracker: {
            provider: "github",
            mcpServer: "board",
            repository: { owner: "upstream", repo: "issues" },
            project,
            labels: {
                kind: {
                    epic: "Epic",
                    deliverableKinds: {
                        feature: "Feature",
                        bugfix: "Bugfix",
                        research: "Research",
                        refactor: "Refactor",
                        audit: "Audit",
                        chore: "Chore",
                    },
                },
            },
            fields: {
                status: { field: "Status", values: statuses },
                phase: {
                    field: "Phase",
                    values: { planning: "Planning", execution: "Execution", selfReview: "Self-Review" },
                },
                priority: { scope: "project", field: "Priority", values: ["High", "Low"] },
            },
        },
    }
    fs.writeFileSync(path.join(root, ".project/integrations.json"), JSON.stringify(config))
    prepareArtifactPersistence(root)
    const request = (extra: object = {}) => ({
        operation: "incomingPullRequestProject",
        reference: "#12",
        evidence: read(),
        fieldEvidence: field(),
        membership: present(),
        action: "review",
        ...extra,
    })
    const plan = (extra: object = {}) => {
        const input = request(extra)
        assert.ok(Value.Check(IntegrationContextSchema, input))
        return buildIntegrationContext({ cwd: root } as never, input as IncomingProjectContextInput, mcpTools)
            .projectAction
    }
    return { root, git, config, request, plan, close: () => fs.rmSync(root, { recursive: true, force: true }) }
}
function mutation(decision: ReturnType<ReturnType<typeof fixture>["plan"]>) {
    if (decision.state !== "mutation-needed") assert.fail(JSON.stringify(decision))
    return decision.mutation
}

describe("maintainer-controlled incoming PR Project", () => {
    it(`adds actual PR membership and applies the explicitly selected initial status`, () => {
        const f = fixture()
        try {
            for (const choice of ["backlog", "todo"]) {
                const first = f.plan({ action: "intake", choice, membership: absent() })
                assert.deepEqual(mutation(first), {
                    tool: "mcp__board__projects_write",
                    arguments: {
                        ...address,
                        method: "add_project_item",
                        item_owner: "upstream",
                        item_repo: "app",
                        item_type: "pull_request",
                        pull_request_number: 12,
                    },
                })
            }
            const initialized = f.plan({ action: "intake", choice: "todo", membership: added() })
            assert.deepEqual(mutation(initialized).arguments, {
                ...address,
                method: "update_project_item",
                item_id: 99,
                updated_field: { name: "Status", value: "Todo" },
            })
            const otherItem = added()
            otherItem.creation.response.item_id = 100
            assert.deepEqual(f.plan({ action: "intake", choice: "todo", membership: otherItem }), {
                state: "blocked",
                reason: "Added Project item does not match current membership",
            })
            const addAsItem = added()
            assert.equal(
                f.plan({
                    action: "intake",
                    choice: "todo",
                    membership: { ...addAsItem, evidence: addAsItem.creation },
                }).state,
                "blocked",
            )
            assert.equal(fs.existsSync(path.join(f.root, ".project/.local/gigs")), false)
        } finally {
            f.close()
        }
    })
    it(`finishes Todo intake after the add response is lost without another add`, () => {
        const f = fixture()
        try {
            const attempt = mutation(f.plan({ action: "intake", choice: "todo", membership: absent() }))
            const server = { adds: 0, item: null as ReturnType<typeof present> | null }
            assert.throws(() => {
                server.adds++
                server.item = present("Backlog")
                throw new Error("Connection lost after server applied the add")
            }, /Connection lost/)
            assert.ok(server.item)
            const membership = { ...server.item, state: "reconciled", attempt }
            assert.equal(Object.hasOwn(attempt, "response"), false)
            const next = f.plan({ action: "intake", choice: "todo", membership })
            assert.deepEqual(mutation(next), {
                tool: "mcp__board__projects_write",
                arguments: {
                    ...address,
                    method: "update_project_item",
                    item_id: 99,
                    updated_field: { name: "Status", value: "Todo" },
                },
            })
            server.item = present("Todo")
            assert.deepEqual(
                f.plan({
                    action: "intake",
                    choice: "todo",
                    membership: { ...membership, ...server.item, state: "reconciled" },
                }),
                { state: "unchanged", status: "Todo" },
            )
            assert.equal(server.adds, 1)
        } finally {
            f.close()
        }
    })
    it("uses native MCP replies across PR, field, membership, creation, and absence evidence", () => {
        const f = fixture()
        const native = (evidence: { tool: string; arguments: object; response: unknown }) => ({
            ...evidence,
            response: { content: [{ type: "text", text: JSON.stringify(evidence.response) }] },
        })
        try {
            const membership = added()
            const common = { evidence: native(read()), fieldEvidence: native(field()) }
            const initialized = f.plan({
                ...common,
                action: "intake",
                choice: "todo",
                membership: {
                    ...membership,
                    evidence: native(membership.evidence),
                    creation: native(membership.creation),
                },
            })
            assert.deepEqual(mutation(initialized).arguments, {
                ...address,
                method: "update_project_item",
                item_id: 99,
                updated_field: { name: "Status", value: "Todo" },
            })
            assert.equal(
                mutation(
                    f.plan({
                        ...common,
                        action: "intake",
                        choice: "todo",
                        membership: { state: "absent", lookup: absent().lookup.map(native) },
                    }),
                ).arguments.method,
                "add_project_item",
            )
        } finally {
            f.close()
        }
    })

    it("preserves advanced progress and skips matching status during reconciled intake", () => {
        const f = fixture()
        try {
            for (const choice of ["backlog", "todo"] as const)
                for (const status of [statuses[choice], "In Review", "Done", "Canceled"])
                    assert.deepEqual(f.plan({ action: "intake", choice, membership: reconciled(status) }), {
                        state: "unchanged",
                        status,
                    })
            assert.deepEqual(f.plan({ action: "intake", choice: "todo", membership: present("Backlog") }), {
                state: "unchanged",
                status: "Backlog",
            })
        } finally {
            f.close()
        }
    })
    it("requires the exact attempted add scope and fresh matching PR membership for recovery", () => {
        const f = fixture()
        try {
            for (const changed of [
                { method: "update_project_item" },
                { owner: "other" },
                { owner_type: "org" },
                { project_number: 3 },
                { item_owner: "other" },
                { item_repo: "other" },
                { item_type: "issue" },
                { pull_request_number: 13 },
            ]) {
                const membership = reconciled()
                Object.assign(membership.attempt.arguments, changed)
                assert.equal(f.plan({ action: "intake", choice: "todo", membership }).state, "blocked")
            }
            const wrongServer = reconciled()
            wrongServer.attempt.tool = "mcp__forge__projects_write"
            const wrongProject = reconciled()
            wrongProject.evidence.arguments.project_number = 3
            const wrongPR = reconciled()
            wrongPR.evidence.response.content.number = 13
            const issue = reconciled()
            issue.evidence.response.content_type = "Issue"
            for (const membership of [wrongServer, wrongProject, wrongPR, issue])
                assert.equal(f.plan({ action: "intake", choice: "todo", membership }).state, "blocked")
        } finally {
            f.close()
        }
    })
    it("limits reconciled intake to its explicit choice without a fabricated success response", () => {
        const f = fixture()
        try {
            for (const action of ["review", "shipping", "cancellation"])
                assert.equal(
                    Value.Check(IntegrationContextSchema, f.request({ action, membership: reconciled() })),
                    false,
                )
            assert.equal(
                Value.Check(IntegrationContextSchema, f.request({ action: "intake", membership: reconciled() })),
                false,
            )
            const membership = { ...reconciled(), attempt: { ...reconciled().attempt, response: { id: 99 } } }
            assert.equal(
                Value.Check(IntegrationContextSchema, f.request({ action: "intake", choice: "todo", membership })),
                false,
            )
        } finally {
            f.close()
        }
    })
    it("preserves existing membership/progress rather than requeueing it", () => {
        const f = fixture()
        try {
            for (const status of ["Todo", "In Review", "Done", "Canceled"]) {
                assert.deepEqual(f.plan({ action: "intake", choice: "backlog", membership: present(status) }), {
                    state: "unchanged",
                    status,
                })
            }
            assert.deepEqual(f.plan({ action: "intake", choice: "todo", membership: added("In Review") }), {
                state: "unchanged",
                status: "In Review",
            })
        } finally {
            f.close()
        }
    })
    it("starts review once and stays In Review across contributor changes", () => {
        const f = fixture()
        try {
            assert.deepEqual(mutation(f.plan()).arguments.updated_field, { name: "Status", value: "In Review" })
            for (const change of ["head", "draft", "feedback"] as const) {
                const evidence = read()
                if (change === "head") evidence.response.head.sha = "c".repeat(40)
                if (change === "draft") evidence.response.draft = true
                if (change === "feedback") Object.assign(evidence.response, { review_decision: "CHANGES_REQUESTED" })
                assert.deepEqual(f.plan({ evidence, membership: present("In Review") }), {
                    state: "unchanged",
                    status: "In Review",
                })
            }
            assert.equal(f.plan({ membership: absent() }).state, "blocked")
            assert.equal(f.plan({ membership: present("Done") }).state, "blocked")
        } finally {
            f.close()
        }
    })
    it("requires confirmed merge before Done and confirmed unmerged close before Canceled", () => {
        const f = fixture()
        try {
            assert.equal(f.plan({ action: "shipping" }).state, "blocked")
            const close = f.plan({ action: "cancellation" })
            assert.deepEqual(mutation(close), {
                tool: "mcp__forge__update_pull_request",
                arguments: { ...repository, pullNumber: 12, state: "closed" },
            })
            const closed = read()
            closed.response.state = "closed"
            assert.deepEqual(mutation(f.plan({ action: "cancellation", evidence: closed })).arguments.updated_field, {
                name: "Status",
                value: "Canceled",
            })
            assert.deepEqual(f.plan({ action: "cancellation", evidence: closed, membership: present("Canceled") }), {
                state: "unchanged",
                status: "Canceled",
            })
            closed.response.merged = true
            closed.response.merged_at = "2026-10-21T12:00:00Z"
            for (const action of ["shipping", "cancellation"])
                assert.deepEqual(mutation(f.plan({ action, evidence: closed })).arguments.updated_field, {
                    name: "Status",
                    value: "Done",
                })
            closed.response.merged_at = null
            assert.equal(f.plan({ action: "shipping", evidence: closed }).state, "blocked")
        } finally {
            f.close()
        }
    })
    it("reuses complete native write success and requests missing outcome facts", () => {
        const f = fixture()
        try {
            const merged = read()
            merged.response.state = "closed"
            merged.response.merged = true
            merged.response.merged_at = "2026-10-21T12:00:00Z"
            const write = {
                ...present("Done").evidence,
                tool: "mcp__board__projects_write",
                arguments: {
                    method: "update_project_item",
                    ...address,
                    item_id: 99,
                    updated_field: { name: "Status", value: "Done" },
                },
            }
            assert.deepEqual(
                f.plan({ action: "shipping", evidence: merged, membership: { state: "present", evidence: write } }),
                { state: "unchanged", status: "Done" },
            )
            assert.equal(
                f.plan({
                    action: "shipping",
                    evidence: merged,
                    membership: { state: "present", evidence: { ...write, response: { id: 99 } } },
                }).state,
                "blocked",
            )
        } finally {
            f.close()
        }
    })
    it("rejects wrong Project, issue content, foreign identity and missing options", () => {
        const f = fixture()
        try {
            const wrongProject = present()
            wrongProject.evidence.arguments.project_number = 3
            const issue = present()
            issue.evidence.response.content_type = "Issue"
            const foreign = present()
            foreign.evidence.response.content.repository = "other/app"
            for (const membership of [wrongProject, issue, foreign])
                assert.equal(f.plan({ membership }).state, "blocked")
            const missingOption = field()
            missingOption.response.options.pop()
            assert.equal(f.plan({ fieldEvidence: missingOption }).state, "blocked")
            const wrongServer = field()
            wrongServer.tool = "mcp__forge__projects_get"
            assert.equal(f.plan({ fieldEvidence: wrongServer }).state, "blocked")
        } finally {
            f.close()
        }
    })
    it("does not claim absent membership from partial or mismatched lookup", () => {
        const f = fixture()
        try {
            const partial = absent()
            partial.lookup[0].response.pageInfo = { hasNextPage: true, nextCursor: "more" }
            assert.equal(f.plan({ action: "intake", choice: "todo", membership: partial }).state, "blocked")
            const existing = absent()
            existing.lookup[0].response.items = [
                { content_type: "PullRequest", content: { repository: "upstream/app", number: 12 } },
            ]
            assert.equal(f.plan({ action: "intake", choice: "backlog", membership: existing }).state, "blocked")
        } finally {
            f.close()
        }
    })
    it("retains forge-only context and performs no local/provider mutation", () => {
        const f = fixture()
        try {
            const index = fs.readFileSync(path.join(f.root, ".git/index"))
            const before = f.git("status", "--porcelain")
            f.plan()
            assert.equal(f.git("status", "--porcelain"), before)
            assert.deepEqual(fs.readFileSync(path.join(f.root, ".git/index")), index)
            fs.writeFileSync(
                path.join(f.root, ".project/integrations.json"),
                JSON.stringify({ tracker: minimalTracker(), forge: f.config.forge }),
            )
            assert.equal(f.plan().state, "blocked")
            const context = buildIntegrationContext(
                { cwd: f.root } as never,
                {
                    operation: "incomingPullRequest",
                    reference: "#12",
                },
                mcpTools,
            )
            assert.equal(context.project.state, "disabled")
            assert.equal(context.roles.forge.config.mcpServer, "forge")
        } finally {
            f.close()
        }
    })
})
