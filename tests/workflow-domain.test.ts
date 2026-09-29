import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import { Value } from "typebox/value"

import {
    entityDirectoryName,
    type EntityIdentity,
    formatBranchName,
    generateRawId,
    qualifyId,
    readyBranch as createReadyBranch,
    type ReadyBranchContract,
    slugify,
    validateRawId,
} from "../workflows/extensions/__lib/domain.ts"
import {
    assertEntityBranchReady,
    type EntityStatus,
    readEntityStatus,
    readEpicTaskProgress,
} from "../workflows/extensions/__lib/entity.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { EntityInitializationSchema, initializeEntity, setEpicTaskTarget } from "../workflows/extensions/init/entity.ts"
import { formatInitializedEntity } from "../workflows/extensions/init/index.ts"
import { IntegrationRecordSchema } from "../workflows/extensions/integrations/records.ts"
import { finalizeLinearBranch, formatLinearTrackerBranch } from "../workflows/extensions/integrations/tracker/linear.ts"

function temporaryRepository(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-domain-"))
    git(directory, ["init", "-b", "main"])
    git(directory, ["config", "user.email", "test@example.com"])
    git(directory, ["config", "user.name", "Test"])
    fs.writeFileSync(path.join(directory, "README.md"), "test\n")
    fs.writeFileSync(path.join(directory, ".gitignore"), ".project/**/.local/\n")
    git(directory, ["add", "README.md", ".gitignore"])
    git(directory, ["commit", "-m", "initial"])
    fs.mkdirSync(path.join(directory, ".project"), { recursive: true })
    fs.writeFileSync(
        path.join(directory, ".project", "config.json"),
        JSON.stringify({ artifacts: "versioned", branches: { format: "identifier-title" } }),
    )
    return directory
}

