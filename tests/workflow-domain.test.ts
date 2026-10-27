import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import { Value } from "typebox/value"
import { linearPhases, phaseValues } from "./workflow-phase-fixtures.ts"

import { entityName, formatBranchName, readyBranch, slugify } from "../workflows/extensions/__lib/domain.ts"
import { readEntityStatus, readEpicTaskProgress, writeEntityStatus } from "../workflows/extensions/__lib/entity.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { EntityInitializationSchema, initializeEntity, preflightEntity } from "../workflows/extensions/init/entity.ts"
import { formatInitializedEntity } from "../workflows/extensions/init/index.ts"

const repository = { owner: "example", repo: "project" }
const forge = { provider: "github", mcpServer: "github", repository }
const statuses = {
    backlog: "Backlog",
    todo: "Todo",
    inProgress: "In Progress",
    inReview: "In Review",
    done: "Done",
    canceled: "Canceled",
}

function git(cwd: string, args: string[]): string {
    return cp.execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function temporaryRepository(tracker: "github" | "linear" = "github", format = "identifier-title"): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-domain-"))
    git(directory, ["init", "-b", "main"])
    git(directory, ["config", "user.email", "test@example.com"])
    git(directory, ["config", "user.name", "Test"])
    fs.writeFileSync(path.join(directory, "README.md"), "test\n")
    fs.writeFileSync(path.join(directory, ".gitignore"), "/.project/.local/\n")
    git(directory, ["add", "README.md", ".gitignore"])
    git(directory, ["commit", "-m", "initial"])
    fs.mkdirSync(path.join(directory, ".project"), { recursive: true })
    fs.writeFileSync(path.join(directory, ".project", "config.json"), JSON.stringify({ branches: { format } }))
    fs.writeFileSync(
        path.join(directory, ".project", "integrations.json"),
        JSON.stringify({
            tracker:
                tracker === "github"
                    ? {
                          provider: "github",
                          mcpServer: "github",
                          repository,
                          project: { owner: "example", ownerType: "user", number: 3 },
                          fields: {
                              status: { field: "Status", values: statuses },
                              phase: { field: "Phase", values: { ...phaseValues } },
                              priority: {
                                  scope: "project",
                                  field: "Priority",
                                  values: ["High", "Low"],
                              },
                          },
                      }
                    : {
                          provider: "linear",
                          mcpServer: "linear",
                          team: "Engineering",
                          phase: linearPhases(),
                          statuses: {
                              issues: statuses,
                              projects: { ...statuses, done: "Completed" },
                          },
                      },
            forge,
        }),
    )
    prepareArtifactPersistence(directory)
    return directory
}

function issue(number: number) {
    return {
        issueId: 1000 + number,
        issueNumber: number,
        issueUrl: `https://github.com/example/project/issues/${number}`,
        projectItemId: 2000 + number,
    }
}

function linearIssue(identifier: string, extra: Record<string, string> = {}) {
    return {
        issueId: `${identifier.toLowerCase()}-uuid`,
        identifier,
        issueUrl: `https://linear.app/example/issue/${identifier}/work`,
        ...extra,
    }
}

const gig = (title: string, object: unknown) => ({
    entity: "gig" as const,
    title,
    slug: slugify(title),
    request: title,
    kind: "chore" as const,
    object,
})
const epic = (title: string, object: unknown) => ({
    entity: "epic" as const,
    title,
    slug: slugify(title),
    request: title,
    object,
})
const task = (title: string, parentEpicDir: string, object: unknown) => ({
    entity: "task" as const,
    title,
    slug: slugify(title),
    request: title,
    parentEpicDir,
    object,
})
// One `## Tasks` section; tagged once issue processing has created or linked its issue.
const planTask = (title: string, marker?: string, kind = "feature", extra = "") =>
    `### ${marker ? `[${marker}] ` : ""}${title}\n\nKind: ${kind}\n${extra}\n${title} outcome.\n`
const epicPlan = (branch: string, target: "epic" | "default", ...tasks: string[]) =>
    `# Epic\n\n## Overview\n\nPlan.\n\n## Task delivery strategy\n\nTask target: ${target}\nEpic branch: ${branch}\n\nWhy.\n\n## Tasks\n\n${tasks.join("\n")}`

