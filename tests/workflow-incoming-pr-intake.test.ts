import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import registerSetup, { inspectProjectSetup } from "../workflows/extensions/project-setup/index.ts"
import {
    INCOMING_PR_WORKFLOW_PATH,
    INCOMING_PR_INTAKE_SCRIPT,
    renderIncomingPrIntake,
} from "../workflows/extensions/project-setup/incoming-pr-intake.ts"

function input() {
    return {
        forge: { provider: "github", mcpServer: "forge", repository: { owner: "Upstream", repo: "App" } },
        tracker: {
            provider: "github",
            mcpServer: "tracker",
            repository: { owner: "upstream", repo: "issues" },
            project: { owner: "board-owner", ownerType: "user", number: 2 },
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
                priority: { scope: "project", field: "Priority", values: ["High", "Low"] },
            },
        },
        tokenSecret: "project_token",
    }
}
function harness(specification = input()) {
    const result = renderIncomingPrIntake(specification)
    const env = Object.fromEntries(
        [...result.file.content.matchAll(/^          (INTAKE_\w+): (.+)$/gm)].map((match) => [
            match[1],
            JSON.parse(match[2]),
        ]),
    )
    const script = result.file.content
        .split("          script: |\n")[1]
        .split("\n")
        .map((line) => line.slice(12))
        .join("\n")
        .trim()
    assert.equal(script, INCOMING_PR_INTAKE_SCRIPT)
    const run = new Function("context", "github", "process", `return (async () => {${script}\n})()`)
    const rows = new Map<string, { id: string; status: string }>()
    const mutations: object[] = []
    const queries: string[] = []
    let pr: any = {
        number: 12,
        state: "open",
        node_id: "PR_fixture",
        base: { repo: { full_name: "upstream/app" } },
        head: { repo: { full_name: "contributor/app" } },
    }
    const github = {
        rest: {
            pulls: {
                async get(args: object) {
                    assert.deepEqual(args, { owner: "upstream", repo: "app", pull_number: 12 })
                    return { data: pr }
                },
            },
        },
        async graphql(query: string, variables: any) {
            queries.push(query)
            if (query.startsWith("query")) {
                assert.deepEqual(variables, { owner: "board-owner", number: 2 })
                return { owner: { projectV2: { id: "PVT_fixture" } } }
            }
            assert.match(query, /addProjectV2ItemById/)
            assert.doesNotMatch(query, /update|delete|archive/i)
            assert.deepEqual(variables, { project: "PVT_fixture", pr: "PR_fixture" })
            mutations.push(variables)
            // GitHub's documented add is idempotent; native defaults apply only on creation.
            if (!rows.has(variables.pr)) rows.set(variables.pr, { id: "PVTI_fixture", status: "Backlog" })
            return { addProjectV2ItemById: { item: { id: rows.get(variables.pr)!.id } } }
        },
    }
    const context = { repo: { owner: "upstream", repo: "app" }, payload: { pull_request: { number: 12 } } }
    return {
        result,
        rows,
        mutations,
        queries,
        context,
        github,
        setPr(value: object) {
            pr = value
        },
        pr: () => pr,
        run: () => run(context, github, { env }) as Promise<void>,
    }
}

