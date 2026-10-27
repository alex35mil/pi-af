import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"
import { linearPhases, phaseValues } from "./workflow-phase-fixtures.ts"
import { parseEpicTasks } from "../workflows/extensions/__lib/epic-tasks.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { initializeEntity } from "../workflows/extensions/init/entity.ts"
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
    return { root, directory: epic.directory, epicPath }
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
            // Existing Status and Priority are never overwritten.
            const kept = planEpicTaskIssues(
                root,
                {
                    entityDir: directory,
                    epicPriority: "High",
                    children: [child("#11", "Parser", { status: "Backlog", priority: "Low" })],
                },
                tools,
            )
            assert.deepEqual(kept.state === "steps-needed" ? kept.steps.map((step) => step.effect) : [], ["create"])

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