function init(cwd: string, input: unknown) {
    return initializeEntity(Value.Parse(EntityInitializationSchema, input), {
        cwd,
    })
}

function writeMetadata(cwd: string, directory: string, status: unknown): void {
    fs.writeFileSync(path.join(cwd, directory, "metadata.json"), `${JSON.stringify(status, null, 2)}\n`)
}

describe("workflow domain", () => {
    it("names entities and branches from the tracker reference", () => {
        assert.equal(slugify("Café workflow!"), "cafe-workflow")
        assert.equal(entityName({ provider: "github", issueNumber: 12 }, "cafe-workflow"), "12-cafe-workflow")
        assert.equal(entityName({ provider: "linear", identifier: "ENG-7" }, "work"), "ENG-7-work")
        assert.equal(
            entityName({ provider: "linear", projectCreatedAt: "2026-10-01T09:00:00Z" }, "rollout"),
            "20261001-rollout",
        )
        assert.throws(
            () => entityName({ provider: "linear", projectCreatedAt: "2026-13-01T00:00:00Z" }, "x"),
            /invalid timestamp/,
        )
        assert.equal(formatBranchName("ENG-7-work", "identifier-title"), "eng-7-work")
        assert.equal(formatBranchName("12-work", "username/identifier-title", "alex"), "alex/12-work")
        assert.throws(() => formatBranchName("12-work", "username/identifier-title"), /configured username/)
        assert.deepEqual(readyBranch("12-work", "main", "generated"), {
            state: "ready",
            name: "12-work",
            start: "main",
            target: "main",
            source: "generated",
        })
    })

    it("accepts only the tracker object that matches each entity", () => {
        const check = (input: unknown) => Value.Check(EntityInitializationSchema, input)
        assert.equal(check(gig("Work", issue(1))), true)
        assert.equal(check(gig("Work", linearIssue("ENG-1"))), true)
        assert.equal(
            check(
                gig("Work", {
                    projectId: "p",
                    projectUrl: "https://linear.app/x/project/p",
                    createdAt: "2026-10-01T09:00:00.000Z",
                }),
            ),
            false,
        )
        assert.equal(
            check(
                epic("Work", {
                    projectId: "p",
                    projectUrl: "https://linear.app/x/project/p",
                    createdAt: "2026-10-01T09:00:00.000Z",
                }),
            ),
            true,
        )
        assert.equal(check({ ...epic("Work", issue(1)), kind: "feature" }), false)
        assert.equal(check({ ...gig("Work", issue(1)), kind: "review" }), false)
        assert.equal(check(gig("Work", linearIssue("eng-1"))), false)
        assert.equal(check({ ...gig("Work", issue(1)), priority: "High" }), false)
    })

    it("uses the current local branch as default without a remote", () => {
        const cwd = temporaryRepository()
        try {
            git(cwd, ["switch", "-c", "other-local-branch"])
            const initialized = init(cwd, gig("Local only", issue(5)))
            assert.equal(initialized.status.branch.start, "other-local-branch")
            assert.equal(initialized.status.branch.target, "other-local-branch")
            assert.equal(git(cwd, ["remote"]), "")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("initializes a GitHub Epic and Task from their issues with a plan marker", () => {
        const cwd = temporaryRepository()
        try {
            const created = init(cwd, epic("Shared workflow", issue(12)))
            assert.equal(created.directory, ".project/.local/epics/12-shared-workflow")
            const epicStatus = created.status
            assert.equal(epicStatus.entity, "epic")
            if (epicStatus.entity !== "epic") assert.fail()
            assert.equal(epicStatus.branch.name, "12-shared-workflow")
            assert.equal(git(cwd, ["rev-parse", epicStatus.branch.name]), git(cwd, ["rev-parse", "main"]))
            assert.deepEqual(epicStatus.tracker, {
                provider: "github",
                repository,
                external: { issueNumber: 12 },
                planComment: { state: "unpublished" },
            })
            assert.equal(epicStatus.phase, "planning")
            const epicDir = path.join(cwd, created.directory)
            for (const entry of ["brief.md", "notes.md", "metadata.json", "reviews", "scratch", "tasks"])
                assert.ok(fs.existsSync(path.join(epicDir, entry)), entry)
            for (const entry of ["pending.md", "status.md", "designs"])
                assert.equal(fs.existsSync(path.join(epicDir, entry)), false, entry)
            assert.deepEqual(
                created.resourceIds.map((ids) => [ids.scope.kind, ids.scope.entity]),
                [
                    ["github-issue", "12-shared-workflow"],
                    ["github-project-item", "12-shared-workflow"],
                ],
            )
            assert.match(formatInitializedEntity(created), /Initialized \.project\/\.local\/epics\/12-shared-workflow/)

            const epicPath = path.join(epicDir, "epic.md")
            const plan = epicPlan(
                "12-shared-workflow",
                "epic",
                planTask("Build it", "#13", "bugfix"),
                planTask("Queued", "#14"),
                planTask("Dropped", "#15", "chore", "Status: canceled\n"),
                planTask("Later"),
            )
            fs.writeFileSync(epicPath, plan)
            assert.throws(
                () => init(cwd, task("Later", created.directory, issue(16))),
                /no Task tagged #16; finish the Epic's issue processing/,
            )
            assert.throws(() => init(cwd, task("Dropped", created.directory, issue(15))), /canceled/)

            const built = init(cwd, task("Build it", created.directory, issue(13)))
            assert.equal(built.directory, ".project/.local/epics/12-shared-workflow/tasks/13-build-it")
            assert.equal(built.status.branch.name, "13-build-it")
            assert.equal(built.status.branch.start, "12-shared-workflow")
            // The plan section supplies the Kind; initialization never rewrites the plan.
            assert.equal(built.status.entity === "task" && built.status.kind, "bugfix")
            assert.equal(fs.readFileSync(epicPath, "utf-8"), plan)
            assert.deepEqual(readEntityStatus(path.join(cwd, built.directory)), built.status)
            assert.throws(() => init(cwd, task("Build it", created.directory, issue(13))), /no Task tagged #13/)

            const lifecycles = { "#13": "inProgress", "#14": "todo", "#15": "canceled" } as const
            assert.deepEqual(readEpicTaskProgress(epicDir, lifecycles), {
                epic: "#12",
                items: [
                    {
                        state: "initialized",
                        title: "Build it",
                        lifecycle: "inProgress",
                        task: { marker: "#13", directory: built.directory },
                    },
                    { state: "queued", title: "Queued", lifecycle: "todo", task: { marker: "#14" } },
                    { state: "canceled", title: "Dropped", task: { marker: "#15" } },
                    { state: "unpublished", title: "Later" },
                ],
            })
            assert.equal(readEpicTaskProgress(epicDir, { ...lifecycles, "#13": "done" }).items[0].state, "complete")
            assert.throws(() => readEpicTaskProgress(epicDir, { "#13": "done" }), /lifecycle is required for #14/)
            // A Task started in another clone has no local directory.
            assert.deepEqual(readEpicTaskProgress(epicDir, { ...lifecycles, "#14": "inProgress" }).items[1], {
                state: "initialized",
                title: "Queued",
                lifecycle: "inProgress",
                task: { marker: "#14" },
            })

            // The tracker owns the relationship; a lagging local plan doesn't break the Task.
            fs.writeFileSync(epicPath, plan.replace("[#13] ", ""))
            assert.deepEqual(readEntityStatus(path.join(cwd, built.directory)), built.status)
            fs.writeFileSync(epicPath, plan.replace("[#13]", "[TASK-01KDVDNA00]"))
            assert.throws(() => readEpicTaskProgress(epicDir), /invalid Task marker/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("routes each new Task from the plan's Task target and never retargets existing Tasks", () => {
        const cwd = temporaryRepository()
        try {
            const created = init(cwd, epic("Feature-flag rollout", issue(20)))
            const epicBranch = created.status.branch.name
            const epicPath = path.join(cwd, created.directory, "epic.md")
            const tasks = [planTask("First Task", "#21"), planTask("Second Task", "#22"), planTask("Third Task", "#23")]
            fs.writeFileSync(epicPath, epicPlan(epicBranch, "epic", ...tasks))
            const first = init(cwd, task("First Task", created.directory, issue(21)))
            assert.equal(first.status.branch.target, epicBranch)

            // Default-target Tasks need nothing from the Epic branch, even after it's deleted.
            fs.writeFileSync(epicPath, epicPlan(epicBranch, "default", ...tasks))
            git(cwd, ["branch", "-D", epicBranch])
            const second = init(cwd, task("Second Task", created.directory, issue(22)))
            assert.equal(second.status.branch.start, "main")
            assert.equal(readEntityStatus(path.join(cwd, first.directory)).branch.target, epicBranch)

            // An Epic-target Task starts from the Epic branch, so it must exist locally.
            fs.writeFileSync(epicPath, epicPlan(epicBranch, "epic", ...tasks))
            const third = () => init(cwd, task("Third Task", created.directory, issue(23)))
            assert.throws(third, /start from the Epic branch 20-feature-flag-rollout; fetch or create it/)
            git(cwd, ["branch", epicBranch, "main"])
            assert.equal(third().status.branch.target, epicBranch)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("requires routing lines that match the Epic", () => {
        const cwd = temporaryRepository()
        try {
            const created = init(cwd, epic("Planning only", issue(30)))
            const epicPath = path.join(cwd, created.directory, "epic.md")
            const start = () => init(cwd, task("Ship it", created.directory, issue(31)))
            fs.writeFileSync(epicPath, epicPlan("other-branch", "default", planTask("Ship it", "#31")))
            assert.throws(start, /says `Epic branch: other-branch`/)
            fs.writeFileSync(
                epicPath,
                epicPlan("30-planning-only", "default", planTask("Ship it", "#31")).replace(
                    "Task target: default\n",
                    "",
                ),
            )
            assert.throws(start, /needs `Task target: default` or `Task target: epic`/)
            fs.writeFileSync(epicPath, epicPlan("30-planning-only", "default", planTask("Ship it", "#31")))
            assert.equal(start().status.branch.start, "main")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("names Linear work from its identifier and the Epic from its Project's creation date", () => {
        const cwd = temporaryRepository("linear", "tracker")
        try {
            const project = {
                projectId: "project-uuid",
                projectUrl: "https://linear.app/example/project/rollout",
                createdAt: "2026-10-01T23:30:00.000-02:00",
            }
            const linearEpic = init(cwd, epic("Rollout", project))
            assert.equal(linearEpic.directory, ".project/.local/epics/20261002-rollout")
            assert.equal(linearEpic.status.branch.name, "20261002-rollout")
            assert.equal(linearEpic.status.branch.source, "tracker")
            assert.deepEqual(linearEpic.status.tracker.external, {
                projectId: "project-uuid",
                createdAt: project.createdAt,
            })
            assert.throws(
                () => init(cwd, epic("Rollout", { ...project, projectId: "other-uuid" })),
                /entity directory already exists/,
            )
            assert.equal(
                Value.Check(EntityInitializationSchema, epic("Later", { ...project, createdAt: "yesterday" })),
                false,
            )
            const { createdAt: _, ...undated } = project
            assert.equal(Value.Check(EntityInitializationSchema, epic("Later", undated)), false)
            git(cwd, ["branch", "20261003-other-epic"])
            assert.throws(
                () =>
                    init(
                        cwd,
                        epic("Other epic", {
                            ...project,
                            projectId: "other",
                            createdAt: "2026-10-03T08:00:00Z",
                        }),
                    ),
                /workflow branch already exists: 20261003-other-epic/,
            )

            fs.writeFileSync(
                path.join(cwd, linearEpic.directory, "epic.md"),
                epicPlan("20261002-rollout", "epic", planTask("Wire it", "ENG-8")),
            )
            assert.throws(
                () =>
                    init(
                        cwd,
                        task(
                            "Wire it",
                            linearEpic.directory,
                            linearIssue("ENG-8", {
                                projectId: "other",
                                gitBranchName: "alex/eng-8",
                            }),
                        ),
                    ),
                /does not belong to the parent Epic Project/,
            )
            assert.throws(
                () =>
                    init(
                        cwd,
                        task("Wire it", linearEpic.directory, linearIssue("ENG-8", { projectId: "project-uuid" })),
                    ),
                /gitBranchName/,
            )
            const wired = init(
                cwd,
                task(
                    "Wire it",
                    linearEpic.directory,
                    linearIssue("ENG-8", {
                        projectId: "project-uuid",
                        gitBranchName: "alex/eng-8-wire-it",
                    }),
                ),
            )
            assert.equal(wired.directory, ".project/.local/epics/20261002-rollout/tasks/ENG-8-wire-it")
            assert.equal(wired.status.branch.name, "alex/eng-8-wire-it")
            assert.equal(wired.resourceIds[0].scope.entity, "ENG-8-wire-it")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("uses static formats for Linear issues and rejects the tracker format on GitHub", () => {
        const linear = temporaryRepository("linear")
        const github = temporaryRepository("github", "tracker")
        try {
            const created = init(linear, gig("Static", linearIssue("ENG-9")))
            assert.equal(created.status.branch.name, "eng-9-static")
            assert.equal(created.status.branch.source, "generated")
            assert.throws(
                () =>
                    preflightEntity(
                        {
                            entity: "gig",
                            title: "Work",
                            slug: "work",
                            request: "Work",
                            kind: "chore",
                        },
                        { cwd: github },
                    ),
                /requires a Linear tracker/,
            )
            assert.throws(() => init(github, gig("Wrong provider", linearIssue("ENG-1"))), /GitHub issue/)
        } finally {
            fs.rmSync(linear, { recursive: true, force: true })
            fs.rmSync(github, { recursive: true, force: true })
        }
    })

    it("fails preflight before any tracker create and changes nothing", () => {
        const cwd = temporaryRepository()
        try {
            const before = git(cwd, ["for-each-ref", "--format=%(refname)"])
            assert.throws(
                () =>
                    preflightEntity(
                        { entity: "gig", title: "Orphan", slug: "-", request: "Orphan", kind: "feature" },
                        { cwd },
                    ),
                /slug must contain/,
            )
            assert.equal(git(cwd, ["for-each-ref", "--format=%(refname)"]), before)
            assert.equal(fs.existsSync(path.join(cwd, ".project/.local/gigs")), false)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("rejects an existing branch or directory without deleting it", () => {
        const cwd = temporaryRepository()
        try {
            git(cwd, ["branch", "40-conflict", "main"])
            assert.throws(() => init(cwd, gig("Conflict", issue(40))), /workflow branch already exists: 40-conflict/)
            assert.ok(git(cwd, ["show-ref", "--verify", "refs/heads/40-conflict"]))
            assert.equal(fs.existsSync(path.join(cwd, ".project/.local/gigs/40-conflict")), false)

            const first = init(cwd, gig("Kept", issue(41)))
            git(cwd, ["branch", "-D", "41-kept"])
            assert.throws(() => init(cwd, gig("Kept", issue(41))), /entity directory already exists/)
            assert.ok(fs.existsSync(path.join(cwd, first.directory, "metadata.json")))
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("rejects metadata that disagrees with its directory, branch, or PR intent", () => {
        const cwd = temporaryRepository()
        try {
            const created = init(cwd, gig("Invariant checks", issue(50)))
            const directory = path.join(cwd, created.directory)
            const status = created.status
            if (status.entity !== "gig") assert.fail("expected Gig")
            writeEntityStatus(directory, { ...status, kind: "audit" })
            const changed = readEntityStatus(directory)
            assert.equal(changed.entity === "gig" ? changed.kind : undefined, "audit")
            const cases: Array<[unknown, RegExp]> = [
                [{ ...status, slug: "Not normalized" }, /slug is not normalized/],
                [{ ...status, slug: "other" }, /directory name does not match/],
                [
                    {
                        ...status,
                        tracker: { ...status.tracker, external: { issueNumber: 51 } },
                    },
                    /directory name does not match/,
                ],
                [{ ...status, branch: { ...status.branch, target: "develop" } }, /branch start\/target/],
                [
                    {
                        ...status,
                        forge: {
                            provider: "github",
                            repository,
                            head: "other",
                            target: "main",
                        },
                    },
                    /forge association/,
                ],
                [{ ...status, state: "inProgress" }, /invalid entity metadata/],
                [{ ...status, id: "GIG-01KDVDNA00" }, /invalid entity metadata/],
            ]
            for (const [candidate, error] of cases) {
                writeMetadata(cwd, created.directory, candidate)
                assert.throws(() => readEntityStatus(directory), error)
            }
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("discovers the recorded default branch from existing work", () => {
        const cwd = temporaryRepository()
        try {
            init(cwd, gig("Earlier", issue(60)))
            git(cwd, ["switch", "-c", "work"])
            git(cwd, ["branch", "another"])
            const later = init(cwd, gig("Later", issue(61)))
            assert.equal(later.status.branch.start, "main")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })
})
