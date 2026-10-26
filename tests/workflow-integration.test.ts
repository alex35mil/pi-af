import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it, type TestContext } from "node:test"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"
import { linearPhases, phaseValues } from "./workflow-phase-fixtures.ts"
import { withToolExecution } from "./extension-context-fixture.ts"

import {
    assertConfiguredPriority,
    loadIntegrationConfig,
    PriorityFieldSchema,
} from "../workflows/extensions/integrations/config.ts"
import { getWorkflowSettingsPaths, prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"

import {
    resolveForgePolicy,
    resolveWorkflowPolicy,
    type WorkflowEnvironment,
} from "../workflows/extensions/integrations/policy.ts"
import registerIntegrations, {
    buildIntegrationContext,
    IntegrationContextSchema,
    renderEntityProviderBody,
} from "../workflows/extensions/integrations/index.ts"

import { verifyMarkdownProjection } from "../workflows/extensions/integrations/projection.ts"
import { linearPriorityNumber } from "../workflows/extensions/integrations/records.ts"

import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"

const mcpTools = workflowMcpCatalog("github", "linear", "workflow-github", "workflow-linear")

const statuses = {
    backlog: "Backlog",
    todo: "Todo",
    inProgress: "In Progress",
    inReview: "In Review",
    done: "Done",
    canceled: "Canceled",
}
const deliverableKinds = {
    feature: "Kind: Feature",
    bugfix: "Kind: Bugfix",
    research: "Kind: Research",
    refactor: "Kind: Refactor",
    audit: "Kind: Audit",
    chore: "Kind: Chore",
}

function config(scope: "project" | "issue" = "project") {
    return {
        provider: "github" as const,
        mcpServer: "github",
        repository: { owner: "alex", repo: "example" },
        project: { owner: "alex", ownerType: scope === "project" ? ("user" as const) : ("org" as const), number: 3 },
        labels: { kind: { epic: "Kind: Epic", deliverableKinds: { ...deliverableKinds } } },
        fields: {
            status: { field: "Status", values: { ...statuses } },
            phase: { field: "Phase", values: { ...phaseValues } },
            priority: { scope, field: "Priority", values: ["Urgent", "High", "Medium", "Low"] },
            internalId: { scope, field: "Internal ID" },
        },
    }
}

function linearConfig() {
    return {
        provider: "linear" as const,
        mcpServer: "linear",
        team: "Engineering",
        phase: linearPhases(),
        statuses: {
            issues: { ...statuses },
            projects: { ...statuses },
        },
    }
}

function forgeConfig() {
    return {
        provider: "github" as const,
        mcpServer: "github",
        repository: { owner: "alex", repo: "example" },
    }
}

const queueSelection = {
    operation: "queueIntake" as const,
    target: "current" as const,
    entity: "gig" as const,
    priority: "High",
    kind: "refactor",
}

function temporaryProject(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-integration-"))
}

function prepareWorkflowProject(root: string): void {
    cp.execFileSync("git", ["init", "-b", "main"], { cwd: root })
    cp.execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root })
    cp.execFileSync("git", ["config", "user.name", "Test"], { cwd: root })
    fs.writeFileSync(path.join(root, "README.md"), "test\n")
    fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
    cp.execFileSync("git", ["add", "README.md", ".gitignore"], { cwd: root })
    cp.execFileSync("git", ["commit", "-m", "initial"], { cwd: root })
    fs.mkdirSync(path.join(root, ".project"), { recursive: true })
    fs.writeFileSync(
        path.join(root, ".project", "config.json"),
        JSON.stringify({ branches: { format: "identifier" } }),
    )
}

