import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"
import { linearPhases, phaseValues } from "./workflow-phase-fixtures.ts"
import { readEntityStatus } from "../workflows/extensions/__lib/entity.ts"
import { parseEpicRouting, parseEpicTasks } from "../workflows/extensions/__lib/epic-tasks.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { initializeEntity } from "../workflows/extensions/init/entity.ts"
import { restoreEpic, restoreEpicPlanSource } from "../workflows/extensions/init/restore.ts"
import { renderProviderBody, restoreProviderSource } from "../workflows/extensions/integrations/projection.ts"
import {
    type EpicChildIssue,
    planEpicTaskIssues,
    recordEpicTaskIssue,
} from "../workflows/extensions/integrations/epic-task-issues.ts"

const repository = { owner: "example", repo: "app" }
const statuses = {
    backlog: "Backlog",
    todo: "Todo",
    inProgress: "In Progress",
    inReview: "In Review",
    done: "Done",
    canceled: "Canceled",
}
const tools = workflowMcpCatalog("github", "linear")

function git(cwd: string, ...args: string[]) {
    return cp.execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function repo(tracker: "github" | "linear") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "epic-task-issues-"))
    git(root, "init", "-qb", "main")
    git(root, "config", "user.email", "test@example.com")
    git(root, "config", "user.name", "Test")
    fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
    git(root, "add", ".")
    git(root, "commit", "-qm", "base")
    fs.mkdirSync(path.join(root, ".project"))
    fs.writeFileSync(
        path.join(root, ".project/config.json"),
        JSON.stringify({ branches: { format: "identifier-title" } }),
    )
    fs.writeFileSync(
        path.join(root, ".project/integrations.json"),
        JSON.stringify({
            tracker:
                tracker === "github"
                    ? {
                          provider: "github",
                          mcpServer: "github",
                          repository,
                          project: { owner: "example", ownerType: "user", number: 3 },
                          labels: {
                              kind: {
                                  epic: "Kind: Epic",
                                  deliverableKinds: {
                                      feature: "Kind: Feature",
                                      bugfix: "Kind: Bugfix",
                                      research: "Kind: Research",
                                      refactor: "Kind: Refactor",
                                      audit: "Kind: Audit",
                                      chore: "Kind: Chore",
                                  },
                              },
                          },
                          fields: {
                              status: { field: "Status", values: statuses },
                              phase: { field: "Phase", values: { ...phaseValues } },
                              priority: { scope: "project", field: "Priority", values: ["High", "Low"] },
                          },
                      }
                    : {
                          provider: "linear",
                          mcpServer: "linear",
                          team: "Engineering",
                          phase: linearPhases(),
                          statuses: { issues: statuses, projects: statuses },
                      },
            forge: { provider: "github", mcpServer: "github", repository },
        }),
    )
    prepareArtifactPersistence(root)
    const epic = initializeEntity(
        {
            entity: "epic",
            title: "Rollout",
            slug: "rollout",
            request: "Roll out",
            object:
                tracker === "github"
                    ? { issueId: 100, issueNumber: 10, issueUrl: "https://github.com/example/app/issues/10" }
                    : {
                          projectId: "project-uuid",
                          projectUrl: "https://linear.app/example/project/rollout",
                          createdAt: "2026-10-01T09:00:00.000Z",
                      },
        },
        { cwd: root },
    )
    const epicPath = path.join(root, epic.directory, "epic.md")
    return { root, directory: epic.directory, epicPath, branch: epic.status.branch.name }
}

const section = (title: string, marker?: string, extra = "") =>
    `### ${marker ? `[${marker}] ` : ""}${title}\n\nKind: feature\n${extra}\n${title} outcome.\n`
const plan = (...sections: string[]) => `# Epic\n\n## Overview\n\nPlan.\n\n## Tasks\n\n${sections.join("\n")}`
const child = (marker: string, title: string, facts: Partial<EpicChildIssue> = {}): EpicChildIssue => ({
    marker,
    title,
    onBoard: true,
    closed: false,
    status: "Todo",
    priority: "High",
    ...facts,
})

