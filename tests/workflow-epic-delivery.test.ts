import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"

import { MCP_TOOL_CATALOG_EVENT } from "../extensions/__lib/mcp.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { readEntityStatus } from "../workflows/extensions/__lib/entity.ts"
import initializeTools from "../workflows/extensions/init/index.ts"
import {
    type EntityInitialization,
    initializeEntity,
    setEpicTaskTarget,
    type InitializedEntity,
} from "../workflows/extensions/init/entity.ts"
import type { EpicDelivery } from "../workflows/extensions/init/delivery.ts"
import { planGitHubMerge } from "../workflows/extensions/integrations/forge/github/merge.ts"
import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"
import { linearPhases } from "./workflow-phase-fixtures.ts"

const repository = { owner: "example", repo: "app" }
const tools = workflowMcpCatalog("forge")
const date = (minute: number) => new Date(`2026-01-02T07:${String(minute).padStart(2, "0")}:00.000Z`)
const githubTask = {
    issueId: 100,
    issueNumber: 9,
    issueUrl: "https://github.com/example/app/issues/9",
    projectItemId: 20,
}
const linearTask = {
    issueId: "issue-id",
    identifier: "ENG-9",
    issueUrl: "https://linear.app/example/issue/ENG-9",
    projectId: "project-id",
}

function fixture(tracker: "github" | "linear" = "github", delivered = true) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "epic-delivery-")))
    const git = (...args: string[]) =>
        cp.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim()
    git("init", "-q", "-b", "main")
    git("config", "user.email", "test@example.invalid")
    git("config", "user.name", "Test")
    fs.writeFileSync(path.join(root, "README.md"), "base\n")
    fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
    fs.mkdirSync(path.join(root, ".project"))
    fs.writeFileSync(
        path.join(root, ".project/config.json"),
        JSON.stringify({ branches: { format: "identifier-title" } }),
    )
    const states = {
        backlog: "Backlog",
        todo: "Todo",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        canceled: "Canceled",
    }
    const config = {
        forge: { provider: "github", mcpServer: "forge", repository },
        tracker:
            tracker === "github"
                ? {
                      provider: "github",
                      mcpServer: "github",
                      repository,
                      project: { owner: "example", ownerType: "user", number: 2 },
                      fields: {
                          status: { field: "Status", values: states },
                          phase: {
                              field: "Phase",
                              values: {
                                  planning: "Planning",
                                  execution: "Execution",
                                  selfReview: "Self-Review",
                              },
                          },
                          priority: {
                              scope: "project",
                              field: "Priority",
                              values: ["High"],
                          },
                      },
                  }
                : {
                      provider: "linear",
                      mcpServer: "linear",
                      team: "Engineering",
                      phase: linearPhases(),
                      statuses: { issues: states, projects: states },
                  },
    }
    fs.writeFileSync(path.join(root, ".project/integrations.json"), JSON.stringify(config))
    prepareArtifactPersistence(root)
    git("add", ".")
    git("commit", "-qm", "base")
    const epic = initializeEntity(
        {
            entity: "epic",
            title: "Independent work",
            slug: "independent-work",
            request: "Ship Tasks independently",
            object:
                tracker === "linear"
                    ? {
                          projectId: "project-id",
                          projectUrl: "https://linear.app/example/project/project-id",
                          createdAt: "2026-10-01T09:00:00.000Z",
                      }
                    : {
                          issueId: 80,
                          issueNumber: 8,
                          issueUrl: "https://github.com/example/app/issues/8",
                      },
        },
        { cwd: root, now: date(0) },
    )
    const branch = epic.status.branch
    const epicPath = path.join(root, epic.directory, "epic.md")
    fs.writeFileSync(
        epicPath,
        `# Epic\n\n## Overview\n\nShip independently.\n\n## Task delivery\n\nApproved strategy: default.\n\n## Tasks\n\n### [${tracker === "linear" ? "ENG-9" : "#9"}] First\n\nKind: feature\n\nIndependent outcome.\n\n### Second\n\nKind: chore\n\nAnother outcome.\n`,
    )
    git("switch", branch.name)
    setEpicTaskTarget(epic.directory, "default", { cwd: root })
    git("commit", "--allow-empty", "-qm", "accept planning")
    fs.writeFileSync(path.join(root, "README.md"), "base\nplanning documentation\n")
    git("add", "README.md")
    git("commit", "-qm", "document planning")
    const headSha = git("rev-parse", "HEAD")
    const baseSha = git("rev-parse", "main")
    if (delivered) {
        git("switch", "main")
        git("merge", "--squash", branch.name)
        git("commit", "-qm", "squash planning")
    }
    const resultSha = git("rev-parse", "HEAD")
    assert.throws(() => git("merge-base", "--is-ancestor", branch.name, "main"))
    const evidence = () => ({
        tool: "mcp__forge__pull_request_read",
        arguments: { method: "get", ...repository, pullNumber: 12 },
        response: {
            number: 12,
            html_url: "https://github.com/example/app/pull/12",
            state: delivered ? "closed" : "open",
            draft: false,
            merged: delivered,
            merged_at: delivered ? "2026-01-02T08:00:00Z" : "",
            head: {
                ref: branch.name,
                sha: headSha,
                repo: { full_name: "example/app" },
            },
            base: { ref: "main", sha: baseSha, repo: { full_name: "example/app" } },
        },
    })
    const delivery = (): EpicDelivery => ({
        kind: "github-pr",
        evidence: evidence(),
    })
    const task = (epicDelivery?: EpicDelivery): EntityInitialization => ({
        entity: "task",
        title: "First",
        slug: "first",
        request: "Ship first",
        object: tracker === "linear" ? linearTask : githubTask,
        parentEpicDir: epic.directory,
        ...(epicDelivery ? { epicDelivery } : {}),
    })
    const snapshot = () => ({
        metadata: fs.readFileSync(path.join(root, epic.directory, "metadata.json"), "utf8"),
        plan: fs.readFileSync(epicPath, "utf8"),
        branches: git("for-each-ref", "--format=%(refname):%(objectname)", "refs/heads"),
        tasks: fs.readdirSync(path.join(root, epic.directory, "tasks")),
        index: fs.readFileSync(path.join(root, ".git/index")),
        head: git("rev-parse", "HEAD"),
        status: git("status", "--porcelain"),
    })
    return {
        root,
        git,
        epic,
        branch,
        epicPath,
        headSha,
        resultSha,
        evidence,
        delivery,
        task,
        snapshot,
        config,
        close: () => fs.rmSync(root, { recursive: true, force: true }),
    }
}

