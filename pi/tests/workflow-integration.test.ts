import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it, type TestContext } from "node:test"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { githubPhaseReads, kindLabelNames, kindLabels, linearPhases, phaseValues } from "./workflow-phase-fixtures.ts"
import { withToolExecution } from "./extension-context-fixture.ts"

import {
    assertConfiguredPriority,
    loadIntegrationConfig,
    PriorityFieldValidator,
} from "../workflows/extensions/integrations/config.ts"
import { getWorkflowSettingsPaths, prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import registerIntegrations, {
    buildIntegrationContext,
    IntegrationContextValidator,
    renderEntityProviderBody,
} from "../workflows/extensions/integrations/index.ts"

import { verifyMarkdownProjection } from "../workflows/extensions/integrations/projection.ts"
import { initializeEntity } from "../workflows/extensions/init/entity.ts"
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

function config(scope: "project" | "issue" = "project", withKindLabels = true) {
    return {
        provider: "github" as const,
        mcpServer: "github",
        repository: { owner: "alex", repo: "example" },
        project: {
            owner: "alex",
            ownerType: scope === "project" ? ("user" as const) : ("org" as const),
            number: 3,
        },
        ...(withKindLabels ? { labels: kindLabels() } : {}),
        fields: {
            status: { field: "Status", values: { ...statuses } },
            phase: { field: "Phase", values: { ...phaseValues } },
            priority: {
                scope,
                field: "Priority",
                values: ["Urgent", "High", "Medium", "Low"],
            },
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
    kind: "refactor" as const,
}

function temporaryProject(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-integration-"))
}

function prepareWorkflowProject(root: string, tracker: unknown = config()): void {
    cp.execFileSync("git", ["init", "-b", "main"], { cwd: root })
    cp.execFileSync("git", ["config", "user.email", "test@example.com"], {
        cwd: root,
    })
    cp.execFileSync("git", ["config", "user.name", "Test"], { cwd: root })
    fs.writeFileSync(path.join(root, "README.md"), "test\n")
    fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
    cp.execFileSync("git", ["add", "README.md", ".gitignore"], { cwd: root })
    cp.execFileSync("git", ["commit", "-m", "initial"], { cwd: root })
    fs.mkdirSync(path.join(root, ".project"), { recursive: true })
    fs.writeFileSync(
        path.join(root, ".project", "config.json"),
        JSON.stringify({ branches: { format: "identifier-title" } }),
    )
    fs.writeFileSync(
        path.join(root, ".project", "integrations.json"),
        JSON.stringify({ tracker, forge: forgeConfig() }),
    )
}

function writeEntity(cwd: string, entity: "epic" | "gig", name: string, tracker: unknown, slug: string): string {
    const directory = path.join(".project", ".local", entity === "epic" ? "epics" : "gigs", name)
    fs.mkdirSync(path.join(cwd, directory), { recursive: true })
    const metadata = {
        slug,
        title: slug,
        entity,
        ...(entity === "epic" ? {} : { kind: "feature" }),
        createdAt: "2026-01-02T03:06:00.000Z",
        phase: "execution",
        branch: {
            state: "ready",
            name: name.toLowerCase(),
            start: "main",
            target: "main",
            source: "generated",
        },
        tracker,
    }
    fs.writeFileSync(path.join(cwd, directory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    return directory
}

function writeGitHubGigEntity(cwd: string): string {
    return writeEntity(
        cwd,
        "gig",
        "42-github-provider",
        {
            provider: "github",
            repository: { owner: "alex", repo: "example" },
            external: { issueNumber: 42 },
            planComment: { state: "unpublished" },
        },
        "github-provider",
    )
}

function writeLinearGigEntity(cwd: string): string {
    return writeEntity(
        cwd,
        "gig",
        "ENG-123-mixed-provider",
        {
            provider: "linear",
            resource: "gig-issue",
            external: { issueId: "linear-uuid", identifier: "ENG-123" },
            planDocument: { state: "unpublished" },
        },
        "mixed-provider",
    )
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
    return {
        root,
        source,
        consumer,
        settingsPath,
        ctx: { cwd: consumer } as ExtensionContext,
    }
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
            assert.equal(IntegrationContextValidator.check({ operation: "inspect", target }), true)
            assert.equal(IntegrationContextValidator.check({ ...queueSelection, target }), true)
            assert.equal(
                IntegrationContextValidator.check({
                    operation: "resume",
                    entityDir: "gig",
                    target,
                }),
                false,
            )
            assert.equal(
                IntegrationContextValidator.check({
                    operation: "adopt",
                    entity: "gig",
                    target,
                }),
                false,
            )
        }
        assert.equal(IntegrationContextValidator.check({ operation: "inspect" }), false)
        const { target, ...withoutTarget } = queueSelection
        assert.equal(IntegrationContextValidator.check(withoutTarget), false)
        assert.equal(
            IntegrationContextValidator.check({
                ...queueSelection,
                target: "other",
            }),
            false,
        )
        assert.equal(
            IntegrationContextValidator.check({
                ...queueSelection,
                kind: "review",
            }),
            false,
        )
        // Accepted Epic plans create every Task issue; Tasks are never queued directly.
        assert.equal(IntegrationContextValidator.check({ ...queueSelection, entity: "task" }), false)
        assert.equal(IntegrationContextValidator.check({ ...queueSelection, entity: "epic" }), true)
    })

    for (const provider of ["github", "linear"] as const) {
        for (const consumingSetup of ["missing", "different", "malformed"] as const) {
            it(`uses ${provider} source configuration with ${consumingSetup} consuming setup`, (t) => {
                const f = workflowFixture(t)
                const tracker =
                    provider === "github"
                        ? {
                              ...config(),
                              mcpServer: "workflow-github",
                              repository: { owner: "maintainer", repo: "workflows" },
                          }
                        : {
                              ...linearConfig(),
                              mcpServer: "workflow-linear",
                              team: "Workflow Team",
                          }
                prepareWorkflowProject(f.source, tracker)
                prepareArtifactPersistence(f.source)
                const sourceIntegrations = path.join(f.source, ".project/integrations.json")
                if (consumingSetup !== "missing") {
                    prepareWorkflowProject(f.consumer)
                    if (consumingSetup === "malformed") {
                        fs.writeFileSync(path.join(f.consumer, ".project/integrations.json"), "broken JSON")
                        fs.writeFileSync(path.join(f.consumer, ".project/config.json"), "broken JSON")
                    }
                }
                const before = fileSnapshot(f.root)
                const inspected = buildIntegrationContext(f.ctx, { operation: "inspect", target: "workflow" }, mcpTools)
                const intake = buildIntegrationContext(f.ctx, { ...queueSelection, target: "workflow" }, mcpTools)
                for (const context of [inspected, intake]) {
                    assert.equal(context.target, "workflow")
                    assert.equal(context.projectRoot, f.source)
                    assert.deepEqual(context.roles.tracker, {
                        state: "enabled",
                        provider,
                        config: tracker,
                    })
                }
                assert.deepEqual(fileSnapshot(f.root), before, "context must not modify either project or settings")
                if (consumingSetup === "different") {
                    prepareArtifactPersistence(f.consumer)
                    const current = buildIntegrationContext(f.ctx, { ...queueSelection, target: "current" }, mcpTools)
                    assert.deepEqual(current.roles.tracker, {
                        state: "enabled",
                        provider: "github",
                        config: config(),
                    })
                }
                const updated =
                    provider === "github"
                        ? {
                              ...tracker,
                              repository: { owner: "maintainer", repo: "new-inbox" },
                          }
                        : { ...tracker, team: "New Workflow Team" }
                fs.writeFileSync(sourceIntegrations, JSON.stringify({ tracker: updated, forge: forgeConfig() }))
                const reread = buildIntegrationContext(f.ctx, { ...queueSelection, target: "workflow" }, mcpTools)
                assert.deepEqual(reread.roles.tracker?.config, updated)
            })
        }
    }

    it("errors on a missing source reference without requiring it for current intake", (t) => {
        const f = workflowFixture(t)
        prepareWorkflowProject(f.consumer)
        prepareArtifactPersistence(f.consumer)
        fs.rmSync(f.settingsPath)
        const before = fileSnapshot(f.root)
        assert.throws(
            () => buildIntegrationContext(f.ctx, { operation: "inspect", target: "workflow" }, mcpTools),
            (error: Error) => error.message.includes("Set workflowProject") && error.message.includes(f.settingsPath),
        )
        assert.equal(buildIntegrationContext(f.ctx, queueSelection, mcpTools).state, "enabled")
        assert.deepEqual(fileSnapshot(f.root), before)
    })

    it("inspects and queues from a sandboxed worker without guarding artifact-free operations", (t) => {
        const f = workflowFixture(t)
        const previous = process.env.PITON_RUNTIME
        t.after(() => {
            if (previous === undefined) delete process.env.PITON_RUNTIME
            else process.env.PITON_RUNTIME = previous
        })
        // The source checkout owns a real .project/.local; the worker links to it.
        prepareWorkflowProject(f.source)
        prepareArtifactPersistence(f.source)
        prepareWorkflowProject(f.consumer)
        fs.writeFileSync(path.join(f.consumer, ".gitignore"), "/.project/.local\n")
        fs.symlinkSync(path.join(f.source, ".project/.local"), path.join(f.consumer, ".project/.local"))
        prepareArtifactPersistence(f.consumer)
        process.env.PITON_RUNTIME = "sandbox"

        const before = fileSnapshot(f.source)
        for (const input of [
            { operation: "inspect" as const, target: "workflow" as const },
            { ...queueSelection, target: "workflow" as const },
        ]) {
            const context = buildIntegrationContext(f.ctx, input, mcpTools)
            assert.equal(context.projectRoot, f.source)
            assert.equal(context.roles.tracker?.provider, "github")
        }
        assert.deepEqual(fileSnapshot(f.source), before)

        // An unlinked worker still inspects and queues, but can't address an entity.
        fs.rmSync(path.join(f.consumer, ".project/.local"))
        fs.mkdirSync(path.join(f.consumer, ".project/.local"))
        for (const input of [{ operation: "inspect" as const, target: "current" as const }, queueSelection])
            assert.equal(buildIntegrationContext(f.ctx, input, mcpTools).state, "enabled")
        for (const input of [
            { operation: "adopt" as const, entity: "gig" as const },
            { operation: "resume" as const, entityDir: ".project/.local/gigs/1-work" },
        ])
            assert.throws(() => buildIntegrationContext(f.ctx, input, mcpTools), /isn't linked to its source checkout/)
    })

    it("names source config errors without falling back or preparing artifacts", (t) => {
        const f = workflowFixture(t)
        prepareWorkflowProject(f.source)
        const integrations = path.join(f.source, ".project/integrations.json")
        for (const content of [
            undefined,
            JSON.stringify({ forge: forgeConfig() }),
            JSON.stringify({ tracker: config() }),
            "broken JSON",
        ]) {
            if (content === undefined) fs.rmSync(integrations)
            else fs.writeFileSync(integrations, content)
            const before = fileSnapshot(f.root)
            assert.throws(
                () => buildIntegrationContext(f.ctx, { operation: "inspect", target: "workflow" }, mcpTools),
                (error: Error) => error.message.includes(f.source) && error.message.includes("integrations.json"),
            )
            assert.deepEqual(fileSnapshot(f.root), before)
        }
        fs.writeFileSync(integrations, JSON.stringify({ tracker: config(), forge: forgeConfig() }))
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
        prepareArtifactPersistence(f.source)
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

    it("reports the global session-analysis setting through its context tool", async (t) => {
        const f = workflowFixture(t)
        type Tool = Parameters<ExtensionAPI["registerTool"]>[0]
        const tools = new Map<string, Tool>()
        registerIntegrations({
            events: { on: () => () => {} },
            on: () => {},
            registerCommand: () => {},
            registerTool: (tool: Tool) => tools.set(tool.name, tool),
        } as unknown as ExtensionAPI)
        const inspect = async () =>
            (
                await tools
                    .get("inspect_session_analysis")!
                    .execute("inspect", {}, undefined, undefined, withToolExecution(f.ctx))
            ).details
        assert.deepEqual(await inspect(), { sessionAnalysis: "disabled" })
        fs.writeFileSync(f.settingsPath, JSON.stringify({ workflowProject: f.source, sessionAnalysis: true }))
        const before = fileSnapshot(f.root)
        assert.deepEqual(await inspect(), { sessionAnalysis: "enabled" })
        assert.deepEqual(fileSnapshot(f.root), before)
        fs.writeFileSync(f.settingsPath, JSON.stringify({ sessionAnalysis: 1 }))
        await assert.rejects(inspect, (error: Error) => error.message.includes(f.settingsPath))
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

    it("keeps Backlog and Todo command intake external-only", async () => {
        const cwd = temporaryProject()
        let sent = ""
        const notices: string[] = []
        type Command = {
            description: string
            handler: (args: string, ctx: unknown) => Promise<void>
        }
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
            for (const tool of [
                "verify_artifact_projection",
                "render_provider_body",
                "prepare_tracker_publication",
                "record_tracker_publication",
                "recover_tracker_publication",
            ])
                assert.ok(tools.includes(tool), tool)
            assert.equal(tools.includes("finalize_linear_branch"), false)
            assert.equal(
                commands.get("backlog")!.description,
                "Add potential work to the configured external Backlog without initializing workflow work",
            )
            assert.equal(
                commands.get("todo")!.description,
                "Add queued work to the configured external Todo queue without initializing workflow work",
            )
            const context = {
                cwd,
                ui: { notify: (message: string) => notices.push(message) },
            }
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

    it("requires both a tracker and a forge", () => {
        const cwd = temporaryProject()
        try {
            assert.throws(() => loadIntegrationConfig(cwd), /missing required \.project\/integrations\.json/)
            fs.mkdirSync(path.join(cwd, ".project"))
            const file = path.join(cwd, ".project/integrations.json")
            for (const content of [{ forge: forgeConfig() }, { tracker: config() }]) {
                fs.writeFileSync(file, JSON.stringify(content))
                assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
            }
            fs.writeFileSync(file, JSON.stringify({ tracker: config(), forge: forgeConfig() }))
            assert.deepEqual(loadIntegrationConfig(cwd), {
                tracker: config(),
                forge: forgeConfig(),
            })
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("rejects an entity bound to another tracker provider", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            prepareArtifactPersistence(cwd)
            const entityDir = writeLinearGigEntity(cwd)
            assert.throws(
                () =>
                    buildIntegrationContext({ cwd } as ExtensionContext, { operation: "resume", entityDir }, mcpTools),
                /bound to linear, not the configured tracker/,
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("plans an item's complete label set and keeps the selection on a Kind change", () => {
        const cwd = temporaryProject()
        try {
            const area = {
                appliesTo: ["deliverable"],
                cardinality: "zeroOrMore",
                values: { fe: { name: "Area: FE", color: "#1D76DB", description: "" } },
            }
            const perf = {
                appliesTo: ["deliverable"],
                cardinality: "zeroOrOne",
                values: { perf: { name: "Perf", color: "#1D76DB", description: "" } },
            }
            prepareWorkflowProject(cwd, { ...config(), labels: { groups: { ...kindLabels().groups, area, perf } } })
            prepareArtifactPersistence(cwd)
            const gig = initializeEntity(
                {
                    entity: "gig",
                    title: "Work",
                    slug: "work",
                    request: "Work",
                    kind: "bugfix",
                    object: { issueId: 1, issueNumber: 7, issueUrl: "https://github.com/alex/example/issues/7" },
                },
                { cwd },
            )
            const ctx = { cwd } as ExtensionContext
            const plan = (labels: unknown, names: string[]) =>
                (
                    buildIntegrationContext(
                        ctx,
                        {
                            operation: "labelMutation",
                            entityDir: gig.directory,
                            ...(labels ? { labels } : {}),
                            current: { provider: "github", names },
                        } as Parameters<typeof buildIntegrationContext>[1],
                        mcpTools,
                    ) as { labelMutation?: unknown }
                ).labelMutation
            // A Kind change from feature to bugfix keeps Area: FE and Perf, and keeps an unrelated label.
            assert.deepEqual(plan(undefined, ["Kind: Feature", "Area: FE", "Perf", "customer"]), {
                provider: "github",
                labels: ["customer", "Area: FE", "Perf", "Kind: Bugfix"],
                changed: true,
                unknown: ["customer"],
            })
            assert.deepEqual(plan({ area: [], perf: ["perf"] }, ["Kind: Bugfix", "Area: FE", "Perf"]), {
                provider: "github",
                labels: ["Perf", "Kind: Bugfix"],
                changed: true,
                unknown: [],
            })
            // A correction that leaves out a group fails instead of dropping that group's labels.
            assert.deepEqual((plan({ area: [] }, ["Kind: Bugfix", "Area: FE", "Perf"]) as { error: unknown }).error, {
                kind: "missingGroup",
                group: "perf",
                values: ["perf"],
            })
            assert.match(JSON.stringify(plan({ nope: [] }, [])), /"state":"invalid"/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("returns queue intake labels from the Kind and the selection, on both trackers", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            prepareArtifactPersistence(cwd)
            const ctx = { cwd } as ExtensionContext
            const labels = (input: Parameters<typeof buildIntegrationContext>[1]) =>
                (buildIntegrationContext(ctx, input, mcpTools) as { labels?: unknown }).labels
            assert.deepEqual(labels(queueSelection), ["Kind: Refactor"])
            assert.deepEqual(labels({ ...queueSelection, entity: "epic", kind: "epic" }), ["Kind: Epic"])
            assert.deepEqual(labels({ ...queueSelection, kind: "not set" }), [])
            const write = (tracker: unknown) =>
                fs.writeFileSync(
                    path.join(cwd, ".project/integrations.json"),
                    JSON.stringify({ tracker, forge: forgeConfig() }),
                )
            const area = {
                appliesTo: ["deliverable"],
                cardinality: "oneOrMore",
                values: { fe: { name: "Area: FE", color: "#1D76DB", description: "" } },
            }
            write({ ...config("project"), labels: { groups: { ...kindLabels().groups, area } } })
            assert.deepEqual(labels({ ...queueSelection, labels: { area: ["fe"] } }), ["Area: FE", "Kind: Refactor"])
            assert.deepEqual(
                (labels(queueSelection) as { error: unknown }).error,
                { kind: "cardinality", group: "area", cardinality: "oneOrMore", selected: [] },
                "a required group without a value is reported, not dropped",
            )
            assert.match(
                JSON.stringify(labels({ ...queueSelection, labels: { kind: ["bugfix"], area: ["fe"] } })),
                /comes from the item's Kind/,
            )
            write(config("project", false))
            assert.deepEqual(labels(queueSelection), [])
            write({
                ...linearConfig(),
                labels: { groups: { kind: { ...kindLabels().groups.kind, scope: "workspace" } } },
            })
            assert.deepEqual(labels(queueSelection), ["Kind: Refactor"], "Linear queue intake applies labels too")
            write(linearConfig())
            assert.deepEqual(labels(queueSelection), [])
            assert.equal(labels({ operation: "inspect", target: "current" }), undefined)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("requires an exact configured Priority or explicit not set", () => {
        assert.doesNotThrow(() => assertConfiguredPriority(config("project"), "High"))
        assert.doesNotThrow(() => assertConfiguredPriority(config("project"), "not set"))
        assert.throws(() => assertConfiguredPriority(config("project"), "Critical"), /not configured/)
        assert.equal(
            PriorityFieldValidator.check({
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
            const write = (tracker: unknown) =>
                fs.writeFileSync(integrationPath, JSON.stringify({ tracker, forge: forgeConfig() }))
            write(linearConfig())
            assert.equal(loadIntegrationConfig(cwd).tracker.provider, "linear")

            const duplicateStatuses = linearConfig()
            duplicateStatuses.statuses.issues.todo = duplicateStatuses.statuses.issues.backlog
            write(duplicateStatuses)
            assert.throws(() => loadIntegrationConfig(cwd), /Linear issue Status mappings must use distinct options/)

            const missingIssueCanceled = linearConfig()
            delete (missingIssueCanceled.statuses.issues as Partial<typeof statuses>).canceled
            write(missingIssueCanceled)
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)

            const missingProjectCanceled = linearConfig()
            delete (missingProjectCanceled.statuses.projects as Partial<typeof statuses>).canceled
            write(missingProjectCanceled)
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)

            write({ ...linearConfig(), repository: { owner: "x", repo: "y" } })
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("requires complete, distinct GitHub mappings while preserving separate scopes", () => {
        const cwd = temporaryProject()
        try {
            fs.mkdirSync(path.join(cwd, ".project"))
            const writeConfig = (tracker: unknown) =>
                fs.writeFileSync(
                    path.join(cwd, ".project", "integrations.json"),
                    JSON.stringify({ tracker, forge: forgeConfig() }),
                )

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

            writeConfig({
                ...config("project"),
                labels: kindLabels({ ...kindLabelNames, bugfix: kindLabelNames.feature.toUpperCase() }),
            })
            assert.throws(() => loadIntegrationConfig(cwd), /"KIND: FEATURE" is used more than once/)

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
            assert.equal(loadIntegrationConfig(cwd).tracker.provider, "github")

            writeConfig(config("project", false))
            assert.equal(loadIntegrationConfig(cwd).tracker.provider, "github")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("reads tracker and forge configuration without provider preflight", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            prepareArtifactPersistence(cwd)
            const result = buildIntegrationContext(
                { cwd } as ExtensionContext,
                { operation: "inspect", target: "current" },
                mcpTools,
            )
            assert.deepEqual(result.roles.tracker, {
                state: "enabled",
                provider: "github",
                config: config(),
            })
            assert.deepEqual(result.roles.forge, {
                state: "enabled",
                provider: "github",
                config: forgeConfig(),
            })
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("renders entity provider bodies with only same-repository GitHub closing references", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            prepareArtifactPersistence(cwd)
            const entityDir = writeGitHubGigEntity(cwd)
            const ctx = { cwd } as ExtensionContext
            const source = "# Result\n\n## Overview\n\nDelivered.\n\n## Verification\n\nTests passed.\n"
            const trackerBody =
                "# Plan\n\nDelivered.\n\n<details>\n<summary>Full plan</summary>\n\n## Verification\n\nTests passed.\n\n</details>"
            const prBody =
                "## Overview\n\nDelivered.\n\n<hr />\n\n<details>\n<summary>Verification</summary>\n\nTests passed.\n\n</details>"

            assert.equal(
                renderEntityProviderBody(ctx, {
                    entityDir,
                    destination: "tracker",
                    source,
                }),
                trackerBody,
            )
            assert.equal(
                renderEntityProviderBody(ctx, {
                    entityDir,
                    destination: "pullRequest",
                    source,
                }),
                `${prBody}\n\n---\n\nCloses #42`,
            )

            fs.writeFileSync(
                path.join(cwd, ".project", "integrations.json"),
                JSON.stringify({
                    tracker: config("project"),
                    forge: {
                        ...forgeConfig(),
                        repository: { owner: "alex", repo: "other" },
                    },
                }),
            )
            assert.equal(
                renderEntityProviderBody(ctx, {
                    entityDir,
                    destination: "pullRequest",
                    source,
                }),
                prBody,
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("keeps Linear tracker and GitHub forge contexts independent", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd, linearConfig())
            prepareArtifactPersistence(cwd)
            const entityDir = writeLinearGigEntity(cwd)
            const ctx = { cwd } as ExtensionContext

            const trackerSide = buildIntegrationContext(ctx, queueSelection, mcpTools)
            assert.equal(trackerSide.roles.tracker?.state, "enabled")
            assert.equal(trackerSide.roles.forge, undefined)
            const resumeSide = buildIntegrationContext(ctx, { operation: "resume", entityDir }, mcpTools)
            assert.equal(resumeSide.roles.tracker?.state, "enabled")
            assert.equal(resumeSide.roles.forge?.state, "enabled")
            const forgeSide = buildIntegrationContext(ctx, { operation: "pullRequest", entityDir }, mcpTools)
            assert.equal(forgeSide.roles.tracker, undefined)
            assert.equal(forgeSide.roles.forge?.state, "enabled")
            assert.equal(
                renderEntityProviderBody(ctx, {
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
        const githubEpic = {
            provider: "github",
            repository: { owner: "alex", repo: "example" },
            external: { issueNumber: 7 },
            planComment: { state: "unpublished" },
        }
        const linearEpic = {
            provider: "linear",
            resource: "project",
            external: {
                projectId: "linear-project-uuid",
                createdAt: "2026-10-01T09:00:00.000Z",
            },
            planDocument: { state: "unpublished" },
        }
        for (const provider of ["github", "linear"] as const) {
            for (const entity of ["epic", "gig"] as const) {
                const cwd = temporaryProject()
                try {
                    prepareWorkflowProject(cwd, provider === "github" ? config() : linearConfig())
                    prepareArtifactPersistence(cwd)
                    const entityDir =
                        entity === "gig"
                            ? provider === "github"
                                ? writeGitHubGigEntity(cwd)
                                : writeLinearGigEntity(cwd)
                            : provider === "github"
                              ? writeEntity(cwd, "epic", "7-rollout", githubEpic, "rollout")
                              : writeEntity(cwd, "epic", "20261001-rollout", linearEpic, "rollout")
                    const before = fileSnapshot(cwd)
                    const overview =
                        "## Overview\n\nExplain the work.\n\n### Plan highlights\n\n- Preserve the contract."
                    const details = "## Scope\n\nKeep every detail and `src/example.ts`."
                    const fold =
                        provider === "github"
                            ? `<details>\n<summary>Full plan</summary>\n\n${details}\n\n</details>`
                            : `>>> Full plan\n\n${details}\n\n>>>`
                    assert.equal(
                        renderEntityProviderBody({ cwd } as ExtensionContext, {
                            entityDir,
                            destination: "tracker",
                            source: `# Work\n\n${overview}\n\n${details}\n`,
                        }),
                        `${provider === "github" ? "# Plan\n\nExplain the work.\n\n## Highlights\n\n- Preserve the contract." : "Explain the work.\n\n## Highlights\n\n- Preserve the contract."}\n\n${fold}`,
                    )
                    assert.deepEqual(fileSnapshot(cwd), before)
                } finally {
                    fs.rmSync(cwd, { recursive: true, force: true })
                }
            }
        }
    })

    it("returns the lossless projection contract with the saved plan publication state", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd, linearConfig())
            prepareArtifactPersistence(cwd)
            const entityDir = writeLinearGigEntity(cwd)
            const projection = buildIntegrationContext(
                { cwd } as ExtensionContext,
                { operation: "artifactProjection", entityDir },
                mcpTools,
            )
            assert.equal(projection.projection.source, "exact accepted epic.md or plan.md")
            assert.match(projection.projection.contentPolicy, /lossless.*never summarize or condense/)
            assert.match(
                projection.projection.rendering,
                /tracker_publication.*complete approved source.*exact registered document mutation/,
            )
            assert.match(
                projection.projection.changedCandidateGate,
                /deterministic renderer output.*no second approval.*substantive omission.*exact diff.*explicit user approval/,
            )
            assert.equal(projection.projection.authority, "local accepted artifact")
            assert.ok("planDocument" in projection.projection)
            assert.deepEqual(projection.projection.planDocument, {
                state: "unpublished",
            })
            assert.equal(projection.roles.tracker?.state, "enabled")
            assert.equal(projection.roles.forge, undefined)
            assert.equal(projection.phaseProjection, undefined)
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
                    tracker: {
                        ...config("issue"),
                        project: { owner: "alex", ownerType: "user", number: 3 },
                    },
                    forge: forgeConfig(),
                }),
            )
            assert.equal(loadIntegrationConfig(cwd).tracker.provider, "github")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("validates native Phase through runtime context", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
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
                        field: {
                            name: "Phase",
                            dataType: "SINGLE_SELECT",
                            options: Object.values(phaseValues),
                        },
                    },
                },
                mcpTools,
            )
            assert.deepEqual(context.phaseMutation, {
                provider: "github",
                field: "Phase",
                value: "Execution",
                changed: true,
            })
            assert.equal(context.phaseProjection?.inProgress, "execution")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("prepares GitHub Phase from the Project field and item reads as the MCP returns them", async () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            prepareArtifactPersistence(cwd)
            const entityDir = writeGitHubGigEntity(cwd)
            type Tool = Parameters<ExtensionAPI["registerTool"]>[0]
            const tools = new Map<string, Tool>()
            let publish: ((data: unknown) => void) | undefined
            registerIntegrations({
                events: {
                    on: (event: string, handler: (data: unknown) => void) => {
                        if (event === "mcp:tool-catalog") publish = handler
                        return () => {}
                    },
                },
                on: () => {},
                registerCommand: () => {},
                registerTool: (tool: Tool) => tools.set(tool.name, tool),
            } as unknown as ExtensionAPI)
            publish!(mcpTools)
            const target = {
                server: "github",
                project: { owner: "ALEX", ownerType: "user" as const, number: 3 },
                repository: { owner: "alex", repo: "example" },
                issueNumber: 42,
            }
            const prepare = (native: unknown, lifecycle = "inProgress") =>
                tools.get("prepare_github_phase_mutation")!.execute(
                    "phase",
                    { entityDir, lifecycle, native },
                    undefined,
                    undefined,
                    withToolExecution({
                        cwd,
                    } as ExtensionContext),
                )
            const prepared = await prepare(githubPhaseReads(target))
            assert.deepEqual((prepared.details as { phaseMutation: unknown }).phaseMutation, {
                provider: "github",
                field: "Phase",
                value: "Execution",
                changed: true,
            })
            const cleared = await prepare(githubPhaseReads(target, null), "done")
            assert.deepEqual((cleared.details as { phaseMutation: unknown }).phaseMutation, {
                provider: "github",
                field: "Phase",
                value: null,
                changed: false,
            })
            await assert.rejects(prepare(githubPhaseReads({ ...target, issueNumber: 43 })), /durable issue/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("calculates Linear whole-label updates through runtime context", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd, linearConfig())
            prepareArtifactPersistence(cwd)
            const entityDir = writeLinearGigEntity(cwd)
            const base = {
                team: null,
                parentId: null,
                isGroup: false,
                groupType: null,
                retiredAt: null,
            }
            const context = buildIntegrationContext(
                { cwd } as ExtensionContext,
                {
                    operation: "trackerMutation",
                    entityDir,
                    change: "phase",
                    lifecycle: "inProgress",
                    native: {
                        provider: "linear",
                        applied: ["customer", "planning"],
                        catalog: [
                            {
                                ...base,
                                id: "group",
                                name: "Phase",
                                isGroup: true,
                                groupType: "singleSelect",
                            },
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
            assert.deepEqual(context.phaseMutation, {
                provider: "linear",
                labels: ["customer", "execution"],
                changed: true,
            })
            assert.equal(context.phaseProjection?.inProgress, "execution")
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
            const write = (tracker: unknown) =>
                fs.writeFileSync(integrationPath, JSON.stringify({ tracker, forge: forgeConfig() }))
            const { audit, ...otherKinds } = kindLabelNames
            write({
                ...valid,
                labels: kindLabels({ ...otherKinds, review: audit } as unknown as typeof kindLabelNames),
            })
            assert.throws(() => loadIntegrationConfig(cwd), /`kind` label group values must be exactly/)
            write({ ...valid, fields: { ...valid.fields, type: { scope: "project", field: "Kind" } } })
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
            write({ ...valid, fields: { labels: true } })
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("validates label groups, the kind group, and kept or retired labels", () => {
        const cwd = temporaryProject()
        try {
            fs.mkdirSync(path.join(cwd, ".project"))
            const integrationPath = path.join(cwd, ".project", "integrations.json")
            const write = (tracker: unknown) =>
                fs.writeFileSync(integrationPath, JSON.stringify({ tracker, forge: forgeConfig() }))
            const label = (name: string, description = "") => ({ name, color: "#1D76DB", description })
            const area = {
                appliesTo: ["epic", "deliverable"],
                cardinality: "zeroOrMore",
                values: { frontend: label("Area: Frontend"), backend: label("Area: Backend") },
            }
            const github = (labels: unknown) => ({ ...config("project", false), labels })
            const loads = (tracker: unknown) => {
                write(tracker)
                return loadIntegrationConfig(cwd)
            }
            const rejects = (tracker: unknown, error: RegExp) => {
                write(tracker)
                assert.throws(() => loadIntegrationConfig(cwd), error)
            }

            assert.ok(loads(github({ groups: { ...kindLabels().groups, area } })))
            assert.ok(loads(github({})))
            assert.ok(loads(github({ groups: { area } })), "the kind group is optional")

            const epicOnly = { appliesTo: ["epic"], cardinality: "exactlyOne", values: { epic: label("Kind: Epic") } }
            assert.ok(loads(github({ groups: { kind: epicOnly } })))
            rejects(
                github({ groups: { kind: { ...epicOnly, values: { ...epicOnly.values, feature: label("F") } } } }),
                /values must be exactly "epic" for its `appliesTo`/,
            )
            rejects(
                github({ groups: { kind: { ...kindLabels().groups.kind, cardinality: "zeroOrOne" } } }),
                /must be `exactlyOne`/,
            )
            rejects(github({ groups: { Area: area } }), /invalid \.project\/integrations\.json/)
            rejects(github({ groups: { area: { ...area, appliesTo: [] } } }), /invalid \.project\/integrations\.json/)
            rejects(github({ groups: { area: { ...area, values: {} } } }), /invalid \.project\/integrations\.json/)
            rejects(
                github({ groups: { area: { ...area, cardinality: "some" } } }),
                /invalid \.project\/integrations\.json/,
            )
            rejects(
                github({
                    groups: { area, other: { ...area, values: { fe: label("area: frontend") } } },
                }),
                /"area: frontend" is used more than once in the GitHub repository/,
            )
            rejects(
                github({ groups: { area: { ...area, values: { fe: label("Area: Frontend", "x".repeat(101)) } } } }),
                /description exceeds 100 characters/,
            )

            assert.ok(
                loads(github({ groups: { area }, unmanaged: { keep: [{ name: "bug" }] }, retired: [{ name: "old" }] })),
            )
            rejects(
                github({ groups: { area }, unmanaged: { keep: [{ name: "area: backend" }] } }),
                /names a managed label/,
            )
            rejects(
                github({ unmanaged: { keep: [{ name: "bug" }] }, retired: [{ name: "BUG" }] }),
                /can't be both kept and retired/,
            )
            rejects(github({ retired: [{ name: "old" }, { name: "Old" }] }), /listed twice in retired/)

            const linear = (labels: unknown) => ({ ...linearConfig(), labels })
            const linearArea = { ...area, scope: "workspace" }
            assert.ok(loads(linear({ groups: { area: { ...linearArea, nativeGroup: label("Area") } } })))
            rejects(
                linear({
                    groups: {
                        area: linearArea,
                        perf: { ...linearArea, scope: "team", values: { perf: label("area: backend") } },
                    },
                }),
                /used more than once in the Linear issue label catalog/,
            )
            assert.ok(
                loads(
                    linear({
                        groups: {
                            area: { ...linearArea, appliesTo: ["epic"] },
                            perf: {
                                ...linearArea,
                                appliesTo: ["deliverable"],
                                values: { fe: label("Area: Frontend") },
                            },
                        },
                    }),
                ),
                "Project and issue labels are separate catalogs",
            )
            rejects(
                linear({ groups: { area: { ...linearArea, values: { s: label("Status") } } } }),
                /reserves the label name/,
            )
            rejects(
                linear({ groups: { area: { ...linearArea, values: { p: label("planning") } } } }),
                /"planning" is used more than once/,
            )
            assert.ok(
                loads(
                    linear({
                        groups: { area: { ...linearArea, appliesTo: ["deliverable"] } },
                        unmanaged: { keep: [{ name: "Area: Frontend", catalog: "project", scope: "team" }] },
                    }),
                ).tracker.provider === "linear",
                "a kept Project label may share a name with a managed issue label",
            )
            rejects(
                linear({
                    groups: { area: { ...linearArea, appliesTo: ["deliverable"] } },
                    unmanaged: { keep: [{ name: "Area: Frontend", catalog: "issue", scope: "team" }] },
                }),
                /names a managed label/,
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("rejects the old label shapes through normal validation", () => {
        const cwd = temporaryProject()
        try {
            fs.mkdirSync(path.join(cwd, ".project"))
            const integrationPath = path.join(cwd, ".project", "integrations.json")
            const write = (tracker: unknown) =>
                fs.writeFileSync(integrationPath, JSON.stringify({ tracker, forge: forgeConfig() }))
            write({
                ...config("project", false),
                labels: { kind: { epic: "Kind: Epic", deliverableKinds: { feature: "Kind: Feature" } } },
            })
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
            const linear = linearConfig()
            write({
                ...linear,
                phase: { ...linear.phase, issues: { scope: "workspace", group: "Phase", values: phaseValues } },
            })
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })
})
