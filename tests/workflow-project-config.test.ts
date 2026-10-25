import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"
import { linearPhases } from "./workflow-phase-fixtures.ts"

import { formatBranchName, validateRawId } from "../workflows/extensions/__lib/domain.ts"
import { inspectProjectMcp, registeredCredentialEnvironment } from "../workflows/extensions/integrations/mcp.ts"
import { configureProjectMcp, LOCAL_MCP_SETTINGS_EXCLUDE } from "../workflows/extensions/project-setup/mcp.ts"
import {
    configureProjectPermissions,
    LOCAL_PERMISSIONS_SETTINGS_EXCLUDE,
} from "../workflows/extensions/project-setup/permissions.ts"
import {
    assertArtifactPersistencePrepared,
    ENTITY_LOCAL_IGNORE,
    loadProjectConfig,
    LOCAL_PROJECT_CONFIG_EXCLUDE,
    prepareArtifactPersistence,
    resolveWorkflowProject,
    UNVERSIONED_PROJECT_EXCLUDE,
} from "../workflows/extensions/__lib/project-config.ts"
import { resolveLinearTrackerBranchRendererForInitialization } from "../workflows/extensions/integrations/tracker/linear.ts"
import registerProjectSetup, { inspectProjectSetup } from "../workflows/extensions/project-setup/index.ts"

function repository(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-project-config-"))
    git(root, ["init", "-b", "main"])
    git(root, ["config", "user.email", "test@example.com"])
    git(root, ["config", "user.name", "Test"])
    fs.writeFileSync(path.join(root, "README.md"), "test\n")
    git(root, ["add", "README.md"])
    git(root, ["commit", "-m", "initial"])
    return root
}

function writeConfig(root: string, input: unknown): void {
    fs.mkdirSync(path.join(root, ".project"), { recursive: true })
    fs.writeFileSync(path.join(root, ".project", "config.json"), JSON.stringify(input))
}

function writeWorkflowSettings(filePath: string, username: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify({ branches: { username } }))
}

function config(artifacts: "versioned" | "unversioned", branches: unknown = { format: "identifier-title" }) {
    return { artifacts, branches }
}

function git(root: string, args: string[]): string {
    return cp.execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim()
}