function registeredTools(catalog = tools) {
    const registered: Parameters<ExtensionAPI["registerTool"]>[0][] = []
    const events = createEventBus()
    initializeTools({
        on() {},
        events,
        registerTool: (tool: (typeof registered)[number]) => registered.push(tool),
    } as never)
    events.emit(MCP_TOOL_CATALOG_EVENT, catalog)
    return registered
}

type Fixture = ReturnType<typeof fixture>
type TaskVariant = "github" | "linear"

function taskToolCall(f: Fixture, variant: TaskVariant, delivery?: EpicDelivery, catalog = tools) {
    const tool = registeredTools(catalog).find((tool) => tool.name === `init_${variant}_task`)!
    const { entity: _entity, ...args } = f.task(delivery)
    assert.equal(Value.Check(tool.parameters, args), true)
    return () =>
        tool.execute("task", args, undefined, undefined, {
            cwd: f.root,
            isProjectTrusted: () => true,
        } as never)
}

function nativeDelivery(read: ReturnType<Fixture["evidence"]>, isError = false): EpicDelivery {
    return {
        kind: "github-pr",
        evidence: {
            ...read,
            response: {
                content: [{ type: "text", text: JSON.stringify(read.response) }],
                isError,
            },
        },
    }
}

describe("Epic routing intent and per-Task delivery", () => {
    it(`records and commits default routing before delivery`, () => {
        const f = fixture("github", false)
        try {
            const current = readEntityStatus(path.join(f.root, f.epic.directory))
            assert.equal(current.entity, "epic")
            if (current.entity !== "epic") assert.fail("expected Epic")
            assert.equal(current.taskTarget, "default")
            assert.equal(f.git("status", "--porcelain"), "")
            const before = f.snapshot()
            assert.throws(() => initializeEntity(f.task(), { cwd: f.root, now: date(1) }), /has not been merged/)
            assert.deepEqual(f.snapshot(), before)
        } finally {
            f.close()
        }
    })

    for (const variant of ["github", "linear"] as const) {
        it(`blocks undelivered routing through the registered ${variant} Task entry point`, async () => {
            const f = fixture(variant, false)
            try {
                const before = f.snapshot()
                await assert.rejects(taskToolCall(f, variant), /has not been merged/)
                assert.deepEqual(f.snapshot(), before)
                await assert.rejects(taskToolCall(f, variant, nativeDelivery(f.evidence())), /confirmed merged PR/)
                assert.deepEqual(f.snapshot(), before)
            } finally {
                f.close()
            }
        })

        it(`initializes a ${variant} Task after a clean plan-plus-routing squash`, async () => {
            const f = fixture(variant)
            try {
                assert.equal(f.git("status", "--porcelain"), "")
                assert.equal(f.git("rev-parse", f.branch.name), f.headSha)
                const metadataPath = `${f.epic.directory}/metadata.json`
                const metadata = fs.readFileSync(path.join(f.root, metadataPath), "utf8")
                assert.equal(JSON.parse(metadata).taskTarget, "default")
                assert.throws(() => f.git("merge-base", "--is-ancestor", f.branch.name, "main"))
                const result = await taskToolCall(f, variant, nativeDelivery(f.evidence()))()
                const initialized = result.details as InitializedEntity
                assert.equal(initialized.status.branch.start, "main")
                assert.equal(initialized.status.branch.target, "main")
                assert.equal(fs.readFileSync(f.epicPath, "utf8").match(/\[(#9|ENG-9)\] /g)?.length, 1)
                assert.equal(fs.readFileSync(path.join(f.root, metadataPath), "utf8"), metadata)
                assert.equal(f.git("rev-parse", f.branch.name), f.headSha)
                assert.equal(f.git("rev-parse", "HEAD"), f.resultSha)
                assert.ok(!("epicDelivery" in initialized.status))
            } finally {
                f.close()
            }
        })
    }

    const changes: Record<string, (read: ReturnType<Fixture["evidence"]>) => void> = {
        "wrong registration": (r) => {
            r.tool = "mcp__other__pull_request_read"
        },
        "wrong method": (r) => {
            r.arguments.method = "get_diff"
        },
        "wrong configured repository": (r) => {
            r.arguments.repo = "other"
        },
        "wrong PR number": (r) => {
            r.response.number = 99
        },
        "wrong PR URL": (r) => {
            r.response.html_url = "https://github.com/example/other/pull/12"
        },
        "wrong head repository": (r) => {
            r.response.head.repo.full_name = "fork/app"
        },
        "wrong base repository": (r) => {
            r.response.base.repo.full_name = "other/app"
        },
        "wrong head branch": (r) => {
            r.response.head.ref = "other"
        },
        "wrong target branch": (r) => {
            r.response.base.ref = "other"
        },
        "wrong head revision": (r) => {
            r.response.head.sha = "a".repeat(40)
        },
        "unmerged PR": (r) => {
            r.response.merged = false
        },
        "missing timestamp": (r) => {
            r.response.merged_at = ""
        },
    }
    for (const variant of ["github", "linear"] as const) {
        it(`rejects invalid native evidence without mutation through the ${variant} entry point`, async () => {
            const f = fixture(variant)
            try {
                const before = f.snapshot()
                for (const [name, change] of Object.entries(changes)) {
                    const read = f.evidence()
                    change(read)
                    await assert.rejects(taskToolCall(f, variant, nativeDelivery(read)), name)
                    assert.deepEqual(f.snapshot(), before, name)
                }
                await assert.rejects(taskToolCall(f, variant, nativeDelivery(f.evidence(), true)))
                assert.deepEqual(f.snapshot(), before)
            } finally {
                f.close()
            }
        })

        it(`requires current branches, forge, provenance and revision for ${variant} Tasks`, async () => {
            for (const missing of ["source", "target", "forge", "catalog", "advanced head"] as const) {
                const f = fixture(variant)
                try {
                    if (missing === "source") f.git("branch", "-D", f.branch.name)
                    if (missing === "target") {
                        f.git("switch", f.branch.name)
                        f.git("branch", "-D", "main")
                    }
                    if (missing === "forge") {
                        const configPath = path.join(f.root, ".project/integrations.json")
                        const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
                        delete config.forge
                        fs.writeFileSync(configPath, JSON.stringify(config))
                    }
                    if (missing === "advanced head") {
                        f.git("switch", f.branch.name)
                        f.git("commit", "--allow-empty", "-qm", "new Epic work")
                    }
                    const before = f.snapshot()
                    const catalog = missing === "catalog" ? new Map() : tools
                    await assert.rejects(taskToolCall(f, variant, nativeDelivery(f.evidence()), catalog), missing)
                    assert.deepEqual(f.snapshot(), before, missing)
                } finally {
                    f.close()
                }
            }
        })

        it(`does not hide invalid explicit proof behind ancestry for ${variant} Tasks`, async () => {
            const f = fixture(variant)
            try {
                f.git("merge", "--no-ff", "-m", "ancestry delivery", f.branch.name)
                const read = f.evidence()
                read.response.head.sha = "a".repeat(40)
                const before = f.snapshot()
                await assert.rejects(taskToolCall(f, variant, nativeDelivery(read)), /verified expected head/)
                assert.deepEqual(f.snapshot(), before)
            } finally {
                f.close()
            }
        })
    }

    it("accepts ancestry delivery without PR evidence", () => {
        const f = fixture("github", false)
        try {
            f.git("switch", "main")
            f.git("merge", "--ff-only", f.branch.name)
            assert.equal(f.git("status", "--porcelain"), "")
            const initialized = initializeEntity(f.task(), {
                cwd: f.root,
                now: date(1),
            })
            assert.equal(initialized.status.branch.target, "main")
        } finally {
            f.close()
        }
    })

    it("trusts merged PR proof with a lagging local target", async () => {
        const f = fixture("github", false)
        try {
            f.git("switch", "main")
            f.git("merge", "--ff-only", `${f.branch.name}^`)
            assert.equal(fs.readFileSync(path.join(f.root, "README.md"), "utf8"), "base\n")
            assert.equal(f.git("status", "--porcelain"), "")
            assert.throws(() => f.git("merge-base", "--is-ancestor", f.branch.name, "main"))
            // Model the remote merge confirmation before this clone synchronizes the result.
            const read = f.evidence()
            read.response.state = "closed"
            read.response.merged = true
            read.response.merged_at = "2026-01-02T08:00:00Z"
            const result = await taskToolCall(f, "github", nativeDelivery(read))()
            assert.equal((result.details as InitializedEntity).status.branch.target, "main")
        } finally {
            f.close()
        }
    })

    it("accepts a delivered result behind a subsequently advanced target", () => {
        const f = fixture()
        try {
            f.git("commit", "--allow-empty", "-qm", "later target work")
            assert.equal(
                initializeEntity(f.task(f.delivery()), {
                    cwd: f.root,
                    now: date(1),
                    tools,
                }).status.branch.target,
                "main",
            )
        } finally {
            f.close()
        }
    })

    it("reuses merged-state validation for native MCP results", () => {
        const f = fixture()
        try {
            const subject = {
                mcpServer: "forge",
                repository,
                number: 12,
                base: "main",
                head: { repository, ref: f.branch.name },
                expectedHeadSha: f.headSha,
            }
            const native = nativeDelivery(f.evidence())
            if (native.kind !== "github-pr") assert.fail("expected PR evidence")
            assert.equal(planGitHubMerge(subject, native.evidence, tools).state, "merged")
            const errored = nativeDelivery(f.evidence(), true)
            if (errored.kind !== "github-pr") assert.fail("expected PR evidence")
            assert.equal(planGitHubMerge(subject, errored.evidence, tools).state, "blocked")
        } finally {
            f.close()
        }
    })

    it("records routing through the native setter without delivery evidence or a catalog", async () => {
        const f = fixture("github", false)
        try {
            const setter = registeredTools(new Map()).find((tool) => tool.name === "set_epic_task_target")!
            for (const target of ["epic", "default"]) {
                const args = { entityDir: f.epic.directory, target }
                assert.equal(Value.Check(setter.parameters, args), true)
                await setter.execute("routing", args, undefined, undefined, {
                    cwd: f.root,
                } as never)
            }
            assert.equal(f.git("status", "--porcelain"), "")
            assert.equal(f.git("rev-parse", f.branch.name), f.headSha)
            assert.equal(
                Value.Check(setter.parameters, {
                    entityDir: f.epic.directory,
                    target: "default",
                    epicDelivery: f.delivery(),
                }),
                false,
            )
            const before = f.snapshot()
            setEpicTaskTarget(f.epic.directory, "default", { cwd: f.root })
            assert.deepEqual(f.snapshot(), before)
        } finally {
            f.close()
        }
    })

    it("keeps setter branch and entity validity checks without requiring delivery", () => {
        for (const missing of ["source", "target", "not-ready", "not-epic"] as const) {
            const f = fixture()
            try {
                let directory = f.epic.directory
                if (missing === "source") f.git("branch", "-D", f.branch.name)
                if (missing === "target") {
                    f.git("switch", f.branch.name)
                    f.git("branch", "-D", "main")
                }
                if (missing === "not-ready") {
                    const metadataPath = path.join(f.root, f.epic.directory, "metadata.json")
                    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"))
                    metadata.branch = {
                        state: "tracker-pending",
                        start: "main",
                        target: "main",
                    }
                    fs.writeFileSync(metadataPath, JSON.stringify(metadata))
                }
                if (missing === "not-epic")
                    directory = initializeEntity(f.task(f.delivery()), {
                        cwd: f.root,
                        now: date(1),
                        tools,
                    }).directory
                const before = f.snapshot()
                assert.throws(() => setEpicTaskTarget(directory, "default", { cwd: f.root }), missing)
                assert.deepEqual(f.snapshot(), before, missing)
            } finally {
                f.close()
            }
        }
    })

    it("keeps concrete schemas and scopes delivery evidence to Task initialization only", () => {
        for (const tool of registeredTools()) {
            assert.ok(Type.IsObject(tool.parameters))
            assert.equal(Boolean(tool.parameters.properties.epicDelivery), tool.name.endsWith("_task"))
        }
    })
})
