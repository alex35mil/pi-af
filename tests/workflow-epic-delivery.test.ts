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
    initializeEntity,
    setEpicTaskTarget,
    type InitializedEntity,
    type TaskInitialization,
} from "../workflows/extensions/init/entity.ts"
import type { EpicDelivery } from "../workflows/extensions/init/delivery.ts"
import { planGitHubMerge } from "../workflows/extensions/integrations/forge/github/merge.ts"
import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"
import { linearPhases } from "./workflow-phase-fixtures.ts"

const repository = { owner: "example", repo: "app" }
const tools = workflowMcpCatalog("forge")
const date = (minute: number) => new Date(`2026-01-02T07:${String(minute).padStart(2, "0")}:00.000Z`)
const githubSource = {
    mode: "external",
    provider: "github",
    issueId: 100,
    issueNumber: 9,
    issueUrl: "https://github.com/example/app/issues/9",
    projectItemId: 20,
} as const
const linearSource = {
    mode: "external",
    provider: "linear",
    resource: "task-issue",
    issueId: "issue-id",
    identifier: "ENG-9",
    issueUrl: "https://linear.app/example/issue/ENG-9",
    projectId: "project-id",
} as const

function fixture(artifacts: "versioned" | "unversioned" = "versioned", tracker: "none" | "github" | "linear" = "none") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "epic-delivery-")))
    const git = (...args: string[]) =>
        cp.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim()
    git("init", "-q", "-b", "main")
    git("config", "user.email", "test@example.invalid")
    git("config", "user.name", "Test")
    fs.writeFileSync(path.join(root, "README.md"), "base\n")
    fs.writeFileSync(path.join(root, ".gitignore"), ".project/**/.local/\n")
    fs.mkdirSync(path.join(root, ".project"))
    fs.writeFileSync(
        path.join(root, ".project/config.json"),
        JSON.stringify({ artifacts, branches: { format: "identifier-title" } }),
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
        ...(tracker === "github"
            ? {
                  tracker: {
                      provider: "github",
                      mcpServer: "github",
                      repository,
                      project: { owner: "example", ownerType: "user", number: 2 },
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
                          status: { field: "Status", values: states },
                          phase: {
                              field: "Phase",
                              values: { planning: "Planning", execution: "Execution", selfReview: "Self-Review" },
                          },
                          priority: { scope: "project", field: "Priority", values: ["High"] },
                          internalId: { scope: "project", field: "Internal ID" },
                      },
                  },
              }
            : tracker === "linear"
              ? {
                    tracker: {
                        provider: "linear",
                        mcpServer: "linear",
                        team: "Engineering",
                        phase: linearPhases(),
                        statuses: { issues: states, projects: states },
                    },
                }
              : {}),
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
            priority: "not set",
            source:
                tracker === "linear"
                    ? {
                          mode: "external",
                          provider: "linear",
                          resource: "project",
                          projectId: "project-id",
                          projectUrl: "https://linear.app/example/project/project-id",
                      }
                    : { mode: "new" },
        },
        { cwd: root, now: date(0) },
    )
    if (epic.status.branch.state !== "ready") assert.fail("expected ready Epic")
    const branch = epic.status.branch
    const epicPath = path.join(root, epic.directory, "epic.md")
    fs.writeFileSync(
        epicPath,
        "# Epic\n\n## Overview\n\nShip independently.\n\n## Task delivery\n\nApproved strategy: default.\n\n## Ordered Tasks\n\n1. **First** — independent outcome.\n2. **Second** — another outcome.\n",
    )
    git("switch", branch.name)
    if (artifacts === "versioned") git("add", ".project")
    git("commit", "--allow-empty", "-qm", "accept planning")
    fs.writeFileSync(path.join(root, "README.md"), "base\nplanning documentation\n")
    git("add", "README.md")
    git("commit", "-qm", "document planning")
    const headSha = git("rev-parse", "HEAD")
    const baseSha = git("rev-parse", "main")
    git("switch", "main")
    git("merge", "--squash", branch.name)
    git("commit", "-qm", "squash planning")
    const resultSha = git("rev-parse", "HEAD")
    assert.throws(() => git("merge-base", "--is-ancestor", branch.name, "main"))
    const evidence = () => ({
        tool: "mcp__forge__pull_request_read",
        arguments: { method: "get", ...repository, pullNumber: 12 },
        response: {
            number: 12,
            html_url: "https://github.com/example/app/pull/12",
            state: "closed",
            draft: false,
            merged: true,
            merged_at: "2026-01-02T08:00:00Z",
            head: { ref: branch.name, sha: headSha, repo: { full_name: "example/app" } },
            base: { ref: "main", sha: baseSha, repo: { full_name: "example/app" } },
        },
    })
    const delivery = (): EpicDelivery => ({ kind: "github-pr", evidence: evidence() })
    const task = (epicDelivery?: EpicDelivery): TaskInitialization => ({
        entity: "task",
        title: "First",
        slug: "first",
        request: "Ship first",
        priority: "not set",
        kind: "feature",
        source: { mode: "new" },
        parentEpicDir: epic.directory,
        epicItemTitle: "First",
        ...(epicDelivery ? { epicDelivery } : {}),
    })
    const switchDefault = (epicDelivery = delivery()) =>
        setEpicTaskTarget(epic.directory, "default", { cwd: root, epicDelivery, tools })
    const snapshot = () => ({
        metadata: fs.readFileSync(path.join(root, epic.directory, "metadata.json"), "utf8"),
        plan: fs.readFileSync(epicPath, "utf8"),
        branches: git("for-each-ref", "--format=%(refname):%(objectname)", "refs/heads"),
        tasks: fs.readdirSync(path.join(root, epic.directory, "tasks")),
        index: fs.readFileSync(path.join(root, ".git/index")),
        head: git("rev-parse", "HEAD"),
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
        switchDefault,
        snapshot,
        config,
        close: () => fs.rmSync(root, { recursive: true, force: true }),
    }
}