function writeTrackerlessGigEntity(cwd: string): string {
    const rawId = "01KDVDNA01"
    const directory = path.join(".project", ".local", "gigs", `20260102-0305.GIG-${rawId}.forge-only`)
    const absolute = path.join(cwd, directory)
    fs.mkdirSync(absolute, { recursive: true })
    const metadata = {
        id: `GIG-${rawId}`,
        rawId,
        slug: "forge-only",
        title: "Forge only",
        entity: "gig",
        kind: "chore",
        authority: { kind: "workflow", priority: "not set" },
        createdAt: "2026-01-02T03:05:00.000Z",
        phase: "planning",
        branch: { state: "ready", name: "gig-forge-only", start: "main", target: "main", source: "generated" },
        integrations: [],
    }
    fs.writeFileSync(path.join(absolute, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    fs.writeFileSync(
        path.join(absolute, "status.md"),
        '# Status\n\n```json\n{\n  "state": "inProgress"\n}\n```\n',
    )
    return directory
}

function writeGitHubGigEntity(cwd: string): string {
    const rawId = "01KDVDNA02"
    const directory = path.join(".project", ".local", "gigs", `20260102-0306.GIG-${rawId}.github-provider`)
    const absolute = path.join(cwd, directory)
    fs.mkdirSync(absolute, { recursive: true })
    const metadata = {
        id: `GIG-${rawId}`,
        rawId,
        slug: "github-provider",
        title: "GitHub provider",
        entity: "gig",
        kind: "feature",
        authority: { kind: "tracker", provider: "github" },
        createdAt: "2026-01-02T03:06:00.000Z",
        phase: "execution",
        branch: {
            state: "ready",
            name: "gig-github-provider",
            start: "main",
            target: "main",
            source: "generated",
        },
        integrations: [
            {
                role: "tracker",
                provider: "github",
                planComment: { state: "unpublished" },
                repository: { owner: "alex", repo: "example" },
                state: "bound",
                external: { issueNumber: 42 },
            },
        ],
    }
    fs.writeFileSync(path.join(absolute, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    return directory
}

function writeLinearGigEntity(cwd: string): string {
    const rawId = "01KDVDNA00"
    const directory = path.join(".project", ".local", "gigs", `20260102-0304.GIG-${rawId}.mixed-provider`)
    const absolute = path.join(cwd, directory)
    fs.mkdirSync(absolute, { recursive: true })
    const metadata = {
        id: `GIG-${rawId}`,
        rawId,
        slug: "mixed-provider",
        title: "Mixed provider",
        entity: "gig",
        kind: "chore",
        authority: { kind: "tracker", provider: "linear" },
        createdAt: "2026-01-02T03:04:00.000Z",
        phase: "planning",
        branch: {
            state: "ready",
            name: "alex/eng-123-mixed-provider",
            start: "main",
            target: "main",
            source: "tracker",
        },
        integrations: [
            {
                role: "tracker",
                provider: "linear",
                planDocument: { state: "unpublished" },
                resource: "gig-issue",
                state: "bound",
                external: { issueId: "linear-uuid" },
            },
        ],
    }
    fs.writeFileSync(path.join(absolute, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    return directory
}

function workflowFixture(t: TestContext) {
    const root = fs.realpathSync(temporaryProject())
    const source = path.join(root, "source")
    const consumer = path.join(root, "consumer")
    const agent = path.join(root, "agent")
    for (const directory of [source, consumer, agent]) fs.mkdirSync(directory)
    const previous = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = agent
    t.after(() => {
        if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
        else process.env.PI_CODING_AGENT_DIR = previous
        fs.rmSync(root, { recursive: true, force: true })
    })
    const settingsPath = getWorkflowSettingsPaths(consumer).global
    fs.writeFileSync(settingsPath, JSON.stringify({ workflowProject: source }))
    return { root, source, consumer, settingsPath, ctx: { cwd: consumer } as ExtensionContext }
}

function fileSnapshot(root: string): [string, string][] {
    return fs
        .readdirSync(root, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((entry) => {
            const file = path.join(root, entry.name)
            return entry.isDirectory() ? fileSnapshot(file) : [[file, fs.readFileSync(file).toString("hex")]]
        })
}

describe("workflow-source queue context", () => {
    it("requires an explicit target only on project inspection and queue intake", () => {
        for (const target of ["current", "workflow"]) {
            assert.equal(Value.Check(IntegrationContextSchema, { operation: "inspect", target }), true)
            assert.equal(Value.Check(IntegrationContextSchema, { ...queueSelection, target }), true)
            assert.equal(
                Value.Check(IntegrationContextSchema, { operation: "resume", entityDir: "gig", target }),
                false,
            )
            assert.equal(Value.Check(IntegrationContextSchema, { operation: "adopt", entity: "gig", target }), false)
        }
        assert.equal(Value.Check(IntegrationContextSchema, { operation: "inspect" }), false)
        const { target, ...withoutTarget } = queueSelection
        assert.equal(Value.Check(IntegrationContextSchema, withoutTarget), false)
        assert.equal(Value.Check(IntegrationContextSchema, { ...queueSelection, target: "other" }), false)
    })

    for (const provider of ["github", "linear"] as const) {
        for (const consumingSetup of ["missing", "different", "malformed"] as const) {
            it(`uses ${provider} source configuration with ${consumingSetup} consuming setup`, (t) => {
                const f = workflowFixture(t)
                prepareWorkflowProject(f.source)
                prepareArtifactPersistence(f.source)
                const tracker =
                    provider === "github"
                        ? {
                              ...config(),
                              mcpServer: "workflow-github",
                              repository: { owner: "maintainer", repo: "workflows" },
                          }
                        : { ...linearConfig(), mcpServer: "workflow-linear", team: "Workflow Team" }
                const sourceIntegrations = path.join(f.source, ".project/integrations.json")
                fs.writeFileSync(sourceIntegrations, JSON.stringify({ tracker }))
                if (consumingSetup !== "missing") {
                    prepareWorkflowProject(f.consumer)
                    fs.writeFileSync(
                        path.join(f.consumer, ".project/integrations.json"),
                        consumingSetup === "malformed" ? "broken JSON" : JSON.stringify({ tracker: config() }),
                    )
                    if (consumingSetup === "malformed")
                        fs.writeFileSync(path.join(f.consumer, ".project/config.json"), "broken JSON")
                }
                const before = fileSnapshot(f.root)
                const inspected = buildIntegrationContext(
                    f.ctx,
                    { operation: "inspect", target: "workflow" },
                    mcpTools,
                )
                const intake = buildIntegrationContext(f.ctx, { ...queueSelection, target: "workflow" }, mcpTools)
                for (const context of [inspected, intake]) {
                    if (context.state !== "enabled") assert.fail("expected source context")
                    assert.equal(context.target, "workflow")
                    assert.equal(context.projectRoot, f.source)
                    assert.deepEqual(context.roles.tracker, { state: "enabled", provider, config: tracker })
                }
                assert.equal(fileSnapshot(f.root).length, before.length)
                assert.deepEqual(fileSnapshot(f.root), before, "context must not modify either project or settings")
                if (consumingSetup === "different") {
                    const current = buildIntegrationContext(
                        f.ctx,
                        { ...queueSelection, target: "current" },
                        mcpTools,
                    )
                    if (current.state !== "enabled") assert.fail("expected consuming context")
                    assert.deepEqual(current.roles.tracker, {
                        state: "enabled",
                        provider: "github",
                        config: config(),
                    })
                }
                const updated =
                    provider === "github"
                        ? { ...tracker, repository: { owner: "maintainer", repo: "new-inbox" } }
                        : { ...tracker, team: "New Workflow Team" }
                fs.writeFileSync(sourceIntegrations, JSON.stringify({ tracker: updated }))
                const reread = buildIntegrationContext(f.ctx, { ...queueSelection, target: "workflow" }, mcpTools)
                if (reread.state !== "enabled") assert.fail("expected refreshed context")
                assert.deepEqual(reread.roles.tracker?.config, updated)
            })
        }
    }

    it("errors on a missing source reference without requiring it for current intake", (t) => {
        const f = workflowFixture(t)
        prepareWorkflowProject(f.consumer)
        fs.writeFileSync(path.join(f.consumer, ".project/integrations.json"), JSON.stringify({ tracker: config() }))
        fs.rmSync(f.settingsPath)
        const before = fileSnapshot(f.root)
        assert.throws(
            () => buildIntegrationContext(f.ctx, { operation: "inspect", target: "workflow" }, mcpTools),
            (error: Error) => error.message.includes("Set workflowProject") && error.message.includes(f.settingsPath),
        )
        assert.equal(buildIntegrationContext(f.ctx, queueSelection, mcpTools).state, "enabled")
        assert.deepEqual(fileSnapshot(f.root), before)
    })

    it("names source config errors without falling back or preparing artifacts", (t) => {
        const f = workflowFixture(t)
        prepareWorkflowProject(f.source)
        const integrations = path.join(f.source, ".project/integrations.json")
        for (const content of [undefined, JSON.stringify({ forge: forgeConfig() }), "broken JSON"]) {
            if (content !== undefined) fs.writeFileSync(integrations, content)
            const before = fileSnapshot(f.root)
            assert.throws(
                () => buildIntegrationContext(f.ctx, { operation: "inspect", target: "workflow" }, mcpTools),
                (error: Error) => error.message.includes(f.source) && error.message.includes("integrations.json"),
            )
            assert.deepEqual(fileSnapshot(f.root), before)
        }
        fs.writeFileSync(integrations, JSON.stringify({ tracker: config() }))
        fs.writeFileSync(
            path.join(f.source, ".project/config.local.json"),
            JSON.stringify({ branches: { username: "alex" } }),
        )
        const unprepared = fileSnapshot(f.root)
        assert.throws(
            () => buildIntegrationContext(f.ctx, { ...queueSelection, target: "workflow" }, mcpTools),
            /not prepared/,
        )
        assert.deepEqual(fileSnapshot(f.root), unprepared)
        prepareArtifactPersistence(f.source)
        const projectConfig = path.join(f.source, ".project/config.json")
        fs.writeFileSync(projectConfig, "broken JSON")
        assert.throws(
            () => buildIntegrationContext(f.ctx, { operation: "inspect", target: "workflow" }, mcpTools),
            (error: Error) => error.message.includes(f.source) && error.message.includes("config.json"),
        )
        fs.rmSync(projectConfig)
        assert.throws(
            () => buildIntegrationContext(f.ctx, { operation: "inspect", target: "workflow" }, mcpTools),
            /missing required/,
        )
    })

    it("exposes source selection through the existing registered context tool without remote calls", async (t) => {
        const f = workflowFixture(t)
        prepareWorkflowProject(f.source)
        fs.writeFileSync(path.join(f.source, ".project/integrations.json"), JSON.stringify({ tracker: config() }))
        type Tool = Parameters<ExtensionAPI["registerTool"]>[0]
        const tools = new Map<string, Tool>()
        registerIntegrations({
            events: { on: () => () => {} },
            on: () => {},
            registerCommand: () => {},
            registerTool: (tool: Tool) => tools.set(tool.name, tool),
        } as unknown as ExtensionAPI)
        const before = fileSnapshot(f.root)
        const result = await tools
            .get("inspect_integrations")!
            .execute("inspect", { target: "workflow" }, undefined, undefined, withToolExecution(f.ctx))
        assert.equal((result.details as { projectRoot: string }).projectRoot, f.source)
        assert.deepEqual(fileSnapshot(f.root), before)
    })
})

describe("workflow integration configuration", () => {
    it("requires exact provider Markdown and returns a concise remediation hint", () => {
        assert.deepEqual(verifyMarkdownProjection("same\n", "same\n"), {
            result: "exact",
            verified: true,
            requiresApproval: false,
        })

        const difference = verifyMarkdownProjection(
            "- first\r\nVisit https://example.com\r\n",
            "* first\nVisit <https://example.com>\n",
        )
        assert.equal(difference.result, "different")
        assert.equal(difference.verified, false)
        assert.equal(difference.requiresApproval, true)
        assert.equal(
            difference.guidance,
            "Review the exact diff. If this is harmless formatting and byte-for-byte comparison is annoying, consider using a Markdown parser and normalized comparison.",
        )
    })

    it("defines every tracker and forge policy case exhaustively", () => {
        const trackerRoles: WorkflowEnvironment["tracker"][] = [
            { kind: "none" },
            { kind: "github", config: config("project") },
            { kind: "linear", config: linearConfig() },
        ]
        const workflowCases = trackerRoles.map((tracker) => resolveWorkflowPolicy({ tracker, forge: { kind: "none" } }))
        assert.deepEqual(
            workflowCases.map((policy) => [
                policy.case,
                policy.lifecycleAuthority,
                policy.priorityAuthority,
                policy.localStatus,
                policy.projection,
            ]),
            [
                ["no-tracker", "workflow", "workflow", "required", "none"],
                ["github", "tracker", "tracker", "forbidden", "restricted"],
                ["linear", "tracker", "tracker", "forbidden", "restricted"],
            ],
        )

        const forgeCases = [
            resolveForgePolicy({ tracker: { kind: "none" }, forge: { kind: "none" } }),
            resolveForgePolicy({ tracker: { kind: "none" }, forge: { kind: "github", config: forgeConfig() } }),
        ]
        assert.deepEqual(
            forgeCases.map((policy) => [policy.case, policy.pullRequests]),
            [
                ["no-forge", false],
                ["github", true],
            ],
        )
    })

    it("keeps Backlog and Todo command intake external-only", async () => {
        const cwd = temporaryProject()
        let sent = ""
        const notices: string[] = []
        type Command = { description: string; handler: (args: string, ctx: unknown) => Promise<void> }
        const commands = new Map<string, Command>()
        const tools: string[] = []
        const pi = {
            events: { on: () => () => {} },
            on: () => {},
            registerCommand: (name: string, command: Command) => commands.set(name, command),
            registerTool: (tool: { name: string }) => tools.push(tool.name),
            sendUserMessage: (message: string) => {
                sent = message
            },
        } as unknown as ExtensionAPI
        try {
            registerIntegrations(pi)
            assert.ok(commands.has("backlog"))
            assert.ok(commands.has("todo"))
            assert.ok(tools.includes("verify_artifact_projection"))
            assert.ok(tools.includes("render_provider_body"))
            assert.ok(tools.includes("prepare_tracker_publication"))
            assert.ok(tools.includes("record_tracker_publication"))
            assert.ok(tools.includes("recover_tracker_publication"))
            assert.equal(tools.includes("render_artifact_links"), false)
            assert.ok(tools.includes("finalize_linear_branch"))
            assert.equal(tools.includes("reconcile_linear_backlog"), false)
            assert.equal(
                commands.get("backlog")!.description,
                "Add potential work to the configured external Backlog without initializing workflow work",
            )
            assert.equal(
                commands.get("todo")!.description,
                "Add queued work to the configured external Todo queue without initializing workflow work",
            )
            const context = { cwd, ui: { notify: (message: string) => notices.push(message) } }
            await commands.get("backlog")!.handler("", context)
            await commands.get("todo")!.handler("", context)
            assert.deepEqual(notices, ["Usage: /backlog <potential work>", "Usage: /todo <queued work>"])
            await commands.get("backlog")!.handler("Capture a potential idea", context)
            assert.match(sent, /Use the backlog skill.*external Backlog intake, not Epic\/Task\/Gig initialization/)
            await commands.get("todo")!.handler("Queue committed work", context)
            assert.match(sent, /Use the todo skill.*external Todo intake, not Epic\/Task\/Gig initialization/)
            assert.equal(fs.existsSync(path.join(cwd, ".project")), false)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("is silently disabled when the config file is absent", () => {
        const cwd = temporaryProject()
        try {
            assert.deepEqual(loadIntegrationConfig(cwd).state, "disabled")
            const ctx = { cwd } as ExtensionContext
            assert.deepEqual(buildIntegrationContext(ctx, { operation: "inspect", target: "current" }, mcpTools), {
                state: "disabled",
                target: "current",
                projectRoot: cwd,
            })
            assert.throws(() => buildIntegrationContext(ctx, queueSelection, mcpTools), /requires a configured tracker/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("validates entity authority when integration configuration is absent", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            prepareArtifactPersistence(cwd)
            const trackerEntity = writeLinearGigEntity(cwd)
            assert.throws(
                () =>
                    buildIntegrationContext(
                        { cwd } as ExtensionContext,
                        {
                            operation: "resume",
                            entityDir: trackerEntity,
                        },
                        mcpTools,
                    ),
                /requires tracker migration/,
            )

            const workflowEntity = writeTrackerlessGigEntity(cwd)
            assert.deepEqual(
                buildIntegrationContext(
                    { cwd } as ExtensionContext,
                    {
                        operation: "resume",
                        entityDir: workflowEntity,
                    },
                    mcpTools,
                ),
                { state: "disabled" },
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("requires an exact configured Priority or explicit not set", () => {
        assert.doesNotThrow(() => assertConfiguredPriority(config("project"), "High"))
        assert.doesNotThrow(() => assertConfiguredPriority(config("project"), "not set"))
        assert.throws(() => assertConfiguredPriority(config("project"), "Critical"), /not configured/)
        assert.equal(
            Value.Check(PriorityFieldSchema, {
                scope: "project",
                field: "Priority",
                values: ["High", "not set"],
            }),
            false,
        )
    })

    it("requires complete, distinct Linear status mappings and native priorities", () => {
        assert.equal(linearPriorityNumber("Urgent"), 1)
        assert.equal(linearPriorityNumber("High"), 2)
        assert.equal(linearPriorityNumber("Medium"), 3)
        assert.equal(linearPriorityNumber("Low"), 4)
        assert.equal(linearPriorityNumber("not set"), 0)
        assert.throws(() => linearPriorityNumber("Critical"), /invalid Linear priority/)
        assert.throws(() => linearPriorityNumber("toString"), /invalid Linear priority/)
        assert.doesNotThrow(() => assertConfiguredPriority(linearConfig(), "High"))
        assert.throws(() => assertConfiguredPriority(linearConfig(), "Critical"), /invalid Linear priority/)

        const cwd = temporaryProject()
        try {
            fs.mkdirSync(path.join(cwd, ".project"))
            const integrationPath = path.join(cwd, ".project", "integrations.json")
            fs.writeFileSync(integrationPath, JSON.stringify({ tracker: linearConfig(), forge: forgeConfig() }))
            const loaded = loadIntegrationConfig(cwd)
            assert.equal(loaded.state, "enabled")
            if (loaded.state !== "enabled") assert.fail("expected enabled integration")
            assert.equal(loaded.config.tracker?.provider, "linear")

            const duplicateStatuses = linearConfig()
            duplicateStatuses.statuses.issues.todo = duplicateStatuses.statuses.issues.backlog
            fs.writeFileSync(integrationPath, JSON.stringify({ tracker: duplicateStatuses }))
            assert.throws(() => loadIntegrationConfig(cwd), /Linear issue Status mappings must use distinct options/)

            const missingIssueCanceled = linearConfig()
            delete (missingIssueCanceled.statuses.issues as Partial<typeof statuses>).canceled
            fs.writeFileSync(integrationPath, JSON.stringify({ tracker: missingIssueCanceled }))
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)

            const missingProjectCanceled = linearConfig()
            delete (missingProjectCanceled.statuses.projects as Partial<typeof statuses>).canceled
            fs.writeFileSync(integrationPath, JSON.stringify({ tracker: missingProjectCanceled }))
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)

            fs.writeFileSync(
                integrationPath,
                JSON.stringify({ tracker: { ...linearConfig(), repository: { owner: "x", repo: "y" } } }),
            )
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("requires complete, distinct GitHub mappings while preserving separate scopes", () => {
        const cwd = temporaryProject()
        try {
            fs.mkdirSync(path.join(cwd, ".project"))
            const writeConfig = (tracker: ReturnType<typeof config>) =>
                fs.writeFileSync(path.join(cwd, ".project", "integrations.json"), JSON.stringify({ tracker }))

            const duplicateStatus = config("project")
            duplicateStatus.fields.status.values.todo = duplicateStatus.fields.status.values.backlog
            writeConfig(duplicateStatus)
            assert.throws(() => loadIntegrationConfig(cwd), /Status mappings must use distinct options/)

            const missingCanceled = config("project")
            delete (missingCanceled.fields.status.values as Partial<typeof statuses>).canceled
            writeConfig(missingCanceled)
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)

            const duplicateProjectField = config("project")
            duplicateProjectField.fields.priority.field = duplicateProjectField.fields.status.field
            writeConfig(duplicateProjectField)
            assert.throws(() => loadIntegrationConfig(cwd), /Project field names must be distinct/)

            const duplicateKindLabel = config("project")
            duplicateKindLabel.labels.kind.deliverableKinds.bugfix =
                duplicateKindLabel.labels.kind.deliverableKinds.feature.toUpperCase()
            writeConfig(duplicateKindLabel)
            assert.throws(() => loadIntegrationConfig(cwd), /label names must be distinct case-insensitively/)

            const phaseCollision = config("project")
            phaseCollision.fields.phase.field = phaseCollision.fields.status.field
            writeConfig(phaseCollision)
            assert.throws(() => loadIntegrationConfig(cwd), /Project field names must be distinct/)

            const duplicatePhase = config("project")
            duplicatePhase.fields.phase.values.selfReview = duplicatePhase.fields.phase.values.execution
            writeConfig(duplicatePhase)
            assert.throws(() => loadIntegrationConfig(cwd), /Phase mappings must use distinct options/)

            const separateScope = config("issue")
            separateScope.fields.priority.field = separateScope.fields.status.field
            writeConfig(separateScope)
            assert.equal(loadIntegrationConfig(cwd).state, "enabled")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("reads tracker and forge configuration independently without provider preflight", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            const file = path.join(cwd, ".project/integrations.json")
            fs.writeFileSync(file, JSON.stringify({ forge: forgeConfig() }))
            assert.throws(
                () => buildIntegrationContext({ cwd } as ExtensionContext, queueSelection, mcpTools),
                /tracker/,
            )
            fs.writeFileSync(file, JSON.stringify({ tracker: config(), forge: forgeConfig() }))
            const result = buildIntegrationContext(
                { cwd } as ExtensionContext,
                {
                    operation: "inspect",
                    target: "current",
                },
                mcpTools,
            )
            if (result.state !== "enabled") assert.fail("enabled configuration expected")
            assert.deepEqual(result.roles.tracker, { state: "enabled", provider: "github", config: config() })
            assert.deepEqual(result.roles.forge, { state: "enabled", provider: "github", config: forgeConfig() })
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("renders entity provider bodies with only same-repository GitHub closing references", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            const integrationPath = path.join(cwd, ".project", "integrations.json")
            fs.writeFileSync(integrationPath, JSON.stringify({ tracker: config("project"), forge: forgeConfig() }))
            prepareArtifactPersistence(cwd)
            const entityDir = writeGitHubGigEntity(cwd)
            const ctx = { cwd } as ExtensionContext
            const source = "# Result\n\n## Overview\n\nDelivered.\n\n## Verification\n\nTests passed.\n"
            const trackerBody =
                "# Plan\n\nDelivered.\n\n<details>\n<summary>Full plan</summary>\n\n## Verification\n\nTests passed.\n\n</details>"
            const prBody =
                "## Overview\n\nDelivered.\n\n<hr />\n\n<details>\n<summary>Verification</summary>\n\nTests passed.\n\n</details>"

            assert.equal(renderEntityProviderBody(ctx, { entityDir, destination: "tracker", source }), trackerBody)
            assert.equal(
                renderEntityProviderBody(ctx, { entityDir, destination: "pullRequest", source }),
                `${prBody}\n\n---\n\nCloses #42`,
            )

            fs.writeFileSync(
                integrationPath,
                JSON.stringify({
                    tracker: config("project"),
                    forge: { ...forgeConfig(), repository: { owner: "alex", repo: "other" } },
                }),
            )
            assert.equal(renderEntityProviderBody(ctx, { entityDir, destination: "pullRequest", source }), prBody)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("keeps Linear tracker and GitHub forge contexts independent", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            fs.writeFileSync(
                path.join(cwd, ".project", "integrations.json"),
                JSON.stringify({ tracker: linearConfig(), forge: forgeConfig() }),
            )
            const entityDir = writeLinearGigEntity(cwd)

            const trackerSide = buildIntegrationContext({ cwd } as ExtensionContext, queueSelection, mcpTools)
            if (trackerSide.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(trackerSide.roles.tracker?.state, "enabled")
            assert.equal(trackerSide.roles.forge, undefined)
            const initializeSide = buildIntegrationContext(
                { cwd } as ExtensionContext,
                {
                    operation: "initialize",
                    entityDir,
                },
                mcpTools,
            )
            if (initializeSide.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(initializeSide.roles.tracker?.state, "enabled")
            assert.equal(initializeSide.roles.forge?.state, "enabled")

            const forgeSide = buildIntegrationContext(
                { cwd } as ExtensionContext,
                {
                    operation: "pullRequest",
                    entityDir,
                },
                mcpTools,
            )
            if (forgeSide.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(forgeSide.roles.tracker, undefined)
            assert.equal(forgeSide.roles.forge?.state, "enabled")
            assert.equal(
                renderEntityProviderBody({ cwd } as ExtensionContext, {
                    entityDir,
                    destination: "pullRequest",
                    source: "# Result\n\n## Overview\n\nDelivered.\n\n## Verification\n\nTests passed.\n",
                }),
                "## Overview\n\nDelivered.\n\n<hr />\n\n<details>\n<summary>Verification</summary>\n\nTests passed.\n\n</details>",
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("renders Epic and Gig trackers losslessly without local mutations", () => {
        for (const provider of ["github", "linear"] as const) {
            for (const entity of ["epic", "gig"] as const) {
                const cwd = temporaryProject()
                try {
                    prepareWorkflowProject(cwd)
                    fs.writeFileSync(
                        path.join(cwd, ".project", "integrations.json"),
                        JSON.stringify({ tracker: provider === "github" ? config() : linearConfig() }),
                    )
                    prepareArtifactPersistence(cwd)
                    let entityDir = provider === "github" ? writeGitHubGigEntity(cwd) : writeLinearGigEntity(cwd)
                    if (entity === "epic") {
                        const original = path.join(cwd, entityDir)
                        const { kind, ...metadata } = JSON.parse(
                            fs.readFileSync(path.join(original, "metadata.json"), "utf-8"),
                        )
                        entityDir = entityDir.replace("gigs", "epics").replace(".GIG-", ".EPIC-")
                        metadata.id = `EPIC-${metadata.rawId}`
                        metadata.entity = "epic"
                        metadata.taskTarget = "epic"
                        if (provider === "linear") {
                            metadata.integrations[0].resource = "project"
                            metadata.integrations[0].external = { projectId: "linear-project-uuid" }
                        }
                        fs.mkdirSync(path.join(cwd, entityDir), { recursive: true })
                        fs.writeFileSync(path.join(cwd, entityDir, "metadata.json"), JSON.stringify(metadata))
                    }
                    const before = fileSnapshot(cwd)
                    const overview =
                        "## Overview\n\nExplain the work.\n\n### Plan highlights\n\n- Preserve the contract."
                    const details = "## Scope\n\nKeep every detail and `src/example.ts`."
                    const fold =
                        provider === "github"
                            ? `<details>\n<summary>Full plan</summary>\n\n${details}\n\n</details>`
                            : `+++ Full plan\n\n${details}\n\n+++`
                    assert.equal(
                        renderEntityProviderBody({ cwd } as ExtensionContext, {
                            entityDir,
                            destination: "tracker",
                            source: `# Work\n\n${overview}\n\n${details}\n`,
                        }),
                        `${provider === "github" ? "# Plan\n\nExplain the work.\n\n## Highlights\n\n- Preserve the contract." : "Explain the work.\n\n## Highlights\n\n- Preserve the contract."}\n\n${fold}`,
                    )
                    assert.deepEqual(fileSnapshot(cwd), before)
                    assert.throws(
                        () =>
                            renderEntityProviderBody({ cwd } as ExtensionContext, {
                                entityDir,
                                destination: "pullRequest",
                                source: `# Work\n\n${overview}\n\n${details}\n`,
                            }),
                        /requires a configured forge/,
                    )
                } finally {
                    fs.rmSync(cwd, { recursive: true, force: true })
                }
            }
        }
    })

    it("renders forge-only PRs and requires a configured role for each destination", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            fs.writeFileSync(path.join(cwd, ".project", "integrations.json"), JSON.stringify({ forge: forgeConfig() }))
            prepareArtifactPersistence(cwd)
            const entityDir = writeTrackerlessGigEntity(cwd)
            const ctx = { cwd } as ExtensionContext
            const source = "# Report\n\n## Overview\n\nConclusion and uncertainty.\n\n## Evidence\n\nAll findings.\n"
            assert.equal(
                renderEntityProviderBody(ctx, { entityDir, destination: "pullRequest", source }),
                "## Overview\n\nConclusion and uncertainty.\n\n<hr />\n\n<details>\n<summary>Evidence</summary>\n\nAll findings.\n\n</details>",
            )
            assert.throws(
                () => renderEntityProviderBody(ctx, { entityDir, destination: "tracker", source }),
                /requires a configured tracker/,
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("reads GitHub configuration and restricted projection policy", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            prepareArtifactPersistence(cwd)
            fs.writeFileSync(
                path.join(cwd, ".project", "integrations.json"),
                JSON.stringify({ tracker: config("issue") }),
            )

            const context = buildIntegrationContext(
                { cwd } as ExtensionContext,
                {
                    operation: "inspect",
                    target: "current",
                },
                mcpTools,
            )
            if (context.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(context.projection?.mode, "restricted")
            const tracker = context.roles.tracker
            if (!tracker || tracker.state !== "enabled" || tracker.provider !== "github") {
                assert.fail("expected enabled GitHub tracker")
            }
            assert.equal(tracker.config.fields.internalId.scope, "issue")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("keeps restricted tracker projection independent from the forge", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            prepareArtifactPersistence(cwd)
            fs.writeFileSync(
                path.join(cwd, ".project", "integrations.json"),
                JSON.stringify({ tracker: linearConfig(), forge: forgeConfig() }),
            )
            const entityDir = writeLinearGigEntity(cwd)

            const projection = buildIntegrationContext(
                { cwd } as ExtensionContext,
                {
                    operation: "artifactProjection",
                    entityDir,
                },
                mcpTools,
            )
            if (projection.state !== "enabled") assert.fail("expected enabled tracker projection")
            assert.ok(projection.projection)
            if (projection.projection.mode !== "restricted") assert.fail("expected restricted tracker projection")
            assert.equal(projection.projection.source, "exact accepted epic.md or plan.md")
            assert.match(projection.projection.contentPolicy, /lossless.*never summarize or condense/)
            assert.match(
                projection.projection.rendering,
                /tracker_publication.*complete approved source.*exact registered document mutation/,
            )
            assert.match(
                projection.projection.changedCandidateGate,
                /deterministic renderer output.*no second approval.*substantive omission.*exact diff.*explicit user approval.*complete source/,
            )
            assert.equal(projection.projection.authority, "local accepted artifact")
            assert.match(projection.projection.outcomeProof, /complete rendered approved body.*clear provider success/)
            assert.match(projection.projection.recovery, /uncertain or partial.*reconcile before retrying/)
            assert.match(projection.projection.discussion, /comments.*accepted source artifact/)
            assert.ok(projection.projection.allowed)
            assert.ok(projection.projection.forbidden)
            assert.ok(projection.projection.allowed.includes("ordinary repository paths"))
            assert.ok(projection.projection.forbidden.some((item) => item.startsWith(".project paths")))
            assert.equal(projection.roles.tracker?.state, "enabled")
            assert.equal(projection.roles.forge, undefined)

            fs.writeFileSync(path.join(cwd, ".project", "integrations.json"), JSON.stringify({ forge: forgeConfig() }))
            assert.throws(
                () =>
                    buildIntegrationContext(
                        { cwd } as ExtensionContext,
                        {
                            operation: "artifactProjection",
                            entityDir,
                        },
                        mcpTools,
                    ),
                /requires tracker migration/,
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("permits a personal Project to use issue-scoped fields", () => {
        const cwd = temporaryProject()
        try {
            fs.mkdirSync(path.join(cwd, ".project"))
            fs.writeFileSync(
                path.join(cwd, ".project/integrations.json"),
                JSON.stringify({
                    tracker: { ...config("issue"), project: { owner: "alex", ownerType: "user", number: 3 } },
                }),
            )
            assert.equal(loadIntegrationConfig(cwd).state, "enabled")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("validates native Phase through runtime context", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            fs.writeFileSync(path.join(cwd, ".project/integrations.json"), JSON.stringify({ tracker: config() }))
            prepareArtifactPersistence(cwd)
            const entityDir = writeGitHubGigEntity(cwd)
            const context = buildIntegrationContext(
                { cwd } as ExtensionContext,
                {
                    operation: "trackerMutation",
                    entityDir,
                    change: "phase",
                    lifecycle: "inProgress",
                    native: {
                        provider: "github",
                        current: "Planning",
                        field: { name: "Phase", dataType: "SINGLE_SELECT", options: Object.values(phaseValues) },
                    },
                },
                mcpTools,
            )
            if (context.state !== "enabled") assert.fail("expected context")
            assert.deepEqual(context.phaseMutation, {
                provider: "github",
                field: "Phase",
                value: "Execution",
                changed: true,
            })
            assert.equal(context.phaseProjection?.inProgress, "execution")
            if (context.projection?.mode === "restricted") {
                assert.ok(context.projection.allowed)
                assert.ok(context.projection.forbidden)
                assert.ok(context.projection.allowed.includes("native Phase metadata"))
                assert.ok(context.projection.forbidden.includes("entity or kind labels/types"))
            }
            const bodyOnly = buildIntegrationContext(
                { cwd } as ExtensionContext,
                {
                    operation: "artifactProjection",
                    entityDir,
                },
                mcpTools,
            )
            if (bodyOnly.state !== "enabled") assert.fail("expected context")
            assert.equal(bodyOnly.phaseProjection, undefined)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("calculates Linear whole-label updates through runtime context", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            fs.writeFileSync(
                path.join(cwd, ".project/integrations.json"),
                JSON.stringify({ tracker: linearConfig() }),
            )
            prepareArtifactPersistence(cwd)
            const entityDir = writeLinearGigEntity(cwd)
            const base = { team: null, parentId: null, isGroup: false, groupType: null, retiredAt: null }
            const context = buildIntegrationContext(
                { cwd } as ExtensionContext,
                {
                    operation: "trackerMutation",
                    entityDir,
                    change: "phase",
                    lifecycle: "inProgress",
                    native: {
                        provider: "linear",
                        applied: ["customer", "execution"],
                        catalog: [
                            { ...base, id: "group", name: "Phase", isGroup: true, groupType: "singleSelect" },
                            ...Object.entries(phaseValues).map(([id, name]) => ({
                                ...base,
                                id,
                                name,
                                parentId: "group",
                            })),
                        ],
                    },
                },
                mcpTools,
            )
            if (context.state !== "enabled") assert.fail("expected context")
            assert.deepEqual(context.phaseMutation, {
                provider: "linear",
                labels: ["customer", "planning"],
                changed: true,
            })
            assert.equal(context.phaseProjection?.inProgress, "planning")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("fails loudly for invalid configuration without substituting labels", () => {
        const cwd = temporaryProject()
        try {
            fs.mkdirSync(path.join(cwd, ".project"))
            const integrationPath = path.join(cwd, ".project", "integrations.json")
            const valid = config("project")
            const { audit, ...legacyKinds } = valid.labels.kind.deliverableKinds
            fs.writeFileSync(
                integrationPath,
                JSON.stringify({
                    tracker: {
                        ...valid,
                        labels: {
                            ...valid.labels,
                            kind: {
                                ...valid.labels.kind,
                                deliverableKinds: { ...legacyKinds, review: audit },
                            },
                        },
                    },
                }),
            )
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)

            fs.writeFileSync(
                integrationPath,
                JSON.stringify({
                    tracker: {
                        ...valid,
                        fields: {
                            ...valid.fields,
                            type: { scope: "project", field: "Kind", epic: "Epic", deliverableKinds },
                        },
                    },
                }),
            )
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)

            fs.writeFileSync(integrationPath, JSON.stringify({ tracker: { ...valid, fields: { labels: true } } }))
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })
})
