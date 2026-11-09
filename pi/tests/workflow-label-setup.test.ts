import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import { parseLabelSetupInput, runLabelSetup } from "../workflows/extensions/project-setup/label-setup.ts"
import { kindLabels } from "./workflow-phase-fixtures.ts"
import { registeredWorkflowTools } from "./workflow-tools-fixture.ts"

interface FakeLabel {
    node_id: string
    name: string
    color: string
    description: string
    archived_at: string | null
    usage: number
}

/** A GitHub REST and GraphQL double covering the repository label calls label setup makes. */
class FakeGitHubLabels {
    labels: FakeLabel[] = []
    readonly writes: string[] = []
    nextId = 1
    failNextWrite = false
    /** The next write takes effect, but its response is lost. */
    loseNextWriteResponse = false

    add(name: string, extra: Partial<FakeLabel> = {}) {
        this.labels.push({
            node_id: `LA_${this.nextId++}`,
            name,
            color: "1D76DB",
            description: "",
            archived_at: null,
            usage: 0,
            ...extra,
        })
    }

    readonly fetch: typeof fetch = async (input, init) => {
        const url = new URL(String(input))
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        const reply = (value: unknown, status = 200) =>
            new Response(value === null ? null : JSON.stringify(value), { status })
        if (url.pathname === "/graphql") {
            const repository: Record<string, unknown> = {}
            for (const [key, name] of Object.entries(body.variables as Record<string, string>)) {
                if (!/^l\d+$/.test(key)) continue
                const label = this.labels.find((candidate) => candidate.name === name)
                repository[key] = label
                    ? { issues: { totalCount: label.usage }, pullRequests: { totalCount: 0 } }
                    : null
            }
            return reply({ data: { repository } })
        }
        const base = "/repos/acme/example/labels"
        if (url.pathname === base && method === "GET") {
            const page = Number(url.searchParams.get("page"))
            return reply(page === 1 ? this.labels : [])
        }
        if (method !== "GET") {
            if (this.failNextWrite) {
                this.failNextWrite = false
                return reply({ message: "Unavailable" }, 503)
            }
            this.writes.push(`${method} ${decodeURIComponent(url.pathname.slice(base.length)) || "/"}`)
        }
        const lost = method !== "GET" && this.loseNextWriteResponse
        if (lost) this.loseNextWriteResponse = false
        if (url.pathname === base && method === "POST") {
            this.add(body.name, { color: body.color, description: body.description })
            return lost ? reply({ message: "response lost" }, 502) : reply(this.labels.at(-1), 201)
        }
        const name = decodeURIComponent(url.pathname.slice(base.length + 1))
        const label = this.labels.find((candidate) => candidate.name === name)
        if (!label) return reply({ message: "Not Found" }, 404)
        if (method === "PATCH") {
            if (body.new_name) label.name = body.new_name
            if (body.color) label.color = body.color
            if (body.description !== undefined) label.description = body.description
            if (body.archived !== undefined) label.archived_at = body.archived ? "2026-11-04T00:00:00Z" : null
            return lost ? reply({ message: "response lost" }, 502) : reply(label)
        }
        if (method === "DELETE") {
            this.labels = this.labels.filter((candidate) => candidate !== label)
            return reply(null, 204)
        }
        return reply({ message: "unexpected request" }, 400)
    }
}

const target = {
    provider: "github" as const,
    credentialEnv: "GITHUB_TOKEN_FOR_TEST",
    repository: { owner: "acme", repo: "example" },
}

function project(integrations?: unknown): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "label-setup-"))
    cp.execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root })
    if (integrations) {
        fs.mkdirSync(path.join(root, ".project"))
        fs.writeFileSync(path.join(root, ".project/integrations.json"), JSON.stringify(integrations))
    }
    return root
}

function trackerConfig(labels: unknown) {
    return {
        tracker: {
            provider: "github",
            mcpServer: "github",
            repository: target.repository,
            project: { owner: "acme", ownerType: "user", number: 1 },
            labels,
            fields: {
                status: {
                    field: "Status",
                    values: {
                        backlog: "Backlog",
                        todo: "Todo",
                        inProgress: "In Progress",
                        inReview: "In Review",
                        done: "Done",
                        canceled: "Canceled",
                    },
                },
                phase: {
                    field: "Phase",
                    values: { planning: "Planning", execution: "Execution", selfReview: "Self-Review" },
                },
                priority: { scope: "project", field: "Priority", values: ["High"] },
            },
        },
        forge: { provider: "github", mcpServer: "github", repository: target.repository },
    }
}

