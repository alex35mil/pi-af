import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"

import { getMcpToolName, type McpToolCatalog, type McpToolMetadata } from "../extensions/__lib/mcp.ts"
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
import registerIntegrations, { buildIntegrationContext } from "../workflows/extensions/integrations/index.ts"
import { resolveIntegrationOperationPolicy } from "../workflows/extensions/integrations/capabilities.ts"
import { verifyMarkdownProjection } from "../workflows/extensions/integrations/projection.ts"
import { linearPriorityNumber } from "../workflows/extensions/integrations/records.ts"
import {
    GITHUB_FORGE_TOOL_NAMES,
    validateGitHubForgeCapabilities,
} from "../workflows/extensions/integrations/forge/github.ts"
import {
    buildGitHubRemoteValidationSteps,
    GITHUB_TRACKER_METHODS,
    GITHUB_TRACKER_TOOL_NAMES,
    validateGitHubTrackerCapabilities,
} from "../workflows/extensions/integrations/tracker/github.ts"
import {
    LINEAR_TOOL_NAMES,
    validateLinearTrackerCapabilities,
} from "../workflows/extensions/integrations/tracker/linear.ts"

const GITHUB_TOOL_NAMES = { ...GITHUB_TRACKER_TOOL_NAMES, ...GITHUB_FORGE_TOOL_NAMES }

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

function metadata(name: string, properties: string[], methods?: string[], serverName = "github"): McpToolMetadata {
    const schemaProperties: Record<string, Record<string, unknown>> = Object.fromEntries(
        properties.map((property) => [property, { type: "string" }]),
    )
    if (methods) schemaProperties.method = { type: "string", enum: methods }
    return {
        serverName,
        serverToolName: name,
        inputSchema: { type: "object", properties: schemaProperties },
    }
}

function catalog(includeOrganizationTools: boolean): McpToolCatalog {
    const entries: Array<[string, McpToolMetadata]> = []
    const add = (name: string, properties: string[], methods?: string[]) => {
        entries.push([getMcpToolName("github", name), metadata(name, properties, methods)])
    }
    add(GITHUB_TOOL_NAMES.issueRead, ["owner", "repo", "issue_number"], ["get", "get_labels"])
    add(
        GITHUB_TOOL_NAMES.issueWrite,
        ["owner", "repo", "title", "body", "issue_number", "issue_fields", "labels"],
        ["create", "update"],
    )
    add(GITHUB_TOOL_NAMES.getLabel, ["owner", "repo", "name"])
    add(GITHUB_TOOL_NAMES.searchIssues, ["query", "owner", "repo", "fields", "sort", "order"])
    add(
        GITHUB_TOOL_NAMES.projectsList,
        ["owner", "owner_type", "project_number", "field_names"],
        ["list_project_fields", "list_project_items"],
    )
    add(
        GITHUB_TOOL_NAMES.projectsWrite,
        [
            "owner",
            "owner_type",
            "project_number",
            "item_owner",
            "item_repo",
            "item_type",
            "issue_number",
            "updated_field",
        ],
        ["add_project_item", "update_project_item"],
    )
    add(GITHUB_TOOL_NAMES.subIssueWrite, ["method", "owner", "repo", "issue_number", "sub_issue_id"])
    add(GITHUB_TOOL_NAMES.createPullRequest, ["owner", "repo", "title", "body", "head", "base"])
    add(GITHUB_TOOL_NAMES.listPullRequests, ["owner", "repo", "head", "base", "state"])
    add(GITHUB_TOOL_NAMES.pullRequestRead, ["method", "owner", "repo", "pullNumber"], ["get"])
    if (includeOrganizationTools) add(GITHUB_TOOL_NAMES.listIssueFields, ["owner", "repo"])
    return new Map(entries)
}