describe("fork-only incoming PR intake", () => {
    it("executes the actual generated static script and only adds fork membership", async () => {
        const h = harness()
        await h.run()
        assert.equal(h.rows.get("PR_fixture")!.status, "Backlog")
        assert.equal(h.mutations.length, 1)
        assert.ok(h.queries[0].includes("owner: user"))
    })
    it("does not add same-repository Deliverable or manual PRs", async () => {
        const h = harness()
        h.setPr({ ...h.pr(), head: { repo: { full_name: "Upstream/App" } } })
        await h.run()
        assert.deepEqual(h.queries, [])
        assert.deepEqual(h.mutations, [])
    })
    it("preserves In Review and terminal cards on repeated/reopened intake", async () => {
        const h = harness()
        await h.run()
        for (const status of ["In Review", "Done", "Canceled"]) {
            h.rows.get("PR_fixture")!.status = status
            await h.run()
            assert.equal(h.rows.size, 1)
            assert.equal(h.rows.get("PR_fixture")!.status, status)
        }
    })
    it("does not add closed, foreign or unidentified PRs", async () => {
        for (const change of ["closed", "base", "head", "number"] as const) {
            const h = harness()
            if (change === "closed") h.setPr({ ...h.pr(), state: "closed" })
            if (change === "base") h.setPr({ ...h.pr(), base: { repo: { full_name: "other/app" } } })
            if (change === "head") h.setPr({ ...h.pr(), head: { repo: null } })
            if (change === "number") h.setPr({ ...h.pr(), number: 99 })
            if (change === "closed") await h.run()
            else await assert.rejects(h.run())
            assert.deepEqual(h.mutations, [])
        }
    })
    it("uses explicit organization scope and treats PR text only as data", async () => {
        const specification = input()
        specification.tracker.project.ownerType = "org"
        const h = harness(specification)
        h.setPr({ ...h.pr(), title: "'); throw new Error('untrusted'); //", body: "${{ secrets.PROJECT_TOKEN }}" })
        await h.run()
        assert.ok(h.queries[0].includes("owner: organization"))
        assert.equal(h.mutations.length, 1)
    })
    it("stops visibly on API authorization failure without another route or mutation", async () => {
        for (const failure of ["pr-read", "project-read"] as const) {
            const h = harness()
            if (failure === "pr-read")
                h.github.rest.pulls.get = async () => {
                    throw new Error("API access denied")
                }
            else
                h.github.graphql = async () => {
                    throw new Error("API access denied")
                }
            await assert.rejects(h.run(), /API access denied/)
            assert.deepEqual(h.mutations, [])
            assert.equal(h.rows.size, 0)
        }
    })
    it("renders a pinned metadata-only workflow and prerequisites, without secrets or deployment claims", () => {
        const result = renderIncomingPrIntake(input())
        assert.equal(result.state, "rendered")
        assert.equal(result.file.path, INCOMING_PR_WORKFLOW_PATH)
        assert.match(result.file.content, /actions\/github-script@[a-f0-9]{40}/)
        assert.match(result.file.content, /types: \[opened, reopened\]/)
        assert.match(result.file.content, /permissions: \{\}/)
        assert.ok(result.file.content.includes("${{ secrets.PROJECT_TOKEN }}"))
        assert.doesNotMatch(
            result.file.content,
            /actions\/checkout|npm |git fetch|updateProjectV2ItemFieldValue|\.project\/|GIG-/,
        )
        assert.deepEqual(
            result.prerequisites.map((entry) => entry.kind),
            ["statusDefault", "actionsSecret", "eventPolicy", "deployment", "existingAutomation"],
        )
        assert.match(result.boundary, /Rendered only/)
        for (const secret of ["GITHUB_TOKEN", "token-with-dash", "bad\nname"])
            assert.throws(() => renderIncomingPrIntake({ ...input(), tokenSecret: secret }))
    })
    it("registers the real renderer as side-effect-free setup tooling", async () => {
        const tools: any[] = []
        registerSetup({
            events: { on: () => () => {} },
            on: () => {},
            registerCommand: () => {},
            registerTool: (tool: any) => tools.push(tool),
        } as never)
        const renderer = tools.find((tool) => tool.name === "render_incoming_pr_intake")
        assert.ok(renderer)
        const rendered = await renderer.execute("fixture", input())
        assert.deepEqual(rendered.details, renderIncomingPrIntake(input()))
    })
    it("includes the managed file in inspection while preserving unrelated workflows", () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "intake-setup-")))
        try {
            cp.execFileSync("git", ["init", "-q"], { cwd: root })
            fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true })
            fs.writeFileSync(path.join(root, INCOMING_PR_WORKFLOW_PATH), "existing intake\n")
            fs.writeFileSync(path.join(root, ".github/workflows/other.yml"), "unrelated\n")
            const inspected = inspectProjectSetup(root, true)
            const existing = inspected.files.find((file) => file.path === INCOMING_PR_WORKFLOW_PATH)
            if (!existing?.exists) assert.fail("Existing managed workflow must appear in setup inspection")
            assert.equal(existing.content, "existing intake\n")
            assert.equal(fs.readFileSync(path.join(root, ".github/workflows/other.yml"), "utf8"), "unrelated\n")
            assert.equal(fs.readFileSync(path.join(root, INCOMING_PR_WORKFLOW_PATH), "utf8"), "existing intake\n")
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