function registeredTools() {
    const registered: Parameters<ExtensionAPI["registerTool"]>[0][] = []
    const events = createEventBus()
    initializeTools({
        on() {},
        events,
        registerTool: (tool: (typeof registered)[number]) => registered.push(tool),
    } as never)
    events.emit(MCP_TOOL_CATALOG_EVENT, tools)
    return registered
}

describe("Epic delivery before default-target Tasks", () => {
    for (const mode of ["versioned", "unversioned"] as const) {
        it(`switches and initializes after a real ${mode} squash, without original-head ancestry`, () => {
            const f = fixture(mode)
            try {
                const initial = readEntityStatus(path.join(f.root, f.epic.directory))
                assert.throws(
                    () => setEpicTaskTarget(f.epic.directory, "default", { cwd: f.root }),
                    /has not been merged/,
                )
                const switched = f.switchDefault()
                assert.deepEqual(switched, { ...initial, taskTarget: "default" })
                assert.throws(() => initializeEntity(f.task(), { cwd: f.root, now: date(1) }), /has not been merged/)
                const first = initializeEntity(f.task(f.delivery()), { cwd: f.root, now: date(1), tools })
                assert.equal(first.status.branch.start, "main")
                assert.equal(first.status.branch.target, "main")
                assert.equal(fs.readFileSync(f.epicPath, "utf8").match(/\[TASK-/g)?.length, 1)
                assert.equal(f.git("rev-parse", "HEAD"), f.resultSha)
                setEpicTaskTarget(f.epic.directory, "epic", { cwd: f.root })
                const second = initializeEntity(
                    { ...f.task(), title: "Second", slug: "second", epicItemTitle: "Second" },
                    { cwd: f.root, now: date(2) },
                )
                assert.equal(second.status.branch.target, f.branch.name)
                assert.equal(readEntityStatus(path.join(f.root, first.directory)).branch.target, "main")
                assert.deepEqual(readEntityStatus(path.join(f.root, f.epic.directory)).branch, initial.branch)
            } finally {
                f.close()
            }
        })
    }

    const changes: Record<string, (read: ReturnType<ReturnType<typeof fixture>["evidence"]>) => void> = {
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
    for (const [name, change] of Object.entries(changes)) {
        it(`rejects ${name} at both operations without mutation`, () => {
            const f = fixture()
            try {
                const read = f.evidence()
                change(read)
                const bad: EpicDelivery = { kind: "github-pr", evidence: read }
                const before = f.snapshot()
                assert.throws(() => f.switchDefault(bad))
                assert.deepEqual(f.snapshot(), before)
                f.switchDefault()
                const afterSwitch = f.snapshot()
                assert.throws(() => initializeEntity(f.task(bad), { cwd: f.root, now: date(1), tools }))
                assert.deepEqual(f.snapshot(), afterSwitch)
            } finally {
                f.close()
            }
        })
    }

    it("keeps versioned plan reachability after accepting PR delivery", () => {
        const f = fixture()
        try {
            f.switchDefault()
            fs.appendFileSync(f.epicPath, "\nUndelivered change.\n")
            const before = f.snapshot()
            assert.throws(
                () => initializeEntity(f.task(f.delivery()), { cwd: f.root, now: date(1), tools }),
                /artifacts are not reachable/,
            )
            assert.deepEqual(f.snapshot(), before)
        } finally {
            f.close()
        }
    })

    it("requires current local source, target, forge and registered-tool facts", () => {
        for (const missing of ["source", "target", "forge", "catalog", "advanced head"] as const) {
            const f = fixture()
            try {
                f.switchDefault()
                if (missing === "source") f.git("branch", "-D", f.branch.name)
                if (missing === "target") {
                    f.git("switch", f.branch.name)
                    f.git("branch", "-D", "main")
                }
                if (missing === "forge")
                    fs.writeFileSync(
                        path.join(f.root, ".project/integrations.json"),
                        JSON.stringify({ tracker: { ...fixtureTracker() } }),
                    )
                if (missing === "advanced head") {
                    f.git("switch", f.branch.name)
                    f.git("commit", "--allow-empty", "-qm", "new Epic work")
                }
                const before = f.snapshot()
                const catalog = missing === "catalog" ? new Map() : tools
                assert.throws(() =>
                    setEpicTaskTarget(f.epic.directory, "default", {
                        cwd: f.root,
                        epicDelivery: f.delivery(),
                        tools: catalog,
                    }),
                )
                assert.throws(() =>
                    initializeEntity(f.task(f.delivery()), { cwd: f.root, now: date(1), tools: catalog }),
                )
                assert.deepEqual(f.snapshot(), before)
            } finally {
                f.close()
            }
        }
    })

    it("trusts GitHub delivery while checking local accepted-plan availability separately", () => {
        const f = fixture()
        try {
            f.git("switch", f.branch.name)
            f.git("branch", "-f", "main", `${f.branch.name}^`)
            f.git("switch", "main")
            assert.notEqual(f.git("rev-parse", "main"), f.resultSha)
            assert.equal(fs.readFileSync(path.join(f.root, "README.md"), "utf8"), "base\n")
            f.switchDefault()
            assert.equal(
                initializeEntity(f.task(f.delivery()), { cwd: f.root, now: date(1), tools }).status.branch.target,
                "main",
            )
        } finally {
            f.close()
        }
    })

    it("accepts a delivered result behind a subsequently advanced target", () => {
        const f = fixture()
        try {
            f.git("commit", "--allow-empty", "-qm", "later target work")
            f.switchDefault()
            assert.equal(
                initializeEntity(f.task(f.delivery()), { cwd: f.root, now: date(1), tools }).status.branch.target,
                "main",
            )
        } finally {
            f.close()
        }
    })

    it("does not hide invalid explicit PR evidence behind valid ancestry", () => {
        const f = fixture()
        try {
            f.git("merge", "--no-ff", "-m", "ancestry delivery", f.branch.name)
            setEpicTaskTarget(f.epic.directory, "default", { cwd: f.root, epicDelivery: { kind: "git-ancestry" } })
            const read = f.evidence()
            read.response.head.sha = "a".repeat(40)
            const before = f.snapshot()
            assert.throws(() => f.switchDefault({ kind: "github-pr", evidence: read }))
            assert.throws(() =>
                initializeEntity(f.task({ kind: "github-pr", evidence: read }), { cwd: f.root, now: date(1), tools }),
            )
            assert.deepEqual(f.snapshot(), before)
        } finally {
            f.close()
        }
    })

    it("reuses merged-state validation with native MCP results at the provider boundary", () => {
        const f = fixture()
        try {
            const read = f.evidence()
            const subject = {
                mcpServer: "forge",
                repository,
                number: 12,
                base: "main",
                head: { repository, ref: f.branch.name },
                expectedHeadSha: f.headSha,
            }
            const native = { ...read, response: { content: [{ type: "text", text: JSON.stringify(read.response) }] } }
            assert.equal(planGitHubMerge(subject, native, tools).state, "merged")
            assert.equal(
                planGitHubMerge(subject, { ...native, response: { ...native.response, isError: true } }, tools).state,
                "blocked",
            )
            f.switchDefault({ kind: "github-pr", evidence: native })
            assert.equal(
                initializeEntity(f.task({ kind: "github-pr", evidence: native }), { cwd: f.root, now: date(1), tools })
                    .status.branch.target,
                "main",
            )
        } finally {
            f.close()
        }
    })

    for (const mode of ["versioned", "unversioned"] as const)
        for (const tracker of ["none", "github", "linear"] as const) {
            it(`passes ${mode} delivery evidence through the registered ${tracker === "none" ? "new" : tracker + " adoption"} Task tool`, async () => {
                const f = fixture(mode, tracker)
                try {
                    const registered = registeredTools()
                    const set = registered.find((t) => t.name === "set_epic_task_target")!
                    await set.execute(
                        "switch",
                        { entityDir: f.epic.directory, target: "default", epicDelivery: f.delivery() },
                        undefined,
                        undefined,
                        { cwd: f.root } as never,
                    )
                    const name = tracker === "none" ? "init_task" : `adopt_${tracker}_task`
                    const tool = registered.find((t) => t.name === name)!
                    const { entity: _entity, source: _source, ...base } = f.task(f.delivery())
                    const source = tracker === "github" ? githubSource : linearSource
                    const { mode: _mode, provider: _provider, ...external } = source
                    const args = {
                        ...base,
                        ...(tracker === "none"
                            ? {}
                            : {
                                  source:
                                      tracker === "linear"
                                          ? {
                                                issueId: linearSource.issueId,
                                                identifier: linearSource.identifier,
                                                issueUrl: linearSource.issueUrl,
                                                projectId: linearSource.projectId,
                                            }
                                          : external,
                              }),
                    }
                    assert.equal(Value.Check(tool.parameters, args), true)
                    const result = await tool.execute("task", args, undefined, undefined, {
                        cwd: f.root,
                        isProjectTrusted: () => true,
                    } as never)
                    const initialized = result.details as InitializedEntity
                    assert.equal(initialized.status.branch.target, "main")
                    assert.equal(fs.readFileSync(f.epicPath, "utf8").match(/\[TASK-/g)?.length, 1)
                    assert.ok(!("epicDelivery" in initialized.status))
                } finally {
                    f.close()
                }
            })
        }

    it("keeps concrete tool schemas and scopes delivery evidence to Tasks/target switching", () => {
        for (const tool of registeredTools()) {
            assert.ok(Type.IsObject(tool.parameters))
            const property = tool.parameters.properties.epicDelivery
            assert.equal(Boolean(property), tool.name.endsWith("_task") || tool.name === "set_epic_task_target")
        }
    })
})

function fixtureTracker() {
    return {
        provider: "linear",
        mcpServer: "linear",
        team: "Engineering",
        phase: linearPhases(),
        statuses: {
            issues: {
                backlog: "Backlog",
                todo: "Todo",
                inProgress: "In Progress",
                inReview: "In Review",
                done: "Done",
                canceled: "Canceled",
            },
            projects: {
                backlog: "Backlog",
                todo: "Todo",
                inProgress: "In Progress",
                inReview: "In Review",
                done: "Done",
                canceled: "Canceled",
            },
        },
    }
}