describe("workflow project configuration", () => {
    it("resolves a private global workflow source while preserving branch settings", () => {
        const root = repository()
        const globalSettingsPath = path.join(root, "workflows.json")
        const localSettingsPath = path.join(root, ".project/config.local.json")
        const options = { globalSettingsPath }
        try {
            writeConfig(root, config("versioned", { format: "username/identifier" }))
            assert.throws(
                () => resolveWorkflowProject(root, options),
                (error: Error) =>
                    error.message.includes("Set workflowProject") && error.message.includes(globalSettingsPath),
            )
            writeWorkflowSettings(globalSettingsPath, "global-user")
            assert.equal(loadProjectConfig(root, options).branches.username, "global-user")
            assert.throws(() => resolveWorkflowProject(root, options), /Set workflowProject/)

            fs.writeFileSync(globalSettingsPath, JSON.stringify({ workflowProject: root }))
            assert.equal(resolveWorkflowProject(root, options), fs.realpathSync(root))
            assert.throws(() => loadProjectConfig(root, options), /username is required/)
            writeWorkflowSettings(localSettingsPath, "local-user")
            assert.equal(loadProjectConfig(root, options).branches.username, "local-user")

            fs.writeFileSync(
                globalSettingsPath,
                JSON.stringify({ workflowProject: root, branches: { username: "global-user" } }),
            )
            assert.equal(loadProjectConfig(root, options).branches.username, "local-user")
            fs.rmSync(localSettingsPath)
            assert.equal(loadProjectConfig(root, options).branches.username, "global-user")

            fs.writeFileSync(
                localSettingsPath,
                JSON.stringify({ workflowProject: root, branches: { username: "local-user" } }),
            )
            assert.throws(() => loadProjectConfig(root, options), /must not have additional properties/)
            assert.equal(
                resolveWorkflowProject(root, options),
                fs.realpathSync(root),
                "source selection reads global settings only",
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("rejects invalid source settings and roots without writing configuration", () => {
        const root = repository()
        const globalSettingsPath = path.join(root, "workflows.json")
        const options = { globalSettingsPath }
        try {
            for (const content of [
                "not JSON",
                "{}",
                '{"extra":true}',
                '{"workflowProject":7}',
                '{"workflowProject":""}',
            ]) {
                fs.writeFileSync(globalSettingsPath, content)
                assert.throws(
                    () => resolveWorkflowProject(root, options),
                    (error: Error) => error.message.includes(globalSettingsPath),
                )
                assert.equal(fs.readFileSync(globalSettingsPath, "utf-8"), content)
            }
            const nested = path.join(root, "nested")
            fs.mkdirSync(nested)
            for (const workflowProject of [
                "relative/path",
                path.join(root, "missing"),
                path.join(root, "README.md"),
                nested,
            ]) {
                const content = JSON.stringify({ workflowProject })
                fs.writeFileSync(globalSettingsPath, content)
                assert.throws(
                    () => resolveWorkflowProject(root, options),
                    (error: Error) => error.message.includes(globalSettingsPath),
                )
                assert.equal(fs.readFileSync(globalSettingsPath, "utf-8"), content)
            }
            fs.writeFileSync(globalSettingsPath, JSON.stringify({ workflowProject: path.join(root, "README.md") }))
            assert.throws(() => resolveWorkflowProject(root, options), /path is not a directory/)
            const alias = path.join(root, "alias")
            fs.symlinkSync(root, alias, "dir")
            fs.writeFileSync(globalSettingsPath, JSON.stringify({ workflowProject: alias }))
            assert.equal(resolveWorkflowProject(root, options), fs.realpathSync(root))
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("loads operational Markdown dependencies from workflow references", () => {
        const skill = fs.readFileSync("workflows/skills/project-setup/SKILL.md", "utf-8")
        const markdownDependencies = [
            ...[...skill.matchAll(/`(\.\.\/\.\.\/[^`\n]+\.md)`/g)].map((match) => match[1]),
            ...[...skill.matchAll(/\]\((\.\.\/\.\.\/[^)#\s]+\.md)(?:#[^)]*)?\)/g)].map((match) => match[1]),
        ]

        assert.ok(markdownDependencies.length > 0)
        assert.ok(markdownDependencies.every((dependency) => dependency.startsWith("../../references/")))
        assert.ok(markdownDependencies.includes("../../references/setup.md"))
    })

    it("starts guided setup without creating artifacts", async () => {
        const root = repository()
        let sent = ""
        let setup:
            | { handler: (args: string, ctx: { cwd: string; isProjectTrusted(): boolean }) => Promise<void> }
            | undefined
        const tools: string[] = []
        const pi = {
            events: { on: () => () => {} },
            on() {},
            registerCommand: (name: string, command: typeof setup) => {
                if (name === "project-setup") setup = command
            },
            registerTool: (tool: { name: string }) => tools.push(tool.name),
            sendUserMessage: (message: string) => {
                sent = message
            },
        } as unknown as ExtensionAPI
        try {
            fs.mkdirSync(path.join(root, ".agents"))
            fs.writeFileSync(
                path.join(root, ".agents", "mcp.json"),
                JSON.stringify({
                    mcpServers: {
                        existing: {
                            url: "https://example.com/mcp",
                            headers: { Authorization: "Bearer top-secret" },
                        },
                    },
                }),
            )
            registerProjectSetup(pi)
            assert.ok(setup)
            assert.ok(tools.includes("inspect_project_setup"))
            assert.ok(tools.includes("configure_mcp"))
            assert.ok(tools.includes("configure_permissions"))
            assert.ok(tools.includes("inspect_permissions"))
            assert.ok(tools.includes("inspect_linear_workspace"))
            assert.ok(tools.includes("inspect_github_project_setup"))
            assert.ok(tools.includes("preview_github_project_setup"))
            assert.ok(tools.includes("apply_github_project_setup"))
            await setup.handler("Use unversioned artifact mode", { cwd: root, isProjectTrusted: () => true })
            assert.match(sent, /Use unversioned artifact mode/)
            assert.match(sent, /Use the project-setup skill/)
            assert.match(sent, /"repositoryRoot":/)
            assert.match(sent, /"path": "\.project\/config\.json"/)
            assert.match(sent, /"path": "\.project\/config\.local\.json"/)
            assert.match(sent, /"globalWorkflowSettings":/)
            assert.match(sent, /"path": "\.agents\/permissions\.local\.json"/)
            assert.match(sent, /"name": "existing"/)
            assert.match(sent, /"boundEntityTrackers": \[\]/)
            assert.match(sent, /"projectPathsInGit": \[\]/)
            assert.doesNotMatch(sent, /top-secret|defaultBranch/)
            assert.equal(fs.existsSync(path.join(root, ".project")), false)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("extracts only safe GitHub identities from fetch remotes without changing Git state", () => {
        const root = repository()
        try {
            assert.deepEqual(inspectProjectSetup(root, true).repositoryIdentity.githubCandidates, [])
            const remotes = [
                [
                    "origin",
                    "https://user:remote-secret@github.com/Owner/Example.git?token=query-secret#fragment-secret",
                ],
                ["ssh", "git@github.com:owner/example.git"],
                ["url", "ssh://git@github.com/Owner/Example.git"],
                ["upstream", "https://github.com/Upstream/Example"],
                ["other", "https://private-secret.example/hidden-secret/repo"],
                ["alias", "git@github-personal:hidden-secret/repo"],
                ["local", "/tmp/private-secret/repo"],
            ]
            for (const [name, url] of remotes) git(root, ["remote", "add", name, url])
            git(root, ["remote", "set-url", "--push", "origin", "https://github.com/PushOnly/Example.git"])
            const before = fs.readFileSync(path.join(root, ".git/config"))
            const index = git(root, ["ls-files", "--stage"])
            const snapshot = inspectProjectSetup(root, true)
            assert.deepEqual(snapshot.repositoryIdentity.githubCandidates, [
                { owner: "Owner", repo: "Example", remotes: ["origin", "ssh", "url"] },
                { owner: "Upstream", repo: "Example", remotes: ["upstream"] },
            ])
            assert.doesNotMatch(
                JSON.stringify(snapshot),
                /remote-secret|query-secret|fragment-secret|private-secret|hidden-secret|PushOnly|defaultBranch/,
            )
            assert.deepEqual(fs.readFileSync(path.join(root, ".git/config")), before)
            assert.equal(git(root, ["ls-files", "--stage"]), index)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    for (const scenario of [
        { name: "missing", project: undefined, integrations: undefined },
        { name: "existing", project: JSON.stringify(config("versioned")), integrations: undefined },
        { name: "incompatible", project: '{"unsupported":true}', integrations: '{"tracker":{"provider":"github"}}' },
        { name: "malformed", project: "{ not JSON", integrations: "{ broken" },
    ]) {
        it(`shares a read-only command/tool snapshot with ${scenario.name} setup`, async () => {
            const root = repository()
            git(root, ["remote", "add", "origin", "https://snapshot-secret@github.com/owner/example.git"])
            type Tool = Parameters<ExtensionAPI["registerTool"]>[0]
            const tools = new Map<string, Tool>()
            let setup:
                | { handler: (args: string, ctx: { cwd: string; isProjectTrusted(): boolean }) => Promise<void> }
                | undefined
            let sent = ""
            const pi = {
                events: { on: () => () => {} },
                on() {},
                registerCommand: (name: string, command: typeof setup) => {
                    if (name === "project-setup") setup = command
                },
                registerTool: (tool: Tool) => tools.set(tool.name, tool),
                sendUserMessage: (message: string) => {
                    sent = message
                },
            } as unknown as ExtensionAPI
            try {
                fs.mkdirSync(path.join(root, ".agents"))
                fs.writeFileSync(
                    path.join(root, ".agents/mcp.json"),
                    JSON.stringify({
                        mcpServers: {
                            "setup-github": {
                                url: "https://api.githubcopilot.com/mcp/",
                                headers: { Authorization: "Bearer ${PROJECT_SETUP_GITHUB_TOKEN}" },
                            },
                            "setup-linear": {
                                url: "https://mcp.linear.app/mcp",
                                headers: { Authorization: "Bearer ${SETUP_LINEAR_TOKEN}" },
                            },
                            "setup-custom": {
                                url: "https://example.com/mcp",
                                headers: { Authorization: "Bearer literal-setup-secret" },
                            },
                        },
                    }),
                )
                fs.writeFileSync(
                    path.join(root, ".agents/mcp.local.json"),
                    JSON.stringify({
                        mcpServers: {
                            "setup-github": {
                                url: "https://api.githubcopilot.com/mcp/",
                                headers: { Authorization: "Bearer ${LOCAL_SETUP_GITHUB_TOKEN}" },
                            },
                        },
                    }),
                )
                if (scenario.project !== undefined) {
                    fs.mkdirSync(path.join(root, ".project"))
                    fs.writeFileSync(path.join(root, ".project/config.json"), scenario.project)
                }
                if (scenario.integrations !== undefined)
                    fs.writeFileSync(path.join(root, ".project/integrations.json"), scenario.integrations)
                if (scenario.name === "existing") {
                    fs.mkdirSync(path.join(root, ".project/gigs/example"), { recursive: true })
                    fs.writeFileSync(
                        path.join(root, ".project/gigs/example/metadata.json"),
                        JSON.stringify({
                            id: "GIG-01KDVDNA00",
                            integrations: [
                                { role: "tracker", provider: "github", state: "bound", external: { issueNumber: 2 } },
                            ],
                        }),
                    )
                    git(root, ["add", ".project/config.json"])
                }
                const observedPaths = [
                    ".git/index",
                    ".git/info/exclude",
                    ".agents/mcp.json",
                    ".agents/mcp.local.json",
                    ".project/config.json",
                    ".project/integrations.json",
                ]
                const fileContents = () =>
                    observedPaths.map((file) =>
                        fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : null,
                    )
                const statusBefore = git(root, ["status", "--porcelain=v1"])
                const indexBefore = git(root, ["ls-files", "--stage"])
                const filesBefore = fileContents()
                registerProjectSetup(pi)
                const tool = tools.get("inspect_project_setup")
                assert.ok(tool)
                assert.ok(setup)
                assert.equal(Value.Check(tool.parameters, {}), true)
                assert.equal(Value.Check(tool.parameters, { unexpected: true }), false)
                const inspected = await tool.execute("inspect", {}, undefined, undefined, {
                    cwd: root,
                    isProjectTrusted: () => true,
                } as never)
                assert.equal(sent, "", "inspection must not inject a user message")
                const snapshot = inspected.details as ReturnType<typeof inspectProjectSetup>
                const text = inspected.content.map((block) => (block.type === "text" ? block.text : "")).join("\n")
                assert.deepEqual(JSON.parse(text), snapshot)
                assert.equal(snapshot.repositoryRoot, fs.realpathSync(root))
                const projectFile = snapshot.files.find((file) => file.path === ".project/config.json")
                const integrationFile = snapshot.files.find((file) => file.path === ".project/integrations.json")
                assert.equal(projectFile?.exists ? projectFile.content : undefined, scenario.project)
                assert.equal(integrationFile?.exists ? integrationFile.content : undefined, scenario.integrations)
                assert.equal(
                    snapshot.mcp.effectiveServers.find((server) => server.name === "setup-github")?.credentialEnv,
                    "LOCAL_SETUP_GITHUB_TOKEN",
                )
                assert.equal(
                    snapshot.mcp.effectiveServers.find((server) => server.name === "setup-linear")?.credentialEnv,
                    "SETUP_LINEAR_TOKEN",
                )
                assert.doesNotMatch(text, /literal-setup-secret/)
                assert.doesNotMatch(JSON.stringify(snapshot), /literal-setup-secret/)
                if (scenario.name === "existing") {
                    assert.equal(snapshot.boundEntityTrackers[0].id, "GIG-01KDVDNA00")
                    assert.ok(snapshot.projectPathsInGit.includes(".project/config.json"))
                    assert.ok(snapshot.stagedProjectPaths.includes(".project/config.json"))
                }
                await setup.handler("Inspect existing setup", { cwd: root, isProjectTrusted: () => true })
                const prefix = "Read-only setup context:\n"
                const start = sent.indexOf(prefix) + prefix.length
                const end = sent.indexOf("\n\nUse the project-setup skill.", start)
                assert.ok(start >= prefix.length && end > start)
                assert.deepEqual(JSON.parse(sent.slice(start, end)), snapshot)
                assert.doesNotMatch(sent, /literal-setup-secret/)
                assert.deepEqual(fileContents(), filesBefore)
                assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)
                assert.equal(git(root, ["status", "--porcelain=v1"]), statusBefore)
                assert.equal(fs.existsSync(path.join(root, ".project")), scenario.project !== undefined)
            } finally {
                fs.rmSync(root, { recursive: true, force: true })
            }
        })
    }

    it("reports reusable official MCP credential environment references without exposing values", () => {
        const root = repository()
        try {
            fs.mkdirSync(path.join(root, ".agents"))
            fs.writeFileSync(
                path.join(root, ".agents", "mcp.json"),
                JSON.stringify({
                    mcpServers: {
                        linear: {
                            url: "https://mcp.linear.app/mcp",
                            headers: { Authorization: "Bearer ${LINEAR_SETUP_KEY}" },
                        },
                        custom: {
                            url: "https://example.com/mcp",
                            headers: { Authorization: "Bearer literal-secret" },
                        },
                    },
                }),
            )

            const inspected = inspectProjectMcp(root, true)
            assert.deepEqual(
                inspected.effectiveServers.find((server) => server.name === "linear"),
                {
                    name: "linear",
                    source: "project",
                    provider: "linear",
                    credentialEnv: "LINEAR_SETUP_KEY",
                },
            )
            assert.deepEqual(
                inspected.effectiveServers.find((server) => server.name === "custom"),
                {
                    name: "custom",
                    source: "project",
                },
            )
            assert.doesNotMatch(JSON.stringify(inspected), /literal-secret/)
            assert.equal(registeredCredentialEnvironment(root, "linear", "linear", true), "LINEAR_SETUP_KEY")
            assert.throws(
                () => registeredCredentialEnvironment(root, "custom", "linear", true),
                /not a recognized linear registration/,
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("resolves Linear tracker Epic branches from current API viewer and template data", async () => {
        const root = repository()
        try {
            fs.writeFileSync(path.join(root, ".gitignore"), `${ENTITY_LOCAL_IGNORE}\n`)
            writeConfig(root, config("versioned", { format: "tracker" }))
            fs.writeFileSync(
                path.join(root, ".project", "integrations.json"),
                JSON.stringify({
                    tracker: {
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
                                done: "Completed",
                                canceled: "Canceled",
                            },
                        },
                    },
                }),
            )
            fs.mkdirSync(path.join(root, ".agents"))
            fs.writeFileSync(
                path.join(root, ".agents", "mcp.json"),
                JSON.stringify({
                    mcpServers: {
                        linear: {
                            url: "https://mcp.linear.app/mcp",
                            headers: { Authorization: "Bearer ${LINEAR_BRANCH_KEY}" },
                        },
                    },
                }),
            )
            const fetch = async () =>
                new Response(
                    JSON.stringify({
                        data: {
                            viewer: { id: "viewer-1", name: "Alex Example", displayName: "alex" },
                            organization: {
                                id: "workspace-1",
                                name: "Acme",
                                urlKey: "acme",
                                gitBranchFormat: "{username}/{issueIdentifier}-{issueTitle}",
                                projectStatuses: [],
                            },
                        },
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                )
            const renderTrackerBranch = await resolveLinearTrackerBranchRendererForInitialization(
                root,
                true,
                {
                    entity: "epic",
                    title: "Linear Epic",
                    slug: "linear-epic",
                    request: "Plan Linear work",
                    priority: "High",
                    source: { mode: "new" },
                },
                undefined,
                { fetch, env: { LINEAR_BRANCH_KEY: "secret" } },
            )
            assert.ok(renderTrackerBranch)
            assert.equal(
                renderTrackerBranch({ entity: "epic", rawId: "01KDVDNA00", slug: "linear-epic" }),
                "alex/epic-01kdvdna00-linear-epic",
            )
            assert.equal(fs.existsSync(path.join(root, ".project", "config.local.json")), false)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("adds approved MCP registrations without credentials or index changes", () => {
        const root = repository()
        const globalSettingsPath = path.join(root, "global-mcp.json")
        try {
            fs.mkdirSync(path.join(root, ".agents"))
            fs.writeFileSync(
                path.join(root, ".agents", "mcp.local.json"),
                `${JSON.stringify({ mcpServers: { existing: { command: "noop" } }, preserved: true }, null, 4)}\n`,
            )
            const indexBefore = git(root, ["ls-files", "--stage"])

            const configured = configureProjectMcp(
                root,
                {
                    target: "local",
                    registrations: [
                        {
                            provider: "linear",
                            name: "linear-workflow",
                            credentialEnv: "LINEAR_WORKFLOW_TOKEN",
                        },
                        {
                            provider: "github",
                            name: "github-workflow",
                            credentialEnv: "GITHUB_WORKFLOW_TOKEN",
                            roles: ["tracker", "forge"],
                        },
                    ],
                },
                { globalSettingsPath },
            )

            assert.deepEqual(configured.changed, ["local"])
            assert.equal(configured.restartRequired, true)
            assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)
            assert.doesNotThrow(() => git(root, ["check-ignore", "-q", ".agents/mcp.local.json"]))
            assert.ok(
                fs
                    .readFileSync(path.join(root, ".git", "info", "exclude"), "utf-8")
                    .split(/\r?\n/)
                    .includes(LOCAL_MCP_SETTINGS_EXCLUDE),
            )

            const local = JSON.parse(fs.readFileSync(path.join(root, ".agents", "mcp.local.json"), "utf-8"))
            assert.equal(local.preserved, true)
            assert.deepEqual(local.mcpServers.existing, { command: "noop" })
            assert.deepEqual(local.mcpServers["linear-workflow"], {
                url: "https://mcp.linear.app/mcp",
                headers: { Authorization: "Bearer ${LINEAR_WORKFLOW_TOKEN}" },
            })

            assert.deepEqual(local.mcpServers["github-workflow"], {
                url: "https://api.githubcopilot.com/mcp/",
                headers: {
                    Authorization: "Bearer ${GITHUB_WORKFLOW_TOKEN}",
                    "X-MCP-Toolsets": "issues,projects,pull_requests",
                },
            })

            const committed = configureProjectMcp(
                root,
                {
                    target: "project",
                    registrations: [
                        {
                            provider: "github",
                            name: "github-committed",
                            credentialEnv: "GITHUB_WORKFLOW_TOKEN",
                            roles: ["forge"],
                        },
                    ],
                },
                { globalSettingsPath },
            )
            assert.deepEqual(committed.changed, ["project"])
            const project = JSON.parse(fs.readFileSync(path.join(root, ".agents", "mcp.json"), "utf-8"))
            assert.deepEqual(project.mcpServers["github-committed"], {
                url: "https://api.githubcopilot.com/mcp/",
                headers: {
                    Authorization: "Bearer ${GITHUB_WORKFLOW_TOKEN}",
                    "X-MCP-Toolsets": "pull_requests",
                },
            })
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("adds approved permission gates without replacing settings or changing the Git index", () => {
        const root = repository()
        try {
            const settingsPath = path.join(root, ".agents", "permissions.local.json")
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
            fs.writeFileSync(
                settingsPath,
                `${JSON.stringify(
                    {
                        defaultMode: "deny",
                        allow: ["read"],
                        ask: ["write(existing.md)"],
                        keybindings: { autoAcceptEdits: "ctrl+shift+a" },
                    },
                    null,
                    4,
                )}\n`,
            )
            const indexBefore = git(root, ["ls-files", "--stage"])
            const rules = ["write(.project/*/plan.md)", "edit(.project/*/plan.md)"]

            const configured = configureProjectPermissions(root, { target: "local", allow: [], ask: rules }, new Map())

            assert.deepEqual(configured.added, { allow: [], ask: rules })
            assert.equal(configured.changed, true)
            assert.equal(configured.localExclusionChanged, true)
            assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)
            assert.doesNotThrow(() => git(root, ["check-ignore", "-q", ".agents/permissions.local.json"]))
            assert.ok(
                fs
                    .readFileSync(path.join(root, ".git", "info", "exclude"), "utf-8")
                    .split(/\r?\n/)
                    .includes(LOCAL_PERMISSIONS_SETTINGS_EXCLUDE),
            )

            const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
            assert.equal(settings.defaultMode, "deny")
            assert.deepEqual(settings.allow, ["read"])
            assert.deepEqual(settings.ask, ["write(existing.md)", ...rules])
            assert.deepEqual(settings.keybindings, { autoAcceptEdits: "ctrl+shift+a" })

            assert.deepEqual(configureProjectPermissions(root, { target: "local", allow: [], ask: rules }, new Map()), {
                target: "local",
                file: ".agents/permissions.local.json",
                added: { allow: [], ask: [] },
                skipped: { allow: [], ask: rules },
                inspection: [],
                changed: false,
                localExclusionChanged: false,
            })
            assert.throws(
                () =>
                    configureProjectPermissions(
                        root,
                        { target: "project", allow: [], ask: ["mcp__github__issue_read"] },
                        new Map(),
                    ),
                /legacy mcp__ rules are not supported/,
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("requires strict explicit configuration", () => {
        const root = repository()
        const globalSettingsPath = path.join(root, "global-workflows.json")
        try {
            assert.throws(
                () => loadProjectConfig(root, { globalSettingsPath }),
                /missing required \.project\/config\.json/,
            )
            writeConfig(root, { ...config("versioned"), extra: true })
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /must not have additional properties/)
            writeConfig(root, config("versioned", { format: "feature/identifier" }))
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /invalid \.project\/config\.json/)
            writeConfig(root, config("versioned", { format: "identifier", username: "alex" }))
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /must not have additional properties/)
            writeConfig(root, config("versioned", { format: { epic: "identifier", deliverable: "tracker" } }))
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /invalid \.project\/config\.json/)

            writeConfig(root, config("versioned"))
            assert.equal(loadProjectConfig(root, { globalSettingsPath }).reviews, undefined)
            writeConfig(root, { ...config("versioned"), reviews: { userConfirmationAfter: 3 } })
            assert.deepEqual(loadProjectConfig(root, { globalSettingsPath }).reviews, { userConfirmationAfter: 3 })
            for (const reviews of [
                {},
                false,
                { userConfirmationAfter: 0 },
                { userConfirmationAfter: 1.5 },
                { userConfirmationAfter: 3, extra: true },
            ]) {
                writeConfig(root, { ...config("versioned"), reviews })
                assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /invalid \.project\/config\.json/)
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("resolves branch username from strict local and global settings", () => {
        const root = repository()
        const globalSettingsPath = path.join(root, "global-workflows.json")
        const localSettingsPath = path.join(root, ".project", "config.local.json")
        try {
            writeConfig(root, config("versioned", { format: "tracker" }))
            fs.writeFileSync(localSettingsPath, "not json")
            assert.equal(loadProjectConfig(root, { globalSettingsPath }).branches.username, undefined)
            fs.rmSync(localSettingsPath)

            writeConfig(root, config("versioned", { format: "username/identifier" }))
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /username is required/)

            writeWorkflowSettings(globalSettingsPath, "global-user")
            assert.equal(loadProjectConfig(root, { globalSettingsPath }).branches.username, "global-user")

            writeWorkflowSettings(localSettingsPath, "alex")
            const configured = loadProjectConfig(root, { globalSettingsPath })
            assert.equal(configured.branches.format, "username/identifier")
            assert.equal(configured.branches.username, "alex")

            fs.writeFileSync(path.join(root, ".gitignore"), `${ENTITY_LOCAL_IGNORE}\n`)
            prepareArtifactPersistence(root)
            assert.ok(
                fs
                    .readFileSync(path.join(root, ".git", "info", "exclude"), "utf-8")
                    .split(/\r?\n/)
                    .includes(LOCAL_PROJECT_CONFIG_EXCLUDE),
            )
            assert.doesNotMatch(fs.readFileSync(path.join(root, ".project", "config.json"), "utf-8"), /alex/)

            fs.writeFileSync(localSettingsPath, JSON.stringify({ branches: { username: "alex" }, extra: true }))
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /must not have additional properties/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("renders every generated branch format exactly", () => {
        const identity = {
            entity: "task" as const,
            rawId: validateRawId("01KDVDNA01"),
            slug: "first-task",
        }
        const identifier = "task-01kdvdna01"
        const cases = [
            ["username/identifier-title", `alex/${identifier}-first-task`],
            ["username/identifier", `alex/${identifier}`],
            ["username-identifier-title", `alex-${identifier}-first-task`],
            ["username-identifier", `alex-${identifier}`],
            ["identifier-title", `${identifier}-first-task`],
            ["title-identifier", `first-task-${identifier}`],
            ["identifier", identifier],
        ] as const
        for (const [format, expected] of cases) {
            assert.equal(
                formatBranchName(identity, format, format.startsWith("username") ? "alex" : undefined),
                expected,
            )
        }
    })

    it("requires the versioned local-state gitignore rule without changing the index", () => {
        const root = repository()
        try {
            writeConfig(root, config("versioned"))
            const indexBefore = git(root, ["ls-files", "--stage"])
            assert.throws(() => prepareArtifactPersistence(root), /versioned artifacts require .*\.local.*\.gitignore/)
            assert.throws(
                () => assertArtifactPersistencePrepared(root),
                /versioned artifacts require .*\.local.*\.gitignore/,
            )
            assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)

            fs.writeFileSync(path.join(root, ".gitignore"), `${ENTITY_LOCAL_IGNORE}\n`)
            assert.equal(prepareArtifactPersistence(root).mode, "versioned")
            assert.equal(assertArtifactPersistencePrepared(root).artifacts, "versioned")
            assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("asserts missing exclusions without writing and prepares the same inspected requirements", () => {
        for (const mode of ["versioned", "unversioned"] as const) {
            const root = repository()
            try {
                writeConfig(root, config(mode))
                if (mode === "versioned") {
                    fs.writeFileSync(path.join(root, ".gitignore"), `${ENTITY_LOCAL_IGNORE}\n`)
                    writeWorkflowSettings(path.join(root, ".project", "config.local.json"), "alex")
                }
                const exclude = path.join(root, ".git", "info", "exclude")
                const before = fs.readFileSync(exclude, "utf-8")
                assert.throws(() => assertArtifactPersistencePrepared(root), /not prepared/)
                assert.equal(fs.readFileSync(exclude, "utf-8"), before)
                assert.equal(prepareArtifactPersistence(root).mode, mode)
                assert.equal(assertArtifactPersistencePrepared(root).artifacts, mode)
            } finally {
                fs.rmSync(root, { recursive: true, force: true })
            }
        }
    })

    it("prepares the unversioned exclusion once without changing the index", () => {
        const root = repository()
        try {
            writeConfig(root, config("unversioned"))
            const indexBefore = git(root, ["ls-files", "--stage"])
            prepareArtifactPersistence(root)
            prepareArtifactPersistence(root)
            assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)
            assert.equal(git(root, ["status", "--porcelain"]), "")
            assert.equal(
                fs
                    .readFileSync(path.join(root, ".git", "info", "exclude"), "utf-8")
                    .split(/\r?\n/)
                    .filter((line) => line === UNVERSIONED_PROJECT_EXCLUDE).length,
                1,
            )
            assert.equal(assertArtifactPersistencePrepared(root).artifacts, "unversioned")
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("rejects unversioned artifacts in Git and requires manual versioned-mode reversal", () => {
        const root = repository()
        try {
            writeConfig(root, config("unversioned"))
            git(root, ["add", ".project/config.json"])
            const indexBefore = git(root, ["ls-files", "--stage"])
            assert.throws(() => prepareArtifactPersistence(root), /in Git or staged/)
            assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)

            git(root, ["reset", "--", ".project/config.json"])
            fs.appendFileSync(path.join(root, ".git", "info", "exclude"), `\n${UNVERSIONED_PROJECT_EXCLUDE}\n`)
            writeConfig(root, config("versioned"))
            assert.throws(() => prepareArtifactPersistence(root), /remove it manually/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("rejects entity-local state in Git", () => {
        const root = repository()
        try {
            writeConfig(root, config("versioned"))
            fs.writeFileSync(path.join(root, ".gitignore"), `${ENTITY_LOCAL_IGNORE}\n`)
            const localDir = path.join(root, ".project", "gigs", "example", ".local")
            fs.mkdirSync(localDir, { recursive: true })
            fs.writeFileSync(path.join(localDir, "status.md"), "# Status\n")
            git(root, ["add", "-f", ".project/gigs/example/.local/status.md"])
            assert.throws(() => prepareArtifactPersistence(root), /entity \.local directories must remain outside Git/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("rejects a staged deletion without changing the index", () => {
        const root = repository()
        try {
            writeConfig(root, config("versioned"))
            git(root, ["add", ".project/config.json"])
            git(root, ["commit", "-m", "add project config to Git"])
            writeConfig(root, config("unversioned"))
            git(root, ["rm", "--cached", ".project/config.json"])
            const indexBefore = git(root, ["diff", "--cached", "--raw"])

            assert.throws(() => prepareArtifactPersistence(root), /in Git or staged/)
            assert.equal(git(root, ["diff", "--cached", "--raw"]), indexBefore)
            assert.equal(fs.existsSync(path.join(root, ".project", "config.json")), true)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
