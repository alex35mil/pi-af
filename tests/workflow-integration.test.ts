import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"

import {
    assertConfiguredPriority,
    loadIntegrationConfig,
    PriorityFieldSchema,
} from "../workflows/extensions/integrations/config.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"

import {
    resolveForgePolicy,
    resolveWorkflowPolicy,
    type WorkflowEnvironment,
} from "../workflows/extensions/integrations/policy.ts"
import registerIntegrations, {
    buildIntegrationContext,
    renderEntityProviderBody,
} from "../workflows/extensions/integrations/index.ts"

import { verifyMarkdownProjection } from "../workflows/extensions/integrations/projection.ts"
import { linearPriorityNumber } from "../workflows/extensions/integrations/records.ts"

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
        labels: { planning: "Planning", kind: { epic: "Kind: Epic", deliverableKinds: { ...deliverableKinds } } },
        fields: {
            status: { field: "Status", values: { ...statuses } },
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

const queueSelection = { operation: "queueIntake" as const, entity: "gig" as const, priority: "High", kind: "refactor" }

function temporaryProject(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-integration-"))
}

function prepareWorkflowProject(root: string, artifactMode: "versioned" | "unversioned" = "versioned"): void {
    cp.execFileSync("git", ["init", "-b", "main"], { cwd: root })
    cp.execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root })
    cp.execFileSync("git", ["config", "user.name", "Test"], { cwd: root })
    fs.writeFileSync(path.join(root, "README.md"), "test\n")
    fs.writeFileSync(path.join(root, ".gitignore"), ".project/**/.local/\n")
    cp.execFileSync("git", ["add", "README.md", ".gitignore"], { cwd: root })
    cp.execFileSync("git", ["commit", "-m", "initial"], { cwd: root })
    fs.mkdirSync(path.join(root, ".project"), { recursive: true })
    fs.writeFileSync(
        path.join(root, ".project", "config.json"),
        JSON.stringify({ artifacts: artifactMode, branches: { format: "identifier" } }),
    )
}

