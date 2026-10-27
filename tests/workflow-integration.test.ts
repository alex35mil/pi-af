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

function config(scope: "project" | "issue" = "project", kindLabels = true) {
    return {
        provider: "github" as const,
        mcpServer: "github",
        repository: { owner: "alex", repo: "example" },
        project: {
            owner: "alex",
            ownerType: scope === "project" ? ("user" as const) : ("org" as const),
            number: 3,
        },
        ...(kindLabels
            ? {
                  labels: {
                      kind: {
                          epic: "Kind: Epic",
                          deliverableKinds: { ...deliverableKinds },
                      },
                  },
              }
            : {}),
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
            assert.equal(Value.Check(IntegrationContextSchema, { operation: "inspect", target }), true)
            assert.equal(Value.Check(IntegrationContextSchema, { ...queueSelection, target }), true)
            assert.equal(
                Value.Check(IntegrationContextSchema, {
                    operation: "resume",
                    entityDir: "gig",
                    target,
                }),
                false,
            )
            assert.equal(
                Value.Check(IntegrationContextSchema, {
                    operation: "adopt",
                    entity: "gig",
                    target,
                }),
                false,
            )
        }
        assert.equal(Value.Check(IntegrationContextSchema, { operation: "inspect" }), false)
        const { target, ...withoutTarget } = queueSelection
        assert.equal(Value.Check(IntegrationContextSchema, withoutTarget), false)
        assert.equal(
            Value.Check(IntegrationContextSchema, {
                ...queueSelection,
                target: "other",
            }),
            false,
        )
        assert.equal(
            Value.Check(IntegrationContextSchema, {
                ...queueSelection,
                kind: "review",
            }),
            false,
        )
        // Accepted Epic plans create every Task issue; Tasks are never queued directly.
        assert.equal(Value.Check(IntegrationContextSchema, { ...queueSelection, entity: "task" }), false)
        assert.equal(Value.Check(IntegrationContextSchema, { ...queueSelection, entity: "epic" }), true)
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

    it("applies the configured Kind label in queue intake only when Kind labels are on", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            prepareArtifactPersistence(cwd)
            const ctx = { cwd } as ExtensionContext
            assert.equal(buildIntegrationContext(ctx, queueSelection, mcpTools).kindLabel, "Kind: Refactor")
            assert.equal(
                buildIntegrationContext(ctx, { ...queueSelection, entity: "epic", kind: "epic" }, mcpTools).kindLabel,
                "Kind: Epic",
            )
            assert.equal(buildIntegrationContext(ctx, { ...queueSelection, kind: "not set" }, mcpTools).kindLabel, null)
            fs.writeFileSync(
                path.join(cwd, ".project/integrations.json"),
                JSON.stringify({
                    tracker: config("project", false),
                    forge: forgeConfig(),
                }),
            )
            assert.equal(buildIntegrationContext(ctx, queueSelection, mcpTools).kindLabel, null)
            fs.writeFileSync(
                path.join(cwd, ".project/integrations.json"),
                JSON.stringify({ tracker: linearConfig(), forge: forgeConfig() }),
            )
            assert.equal(buildIntegrationContext(ctx, queueSelection, mcpTools).kindLabel, null)
            assert.equal(
                buildIntegrationContext(ctx, { operation: "inspect", target: "current" }, mcpTools).kindLabel,
                undefined,
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

            const duplicateKindLabel = config("project")
            duplicateKindLabel.labels!.kind.deliverableKinds.bugfix =
                duplicateKindLabel.labels!.kind.deliverableKinds.feature.toUpperCase()
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
            const { audit, ...otherKinds } = valid.labels!.kind.deliverableKinds
            write({
                ...valid,
                labels: {
                    kind: {
                        ...valid.labels!.kind,
                        deliverableKinds: { ...otherKinds, review: audit },
                    },
                },
            })
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
            write({
                ...valid,
                fields: {
                    ...valid.fields,
                    type: {
                        scope: "project",
                        field: "Kind",
                        epic: "Epic",
                        deliverableKinds,
                    },
                },
            })
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
            write({ ...valid, fields: { labels: true } })
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })
})