describe("Epic Task format", () => {
    it("parses multi-paragraph sections, lists, and code blocks as one Task each", () => {
        const tasks = parseEpicTasks(
            [
                "# Epic",
                "",
                "### Not a Task",
                "",
                "Context.",
                "",
                "## Tasks",
                "",
                "### [#12] Build the parser",
                "",
                "Kind: bugfix",
                "",
                "First paragraph.",
                "",
                "1. nested",
                "2. list",
                "",
                "```markdown",
                "### Not a heading",
                "## Not a section",
                "```",
                "",
                "### Wire the CLI",
                "",
                "Kind: chore",
                "",
                "Second.",
                "",
                "## Delivery",
                "",
                "Not part of a Task.",
            ].join("\n"),
        )
        assert.deepEqual(
            tasks.map(({ title, marker, kind, canceled }) => ({ title, marker, kind, canceled })),
            [
                { title: "Build the parser", marker: "#12", kind: "bugfix", canceled: false },
                { title: "Wire the CLI", marker: undefined, kind: "chore", canceled: false },
            ],
        )
        assert.match(tasks[0].description, /^First paragraph\.[\s\S]*### Not a heading[\s\S]*```$/)
        assert.equal(tasks[1].description, "Second.")
    })

    it("rejects malformed Tasks", () => {
        assert.throws(() => parseEpicTasks(plan("### A\n\nNo kind.\n")), /first body line must be `Kind/)
        assert.throws(() => parseEpicTasks(plan("### A\n\nKind: epic\n\nText.\n")), /invalid Kind/)
        assert.throws(() => parseEpicTasks(plan("### A\n\nKind: chore\n")), /description is empty/)
        assert.throws(() => parseEpicTasks(plan(section("A", undefined, "Status: canceled\n"))), /already has an issue/)
        assert.throws(() => parseEpicTasks(plan(section("A", "#1", "Status: done\n"))), /only allowed Status/)
        assert.throws(() => parseEpicTasks(plan(section("A"), section("A"))), /duplicate Task title/)
        assert.throws(() => parseEpicTasks(plan(section("A", "#1"), section("B", "#1"))), /duplicate Task marker #1/)
        assert.throws(() => parseEpicTasks(plan(section("[x] A"))), /invalid Task marker/)
        assert.throws(() => parseEpicTasks(`# Epic\n\n${section("Stray")}`), /outside `## Tasks`/)
        // A plan without `## Tasks` simply has no Tasks.
        assert.deepEqual(parseEpicTasks("# Epic\n\n## Ordered Tasks\n\n1. **A** — a.\n"), [])
        assert.equal(parseEpicTasks(plan(section("A", "#1", "Status: canceled\n")))[0].canceled, true)
    })
})

describe("Epic Task issue processing", () => {
    it("creates untagged Tasks, tags them, and finishes on a rerun", () => {
        const { root, directory, epicPath } = repo("github")
        try {
            fs.writeFileSync(epicPath, plan(section("Parser"), section("CLI")))
            const first = planEpicTaskIssues(root, { entityDir: directory, epicPriority: "High", children: [] }, tools)
            assert.equal(first.state, "steps-needed")
            const steps = first.state === "steps-needed" ? first.steps : []
            assert.deepEqual(
                steps.map((step) => [step.title, step.effect]),
                [
                    ["Parser", "create"],
                    ["CLI", "create"],
                ],
            )
            const create = steps[0].effect === "create" ? steps[0].mutation : undefined
            assert.deepEqual(create?.arguments, {
                method: "create",
                ...repository,
                title: "Parser",
                body: "Parser outcome.",
                labels: ["Kind: Feature"],
                parent_issue_number: 10,
            })
            const evidence = {
                tool: create!.tool,
                arguments: create!.arguments,
                response: { id: "5", url: "https://github.com/example/app/issues/11" },
            }
            assert.deepEqual(
                recordEpicTaskIssue(root, { entityDir: directory, title: "Parser", marker: "#11", evidence }, tools),
                {
                    state: "tagged",
                    title: "Parser",
                    marker: "#11",
                },
            )
            assert.throws(
                () => recordEpicTaskIssue(root, { entityDir: directory, title: "CLI", marker: "#12", evidence }, tools),
                /another Task title/,
            )
            assert.throws(
                () => recordEpicTaskIssue(root, { entityDir: directory, title: "CLI", marker: "#11" }, tools),
                /already contains Task marker #11/,
            )
            assert.equal(
                recordEpicTaskIssue(root, { entityDir: directory, title: "Parser", marker: "#11" }, tools).state,
                "unchanged",
            )
            assert.match(fs.readFileSync(epicPath, "utf-8"), /^### \[#11\] Parser$/m)

            // The session stopped after #12 was created but before its tag; the rerun's
            // title lookup tags it instead of creating a duplicate.
            const retry = planEpicTaskIssues(
                root,
                {
                    entityDir: directory,
                    epicPriority: "High",
                    children: [child("#11", "Parser"), child("#12", "CLI")],
                },
                tools,
            )
            assert.deepEqual(retry, { state: "steps-needed", steps: [{ title: "CLI", marker: "#12", effect: "tag" }] })
            recordEpicTaskIssue(root, { entityDir: directory, title: "CLI", marker: "#12" }, tools)
            const done = planEpicTaskIssues(
                root,
                { entityDir: directory, epicPriority: "High", children: [child("#11", "Parser"), child("#12", "CLI")] },
                tools,
            )
            assert.deepEqual(done, { state: "complete" })
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("skips children already tagged in the plan and stops on ambiguous titles", () => {
        const { root, directory, epicPath } = repo("github")
        try {
            // #11 was renamed in the plan but kept its original issue title.
            fs.writeFileSync(epicPath, plan(section("Parser core", "#11"), section("Parser")))
            const result = planEpicTaskIssues(
                root,
                { entityDir: directory, epicPriority: "High", children: [child("#11", "Parser")] },
                tools,
            )
            assert.equal(result.state === "steps-needed" && result.steps[0].effect, "create")
            const ambiguous = planEpicTaskIssues(
                root,
                {
                    entityDir: directory,
                    epicPriority: "High",
                    children: [child("#11", "Parser"), child("#20", "Parser"), child("#21", "Parser")],
                },
                tools,
            )
            assert.equal(ambiguous.state, "blocked")
            assert.match(ambiguous.state === "blocked" ? ambiguous.reason : "", /#20, #21/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("repairs partial board setup and checks the lifecycle of a title match", () => {
        const { root, directory, epicPath } = repo("github")
        try {
            fs.writeFileSync(epicPath, plan(section("Parser", "#11"), section("CLI")))
            const repair = planEpicTaskIssues(
                root,
                {
                    entityDir: directory,
                    epicPriority: "High",
                    children: [{ marker: "#11", title: "Parser", onBoard: false, closed: false }],
                },
                tools,
            )
            assert.equal(repair.state, "steps-needed")
            assert.deepEqual(repair.state === "steps-needed" ? repair.steps.map((step) => step.effect) : [], [
                "addToProject",
                "setStatus",
                "setPriority",
                "create",
            ])
            // Auto-added as Backlog with no Priority (Project automation): moved to Todo with the Epic's Priority.
            const automated = planEpicTaskIssues(
                root,
                {
                    entityDir: directory,
                    epicPriority: "High",
                    children: [{ marker: "#11", title: "Parser", onBoard: true, closed: false, status: "Backlog" }],
                },
                tools,
            )
            const automatedSteps = automated.state === "steps-needed" ? automated.steps : []
            assert.deepEqual(
                automatedSteps.map((step) => step.effect),
                ["setStatus", "setPriority", "create"],
            )
            assert.deepEqual(
                automatedSteps[0].effect === "setStatus" && automatedSteps[0].mutation.arguments.updated_field,
                { name: "Status", value: "Todo" },
            )
            // A Priority already set on the Task is kept, and Todo needs no change.
            const kept = planEpicTaskIssues(
                root,
                {
                    entityDir: directory,
                    epicPriority: "High",
                    children: [child("#11", "Parser", { status: "Todo", priority: "Low" })],
                },
                tools,
            )
            assert.deepEqual(kept.state === "steps-needed" ? kept.steps.map((step) => step.effect) : [], ["create"])
            // A Task canceled on the tracker is never pulled back into Todo.
            const canceled = planEpicTaskIssues(
                root,
                {
                    entityDir: directory,
                    epicPriority: "High",
                    children: [{ marker: "#11", title: "Parser", onBoard: true, closed: true, status: "Canceled" }],
                },
                tools,
            )
            assert.deepEqual(canceled.state === "steps-needed" ? canceled.steps.map((step) => step.effect) : [], [
                "create",
            ])

            const started = planEpicTaskIssues(
                root,
                {
                    entityDir: directory,
                    epicPriority: "High",
                    children: [child("#11", "Parser"), child("#13", "CLI", { status: "In Progress" })],
                },
                tools,
            )
            assert.equal(started.state, "blocked")
            assert.equal(started.state === "blocked" && started.task, "CLI")
            // A started title match is never tagged.
            assert.deepEqual(started.state === "blocked" ? started.steps : undefined, [])
            const missing = planEpicTaskIssues(
                root,
                { entityDir: directory, epicPriority: "High", children: [] },
                tools,
            )
            assert.match(missing.state === "blocked" ? missing.reason : "", /#11 is not a child issue/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("cancels only queued Tasks and finishes an interrupted cancel", () => {
        const { root, directory, epicPath } = repo("github")
        try {
            fs.writeFileSync(epicPath, plan(section("Dropped", "#14", "Status: canceled\n")))
            const run = (facts: Partial<EpicChildIssue>) =>
                planEpicTaskIssues(
                    root,
                    { entityDir: directory, epicPriority: "High", children: [child("#14", "Dropped", facts)] },
                    tools,
                )
            const queued = run({ status: "Todo" })
            assert.deepEqual(queued.state === "steps-needed" ? queued.steps.map((step) => step.effect) : [], [
                "cancel",
                "close",
            ])
            const interrupted = run({ status: "Canceled", closed: false })
            assert.deepEqual(interrupted.state === "steps-needed" ? interrupted.steps.map((step) => step.effect) : [], [
                "close",
            ])
            assert.deepEqual(run({ status: "Canceled", closed: true }), { state: "complete" })
            const active = run({ status: "In Progress" })
            assert.equal(active.state, "blocked")
            assert.match(active.state === "blocked" ? active.reason : "", /only a queued Task can be canceled/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("moves a Linear queued Task from Backlog to Todo and fills a missing Priority", () => {
        const { root, directory, epicPath } = repo("linear")
        try {
            fs.writeFileSync(epicPath, plan(section("Parser", "ENG-4")))
            const run = (facts: Partial<EpicChildIssue>) =>
                planEpicTaskIssues(
                    root,
                    {
                        entityDir: directory,
                        epicPriority: "High",
                        children: [{ ...child("ENG-4", "Parser"), ...facts }],
                    },
                    tools,
                )
            const backlog = run({ status: "Backlog", priority: undefined })
            assert.deepEqual(
                backlog.state === "steps-needed" &&
                    backlog.steps[0].effect !== "tag" &&
                    backlog.steps[0].mutation.arguments,
                {
                    id: "ENG-4",
                    state: "Todo",
                    priority: 2,
                },
            )
            assert.deepEqual(run({ status: "Todo", priority: "Low" }), { state: "complete" })
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("creates Linear issues in the Epic's Project with Todo and Priority", () => {
        const { root, directory, epicPath } = repo("linear")
        try {
            fs.writeFileSync(epicPath, plan(section("Parser"), section("Dropped", "ENG-3", "Status: canceled\n")))
            const result = planEpicTaskIssues(
                root,
                { entityDir: directory, epicPriority: "High", children: [child("ENG-3", "Dropped")] },
                tools,
            )
            assert.equal(result.state, "steps-needed")
            const steps = result.state === "steps-needed" ? result.steps : []
            assert.deepEqual(steps[0].effect === "create" && steps[0].mutation.arguments, {
                team: "Engineering",
                title: "Parser",
                description: "Parser outcome.",
                project: "project-uuid",
                state: "Todo",
                priority: 2,
            })
            assert.deepEqual(steps[1].effect === "cancel" && steps[1].mutation.arguments, {
                id: "ENG-3",
                state: "Canceled",
            })
            const create = steps[0].effect === "create" ? steps[0].mutation : undefined
            assert.equal(
                recordEpicTaskIssue(
                    root,
                    {
                        entityDir: directory,
                        title: "Parser",
                        marker: "ENG-4",
                        evidence: { tool: create!.tool, arguments: create!.arguments, response: { id: "ENG-4" } },
                    },
                    tools,
                ).state,
                "tagged",
            )
            assert.match(fs.readFileSync(epicPath, "utf-8"), /^### \[ENG-4\] Parser$/m)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})

const token = "0f6c1b8e-6a51-4d2c-9f3e-2b7a4c5d6e7f"
const accepted = (branch: string) =>
    [
        "# Rollout",
        "",
        "## Overview",
        "",
        "Why it matters.",
        "",
        "### Plan highlights",
        "",
        "- Ship it.",
        "",
        "## Task delivery strategy",
        "",
        "Task target: default",
        `Epic branch: ${branch}`,
        "",
        "Independent Tasks.",
        "",
        "## Tasks",
        "",
        "### [#11] Parser",
        "",
        "Kind: feature",
        "",
        "1. nested",
        "   - list",
        "",
        "```md",
        "## not a section",
        "```",
        "",
        "### CLI",
        "",
        "Kind: chore",
        "",
        "Wire it.",
        "",
    ].join("\n")

describe("Epic routing and restore", () => {
    it("parses routing lines and rejects missing or invalid ones", () => {
        assert.deepEqual(parseEpicRouting(accepted("10-rollout")), { taskTarget: "default", epicBranch: "10-rollout" })
        assert.throws(() => parseEpicRouting("# E\n\n## Tasks\n"), /no `## Task delivery strategy`/)
        assert.throws(
            () => parseEpicRouting(accepted("x").replace("Task target: default", "Task target: main")),
            /needs `Task target: default` or `Task target: epic`/,
        )
        assert.throws(() => parseEpicRouting(accepted("x").replace("Epic branch: x\n", "")), /needs `Epic branch:/)
    })

    it("round-trips accepted epic.md through GitHub and Linear plan rendering", () => {
        const source = accepted("10-rollout")
        for (const kind of ["github-plan-comment", "linear-plan-document"] as const) {
            const footer =
                kind === "github-plan-comment" ? "<sub>Sent via Pi. Model: a/b.</sub>" : "*Sent via Pi. Model: a/b.*"
            const body = `${renderProviderBody(source, { kind })}\n\n<!-- plan-publication:tok -->\n\n${footer}`
            assert.deepEqual(restoreProviderSource(body, { kind }, "Rollout"), { source, token: "tok" })
        }
        assert.throws(
            () =>
                restoreProviderSource(
                    renderProviderBody(source, { kind: "github-plan-comment" }),
                    { kind: "github-plan-comment" },
                    "R",
                ),
            /exactly one plan publication marker/,
        )
    })

    it("restores a GitHub Epic in a clone without its local files", () => {
        const { root, directory, branch } = repo("github")
        try {
            const source = accepted(branch)
            const body = `${renderProviderBody(source, { kind: "github-plan-comment" })}\n\n<!-- plan-publication:${token} -->`
            const comment = (id: number, text: string) => ({
                id,
                body: text,
                html_url: `https://github.com/example/app/issues/10#issuecomment-${id}`,
            })
            const page = (comments: unknown[]) => ({
                tool: "mcp__github__issue_read",
                arguments: { method: "get_comments", ...repository, issue_number: 10, page: 1, perPage: 100 },
                response: comments,
            })
            const epic = {
                tool: "mcp__github__issue_read",
                arguments: { method: "get", ...repository, issue_number: 10 },
                response: {
                    id: 100,
                    number: 10,
                    title: "Rollout",
                    body: "Roll out",
                    html_url: "https://github.com/example/app/issues/10",
                    created_at: "2026-10-01T09:00:00Z",
                },
            }
            const pages = [page([comment(7, "discussion"), comment(8, body)])]

            // An existing local Epic for the same issue blocks restore under any slug.
            assert.throws(() => restoreEpic(root, { slug: "other", epic, pages }, tools), /already exists/)
            const local = path.join(root, directory)
            assert.deepEqual(restoreEpicPlanSource(root, { entityDir: directory, pages }, tools).source, source)

            fs.rmSync(local, { recursive: true })
            assert.throws(
                () =>
                    restoreEpic(
                        root,
                        { slug: "rollout", epic, pages: [page([comment(8, body), comment(9, body)])] },
                        tools,
                    ),
                /found 2 published plans/,
            )
            assert.throws(() => restoreEpic(root, { slug: "rollout", epic, pages: [page([])] }, tools), /found 0/)
            const noTasks = `${renderProviderBody(source.split("\n## Tasks")[0], { kind: "github-plan-comment" })}\n\n<!-- plan-publication:${token} -->`
            assert.throws(
                () => restoreEpic(root, { slug: "rollout", epic, pages: [page([comment(8, noTasks)])] }, tools),
                /no `## Tasks` section/,
            )
            assert.equal(fs.existsSync(local), false)

            // A leftover directory without metadata is never overwritten or removed.
            fs.mkdirSync(local, { recursive: true })
            fs.writeFileSync(path.join(local, "notes.md"), "keep")
            assert.throws(() => restoreEpic(root, { slug: "rollout", epic, pages }, tools), /already exists/)
            assert.equal(fs.readFileSync(path.join(local, "notes.md"), "utf-8"), "keep")
            fs.rmSync(local, { recursive: true })

            // The slug only names the directory; the branch comes from the published plan.
            const restored = restoreEpic(root, { slug: "renamed", epic, pages }, tools)
            assert.equal(restored.directory, ".project/.local/epics/10-renamed")
            const status = readEntityStatus(path.join(root, restored.directory))
            assert.equal(status.branch.name, branch)
            assert.equal(status.phase, "execution")
            assert.deepEqual(status.tracker.provider === "github" && status.tracker.planComment, {
                state: "published",
                token,
                id: 8,
                url: "https://github.com/example/app/issues/10#issuecomment-8",
            })
            assert.equal(fs.readFileSync(path.join(root, restored.directory, "epic.md"), "utf-8"), source)

            // A restored clone has no Task directories; started Tasks come from the tracker.
            const children = [
                child("#11", "Parser", { status: "In Progress" }),
                child("#12", "CLI", { status: "Done" }),
            ]
            fs.writeFileSync(path.join(root, restored.directory, "epic.md"), source.replace("### CLI", "### [#12] CLI"))
            assert.deepEqual(
                planEpicTaskIssues(root, { entityDir: restored.directory, epicPriority: "High", children }, tools),
                { state: "complete" },
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})

describe("Linear Epic restore", () => {
    it("restores a Linear Epic from its Project read and attached plan document", () => {
        const { root, directory, branch } = repo("linear")
        try {
            const source = accepted(branch).replace("[#11]", "[ENG-11]")
            const body = `${renderProviderBody(source, { kind: "linear-plan-document" })}\n\n<!-- plan-publication:${token} -->`
            const project = {
                tool: "mcp__linear__get_project",
                arguments: { query: "project-uuid" },
                response: {
                    id: "P-ENG-1",
                    uuid: "project-uuid",
                    name: "Rollout",
                    description: "Roll out",
                    url: "https://linear.app/example/project/rollout",
                    createdAt: "2026-10-01T09:00:00.000Z",
                },
            }
            const document = {
                id: "document-uuid",
                url: "https://linear.app/example/document/plan-slug",
                content: body,
                archivedAt: null,
                issue: null,
                project: { id: "P-ENG-1" },
            }
            const pages = [
                project,
                {
                    tool: "mcp__linear__list_documents",
                    arguments: {
                        limit: 50,
                        includeArchived: true,
                        orderBy: "createdAt",
                        fields: ["id", "url", "issue", "project"],
                        projectId: "project-uuid",
                    },
                    response: { documents: [{ ...document, content: undefined }], hasNextPage: false },
                },
                { tool: "mcp__linear__get_document", arguments: { id: "document-uuid" }, response: document },
            ]
            fs.rmSync(path.join(root, directory), { recursive: true })
            const restored = restoreEpic(root, { slug: "rollout", epic: project, pages }, tools)
            assert.equal(restored.directory, ".project/.local/epics/20261001-rollout")
            const status = readEntityStatus(path.join(root, restored.directory))
            assert.equal(status.branch.name, branch)
            assert.deepEqual(status.tracker.provider === "linear" && status.tracker.planDocument, {
                state: "published",
                token,
                id: "document-uuid",
                url: "https://linear.app/example/document/plan-slug",
            })
            assert.equal(fs.readFileSync(path.join(root, restored.directory, "epic.md"), "utf-8"), source)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