function writeTrackerlessGigEntity(cwd: string): string {
    const rawId = "01KDVDNA01"
    const directory = path.join(".project", "gigs", `20260102-0305.GIG-${rawId}.forge-only`)
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
        workStage: "planning",
        branch: { state: "ready", name: "gig-forge-only", start: "main", target: "main", source: "generated" },
        integrations: [],
    }
    fs.writeFileSync(path.join(absolute, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    fs.mkdirSync(path.join(absolute, ".local"), { recursive: true })
    fs.writeFileSync(
        path.join(absolute, ".local", "status.md"),
        '# Status\n\n```json\n{\n  "state": "inProgress"\n}\n```\n',
    )
    return directory
}

function writeGitHubGigEntity(cwd: string): string {
    const rawId = "01KDVDNA02"
    const directory = path.join(".project", "gigs", `20260102-0306.GIG-${rawId}.github-provider`)
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
        workStage: "execution",
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
    const directory = path.join(".project", "gigs", `20260102-0304.GIG-${rawId}.mixed-provider`)
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
        workStage: "planning",
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
                resource: "gig-issue",
                state: "bound",
                external: { issueId: "linear-uuid" },
            },
        ],
    }
    fs.writeFileSync(path.join(absolute, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    return directory
}

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

    it("defines every artifact, tracker, and forge policy case exhaustively", () => {
        const trackerRoles: WorkflowEnvironment["tracker"][] = [
            { kind: "none" },
            { kind: "github", config: config("project") },
            { kind: "linear", config: linearConfig() },
        ]
        const workflowCases = (["versioned", "unversioned"] as const).flatMap((artifactKind) =>
            trackerRoles.map((tracker) =>
                resolveWorkflowPolicy({ artifacts: { kind: artifactKind }, tracker, forge: { kind: "none" } }),
            ),
        )
        assert.deepEqual(
            workflowCases.map((policy) => [
                policy.case,
                policy.lifecycleAuthority,
                policy.priorityAuthority,
                policy.localStatus,
                policy.projection,
                policy.systemMetadataProjection,
            ]),
            [
                ["versioned/no-tracker", "workflow", "workflow", "required", "none", false],
                ["versioned/github", "tracker", "tracker", "forbidden", "full", true],
                ["versioned/linear", "tracker", "tracker", "forbidden", "full", true],
                ["unversioned/no-tracker", "workflow", "workflow", "required", "none", false],
                ["unversioned/github", "tracker", "tracker", "forbidden", "restricted", false],
                ["unversioned/linear", "tracker", "tracker", "forbidden", "restricted", false],
            ],
        )

        const forgeCases = (["versioned", "unversioned"] as const).flatMap((artifactKind) => [
            resolveForgePolicy({
                artifacts: { kind: artifactKind },
                tracker: { kind: "none" },
                forge: { kind: "none" },
            }),
            resolveForgePolicy({
                artifacts: { kind: artifactKind },
                tracker: { kind: "none" },
                forge: { kind: "github", config: forgeConfig() },
            }),
        ])
        assert.deepEqual(
            forgeCases.map((policy) => [policy.case, policy.pullRequests]),
            [
                ["versioned/no-forge", false],
                ["versioned/github", true],
                ["unversioned/no-forge", false],
                ["unversioned/github", true],
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
            assert.deepEqual(buildIntegrationContext(ctx, { operation: "inspect" }), {
                state: "disabled",
            })
            assert.throws(() => buildIntegrationContext(ctx, queueSelection), /requires a configured tracker/)
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
                    buildIntegrationContext({ cwd } as ExtensionContext, {
                        operation: "resume",
                        entityDir: trackerEntity,
                    }),
                /requires tracker migration/,
            )

            const workflowEntity = writeTrackerlessGigEntity(cwd)
            assert.deepEqual(
                buildIntegrationContext({ cwd } as ExtensionContext, {
                    operation: "resume",
                    entityDir: workflowEntity,
                }),
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

            const planningCollision = config("project")
            planningCollision.labels.kind.epic = planningCollision.labels.planning.toLowerCase()
            writeConfig(planningCollision)
            assert.throws(() => loadIntegrationConfig(cwd), /label names must be distinct case-insensitively/)

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
            assert.throws(() => buildIntegrationContext({ cwd } as ExtensionContext, queueSelection), /tracker/)
            fs.writeFileSync(file, JSON.stringify({ tracker: config(), forge: forgeConfig() }))
            const result = buildIntegrationContext({ cwd } as ExtensionContext, { operation: "inspect" })
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
            const source = "# Result\n\nDelivered.\n"

            assert.equal(renderEntityProviderBody(ctx, { entityDir, destination: "tracker", source }), "Delivered.\n")
            assert.equal(
                renderEntityProviderBody(ctx, { entityDir, destination: "pullRequest", source }),
                "Delivered.\n\n---\n\nCloses #42",
            )

            fs.writeFileSync(
                integrationPath,
                JSON.stringify({
                    tracker: config("project"),
                    forge: { ...forgeConfig(), repository: { owner: "alex", repo: "other" } },
                }),
            )
            assert.equal(
                renderEntityProviderBody(ctx, { entityDir, destination: "pullRequest", source }),
                "Delivered.\n",
            )
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

            const trackerSide = buildIntegrationContext({ cwd } as ExtensionContext, queueSelection)
            if (trackerSide.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(trackerSide.roles.tracker?.state, "enabled")
            assert.equal(trackerSide.roles.forge, undefined)
            const initializeSide = buildIntegrationContext({ cwd } as ExtensionContext, {
                operation: "initialize",
                entityDir,
            })
            if (initializeSide.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(initializeSide.roles.tracker?.state, "enabled")
            assert.equal(initializeSide.roles.forge?.state, "enabled")

            const forgeSide = buildIntegrationContext({ cwd } as ExtensionContext, {
                operation: "pullRequest",
                entityDir,
            })
            if (forgeSide.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(forgeSide.roles.tracker, undefined)
            assert.equal(forgeSide.roles.forge?.state, "enabled")
            assert.equal(
                renderEntityProviderBody({ cwd } as ExtensionContext, {
                    entityDir,
                    destination: "pullRequest",
                    source: "# Result\n\nDelivered.\n",
                }),
                "Delivered.\n",
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("reads unversioned GitHub configuration and projection policy", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd, "unversioned")
            prepareArtifactPersistence(cwd)
            fs.writeFileSync(
                path.join(cwd, ".project", "integrations.json"),
                JSON.stringify({ tracker: config("issue") }),
            )

            const context = buildIntegrationContext({ cwd } as ExtensionContext, { operation: "inspect" })
            if (context.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(context.artifactMode, "unversioned")
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

    it("keeps restricted unversioned tracker projection independent from the forge", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd, "unversioned")
            prepareArtifactPersistence(cwd)
            fs.writeFileSync(
                path.join(cwd, ".project", "integrations.json"),
                JSON.stringify({ tracker: linearConfig(), forge: forgeConfig() }),
            )
            const entityDir = writeLinearGigEntity(cwd)

            const projection = buildIntegrationContext({ cwd } as ExtensionContext, {
                operation: "artifactProjection",
                entityDir,
            })
            if (projection.state !== "enabled") assert.fail("expected enabled tracker projection")
            assert.equal(projection.artifactMode, "unversioned")
            assert.ok(projection.projection)
            if (projection.projection.mode !== "restricted") assert.fail("expected restricted tracker projection")
            assert.equal(projection.projection.source, "exact accepted epic.md or plan.md")
            assert.match(projection.projection.contentPolicy, /lossless.*never summarize or condense/)
            assert.match(
                projection.projection.automaticPresentationNormalization,
                /remove the first Markdown H1.*same-repository GitHub.*Closes/,
            )
            assert.match(
                projection.projection.changedCandidateGate,
                /except for root-H1 removal and the same-repository GitHub closing reference.*exact diff.*every omission, rewrite, or addition.*approval/,
            )
            assert.equal(projection.projection.ownership, "workflow")
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
                    buildIntegrationContext({ cwd } as ExtensionContext, {
                        operation: "artifactProjection",
                        entityDir,
                    }),
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