function linearCatalog(): McpToolCatalog {
    const entries: Array<[string, McpToolMetadata]> = []
    const add = (name: string, properties: string[]) => {
        entries.push([getMcpToolName("linear", name), metadata(name, properties, undefined, "linear")])
    }
    add(LINEAR_TOOL_NAMES.getWorkspace, [])
    add(LINEAR_TOOL_NAMES.getTeam, ["query"])
    add(LINEAR_TOOL_NAMES.listIssueStatuses, ["team"])
    add(LINEAR_TOOL_NAMES.getIssue, ["id", "includeRelations"])
    add(LINEAR_TOOL_NAMES.listIssues, ["query", "team", "state", "project", "priority", "parentId", "fields"])
    add(LINEAR_TOOL_NAMES.saveIssue, ["id", "title", "description", "patch", "team", "priority", "project", "state"])
    add(LINEAR_TOOL_NAMES.getProject, ["query"])
    add(LINEAR_TOOL_NAMES.listProjects, ["query", "state", "team", "fields"])
    add(LINEAR_TOOL_NAMES.saveProject, [
        "id",
        "name",
        "description",
        "patch",
        "state",
        "priority",
        "addTeams",
        "setTeams",
    ])
    return new Map(entries)
}

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
                external: {
                    issueId: "linear-uuid",
                    identifier: "ENG-123",
                    issueUrl: "https://linear.app/example/issue/ENG-123/mixed-provider",
                    gitBranchName: "alex/eng-123-mixed-provider",
                },
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
            forgeCases.map((policy) => [policy.case, policy.pullRequests, policy.artifactLinks]),
            [
                ["versioned/no-forge", false, "unavailable"],
                ["versioned/github", true, "pull-request"],
                ["unversioned/no-forge", false, "unavailable"],
                ["unversioned/github", true, "forbidden"],
            ],
        )
        assert.equal(
            resolveForgePolicy({
                artifacts: { kind: "versioned" },
                tracker: { kind: "linear", config: linearConfig() },
                forge: { kind: "github", config: forgeConfig() },
            }).artifactLinks,
            "pull-request-and-tracker",
        )

        assert.deepEqual(
            [
                "inspect",
                "queueIntake",
                "initialize",
                "resume",
                "artifactProjection",
                "artifactLinks",
                "pullRequest",
            ].map((operation) =>
                resolveIntegrationOperationPolicy(operation as Parameters<typeof resolveIntegrationOperationPolicy>[0]),
            ),
            [
                {
                    operation: "inspect",
                    entity: false,
                    tracker: "optional",
                    forge: "optional",
                    forgeCapabilities: true,
                },
                {
                    operation: "queueIntake",
                    entity: false,
                    tracker: "required",
                    forge: "none",
                    forgeCapabilities: false,
                },
                {
                    operation: "initialize",
                    entity: true,
                    tracker: "optional",
                    forge: "optional",
                    forgeCapabilities: true,
                },
                { operation: "resume", entity: true, tracker: "optional", forge: "optional", forgeCapabilities: true },
                {
                    operation: "artifactProjection",
                    entity: true,
                    tracker: "optional",
                    forge: "none",
                    forgeCapabilities: false,
                },
                {
                    operation: "artifactLinks",
                    entity: true,
                    tracker: "none",
                    forge: "required",
                    forgeCapabilities: false,
                },
                { operation: "pullRequest", entity: true, tracker: "none", forge: "required", forgeCapabilities: true },
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
            assert.deepEqual(buildIntegrationContext(ctx, catalog(false), "inspect"), {
                state: "disabled",
                registeredMcpServers: ["github"],
            })
            assert.throws(() => buildIntegrationContext(ctx, new Map(), "queueIntake"), /requires a configured tracker/)
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
                () => buildIntegrationContext({ cwd } as ExtensionContext, new Map(), "resume", trackerEntity),
                /requires tracker migration/,
            )

            const workflowEntity = writeTrackerlessGigEntity(cwd)
            assert.deepEqual(
                buildIntegrationContext({ cwd } as ExtensionContext, new Map(), "resume", workflowEntity),
                { state: "disabled", registeredMcpServers: [] },
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

    it("validates a personal Project using only Project-scoped fields", () => {
        const tools = validateGitHubTrackerCapabilities(catalog(false), config("project"))
        assert.equal(tools.issueWrite, "mcp__github__issue_write")
        assert.equal(tools.projectsWrite, "mcp__github__projects_write")
        assert.equal("listIssueFields" in tools, false)
    })

    it("requires repository-label capabilities for GitHub lifecycle operations", () => {
        const withoutLabel = new Map(catalog(false))
        withoutLabel.delete(getMcpToolName("github", GITHUB_TRACKER_TOOL_NAMES.getLabel))
        assert.throws(
            () => validateGitHubTrackerCapabilities(withoutLabel, config("project"), "inspect"),
            /missing required tool mcp__github__get_label/,
        )
        assert.throws(
            () => validateGitHubTrackerCapabilities(withoutLabel, config("project"), "initialize"),
            /missing required tool mcp__github__get_label/,
        )
        assert.throws(
            () => validateGitHubTrackerCapabilities(withoutLabel, config("project"), "queueIntake"),
            /missing required tool mcp__github__get_label/,
        )
        assert.doesNotThrow(() =>
            validateGitHubTrackerCapabilities(withoutLabel, config("project"), "queueIntake", "unversioned"),
        )
        assert.doesNotThrow(() =>
            validateGitHubTrackerCapabilities(withoutLabel, config("project"), "artifactProjection"),
        )

        const withoutLabelRead = new Map(catalog(false))
        withoutLabelRead.set(
            getMcpToolName("github", GITHUB_TRACKER_TOOL_NAMES.issueRead),
            metadata(GITHUB_TOOL_NAMES.issueRead, ["owner", "repo", "issue_number"], ["get"]),
        )
        assert.throws(
            () => validateGitHubTrackerCapabilities(withoutLabelRead, config("project"), "initialize"),
            /get_labels/,
        )
        assert.doesNotThrow(() =>
            validateGitHubTrackerCapabilities(withoutLabelRead, config("project"), "artifactProjection"),
        )
    })

    it("validates official Linear capabilities by entity and operation", () => {
        const tools = linearCatalog()
        const readOnly = new Map(tools)
        readOnly.delete(getMcpToolName("linear", LINEAR_TOOL_NAMES.saveIssue))
        readOnly.delete(getMcpToolName("linear", LINEAR_TOOL_NAMES.saveProject))
        const inspected = validateLinearTrackerCapabilities(readOnly, linearConfig(), "inspect")
        assert.equal(inspected.getIssue, "mcp__linear__get_issue")
        assert.equal("saveProject" in inspected, false)
        const all = validateLinearTrackerCapabilities(tools, linearConfig(), "queueIntake")
        assert.equal(all.saveProject, "mcp__linear__save_project")

        const withoutProjectWrite = new Map(tools)
        withoutProjectWrite.delete(getMcpToolName("linear", LINEAR_TOOL_NAMES.saveProject))
        assert.throws(
            () => validateLinearTrackerCapabilities(withoutProjectWrite, linearConfig(), "initialize", "epic"),
            /missing required tool mcp__linear__save_project/,
        )
        assert.doesNotThrow(() =>
            validateLinearTrackerCapabilities(withoutProjectWrite, linearConfig(), "initialize", "gig"),
        )

        const withoutIssueWrite = new Map(tools)
        withoutIssueWrite.delete(getMcpToolName("linear", LINEAR_TOOL_NAMES.saveIssue))
        assert.doesNotThrow(() =>
            validateLinearTrackerCapabilities(withoutIssueWrite, linearConfig(), "initialize", "epic"),
        )
        assert.throws(
            () => validateLinearTrackerCapabilities(withoutIssueWrite, linearConfig(), "initialize", "task"),
            /missing required tool mcp__linear__save_issue/,
        )
    })

    it("validates tracker and forge roles independently", () => {
        const allTools = catalog(false)
        const trackerTools = new Map(allTools)
        trackerTools.delete(getMcpToolName("github", GITHUB_TOOL_NAMES.createPullRequest))
        assert.doesNotThrow(() => validateGitHubTrackerCapabilities(trackerTools, config("project")))

        const forgeCatalog = new Map(
            [...allTools].filter(([name]) =>
                [
                    GITHUB_TOOL_NAMES.createPullRequest,
                    GITHUB_TOOL_NAMES.listPullRequests,
                    GITHUB_TOOL_NAMES.pullRequestRead,
                ].some((tool) => name.endsWith(`__${tool}`)),
            ),
        )
        const forgeTools = validateGitHubForgeCapabilities(forgeCatalog, forgeConfig())
        assert.equal(forgeTools.createPullRequest, "mcp__github__create_pull_request")
        assert.equal(forgeTools.listPullRequests, "mcp__github__list_pull_requests")
        assert.equal(forgeTools.pullRequestRead, "mcp__github__pull_request_read")
        const forgeWithoutLookup = new Map(forgeCatalog)
        forgeWithoutLookup.delete(getMcpToolName("github", GITHUB_TOOL_NAMES.listPullRequests))
        assert.throws(
            () => validateGitHubForgeCapabilities(forgeWithoutLookup, forgeConfig()),
            /missing required tool mcp__github__list_pull_requests/,
        )

        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            const integrationPath = path.join(cwd, ".project", "integrations.json")
            fs.writeFileSync(integrationPath, JSON.stringify({ tracker: config("project") }))
            assert.equal(loadIntegrationConfig(cwd).state, "enabled")
            fs.writeFileSync(integrationPath, JSON.stringify({ forge: forgeConfig() }))
            assert.equal(loadIntegrationConfig(cwd).state, "enabled")
            assert.throws(
                () => buildIntegrationContext({ cwd } as ExtensionContext, allTools, "queueIntake"),
                /tracker/,
            )

            fs.writeFileSync(integrationPath, JSON.stringify({ tracker: config("project"), forge: forgeConfig() }))
            const trackerAvailable = buildIntegrationContext({ cwd } as ExtensionContext, trackerTools, "inspect")
            assert.equal(trackerAvailable.state, "enabled")
            assert.equal(trackerAvailable.roles.tracker?.state, "enabled")
            assert.equal(trackerAvailable.roles.forge?.state, "unavailable")
            const forgeAvailable = buildIntegrationContext({ cwd } as ExtensionContext, forgeCatalog, "inspect")
            assert.equal(forgeAvailable.state, "enabled")
            assert.equal(forgeAvailable.roles.tracker?.state, "unavailable")
            assert.equal(forgeAvailable.roles.forge?.state, "enabled")

            fs.writeFileSync(integrationPath, JSON.stringify({}))
            assert.throws(() => loadIntegrationConfig(cwd), /invalid \.project\/integrations\.json/)
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("returns the shared PR link contract without a tracker", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            fs.writeFileSync(path.join(cwd, ".project", "integrations.json"), JSON.stringify({ forge: forgeConfig() }))
            const entityDir = writeTrackerlessGigEntity(cwd)
            const context = buildIntegrationContext({ cwd } as ExtensionContext, new Map(), "artifactLinks", entityDir)
            if (context.state !== "enabled") assert.fail("expected enabled forge links")
            assert.deepEqual(context.artifactLinkDestinations, ["pullRequest"])
            assert.deepEqual(context.linkSection, {
                heading: "Links",
                order: ["brief", "planOrEpic", "resultOrReport", "tracker", "pullRequest"],
                repositoryVariants: ["permanentCommit", "targetBranch"],
                destinations: {
                    pullRequest: ["brief", "planOrEpic", "tracker"],
                    tracker: ["brief", "planOrEpic", "resultOrReport", "pullRequest"],
                },
            })
            assert.deepEqual(context.projection, { mode: "none" })
            assert.equal(context.roles.tracker, undefined)
            assert.equal(context.roles.forge?.state, "enabled")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("keeps Linear tracker and GitHub forge failures independent in both directions", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            fs.writeFileSync(
                path.join(cwd, ".project", "integrations.json"),
                JSON.stringify({ tracker: linearConfig(), forge: forgeConfig() }),
            )
            const entityDir = writeLinearGigEntity(cwd)

            const trackerSide = buildIntegrationContext({ cwd } as ExtensionContext, linearCatalog(), "queueIntake")
            if (trackerSide.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(trackerSide.roles.tracker?.state, "enabled")
            assert.equal(trackerSide.roles.forge, undefined)
            const initializeSide = buildIntegrationContext(
                { cwd } as ExtensionContext,
                linearCatalog(),
                "initialize",
                entityDir,
            )
            if (initializeSide.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(initializeSide.roles.tracker?.state, "enabled")
            assert.equal(initializeSide.roles.forge?.state, "unavailable")

            const forgeSide = buildIntegrationContext(
                { cwd } as ExtensionContext,
                catalog(false),
                "pullRequest",
                entityDir,
            )
            if (forgeSide.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(forgeSide.roles.tracker, undefined)
            assert.equal(forgeSide.roles.forge?.state, "enabled")
            const artifactSide = buildIntegrationContext(
                { cwd } as ExtensionContext,
                new Map(),
                "artifactLinks",
                entityDir,
            )
            if (artifactSide.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(artifactSide.roles.tracker, undefined)
            assert.equal(artifactSide.roles.forge?.state, "enabled")
            assert.deepEqual(artifactSide.artifactLinkDestinations, ["pullRequest", "tracker"])
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("inspects unversioned GitHub setup without versioned-only metadata capabilities", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd, "unversioned")
            prepareArtifactPersistence(cwd)
            fs.writeFileSync(
                path.join(cwd, ".project", "integrations.json"),
                JSON.stringify({ tracker: config("issue") }),
            )
            const tools = new Map(catalog(true))

            const context = buildIntegrationContext({ cwd } as ExtensionContext, tools, "inspect")
            if (context.state !== "enabled") assert.fail("expected enabled integrations")
            assert.equal(context.artifactMode, "unversioned")
            assert.equal(context.projection?.mode, "restricted")
            const tracker = context.roles.tracker
            if (!tracker || tracker.state !== "enabled" || tracker.provider !== "github") {
                assert.fail("expected enabled GitHub tracker")
            }
            assert.equal(
                tracker.remoteValidation.some((step) => /Internal ID|configured Kind label/.test(step)),
                false,
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("keeps unversioned-artifact tracker projection and forge links independent", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd, "unversioned")
            prepareArtifactPersistence(cwd)
            fs.writeFileSync(
                path.join(cwd, ".project", "integrations.json"),
                JSON.stringify({ tracker: linearConfig(), forge: forgeConfig() }),
            )
            const entityDir = writeLinearGigEntity(cwd)

            const links = buildIntegrationContext({ cwd } as ExtensionContext, new Map(), "artifactLinks", entityDir)
            assert.deepEqual(links, {
                state: "skipped",
                operation: "artifactLinks",
                reason: "unversioned artifacts have no forge links",
            })

            const projection = buildIntegrationContext(
                { cwd } as ExtensionContext,
                linearCatalog(),
                "artifactProjection",
                entityDir,
            )
            if (projection.state !== "enabled") assert.fail("expected enabled tracker projection")
            assert.equal(projection.artifactMode, "unversioned")
            assert.ok(projection.projection)
            if (projection.projection.mode !== "restricted") assert.fail("expected restricted tracker projection")
            assert.equal(projection.projection.source, "exact accepted epic.md or plan.md")
            assert.match(projection.projection.contentPolicy, /lossless.*never summarize or condense/)
            assert.match(
                projection.projection.automaticPresentationNormalization,
                /without separate content approval.*first Markdown H1.*Plan:.*shared destination-specific `## Links`/,
            )
            assert.match(
                projection.projection.changedCandidateGate,
                /except for duplicate-title H1 normalization and shared deterministic Links rendering.*exact diff.*every omission\/rewrite\/addition.*approval/,
            )
            assert.match(
                projection.projection.postWriteVerification,
                /re-read.*verify_artifact_projection.*only exact bytes verify.*concise hint.*Markdown parsing and normalized comparison.*harmless formatting.*byte-for-byte comparison annoying/,
            )
            assert.equal(projection.projection.preserveUnrelatedProviderContent, true)
            assert.ok(projection.projection.allowed)
            assert.ok(projection.projection.forbidden)
            assert.ok(projection.projection.allowed.includes("ordinary repository paths"))
            assert.ok(projection.projection.forbidden.some((item) => item.startsWith(".project paths")))
            assert.equal(projection.roles.tracker?.state, "enabled")
            assert.equal(projection.roles.forge, undefined)

            fs.writeFileSync(path.join(cwd, ".project", "integrations.json"), JSON.stringify({ forge: forgeConfig() }))
            assert.throws(
                () => buildIntegrationContext({ cwd } as ExtensionContext, new Map(), "artifactProjection", entityDir),
                /requires tracker migration/,
            )
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("permits a personal Project to use fields from an organization repository", () => {
        const personalProjectWithIssueFields = {
            ...config("issue"),
            project: { owner: "alex", ownerType: "user" as const, number: 3 },
        }
        const tools = validateGitHubTrackerCapabilities(catalog(true), personalProjectWithIssueFields)
        assert.equal(tools.listIssueFields, "mcp__github__list_issue_fields")
    })

    it("requires issue-field capability for organization metadata", () => {
        assert.throws(
            () => validateGitHubTrackerCapabilities(catalog(false), config("issue")),
            /missing required tool mcp__github__list_issue_fields/,
        )
        const tools = validateGitHubTrackerCapabilities(catalog(true), config("issue"))
        assert.equal(tools.listIssueFields, "mcp__github__list_issue_fields")
    })

    it("resolves GitHub artifact projection without metadata or forge tools", () => {
        const contentOnly = new Map(
            [...catalog(true)].filter(([name]) =>
                [
                    `mcp__github__${GITHUB_TRACKER_TOOL_NAMES.issueRead}`,
                    `mcp__github__${GITHUB_TRACKER_TOOL_NAMES.issueWrite}`,
                ].includes(name),
            ),
        )
        const tools = validateGitHubTrackerCapabilities(contentOnly, config("issue"), "artifactProjection")
        assert.deepEqual(Object.keys(tools).sort(), ["issueRead", "issueWrite"])
    })

    it("validates Kind labels only for versioned artifacts", () => {
        const projectConfig = config("project")
        const projectTools = validateGitHubTrackerCapabilities(catalog(false), projectConfig)
        const projectSteps = buildGitHubRemoteValidationSteps(projectConfig, projectTools)
        assert.equal(projectSteps.length, 3)
        assert.doesNotMatch(projectSteps[0], /Kind|Type/)
        assert.match(projectSteps[1], /get_label.*Planning label/)
        assert.match(projectSteps[2], /get_label.*Kind: Epic.*Kind: Chore/)

        const issueConfig = config("issue")
        const issueTools = validateGitHubTrackerCapabilities(catalog(true), issueConfig)
        const issueSteps = buildGitHubRemoteValidationSteps(issueConfig, issueTools)
        assert.equal(issueSteps.length, 4)
        assert.match(issueSteps[1], /get_label.*Planning label/)
        assert.match(issueSteps[2], /get_label.*Kind: Epic.*Kind: Chore/)
        assert.match(issueSteps[3], /list_issue_fields/)

        const unversionedSteps = buildGitHubRemoteValidationSteps(projectConfig, projectTools, "unversioned")
        assert.equal(unversionedSteps.length, 2)
        assert.equal(unversionedSteps.some((step) => /configured Kind label/.test(step)), false)
    })

    it("returns the official sub-issue add operation without speculative schema requirements", () => {
        const cwd = temporaryProject()
        try {
            prepareWorkflowProject(cwd)
            fs.writeFileSync(
                path.join(cwd, ".project", "integrations.json"),
                JSON.stringify({ tracker: config("project"), forge: forgeConfig() }),
            )
            const context = buildIntegrationContext({ cwd } as ExtensionContext, catalog(false), "inspect")
            assert.equal(context.state, "enabled")
            const tracker = context.roles.tracker
            assert.equal(tracker?.state, "enabled")
            assert.equal(tracker?.provider, "github")
            if (!tracker || tracker.state !== "enabled" || tracker.provider !== "github") {
                assert.fail("expected enabled GitHub tracker")
            }
            assert.equal(tracker.methods.subIssueAdd, GITHUB_TRACKER_METHODS.subIssueAdd)
            assert.equal(tracker.methods.subIssueAdd, "add")
            assert.equal(context.roles.forge?.provider, "github")
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true })
        }
    })

    it("rejects a matching tool name whose schema lacks required operations", () => {
        const tools = new Map(catalog(false))
        tools.set(
            "mcp__github__projects_write",
            metadata(GITHUB_TOOL_NAMES.projectsWrite, ["owner", "project_number"], ["add_project_item"]),
        )
        assert.throws(
            () => validateGitHubTrackerCapabilities(tools, config("project")),
            /projects_write schema is missing:/,
        )
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