const area = (name: string) => ({
    groups: {
        area: {
            appliesTo: ["deliverable" as const],
            cardinality: "zeroOrMore" as const,
            values: { frontend: { name, color: "#1D76DB", description: "" } },
        },
    },
})

describe("label setup tools", () => {
    it("previews, applies by the approved hash, verifies, and returns the configuration to save", async () => {
        const github = new FakeGitHubLabels()
        github.add("bug", { usage: 2 })
        const cwd = project()
        const options = { cwd, fetch: github.fetch, env: { GITHUB_TOKEN_FOR_TEST: "secret-token" } }
        try {
            const inspected = await runLabelSetup({ operation: "inspect", target }, options)
            assert.equal((inspected.catalog as unknown[]).length, 1)
            assert.equal(inspected.previous, null)

            const blocked = await runLabelSetup({ operation: "preview", target, labels: kindLabels() }, options)
            assert.equal(blocked.state, "decisions-needed")
            const [decision] = blocked.decisions as { id: string; options: string[] }[]
            assert.deepEqual(decision.options, ["remove", "keep"])

            const answers = { [decision.id]: "keep" }
            const preview = await runLabelSetup(
                { operation: "preview", target, labels: kindLabels(), answers },
                options,
            )
            assert.equal(preview.state, "ready")
            assert.equal((preview.actions as unknown[]).length, 7)
            await assert.rejects(
                runLabelSetup(
                    { operation: "apply", target, labels: kindLabels(), answers, approvedPlanHash: "0".repeat(64) },
                    options,
                ),
                /changed after approval/,
            )
            assert.deepEqual(github.writes, [])

            const applied = await runLabelSetup(
                {
                    operation: "apply",
                    target,
                    labels: kindLabels(),
                    answers,
                    approvedPlanHash: String(preview.planHash),
                },
                options,
            )
            assert.equal(applied.state, "applied")
            const writes: readonly string[] = github.writes
            assert.equal(writes.filter((write) => write.startsWith("POST")).length, 7)
            const saved = applied.configuration as { labels: { unmanaged?: { keep: unknown[] } } }
            assert.deepEqual(saved.labels.unmanaged, { keep: [{ name: "bug" }] })
            assert.doesNotMatch(JSON.stringify(applied), /secret-token/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("reads the previous managed set from the working-tree configuration, and ignores an invalid one", async () => {
        const github = new FakeGitHubLabels()
        github.add("Area: Fronted")
        const options = (cwd: string) => ({ cwd, fetch: github.fetch, env: { GITHUB_TOKEN_FOR_TEST: "t" } })
        const valid = project(trackerConfig(area("Area: Fronted")))
        const invalid = project({ tracker: { labels: { kind: { epic: "Kind: Epic" } } } })
        try {
            const rename = await runLabelSetup(
                { operation: "preview", target, labels: area("Area: Frontend") },
                options(valid),
            )
            assert.match(JSON.stringify(rename.actions), /rename to \\"Area: Frontend\\"/)

            const noPrevious = await runLabelSetup({ operation: "inspect", target }, options(invalid))
            assert.equal(noPrevious.previous, null)
        } finally {
            fs.rmSync(valid, { recursive: true, force: true })
            fs.rmSync(invalid, { recursive: true, force: true })
        }
    })

    it("continues after a failed write that the tracker confirms was applied", async () => {
        const github = new FakeGitHubLabels()
        github.add("bug")
        const cwd = project()
        const options = { cwd, fetch: github.fetch, env: { GITHUB_TOKEN_FOR_TEST: "t" } }
        const labels = { ...kindLabels(), unmanaged: { keep: [{ name: "bug" }] } }
        try {
            const preview = await runLabelSetup({ operation: "preview", target, labels }, options)
            assert.equal(preview.state, "ready")
            github.loseNextWriteResponse = true
            const applied = await runLabelSetup(
                { operation: "apply", target, labels, approvedPlanHash: String(preview.planHash) },
                options,
            )
            assert.equal(applied.state, "applied")
            assert.equal((applied.recovered as string[]).length, 1)
            assert.equal(github.labels.length, 8, "the lost create isn't repeated")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("stops after a failed write that the tracker confirms wasn't applied", async () => {
        const github = new FakeGitHubLabels()
        const cwd = project()
        const options = { cwd, fetch: github.fetch, env: { GITHUB_TOKEN_FOR_TEST: "t" } }
        try {
            const preview = await runLabelSetup(
                { operation: "preview", target, labels: area("Area: Frontend") },
                options,
            )
            github.failNextWrite = true
            await assert.rejects(
                runLabelSetup(
                    {
                        operation: "apply",
                        target,
                        labels: area("Area: Frontend"),
                        approvedPlanHash: String(preview.planHash),
                    },
                    options,
                ),
                /503/,
            )
            assert.deepEqual(github.labels, [], "nothing was created")
            const again = await runLabelSetup({ operation: "preview", target, labels: area("Area: Frontend") }, options)
            assert.equal((again.actions as unknown[]).length, 1, "a failed create is planned again, never assumed")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("retires a used label and deletes an unused one when they leave the configuration", async () => {
        const github = new FakeGitHubLabels()
        github.add("Area: Frontend", { usage: 3 })
        github.add("Area: Backend")
        const both = {
            groups: {
                area: {
                    appliesTo: ["deliverable" as const],
                    cardinality: "zeroOrMore" as const,
                    values: {
                        frontend: { name: "Area: Frontend", color: "#1D76DB", description: "" },
                        backend: { name: "Area: Backend", color: "#1D76DB", description: "" },
                    },
                },
            },
        }
        const cwd = project(trackerConfig(both))
        const options = { cwd, fetch: github.fetch, env: { GITHUB_TOKEN_FOR_TEST: "t" } }
        try {
            const preview = await runLabelSetup({ operation: "preview", target, labels: {} }, options)
            assert.deepEqual(
                (preview.removals as { kind: string; name: string }[]).map((action) => [action.kind, action.name]),
                [
                    ["retire", "Area: Frontend"],
                    ["delete", "Area: Backend"],
                ],
            )
            const applied = await runLabelSetup(
                { operation: "apply", target, labels: {}, approvedPlanHash: String(preview.planHash) },
                options,
            )
            assert.deepEqual(github.writes, ["PATCH /Area: Frontend", "DELETE /Area: Backend"])
            assert.ok(github.labels.find((label) => label.name === "Area: Frontend")?.archived_at)
            assert.deepEqual((applied.configuration as { labels: { retired: unknown[] } }).labels.retired, [
                { name: "Area: Frontend" },
            ])
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("re-adopts a label on the retired list and returns a valid configuration", async () => {
        const github = new FakeGitHubLabels()
        github.add("Area: Legacy", { color: "000000" })
        const cwd = project()
        const options = { cwd, fetch: github.fetch, env: { GITHUB_TOKEN_FOR_TEST: "t" } }
        const labels = { ...area("Area: Legacy"), retired: [{ name: "Area: Legacy" }] }
        try {
            const preview = await runLabelSetup({ operation: "preview", target, labels }, options)
            assert.equal(preview.state, "ready")
            assert.deepEqual(
                (preview.droppedEntries as { list: string; reason: string }[]).map((entry) => [
                    entry.list,
                    entry.reason,
                ]),
                [["retired", "the configuration now manages it"]],
            )
            const applied = await runLabelSetup(
                { operation: "apply", target, labels, approvedPlanHash: String(preview.planHash) },
                options,
            )
            assert.equal((applied.configuration as { labels: { retired?: unknown } }).labels.retired, undefined)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })
})

/**
 * A Linear GraphQL double with two teams and a label catalog. With `writes`, it also applies label
 * create, update, delete, restore, and retire mutations to the catalog and records each one.
 */
function fakeLinear(
    catalog: { issue: Record<string, unknown>[]; project: Record<string, unknown>[] },
    writes?: string[],
): typeof fetch {
    let nextId = 1
    return async (_input, init) => {
        const body = JSON.parse(String(init?.body))
        const query = String(body.query)
        const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
        const mutation = /(issueLabel|projectLabel)(Create|Update|Delete|Restore|Retire)\(/.exec(query)
        if (mutation && writes) {
            const [, kind, verb] = mutation
            const list = kind === "issueLabel" ? catalog.issue : catalog.project
            const { id, input } = body.variables as { id?: string; input?: Record<string, unknown> }
            const label = list.find((node) => node.id === id)
            const name = String(input?.name ?? label?.name)
            writes.push(`${verb} ${name}`)
            if (verb === "Create") {
                const created = linearLabel(`new-${nextId++}`, name, {
                    color: input?.color,
                    description: input?.description,
                    isGroup: input?.isGroup === true,
                    groupType: input?.groupType ?? null,
                    team: input?.teamId ? { id: input.teamId } : null,
                    parent: input?.parentId ? { id: input.parentId } : null,
                })
                list.push(created)
                return reply({ [`${kind}Create`]: { success: true, [kind]: { id: created.id } } })
            }
            if (!label) throw new Error(`fake Linear: no label ${id}`)
            if (verb === "Delete") list.splice(list.indexOf(label), 1)
            if (verb === "Retire") label.retiredAt = "2026-11-05T00:00:00Z"
            if (verb === "Restore") label.retiredAt = null
            if (verb === "Update") {
                const { parentId, ...rest } = input ?? {}
                Object.assign(label, rest, parentId !== undefined ? { parent: parentId ? { id: parentId } : null } : {})
            }
            return reply({ [`${kind}${verb}`]: { success: true } })
        }
        if (query.includes("LabelSetupTeams"))
            return reply({
                teams: {
                    nodes: [
                        { id: "team-ale", key: "ALE", name: "Alex" },
                        { id: "team-ops", key: "OPS", name: "Ops" },
                    ],
                },
            })
        const field = query.includes("issueLabels") ? "issueLabels" : "projectLabels"
        const nodes = field === "issueLabels" ? catalog.issue : catalog.project
        return reply({ [field]: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } })
    }
}

const linearLabel = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    color: "#8250DF",
    description: "",
    isGroup: false,
    groupType: null,
    retiredAt: null,
    team: null,
    parent: null,
    issues: { nodes: [] },
    projects: { nodes: [] },
    ...extra,
})

function linearPhaseCatalog(prefix: string, projectGroupType: string | null) {
    const children = (group: string) =>
        ["Planning", "Execution", "Self-Review"].map((name) =>
            linearLabel(`${group}:${name}`, name, { parent: { id: group } }),
        )
    return {
        issue: [
            linearLabel(`${prefix}-issue`, "Phase", { isGroup: true, groupType: "singleSelect" }),
            ...children(`${prefix}-issue`),
        ],
        project: [
            linearLabel(`${prefix}-project`, "Phase", { isGroup: true, groupType: projectGroupType }),
            ...children(`${prefix}-project`),
        ],
    }
}

describe("Linear label setup", () => {
    const phase = {
        issues: {
            scope: "workspace" as const,
            group: { name: "Phase", color: "#8250DF", description: "" },
            values: {
                planning: { name: "Planning", color: "#8250DF", description: "" },
                execution: { name: "Execution", color: "#8250DF", description: "" },
                selfReview: { name: "Self-Review", color: "#8250DF", description: "" },
            },
        },
    }
    const phases = { issues: phase.issues, projects: phase.issues }
    const linearTarget = (team: string) => ({ provider: "linear" as const, credentialEnv: "LINEAR_KEY", team })

    it("treats an untyped Project Phase group as single-select, as runtime does", async () => {
        const cwd = project()
        try {
            const preview = await runLabelSetup(
                { operation: "preview", target: linearTarget("ALE"), labels: {}, phase: phases },
                { cwd, fetch: fakeLinear(linearPhaseCatalog("p", null)), env: { LINEAR_KEY: "k" } },
            )
            assert.equal(preview.state, "ready")
            assert.deepEqual(preview.actions, [])
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("uses the previous managed set only when its team is the target team", async () => {
        const statuses = { backlog: "B", todo: "T", inProgress: "P", inReview: "R", done: "D", canceled: "C" }
        const saved = (team: string) => ({
            tracker: {
                provider: "linear",
                mcpServer: "linear",
                team,
                phase: phases,
                labels: {
                    groups: {
                        area: {
                            appliesTo: ["deliverable"],
                            cardinality: "zeroOrMore",
                            scope: "workspace",
                            values: { fe: { name: "Area: FE", color: "#8250DF", description: "" } },
                        },
                    },
                },
                statuses: { issues: statuses, projects: statuses },
            },
            forge: { provider: "github", mcpServer: "github", repository: { owner: "o", repo: "r" } },
        })
        const catalog = linearPhaseCatalog("p", "singleSelect")
        catalog.issue.push(linearLabel("fe", "Area: FE"))
        const sameTeam = project(saved("Alex"))
        const otherTeam = project(saved("OPS"))
        const options = (cwd: string) => ({ cwd, fetch: fakeLinear(catalog), env: { LINEAR_KEY: "k" } })
        try {
            const same = await runLabelSetup(
                { operation: "preview", target: linearTarget("ALE"), labels: {}, phase: phases },
                options(sameTeam),
            )
            assert.deepEqual(
                (same.removals as { kind: string; name: string }[]).map((action) => [action.kind, action.name]),
                [["delete", "Area: FE"]],
                "the team matched by name, so its managed label is removed",
            )
            const other = await runLabelSetup({ operation: "inspect", target: linearTarget("ALE") }, options(otherTeam))
            assert.equal(other.previous, null)
        } finally {
            fs.rmSync(sameTeam, { recursive: true, force: true })
            fs.rmSync(otherTeam, { recursive: true, force: true })
        }
    })

    it("adopts a misplaced label and remaps another on first setup, then verifies", async () => {
        const def = (name: string) => ({ name, color: "#1D76DB", description: "" })
        const labels = {
            groups: {
                kind: {
                    appliesTo: ["deliverable" as const],
                    cardinality: "exactlyOne" as const,
                    scope: "workspace" as const,
                    nativeGroup: def("Kind"),
                    values: {
                        feature: def("Feature"),
                        bugfix: def("Bug"),
                        research: def("Research"),
                        refactor: def("Refactor"),
                        audit: def("Audit"),
                        chore: def("Chore"),
                    },
                },
            },
        }
        const catalog = linearPhaseCatalog("p", "singleSelect")
        catalog.issue.push(
            linearLabel("feature", "Feature", { issues: { nodes: [{ id: "i1" }] } }),
            linearLabel("bug", "Bug"),
            linearLabel("improvement", "Improvement", { issues: { nodes: [{ id: "i2" }] } }),
        )
        const writes: string[] = []
        const cwd = project()
        const options = { cwd, fetch: fakeLinear(catalog, writes), env: { LINEAR_KEY: "k" } }
        const request = {
            target: linearTarget("ALE"),
            labels,
            phase: phases,
            remap: [
                {
                    name: "Improvement",
                    catalog: "issue" as const,
                    scope: "workspace" as const,
                    group: "kind",
                    value: "refactor",
                },
            ],
            answers: {
                "misplaced:issue:kind:feature": "adopt",
                "misplaced:issue:kind:bugfix": "replace",
                "single-select:issue:kind": "proceed",
            },
        }
        try {
            const preview = await runLabelSetup({ operation: "preview", ...request }, options)
            assert.equal(preview.state, "ready", JSON.stringify(preview.decisions))
            const applied = await runLabelSetup(
                { operation: "apply", ...request, approvedPlanHash: preview.planHash as string },
                options,
            )
            assert.equal(applied.state, "applied")
            assert.equal(writes[0], "Delete Bug", "the replaced label is deleted before anything is created")
            assert.ok(writes.indexOf("Create Kind") < writes.indexOf("Update Feature"))
            assert.ok(writes.includes("Update Refactor"), "Improvement is renamed in place")
            assert.ok(!writes.includes("Create Refactor"))
            const byName = (name: string) => catalog.issue.find((node) => node.name === name)
            assert.equal(byName("Improvement"), undefined)
            assert.equal(byName("Refactor")?.id, "improvement", "the remapped label keeps its id and items")
            assert.equal(byName("Feature")?.id, "feature")
            assert.deepEqual(
                (applied.configuration as { labels: typeof labels }).labels.groups,
                labels.groups,
                "the remap list isn't saved",
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })
})

describe("label setup input validation", () => {
    const phase = {
        scope: "workspace" as const,
        group: { name: "Phase", color: "#8250DF", description: "" },
        values: {
            planning: { name: "Planning", color: "#8250DF", description: "" },
            execution: { name: "Execution", color: "#8250DF", description: "" },
            selfReview: { name: "Self-Review", color: "#8250DF", description: "" },
        },
    }

    it("reports only the target provider's errors", () => {
        const input = {
            target: { provider: "linear", credentialEnv: "LINEAR_KEY", team: "ALE" },
            phase: { issues: phase, projects: phase },
            labels: {
                groups: {
                    area: {
                        appliesTo: ["deliverable"],
                        cardinality: "zeroOrMore",
                        scope: "team",
                        values: { myArea: { name: "A", color: "#1D76DB", description: "" } },
                    },
                },
            },
        }
        assert.throws(
            () => parseLabelSetupInput("preview", input),
            (error: Error) =>
                /for linear is invalid/.test(error.message) &&
                /myArea/.test(error.message) &&
                !/scope|nativeGroup|anyOf/.test(error.message),
        )
    })

    it("rejects a GitHub remap entry shaped for Linear", () => {
        const input = {
            target,
            labels: area("Area: Frontend"),
            remap: [{ name: "bug", catalog: "issue", scope: "workspace", group: "area", value: "frontend" }],
        }
        assert.throws(() => parseLabelSetupInput("preview", input), /for github is invalid[\s\S]*remap/)
    })

    it("validates in prepareArguments, before Pi's union check", () => {
        for (const name of ["inspect_label_setup", "preview_label_setup", "apply_label_setup"]) {
            const prepare = registeredWorkflowTools().find((tool) => tool.name === name)?.prepareArguments
            assert.ok(prepare, name)
            assert.throws(() => prepare({ target: { provider: "linear" } }), /for linear is invalid/)
        }
    })
})