function git(cwd: string, args: string[]): string {
    return cp.execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

const linearTrackerBranch = {
    template: "{username}/{issueIdentifier}-{issueTitle}" as const,
    username: "alex",
}
const renderTrackerBranch = (identity: EntityIdentity) => formatLinearTrackerBranch(identity, linearTrackerBranch)

function readyBranch(status: EntityStatus): ReadyBranchContract {
    if (status.branch.state !== "ready") assert.fail("expected ready branch")
    return status.branch
}

function writeStatus(repository: string, directory: string, status: EntityStatus): void {
    const statusPath = path.join(repository, directory, ".local", "status.md")
    if (status.authority.kind === "workflow" && "state" in status) {
        const { state, ...metadata } = status
        fs.writeFileSync(path.join(repository, directory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`)
        fs.writeFileSync(statusPath, `# Status\n\n\`\`\`json\n${JSON.stringify({ state }, null, 2)}\n\`\`\`\n`)
        return
    }
    fs.writeFileSync(path.join(repository, directory, "metadata.json"), `${JSON.stringify(status, null, 2)}\n`)
    fs.rmSync(statusPath, { force: true })
}

function enableLinearIntegration(
    repository: string,
    forge = false,
    artifactMode: "versioned" | "unversioned" = "versioned",
): void {
    fs.mkdirSync(path.join(repository, ".project"), { recursive: true })
    fs.writeFileSync(
        path.join(repository, ".project", "config.json"),
        JSON.stringify({
            artifacts: artifactMode,
            branches: { format: "tracker" },
        }),
    )
    fs.writeFileSync(
        path.join(repository, ".project", "integrations.json"),
        JSON.stringify({
            tracker: {
                provider: "linear",
                mcpServer: "linear",
                team: "Engineering",
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
                        done: "Completed",
                        canceled: "Canceled",
                    },
                },
            },
            ...(forge
                ? {
                      forge: {
                          provider: "github",
                          mcpServer: "github",
                          repository: { owner: "example", repo: "project" },
                      },
                  }
                : {}),
        }),
    )
}

function enableGitHubIntegration(repository: string): void {
    fs.mkdirSync(path.join(repository, ".project"), { recursive: true })
    fs.writeFileSync(
        path.join(repository, ".project", "integrations.json"),
        JSON.stringify({
            tracker: {
                provider: "github",
                mcpServer: "github",
                repository: { owner: "example", repo: "project" },
                project: { owner: "example", ownerType: "user", number: 3 },
                labels: {
                    planning: "Planning",
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
                    priority: { scope: "project", field: "Priority", values: ["High", "Low"] },
                    internalId: { scope: "project", field: "Internal ID" },
                },
            },
            forge: {
                provider: "github",
                mcpServer: "github",
                repository: { owner: "example", repo: "project" },
            },
        }),
    )
}

describe("workflow domain", () => {
    it("builds sortable timestamp IDs", () => {
        const earlier = generateRawId(new Date("2026-01-01T00:00:00.000Z"))
        const later = generateRawId(new Date("2026-01-01T00:00:00.001Z"))

        assert.equal(earlier.length, 10)
        assert.match(earlier, /^[0-7][0-9A-HJKMNP-TV-Z]{9}$/)
        assert.ok(earlier < later)
        assert.equal(qualifyId("task", earlier), `TASK-${earlier}`)
        assert.throws(() => validateRawId("01INVALID-ID"), /invalid raw workflow ID/)
    })

    it("uses readable slugs and exact branch contracts", () => {
        const epicId = validateRawId("01KDVDNA00")
        const taskId = validateRawId("01KDVDNA01")
        const slug = slugify("Café workflow!")

        assert.equal(slug, "cafe-workflow")
        const epicName = formatBranchName({ entity: "epic", rawId: epicId, slug }, "identifier-title")
        assert.equal(epicName, `epic-${epicId.toLowerCase()}-cafe-workflow`)
        assert.deepEqual(createReadyBranch(epicName, "main", "generated"), {
            state: "ready",
            name: epicName,
            start: "main",
            target: "main",
            source: "generated",
        })
        assert.equal(
            formatBranchName({ entity: "task", rawId: taskId, slug: "first-task" }, "identifier-title"),
            `task-${taskId.toLowerCase()}-first-task`,
        )
        assert.equal(
            entityDirectoryName({ entity: "gig", rawId: taskId, slug: "first-task" }, new Date(2026, 0, 2, 3, 4)),
            `20260102-0304.GIG-${taskId}.first-task`,
        )
    })

    it("uses the current local branch as default without a remote", () => {
        const repository = temporaryRepository()
        try {
            git(repository, ["branch", "other-local-branch"])
            git(repository, ["switch", "other-local-branch"])
            assert.equal(git(repository, ["remote"]), "")

            const initialized = initializeEntity(
                {
                    entity: "gig",
                    title: "Local only",
                    slug: "local-only",
                    request: "Initialize work without a remote",
                    priority: "not set",
                    source: { mode: "new" },
                    kind: "chore",
                },
                {
                    cwd: repository,
                    now: new Date("2026-01-02T03:04:00.000Z"),
                },
            )
            const branch = readyBranch(initialized.status)
            assert.equal(branch.start, "other-local-branch")
            assert.equal(branch.target, "other-local-branch")
            assert.equal(git(repository, ["remote"]), "")
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })

    it("rejects invalid entity variant combinations at the TypeBox boundary", () => {
        const common = {
            title: "Work",
            slug: "work",
            request: "Do work",
            priority: "High",
            source: { mode: "new" },
        }

        assert.equal(Value.Check(EntityInitializationSchema, { ...common, entity: "epic", kind: "feature" }), false)
        assert.equal(Value.Check(EntityInitializationSchema, { ...common, entity: "task", kind: "feature" }), false)
        assert.equal(Value.Check(EntityInitializationSchema, { ...common, entity: "gig", kind: "audit" }), true)
        assert.equal(Value.Check(EntityInitializationSchema, { ...common, entity: "gig", kind: "review" }), false)
        assert.equal(
            Value.Check(EntityInitializationSchema, {
                ...common,
                entity: "gig",
                kind: "feature",
                parentEpicDir: ".project/epics/example",
            }),
            false,
        )
        assert.equal(
            Value.Check(EntityInitializationSchema, {
                ...common,
                entity: "gig",
                kind: "feature",
                source: { mode: "external", provider: "github", reference: "#42" },
            }),
            false,
        )
        assert.equal(
            Value.Check(EntityInitializationSchema, {
                ...common,
                entity: "gig",
                kind: "feature",
                source: {
                    mode: "external",
                    provider: "github",
                    issueId: 101,
                    issueNumber: 42,
                    issueUrl: "https://github.com/example/project/issues/42",
                    projectItemId: "PVTI_example",
                },
            }),
            true,
        )
        const linearProject = {
            mode: "external",
            provider: "linear",
            resource: "project",
            projectId: "project-uuid",
            projectUrl: "https://linear.app/example/project/epic",
        }
        const linearGigIssue = {
            mode: "external",
            provider: "linear",
            resource: "gig-issue",
            issueId: "issue-uuid",
            identifier: "ENG-42",
            issueUrl: "https://linear.app/example/issue/ENG-42/work",
            gitBranchName: "alex/eng-42-work",
        }
        assert.equal(
            Value.Check(EntityInitializationSchema, { ...common, entity: "epic", source: linearProject }),
            true,
        )
        assert.equal(
            Value.Check(EntityInitializationSchema, { ...common, entity: "epic", source: linearGigIssue }),
            false,
        )
        assert.equal(
            Value.Check(EntityInitializationSchema, {
                ...common,
                entity: "gig",
                kind: "feature",
                source: linearGigIssue,
            }),
            true,
        )
        assert.equal(
            Value.Check(EntityInitializationSchema, {
                ...common,
                entity: "gig",
                kind: "feature",
                source: linearProject,
            }),
            false,
        )
    })

    it("rejects tracker branch format without a Linear tracker", () => {
        const repository = temporaryRepository()
        try {
            fs.writeFileSync(
                path.join(repository, ".project", "config.json"),
                JSON.stringify({ artifacts: "versioned", branches: { format: "tracker" } }),
            )
            assert.throws(
                () =>
                    initializeEntity(
                        {
                            entity: "gig",
                            title: "Unsupported tracker branch",
                            slug: "unsupported-tracker-branch",
                            request: "Reject unsupported tracker branch naming",
                            priority: "not set",
                            source: { mode: "new" },
                            kind: "chore",
                        },
                        { cwd: repository },
                    ),
                /tracker branch format requires a Linear tracker/,
            )
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })

    it("models tracker checkpoints and confirmed forge PR references", () => {
        const issue = {
            issueId: 101,
            issueNumber: 42,
            issueUrl: "https://github.com/example/project/issues/42",
        }
        assert.equal(
            Value.Check(IntegrationRecordSchema, {
                role: "tracker",
                provider: "github",
                state: "issue-bound-pending",
                external: issue,
                operations: ["add issue to Project"],
            }),
            true,
        )
        assert.equal(
            Value.Check(IntegrationRecordSchema, {
                role: "tracker",
                provider: "github",
                state: "bound-pending",
                external: { ...issue, projectItemId: "PVTI_example" },
                operations: ["set Project Status"],
            }),
            true,
        )
        assert.equal(
            Value.Check(IntegrationRecordSchema, {
                role: "forge",
                provider: "github",
                pullRequest: { number: 7, url: "https://github.com/example/project/pull/7" },
            }),
            true,
        )
        assert.equal(
            Value.Check(IntegrationRecordSchema, {
                role: "tracker",
                provider: "linear",
                resource: "project",
                state: "bound",
                external: { projectId: "project-uuid", projectUrl: "https://linear.app/example/project/epic" },
            }),
            true,
        )
        const linearTask = {
            role: "tracker",
            provider: "linear",
            resource: "task-issue",
            state: "bound",
            external: {
                issueId: "issue-uuid",
                identifier: "ENG-42",
                issueUrl: "https://linear.app/example/issue/ENG-42/work",
                gitBranchName: "alex/eng-42-work",
                projectId: "project-uuid",
            },
        }
        assert.equal(Value.Check(IntegrationRecordSchema, linearTask), true)
        assert.equal(
            Value.Check(IntegrationRecordSchema, {
                ...linearTask,
                resource: "gig-issue",
            }),
            false,
        )
    })

    it("initializes Epic and Task artifacts with exact ancestry and no integration calls", () => {
        const repository = temporaryRepository()
        try {
            const epic = initializeEntity(
                {
                    entity: "epic",
                    title: "Project workflow",
                    slug: "project-workflow",
                    request: "Plan the project",
                    priority: "High",
                    source: { mode: "new" },
                },
                { cwd: repository, now: new Date("2026-01-02T03:04:00.000Z") },
            )
            assert.equal(epic.status.entity, "epic")
            assert.deepEqual(epic.status.authority, { kind: "workflow", priority: "High" })
            assert.deepEqual(epic.status.integrations, [])
            const epicBranch = readyBranch(epic.status)
            assert.equal(git(repository, ["rev-parse", epicBranch.name]), git(repository, ["rev-parse", "main"]))
            assert.ok(fs.existsSync(path.join(repository, epic.directory, ".local")))
            assert.ok(fs.existsSync(path.join(repository, epic.directory, ".local", "reviews")))
            assert.ok(fs.existsSync(path.join(repository, epic.directory, ".local", "scratch")))
            assert.ok(fs.existsSync(path.join(repository, epic.directory, "tasks")))
            const metadataPath = path.join(repository, epic.directory, "metadata.json")
            const localStatusPath = path.join(repository, epic.directory, ".local", "status.md")
            const epicMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as Record<string, unknown>
            if (!("state" in epic.status)) assert.fail("expected workflow Epic authority")
            assert.deepEqual({ ...epicMetadata, state: epic.status.state }, epic.status)
            assert.equal(epic.status.workStage, "planning")
            assert.match(fs.readFileSync(localStatusPath, "utf-8"), /"state": "inProgress"/)
            assert.equal(
                git(repository, ["check-ignore", path.relative(repository, localStatusPath)]),
                epic.directory + "/.local/status.md",
            )

            const planDisplay = "**Implement shared workflow** — build the core."
            const planItem = `1. ${planDisplay}`
            const epicPath = path.join(repository, epic.directory, "epic.md")
            fs.writeFileSync(
                epicPath,
                `# Epic\n\n1. **Context only** — not a Task.\n\n## Ordered Tasks\n\n${planItem}\n`,
            )
            assert.deepEqual(fs.readdirSync(path.join(repository, epic.directory, "tasks")), [])
            assert.deepEqual(readEpicTaskProgress(path.join(repository, epic.directory)).items, [
                { state: "prospective", display: planDisplay },
            ])
            const taskInput = {
                entity: "task" as const,
                title: "Shared workflow",
                slug: "shared-workflow",
                request: "Build it",
                priority: "Urgent",
                source: { mode: "new" as const },
                kind: "feature" as const,
                parentEpicDir: epic.directory,
                epicItemTitle: "Implement shared workflow",
            }
            assert.throws(
                () => initializeEntity({ ...taskInput, epicItemTitle: "Missing Task" }, { cwd: repository }),
                /does not contain an ordered Task entry titled/,
            )
            assert.throws(
                () => initializeEntity({ ...taskInput, epicItemTitle: "Context only" }, { cwd: repository }),
                /does not contain an ordered Task entry titled/,
            )
            const acceptedEpic = fs.readFileSync(epicPath, "utf-8")
            fs.appendFileSync(epicPath, "2. Missing canonical Task title formatting.\n")
            assert.throws(
                () => initializeEntity(taskInput, { cwd: repository }),
                /must use \*\*Title\*\* — description/,
            )
            fs.writeFileSync(epicPath, acceptedEpic)
            fs.appendFileSync(epicPath, "2. **Implement shared workflow** — duplicate it.\n")
            assert.throws(
                () => initializeEntity(taskInput, { cwd: repository }),
                /multiple ordered Task entries titled/,
            )
            fs.writeFileSync(epicPath, acceptedEpic)
            const task = initializeEntity(taskInput, {
                cwd: repository,
                now: new Date("2026-01-02T03:05:00.000Z"),
            })
            assert.equal(task.status.entity, "task")
            assert.equal(fs.existsSync(path.join(repository, task.directory, "log.md")), false)
            const taskBranch = readyBranch(task.status)
            assert.equal(taskBranch.start, epicBranch.name)
            assert.equal(taskBranch.target, epicBranch.name)
            assert.match(taskBranch.name, /^task-/)
            assert.equal(
                git(repository, ["rev-parse", taskBranch.name]),
                git(repository, ["rev-parse", epicBranch.name]),
            )
            assert.deepEqual(readEntityStatus(path.join(repository, task.directory)), task.status)
            assert.ok(fs.existsSync(path.join(repository, task.directory, ".local", "scratch")))
            assert.ok(fs.existsSync(path.join(repository, task.directory, ".local", "designs")))
            assert.equal(fs.existsSync(path.join(repository, task.directory, "designs")), false)
            const taskBrief = fs.readFileSync(path.join(repository, task.directory, "brief.md"), "utf-8")
            assert.equal(taskBrief, "# Brief\n\n## Request\n\nBuild it\n")
            assert.match(fs.readFileSync(epicPath, "utf-8"), new RegExp(`1\\. \\[${task.status.id}\\]`))
            const linkedEpicContent = fs.readFileSync(epicPath, "utf-8")
            fs.writeFileSync(epicPath, linkedEpicContent.replace(`[${task.status.id}] `, ""))
            assert.throws(() => readEntityStatus(path.join(repository, task.directory)), /exactly one marker/)
            fs.writeFileSync(epicPath, `${linkedEpicContent.trimEnd()}\n2. [${task.status.id}] ${planDisplay}\n`)
            assert.throws(() => readEntityStatus(path.join(repository, task.directory)), /duplicate Task ID markers/)
            fs.writeFileSync(epicPath, linkedEpicContent)

            assert.deepEqual(readEpicTaskProgress(path.join(repository, epic.directory)).items, [
                {
                    state: "initialized",
                    display: planDisplay,
                    lifecycle: "inProgress",
                    task: { id: task.status.id, directory: task.directory },
                },
            ])
            assert.throws(
                () => initializeEntity({ ...taskInput, slug: "duplicate-task" }, { cwd: repository }),
                /already has an initialized Task/,
            )

            const renamedDisplay = "**Implement reusable workflow** — build the renamed core."
            fs.writeFileSync(
                epicPath,
                fs
                    .readFileSync(epicPath, "utf-8")
                    .replace(`1. [${task.status.id}] ${planDisplay}`, `7. [${task.status.id}] ${renamedDisplay}`),
            )
            assert.deepEqual(readEpicTaskProgress(path.join(repository, epic.directory)).items, [
                {
                    state: "initialized",
                    display: renamedDisplay,
                    lifecycle: "inProgress",
                    task: { id: task.status.id, directory: task.directory },
                },
            ])
            writeStatus(repository, task.directory, { ...task.status, state: "done", workStage: "execution" })
            assert.deepEqual(readEpicTaskProgress(path.join(repository, epic.directory)).items, [
                {
                    state: "complete",
                    display: renamedDisplay,
                    task: { id: task.status.id, directory: task.directory },
                },
            ])
            writeStatus(repository, task.directory, { ...task.status, state: "canceled" })
            assert.deepEqual(readEpicTaskProgress(path.join(repository, epic.directory)).items, [
                {
                    state: "canceled",
                    display: renamedDisplay,
                    task: { id: task.status.id, directory: task.directory },
                },
            ])

            enableGitHubIntegration(repository)
            const gig = initializeEntity(
                {
                    entity: "gig",
                    title: "Approved backlog issue",
                    slug: "approved-backlog-issue",
                    request: "Start selected future work",
                    priority: "High",
                    kind: "feature",
                    source: {
                        mode: "external",
                        provider: "github",
                        issueId: 101,
                        issueNumber: 42,
                        issueUrl: "https://github.com/example/project/issues/42",
                        projectItemId: "PVTI_example",
                    },
                },
                { cwd: repository, now: new Date("2026-01-02T03:06:00.000Z") },
            )
            assert.match(formatInitializedEntity(gig), /Integrations: tracker\/github: bound-pending/)
            const tracker = gig.status.integrations.find((integration) => integration.role === "tracker")
            assert.ok(tracker)
            assert.equal(tracker.state, "bound-pending")
            assert.equal(tracker.provider, "github")
            if (tracker.provider !== "github" || tracker.state !== "bound-pending")
                assert.fail("expected GitHub tracker")
            assert.equal(tracker.external.issueNumber, 42)
            assert.equal(gig.status.integrations.length, 1)
            assert.equal(gig.status.workStage, "planning")
            assert.deepEqual(gig.status.authority, {
                kind: "tracker",
                provider: "github",
                desired: { lifecycle: "inProgress", priority: "High" },
            })
            assert.ok(fs.existsSync(path.join(repository, gig.directory, ".local", "designs")))
            assert.equal(fs.existsSync(path.join(repository, gig.directory, "designs")), false)
            const trackerStatusPath = path.join(repository, gig.directory, ".local", "status.md")
            assert.equal(fs.existsSync(trackerStatusPath), false)
            fs.writeFileSync(trackerStatusPath, '# Status\n\n```json\n{ "state": "inProgress" }\n```\n')
            assert.throws(
                () => readEntityStatus(path.join(repository, gig.directory)),
                /must not have local lifecycle state/,
            )
            fs.rmSync(trackerStatusPath)
            assert.deepEqual(tracker.operations, [
                "apply configured Kind label and Internal ID",
                "move Project Status to In Progress",
                "add Planning label",
            ])

            const integrationPath = path.join(repository, ".project", "integrations.json")
            const configured = JSON.parse(fs.readFileSync(integrationPath, "utf-8")) as {
                tracker: unknown
                forge: unknown
            }
            fs.writeFileSync(integrationPath, JSON.stringify({ forge: configured.forge }))
            const forgeOnly = initializeEntity(
                {
                    entity: "gig",
                    title: "Forge only",
                    slug: "forge-only",
                    request: "Create code work without a tracker issue",
                    priority: "not set",
                    kind: "chore",
                    source: { mode: "new" },
                },
                { cwd: repository, now: new Date("2026-01-02T03:07:00.000Z") },
            )
            assert.deepEqual(forgeOnly.status.integrations, [])
            assert.throws(
                () =>
                    initializeEntity(
                        {
                            entity: "gig",
                            title: "Invalid adoption",
                            slug: "invalid-adoption",
                            request: "Cannot adopt tracker work",
                            priority: "not set",
                            kind: "chore",
                            source: {
                                mode: "external",
                                provider: "github",
                                issueId: 101,
                                issueNumber: 42,
                                issueUrl: "https://github.com/example/project/issues/42",
                                projectItemId: "PVTI_example",
                            },
                        },
                        { cwd: repository },
                    ),
                /matching tracker/,
            )

            fs.writeFileSync(integrationPath, JSON.stringify({ tracker: configured.tracker }))
            const trackerOnly = initializeEntity(
                {
                    entity: "gig",
                    title: "Tracker only",
                    slug: "tracker-only",
                    request: "Create versioned work without PR management",
                    priority: "High",
                    kind: "chore",
                    source: { mode: "new" },
                },
                { cwd: repository, now: new Date("2026-01-02T03:08:00.000Z") },
            )
            assert.deepEqual(trackerOnly.status.integrations, [
                { role: "tracker", provider: "github", state: "awaiting", operation: "create issue" },
            ])
            assert.deepEqual(trackerOnly.status.authority, {
                kind: "tracker",
                provider: "github",
                desired: { lifecycle: "inProgress", priority: "High" },
            })

            const taskDirectory = path.join(repository, task.directory)
            const originalBranch = readyBranch(task.status)
            writeStatus(repository, task.directory, {
                ...task.status,
                branch: { ...originalBranch, start: "other", target: "other" },
            })
            assert.throws(
                () => readEntityStatus(taskDirectory),
                /neither the containing Epic branch nor its default target/,
            )
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })

    it("targets future Tasks at default after an early Epic merge without changing existing Tasks", () => {
        const repository = temporaryRepository()
        try {
            const epic = initializeEntity(
                {
                    entity: "epic",
                    title: "Feature-flag rollout",
                    slug: "feature-flag-rollout",
                    request: "Ship Tasks independently",
                    priority: "not set",
                    source: { mode: "new" },
                },
                { cwd: repository, now: new Date("2026-01-02T07:00:00.000Z") },
            )
            assert.equal(epic.status.entity, "epic")
            if (epic.status.entity !== "epic") assert.fail("expected Epic")
            const epicBranch = readyBranch(epic.status)
            const epicPath = path.join(repository, epic.directory, "epic.md")
            const firstItem = "1. **First Task** — land through the Epic branch."
            const secondItem = "2. **Second Task** — land directly on default."
            const thirdItem = "3. **Third Task** — return to the Epic branch."
            fs.writeFileSync(epicPath, `# Epic\n\n## Ordered Tasks\n\n${firstItem}\n${secondItem}\n${thirdItem}\n`)

            const first = initializeEntity(
                {
                    entity: "task",
                    title: "First Task",
                    slug: "first-task",
                    request: "Implement the first part",
                    priority: "not set",
                    source: { mode: "new" },
                    kind: "feature",
                    parentEpicDir: epic.directory,
                    epicItemTitle: "First Task",
                },
                { cwd: repository, now: new Date("2026-01-02T07:01:00.000Z") },
            )
            assert.equal(readyBranch(first.status).target, epicBranch.name)

            git(repository, ["checkout", epicBranch.name])
            git(repository, ["add", ".project"])
            git(repository, ["commit", "-m", "accept epic"])
            assert.throws(
                () => setEpicTaskTarget(epic.directory, "default", { cwd: repository }),
                /has not been merged/,
            )

            git(repository, ["checkout", "main"])
            git(repository, ["merge", "--ff-only", epicBranch.name])
            const merged = setEpicTaskTarget(epic.directory, "default", { cwd: repository })
            assert.equal(merged.entity, "epic")
            if (merged.entity !== "epic") assert.fail("expected Epic")
            assert.equal(merged.taskTarget, "default")
            assert.equal(readyBranch(readEntityStatus(path.join(repository, first.directory))).target, epicBranch.name)

            const second = initializeEntity(
                {
                    entity: "task",
                    title: "Second Task",
                    slug: "second-task",
                    request: "Implement the second part",
                    priority: "not set",
                    source: { mode: "new" },
                    kind: "feature",
                    parentEpicDir: epic.directory,
                    epicItemTitle: "Second Task",
                },
                { cwd: repository, now: new Date("2026-01-02T07:03:00.000Z") },
            )
            assert.equal(second.status.entity, "task")
            if (second.status.entity !== "task") assert.fail("expected Task")
            assert.equal(readyBranch(second.status).start, "main")
            assert.equal(readyBranch(second.status).target, "main")

            const resumed = setEpicTaskTarget(epic.directory, "epic", { cwd: repository })
            assert.equal(resumed.entity, "epic")
            if (resumed.entity !== "epic") assert.fail("expected Epic")
            assert.equal(resumed.taskTarget, "epic")

            const third = initializeEntity(
                {
                    entity: "task",
                    title: "Third Task",
                    slug: "third-task",
                    request: "Implement later Epic work",
                    priority: "not set",
                    source: { mode: "new" },
                    kind: "feature",
                    parentEpicDir: epic.directory,
                    epicItemTitle: "Third Task",
                },
                { cwd: repository, now: new Date("2026-01-02T07:05:00.000Z") },
            )
            assert.equal(third.status.entity, "task")
            if (third.status.entity !== "task") assert.fail("expected Task")
            assert.equal(readyBranch(third.status).start, epicBranch.name)
            assert.equal(readyBranch(third.status).target, epicBranch.name)
            assert.equal(readyBranch(readEntityStatus(path.join(repository, second.directory))).target, "main")
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })

    it("reuses exact native Linear backlog objects", () => {
        const repository = temporaryRepository()
        try {
            enableLinearIntegration(repository)
            const epic = initializeEntity(
                {
                    entity: "epic",
                    title: "Existing Linear Epic",
                    slug: "existing-linear-epic",
                    request: "Adopt the native Project",
                    priority: "Medium",
                    source: {
                        mode: "external",
                        provider: "linear",
                        resource: "project",
                        projectId: "project-uuid",
                        projectUrl: "https://linear.app/example/project/existing-linear-epic",
                    },
                },
                {
                    cwd: repository,
                    now: new Date("2026-01-03T02:00:00.000Z"),
                    renderTrackerBranch,
                },
            )
            const epicTracker = epic.status.integrations[0]
            assert.equal(epicTracker.provider, "linear")
            assert.equal(epicTracker.state, "bound-pending")
            const planItem = "1. **Existing Linear Task** — adopt it."
            const invalidPlanItem = "2. **Wrong Linear Task** — reject it."
            fs.writeFileSync(
                path.join(repository, epic.directory, "epic.md"),
                `# Epic\n\n## Ordered Tasks\n\n${planItem}\n${invalidPlanItem}\n`,
            )

            const externalTaskSource = {
                mode: "external" as const,
                provider: "linear" as const,
                resource: "task-issue" as const,
                issueId: "task-uuid",
                identifier: "ENG-40",
                issueUrl: "https://linear.app/example/issue/ENG-40/existing-linear-task",
                gitBranchName: "alex/eng-40-existing-linear-task",
                projectId: "project-uuid",
            }
            const task = initializeEntity(
                {
                    entity: "task",
                    title: "Existing Linear Task",
                    slug: "existing-linear-task",
                    request: "Adopt the Project issue",
                    priority: "High",
                    source: externalTaskSource,
                    kind: "feature",
                    parentEpicDir: epic.directory,
                    epicItemTitle: "Existing Linear Task",
                },
                { cwd: repository, now: new Date("2026-01-03T02:01:00.000Z") },
            )
            assert.equal(readyBranch(task.status).name, externalTaskSource.gitBranchName)
            assert.throws(
                () =>
                    initializeEntity(
                        {
                            entity: "task",
                            title: "Wrong Linear Task",
                            slug: "wrong-linear-task",
                            request: "Reject the wrong Project",
                            priority: "High",
                            source: { ...externalTaskSource, issueId: "wrong-uuid", projectId: "wrong-project" },
                            kind: "feature",
                            parentEpicDir: epic.directory,
                            epicItemTitle: "Wrong Linear Task",
                        },
                        { cwd: repository },
                    ),
                /does not belong to the parent Epic Project/,
            )

            const gig = initializeEntity(
                {
                    entity: "gig",
                    title: "Existing Linear Gig",
                    slug: "existing-linear-gig",
                    request: "Adopt the standalone issue",
                    priority: "Low",
                    source: {
                        mode: "external",
                        provider: "linear",
                        resource: "gig-issue",
                        issueId: "gig-uuid",
                        identifier: "ENG-41",
                        issueUrl: "https://linear.app/example/issue/ENG-41/existing-linear-gig",
                        gitBranchName: "alex/eng-41-existing-linear-gig",
                    },
                    kind: "chore",
                },
                { cwd: repository, now: new Date("2026-01-03T02:02:00.000Z") },
            )
            assert.equal(readyBranch(gig.status).name, "alex/eng-41-existing-linear-gig")
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })

    it("omits workflow-system projection metadata in unversioned artifact mode", () => {
        const githubRepository = temporaryRepository()
        const linearRepository = temporaryRepository()
        try {
            fs.writeFileSync(
                path.join(githubRepository, ".project", "config.json"),
                JSON.stringify({
                    artifacts: "unversioned",
                    branches: { format: "identifier-title" },
                }),
            )
            prepareArtifactPersistence(githubRepository)
            enableGitHubIntegration(githubRepository)
            const github = initializeEntity(
                {
                    entity: "gig",
                    title: "Private GitHub work",
                    slug: "private-github-work",
                    request: "Keep workflow metadata private",
                    priority: "High",
                    source: {
                        mode: "external",
                        provider: "github",
                        issueId: 101,
                        issueNumber: 12,
                        issueUrl: "https://github.com/example/project/issues/12",
                        projectItemId: "PVTI_private",
                    },
                    kind: "feature",
                },
                { cwd: githubRepository, now: new Date("2026-01-03T02:03:00.000Z") },
            )
            const githubTracker = github.status.integrations[0]
            assert.equal(githubTracker.role, "tracker")
            if (
                githubTracker.role !== "tracker" ||
                githubTracker.provider !== "github" ||
                githubTracker.state !== "bound-pending"
            ) {
                assert.fail("expected pending GitHub tracker projection")
            }
            assert.deepEqual(githubTracker.operations, ["move Project Status to In Progress", "add Planning label"])
            assert.equal(fs.existsSync(path.join(githubRepository, github.directory, ".local", "status.md")), false)

            enableLinearIntegration(linearRepository, false, "unversioned")
            prepareArtifactPersistence(linearRepository)
            const linear = initializeEntity(
                {
                    entity: "gig",
                    title: "Private Linear work",
                    slug: "private-linear-work",
                    request: "Keep workflow metadata private",
                    priority: "Low",
                    source: {
                        mode: "external",
                        provider: "linear",
                        resource: "gig-issue",
                        issueId: "private-linear-uuid",
                        identifier: "ENG-99",
                        issueUrl: "https://linear.app/example/issue/ENG-99/private-linear-work",
                        gitBranchName: "alex/eng-99-private-linear-work",
                    },
                    kind: "chore",
                },
                { cwd: linearRepository, now: new Date("2026-01-03T02:04:00.000Z") },
            )
            const linearTracker = linear.status.integrations[0]
            assert.equal(linearTracker.role, "tracker")
            if (
                linearTracker.role !== "tracker" ||
                linearTracker.provider !== "linear" ||
                linearTracker.state !== "bound-pending"
            ) {
                assert.fail("expected pending Linear tracker projection")
            }
            assert.deepEqual(linearTracker.operations, ["move Linear issue to In Progress"])
            assert.equal(fs.existsSync(path.join(linearRepository, linear.directory, ".local", "status.md")), false)
        } finally {
            fs.rmSync(githubRepository, { recursive: true, force: true })
            fs.rmSync(linearRepository, { recursive: true, force: true })
        }
    })

    it("initializes native Linear records and resolves tracker-owned branches safely", () => {
        const repository = temporaryRepository()
        try {
            enableLinearIntegration(repository, true)
            const epicInput = {
                entity: "epic" as const,
                title: "Linear Epic",
                slug: "linear-epic",
                request: "Plan native Linear Project work",
                priority: "High",
                source: { mode: "new" as const },
            }
            assert.throws(() => initializeEntity(epicInput, { cwd: repository }), /requires a provider branch renderer/)
            const epic = initializeEntity(epicInput, {
                cwd: repository,
                now: new Date("2026-01-03T03:04:00.000Z"),
                renderTrackerBranch,
            })
            const epicBranch = readyBranch(epic.status)
            assert.equal(epicBranch.name, `alex/${epic.status.id.toLowerCase()}-linear-epic`)
            assert.equal(epicBranch.source, "tracker")
            assert.deepEqual(epic.status.integrations[0], {
                role: "tracker",
                provider: "linear",
                resource: "project",
                state: "awaiting",
                operation: "create Linear Project",
            })

            const epicPath = path.join(repository, epic.directory, "epic.md")
            const waitingPlanItem = "1. **Waiting Linear Task** — wait for the Project."
            fs.writeFileSync(epicPath, `# Epic\n\n## Ordered Tasks\n\n${waitingPlanItem}\n`)
            const waitingTask = initializeEntity(
                {
                    entity: "task",
                    title: "Waiting Linear Task",
                    slug: "waiting-linear-task",
                    request: "Persist locally while Project binding is pending",
                    priority: "Medium",
                    source: { mode: "new" },
                    kind: "chore",
                    parentEpicDir: epic.directory,
                    epicItemTitle: "Waiting Linear Task",
                },
                { cwd: repository, now: new Date("2026-01-03T03:04:30.000Z") },
            )
            assert.deepEqual(waitingTask.status.integrations[0], {
                role: "tracker",
                provider: "linear",
                resource: "task-issue",
                state: "awaiting",
                operation: "wait for parent Epic Project binding, then create Linear issue",
            })

            const boundEpicStatus: EntityStatus = {
                ...epic.status,
                authority: { kind: "tracker", provider: "linear" },
                integrations: [
                    {
                        role: "tracker" as const,
                        provider: "linear" as const,
                        resource: "project" as const,
                        state: "bound" as const,
                        external: {
                            projectId: "project-uuid",
                            projectUrl: "https://linear.app/example/project/linear-epic",
                        },
                    },
                ],
            }
            writeStatus(repository, epic.directory, boundEpicStatus)
            const planItem = "2. **Linear Task** — implement it."
            fs.appendFileSync(epicPath, `${planItem}\n`)

            const task = initializeEntity(
                {
                    entity: "task",
                    title: "Linear Task",
                    slug: "linear-task",
                    request: "Implement the Linear-backed task",
                    priority: "Urgent",
                    source: { mode: "new" },
                    kind: "feature",
                    parentEpicDir: epic.directory,
                    epicItemTitle: "Linear Task",
                },
                { cwd: repository, now: new Date("2026-01-03T03:05:00.000Z") },
            )
            assert.equal(task.status.branch.state, "tracker-pending")
            assert.throws(() => assertEntityBranchReady(task.status), /finish tracker binding/)
            assert.match(formatInitializedEntity(task), /pending tracker branch name/)
            assert.deepEqual(task.status.integrations[0], {
                role: "tracker",
                provider: "linear",
                resource: "task-issue",
                state: "awaiting",
                operation: "create Linear issue in parent Epic Project",
            })

            const partialTaskStatus = {
                ...task.status,
                integrations: [
                    {
                        role: "tracker" as const,
                        provider: "linear" as const,
                        resource: "task-issue" as const,
                        state: "issue-bound-pending" as const,
                        external: {
                            issueId: "issue-uuid",
                            identifier: "ENG-42",
                            issueUrl: "https://linear.app/example/issue/ENG-42/linear-task",
                            projectId: "project-uuid",
                        },
                        operations: ["read generated gitBranchName"],
                    },
                ],
            }
            writeStatus(repository, task.directory, partialTaskStatus)
            assert.equal(readEntityStatus(path.join(repository, task.directory)).branch.state, "tracker-pending")
            assert.throws(
                () => finalizeLinearBranch(task.directory, { cwd: repository }),
                /requires a bound Linear issue tracker record/,
            )

            const linearBranchName = "alex/eng-42-linear-task"
            const boundTaskStatus: EntityStatus = {
                ...task.status,
                authority: { kind: "tracker", provider: "linear" },
                integrations: [
                    {
                        role: "tracker" as const,
                        provider: "linear" as const,
                        resource: "task-issue" as const,
                        state: "bound" as const,
                        external: {
                            issueId: "issue-uuid",
                            identifier: "ENG-42",
                            issueUrl: "https://linear.app/example/issue/ENG-42/linear-task",
                            gitBranchName: linearBranchName,
                            projectId: "project-uuid",
                        },
                    },
                ],
            }
            writeStatus(repository, task.directory, boundTaskStatus)
            assert.throws(
                () =>
                    finalizeLinearBranch(task.directory, {
                        cwd: repository,
                        afterBranchCreated: () => {
                            throw new Error("simulated process interruption")
                        },
                    }),
                /simulated process interruption/,
            )
            const interrupted = readEntityStatus(path.join(repository, task.directory))
            assert.equal(interrupted.branch.state, "provisioning")
            assert.equal(
                git(repository, ["rev-parse", linearBranchName]),
                git(repository, ["rev-parse", epicBranch.name]),
            )

            const finalized = finalizeLinearBranch(task.directory, { cwd: repository })
            const finalizedBranch = readyBranch(finalized)
            assert.equal(finalizedBranch.name, linearBranchName)
            assert.equal(finalizedBranch.start, epicBranch.name)
            assert.equal(finalizedBranch.target, epicBranch.name)

            writeStatus(repository, task.directory, {
                ...finalized,
                authority: {
                    kind: "tracker",
                    provider: "linear",
                    desired: { lifecycle: "inProgress", priority: "Critical" },
                },
                integrations: finalized.integrations.map((integration) =>
                    integration.role === "tracker" &&
                    integration.provider === "linear" &&
                    integration.resource === "task-issue" &&
                    integration.state === "bound"
                        ? { ...integration, state: "bound-pending" as const, operations: ["set native priority"] }
                        : integration,
                ),
            })
            assert.throws(
                () => readEntityStatus(path.join(repository, task.directory)),
                /invalid native priority "Critical"/,
            )
            writeStatus(repository, task.directory, {
                ...finalized,
                integrations: finalized.integrations.map((integration) =>
                    integration.role === "tracker" &&
                    integration.provider === "linear" &&
                    integration.resource === "task-issue" &&
                    (integration.state === "bound" || integration.state === "bound-pending")
                        ? { ...integration, external: { ...integration.external, gitBranchName: "alex/eng-42-wrong" } }
                        : integration,
                ),
            })
            assert.throws(
                () => readEntityStatus(path.join(repository, task.directory)),
                /tracker-owned Task\/Gig branch must match/,
            )
            writeStatus(repository, task.directory, {
                ...finalized,
                integrations: finalized.integrations.map((integration) =>
                    integration.role === "tracker" &&
                    integration.provider === "linear" &&
                    integration.resource === "task-issue" &&
                    (integration.state === "bound" || integration.state === "bound-pending")
                        ? { ...integration, external: { ...integration.external, projectId: "another-project" } }
                        : integration,
                ),
            })
            assert.throws(
                () => readEntityStatus(path.join(repository, task.directory)),
                /Linear Task Project does not match its parent Epic Project/,
            )
            writeStatus(repository, task.directory, finalized)

            const resumedGig = initializeEntity(
                {
                    entity: "gig",
                    title: "Linear partial Gig",
                    slug: "linear-partial-gig",
                    request: "Resume from known issue identity",
                    priority: "Low",
                    source: { mode: "new" },
                    kind: "chore",
                },
                { cwd: repository, now: new Date("2026-01-03T03:06:00.000Z") },
            )
            const partialGigTracker = {
                role: "tracker" as const,
                provider: "linear" as const,
                resource: "gig-issue" as const,
                state: "issue-bound-pending" as const,
                external: {
                    issueId: "gig-partial-uuid",
                    identifier: "ENG-43",
                    issueUrl: "https://linear.app/example/issue/ENG-43/linear-partial-gig",
                },
                operations: ["read generated gitBranchName"],
            }
            writeStatus(repository, resumedGig.directory, {
                ...resumedGig.status,
                integrations: [partialGigTracker],
            })
            const resumedPartial = readEntityStatus(path.join(repository, resumedGig.directory))
            const resumedTracker = resumedPartial.integrations[0]
            if (
                resumedTracker.role !== "tracker" ||
                resumedTracker.provider !== "linear" ||
                resumedTracker.resource !== "gig-issue" ||
                resumedTracker.state !== "issue-bound-pending"
            ) {
                assert.fail("expected partial Linear Gig identity")
            }
            assert.equal(resumedTracker.external.issueId, "gig-partial-uuid")

            const resumedBranchName = "alex/eng-43-linear-partial-gig"
            writeStatus(repository, resumedGig.directory, {
                ...resumedPartial,
                authority: { kind: "tracker", provider: "linear" },
                integrations: [
                    {
                        role: "tracker",
                        provider: "linear",
                        resource: "gig-issue",
                        state: "bound",
                        external: { ...partialGigTracker.external, gitBranchName: resumedBranchName },
                    },
                ],
            })
            assert.throws(
                () =>
                    finalizeLinearBranch(resumedGig.directory, {
                        cwd: repository,
                        afterProvisioningCheckpoint: () => {
                            throw new Error("simulated interruption before Git ref creation")
                        },
                    }),
                /simulated interruption before Git ref creation/,
            )
            assert.equal(readEntityStatus(path.join(repository, resumedGig.directory)).branch.state, "provisioning")
            assert.equal(git(repository, ["branch", "--list", resumedBranchName]), "")
            const mainCommit = git(repository, ["rev-parse", "main"])
            const tree = git(repository, ["rev-parse", "main^{tree}"])
            const conflictingCommit = git(repository, ["commit-tree", tree, "-p", mainCommit, "-m", "conflict"])
            git(repository, ["branch", resumedBranchName, conflictingCommit])
            assert.throws(
                () => finalizeLinearBranch(resumedGig.directory, { cwd: repository }),
                /collision at a different commit/,
            )
            git(repository, ["branch", "-D", resumedBranchName])
            assert.equal(
                readyBranch(finalizeLinearBranch(resumedGig.directory, { cwd: repository })).name,
                resumedBranchName,
            )

            const collision = initializeEntity(
                {
                    entity: "gig",
                    title: "Linear collision",
                    slug: "linear-collision",
                    request: "Reject a pre-existing generated branch",
                    priority: "Low",
                    source: { mode: "new" },
                    kind: "chore",
                },
                { cwd: repository, now: new Date("2026-01-03T03:07:00.000Z") },
            )
            const collisionBranch = "alex/eng-44-linear-collision"
            const collisionBinding = {
                role: "tracker" as const,
                provider: "linear" as const,
                resource: "gig-issue" as const,
                state: "bound" as const,
                external: {
                    issueId: "collision-uuid",
                    identifier: "ENG-44",
                    issueUrl: "https://linear.app/example/issue/ENG-44/linear-collision",
                    gitBranchName: "bad branch name",
                },
            }
            writeStatus(repository, collision.directory, {
                ...collision.status,
                authority: { kind: "tracker", provider: "linear" },
                integrations: [collisionBinding],
            })
            assert.throws(() => finalizeLinearBranch(collision.directory, { cwd: repository }), /check-ref-format/)
            writeStatus(repository, collision.directory, {
                ...collision.status,
                authority: { kind: "tracker", provider: "linear" },
                integrations: [
                    { ...collisionBinding, external: { ...collisionBinding.external, gitBranchName: collisionBranch } },
                ],
            })
            git(repository, ["branch", collisionBranch, "main"])
            assert.throws(
                () => finalizeLinearBranch(collision.directory, { cwd: repository }),
                /workflow branch already exists/,
            )
            assert.equal(readEntityStatus(path.join(repository, collision.directory)).branch.state, "tracker-pending")
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })

    it("rejects cross-field status corruption and duplicate roles", () => {
        const repository = temporaryRepository()
        try {
            const gig = initializeEntity(
                {
                    entity: "gig",
                    title: "Invariant checks",
                    slug: "invariant-checks",
                    request: "Validate status",
                    priority: "not set",
                    source: { mode: "new" },
                    kind: "chore",
                },
                { cwd: repository, now: new Date("2026-01-02T03:07:00.000Z") },
            )
            assert.equal(gig.status.entity, "gig")
            if (gig.status.entity !== "gig") assert.fail("expected Gig status")
            const directory = path.join(repository, gig.directory)
            const gigBranch = readyBranch(gig.status)
            writeStatus(repository, gig.directory, { ...gig.status, kind: "audit" })
            const transitioned = readEntityStatus(directory)
            assert.equal(transitioned.entity, "gig")
            if (transitioned.entity !== "gig") assert.fail("expected Gig status")
            assert.equal(transitioned.kind, "audit")
            writeStatus(repository, gig.directory, gig.status)
            fs.rmSync(path.join(directory, ".local", "status.md"))
            assert.throws(() => readEntityStatus(directory), /missing authoritative local status/)
            writeStatus(repository, gig.directory, gig.status)

            const metadataPath = path.join(directory, "metadata.json")
            const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as Record<string, unknown>
            fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, state: "planning" }))
            assert.throws(() => readEntityStatus(directory), /invalid entity metadata/)
            writeStatus(repository, gig.directory, gig.status)

            fs.writeFileSync(
                path.join(directory, ".local", "status.md"),
                '# Status\n\n```json\n{\n  "state": "planning",\n  "extra": true\n}\n```\n',
            )
            assert.throws(() => readEntityStatus(directory), /invalid local status/)
            writeStatus(repository, gig.directory, { ...gig.status, state: "inReview" })
            assert.throws(
                () => readEntityStatus(directory),
                /planning work stage requires In Progress or Canceled lifecycle/,
            )
            writeStatus(repository, gig.directory, { ...gig.status, state: "canceled" })
            const canceled = readEntityStatus(directory)
            if (!("state" in canceled)) assert.fail("expected workflow lifecycle")
            assert.equal(canceled.state, "canceled")
            writeStatus(repository, gig.directory, { ...gig.status, state: "inReview", workStage: "execution" })
            assert.equal(readEntityStatus(directory).workStage, "execution")
            writeStatus(repository, gig.directory, gig.status)

            const cases: Array<{ status: typeof gig.status; error: RegExp }> = [
                {
                    status: { ...gig.status, id: "GIG-01KDVDNA00" },
                    error: /qualified ID does not match/,
                },
                {
                    status: { ...gig.status, slug: "Not normalized" },
                    error: /slug is not normalized/,
                },
                {
                    status: { ...gig.status, branch: { ...gigBranch, target: "develop" } },
                    error: /branch start\/target/,
                },
                {
                    status: {
                        ...gig.status,
                        integrations: [
                            { role: "tracker", provider: "github", state: "awaiting", operation: "create issue" },
                            {
                                role: "tracker",
                                provider: "github",
                                state: "pending",
                                operations: ["create issue"],
                            },
                        ],
                    },
                    error: /duplicate integration role/,
                },
            ]
            for (const testCase of cases) {
                writeStatus(repository, gig.directory, testCase.status)
                assert.throws(() => readEntityStatus(directory), testCase.error)
            }
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })

    it("rejects a timestamp ID collision without deleting existing work", () => {
        const repository = temporaryRepository()
        try {
            const now = new Date("2026-01-02T03:04:00.000Z")
            const first = initializeEntity(
                {
                    entity: "gig",
                    title: "First",
                    slug: "first",
                    request: "First",
                    priority: "not set",
                    source: { mode: "new" },
                    kind: "chore",
                },
                { cwd: repository, now },
            )
            assert.throws(
                () =>
                    initializeEntity(
                        {
                            entity: "gig",
                            title: "Second",
                            slug: "second",
                            request: "Second",
                            priority: "not set",
                            source: { mode: "new" },
                            kind: "chore",
                        },
                        { cwd: repository, now },
                    ),
                /workflow ID already exists for this timestamp/,
            )
            assert.deepEqual(readEntityStatus(path.join(repository, first.directory)), first.status)
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })

    it("rejects an ID whose generated branch already exists without deleting that branch", () => {
        const repository = temporaryRepository()
        try {
            const now = new Date("2026-01-02T03:04:00.000Z")
            const rawId = generateRawId(now)
            const branch = formatBranchName({ entity: "gig", rawId, slug: "conflict" }, "identifier-title")
            git(repository, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"])
            git(repository, ["branch", branch, "main"])

            assert.throws(
                () =>
                    initializeEntity(
                        {
                            entity: "gig",
                            title: "Conflict",
                            slug: "conflict",
                            request: "Conflict",
                            priority: "not set",
                            source: { mode: "new" },
                            kind: "chore",
                        },
                        { cwd: repository, now },
                    ),
                /workflow branch already exists/,
            )
            assert.equal(git(repository, ["show-ref", "--verify", `refs/heads/${branch}`]).length > 0, true)
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })
})
