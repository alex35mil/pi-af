import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"

import { inspectProjectMcp, registeredCredentialEnvironment } from "../workflows/extensions/integrations/mcp.ts"
import { configureProjectMcp, LOCAL_MCP_SETTINGS_EXCLUDE } from "../workflows/extensions/project-setup/mcp.ts"
import {
    configureProjectPermissions,
    LOCAL_PERMISSIONS_SETTINGS_EXCLUDE,
} from "../workflows/extensions/project-setup/permissions.ts"
import {
    assertArtifactPersistencePrepared,
    assertSandboxArtifactsLinked,
    loadProjectConfig,
    LOCAL_PROJECT_CONFIG_EXCLUDE,
    LEGACY_PROJECT_LOCAL_IGNORE,
    prepareArtifactPersistence,
    PROJECT_LOCAL_IGNORE,
    resolveWorkflowProject,
} from "../workflows/extensions/__lib/project-config.ts"
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

function config(branches: unknown = { format: "identifier-title" }) {
    return { branches }
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
            writeConfig(root, config({ format: "username/identifier-title" }))
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
            await setup.handler("Configure workflows", { cwd: root, isProjectTrusted: () => true })
            assert.match(sent, /Configure workflows/)
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

    it("tells setup whether to append, replace, or keep the project-local ignore rule", () => {
        const root = repository()
        try {
            const ignore = () => inspectProjectSetup(root, true).projectLocalIgnore
            assert.deepEqual(ignore(), { state: "append", rule: PROJECT_LOCAL_IGNORE })
            fs.writeFileSync(path.join(root, ".gitignore"), `node_modules/\n${LEGACY_PROJECT_LOCAL_IGNORE}\n`)
            assert.deepEqual(ignore(), {
                state: "replace",
                from: LEGACY_PROJECT_LOCAL_IGNORE,
                rule: PROJECT_LOCAL_IGNORE,
            })
            fs.writeFileSync(path.join(root, ".gitignore"), `${PROJECT_LOCAL_IGNORE}\n`)
            assert.deepEqual(ignore(), { state: "present", rule: PROJECT_LOCAL_IGNORE })
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    for (const scenario of [
        { name: "missing", project: undefined, integrations: undefined },
        { name: "existing", project: JSON.stringify(config()), integrations: undefined },
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
                    fs.mkdirSync(path.join(root, ".project/.local/gigs/example"), { recursive: true })
                    fs.writeFileSync(
                        path.join(root, ".project/.local/gigs/example/metadata.json"),
                        JSON.stringify({
                            tracker: { provider: "github", external: { issueNumber: 2 } },
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
                    assert.deepEqual(snapshot.boundEntityTrackers, [
                        {
                            path: ".project/.local/gigs/example/metadata.json",
                            entity: "example",
                            provider: "github",
                            reference: "#2",
                        },
                    ])
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
            writeConfig(root, { ...config(), extra: true })
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /must not have additional properties/)
            writeConfig(root, config({ format: "feature/identifier" }))
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /invalid \.project\/config\.json/)
            writeConfig(root, config({ format: "identifier-title", username: "alex" }))
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /must not have additional properties/)
            writeConfig(root, config({ format: { epic: "identifier", deliverable: "tracker" } }))
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /invalid \.project\/config\.json/)

            writeConfig(root, config())
            assert.equal(loadProjectConfig(root, { globalSettingsPath }).reviews, undefined)
            writeConfig(root, { ...config(), reviews: { userConfirmationAfter: 3 } })
            assert.deepEqual(loadProjectConfig(root, { globalSettingsPath }).reviews, { userConfirmationAfter: 3 })
            for (const reviews of [
                {},
                false,
                { userConfirmationAfter: 0 },
                { userConfirmationAfter: 1.5 },
                { userConfirmationAfter: 3, extra: true },
            ]) {
                writeConfig(root, { ...config(), reviews })
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
            writeConfig(root, config({ format: "tracker" }))
            fs.writeFileSync(localSettingsPath, "not json")
            assert.equal(loadProjectConfig(root, { globalSettingsPath }).branches.username, undefined)
            fs.rmSync(localSettingsPath)

            writeConfig(root, config({ format: "username/identifier-title" }))
            assert.throws(() => loadProjectConfig(root, { globalSettingsPath }), /username is required/)

            writeWorkflowSettings(globalSettingsPath, "global-user")
            assert.equal(loadProjectConfig(root, { globalSettingsPath }).branches.username, "global-user")

            writeWorkflowSettings(localSettingsPath, "alex")
            const configured = loadProjectConfig(root, { globalSettingsPath })
            assert.equal(configured.branches.format, "username/identifier-title")
            assert.equal(configured.branches.username, "alex")

            fs.writeFileSync(path.join(root, ".gitignore"), `${PROJECT_LOCAL_IGNORE}\n`)
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

    it("requires the project-local gitignore rule without changing the index", () => {
        const root = repository()
        try {
            writeConfig(root, config())
            const indexBefore = git(root, ["ls-files", "--stage"])
            assert.throws(() => prepareArtifactPersistence(root), /\/\.project\/\.local in \.gitignore/)
            assert.throws(() => assertArtifactPersistencePrepared(root), /\/\.project\/\.local in \.gitignore/)
            assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)

            fs.writeFileSync(path.join(root, ".gitignore"), `${PROJECT_LOCAL_IGNORE}\n`)
            assert.equal(prepareArtifactPersistence(root).state, "ready")
            assertArtifactPersistencePrepared(root)
            assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("accepts the committed ignore rule for a missing, real, or linked local root", () => {
        type Shape = "missing" | "directory" | "symlink"
        const cases: { rule: string; shape: Shape; ok: boolean }[] = [
            { rule: LEGACY_PROJECT_LOCAL_IGNORE, shape: "missing", ok: true },
            { rule: LEGACY_PROJECT_LOCAL_IGNORE, shape: "directory", ok: true },
            { rule: LEGACY_PROJECT_LOCAL_IGNORE, shape: "symlink", ok: false },
            { rule: PROJECT_LOCAL_IGNORE, shape: "missing", ok: true },
            { rule: PROJECT_LOCAL_IGNORE, shape: "directory", ok: true },
            { rule: PROJECT_LOCAL_IGNORE, shape: "symlink", ok: true },
        ]
        for (const { rule, shape, ok } of cases) {
            const root = repository()
            const source = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-local-source-"))
            try {
                writeConfig(root, config())
                fs.writeFileSync(path.join(root, ".gitignore"), `${rule}\n`)
                const local = path.join(root, ".project", ".local")
                if (shape === "directory") fs.mkdirSync(local)
                if (shape === "symlink") fs.symlinkSync(source, local)
                if (ok) assert.equal(prepareArtifactPersistence(root).state, "ready", `${rule} ${shape}`)
                else
                    assert.throws(
                        () => prepareArtifactPersistence(root),
                        /symlink.*no trailing slash/,
                        `${rule} ${shape}`,
                    )
            } finally {
                fs.rmSync(root, { recursive: true, force: true })
                fs.rmSync(source, { recursive: true, force: true })
            }
        }
    })

    it("ignores local excludes when checking for the committed ignore rule", () => {
        const root = repository()
        try {
            writeConfig(root, config())
            fs.appendFileSync(path.join(root, ".git", "info", "exclude"), `${PROJECT_LOCAL_IGNORE}\n`)
            assert.throws(() => prepareArtifactPersistence(root), /in \.gitignore/)
            fs.writeFileSync(path.join(root, "global-ignore"), `${PROJECT_LOCAL_IGNORE}\n`)
            git(root, ["config", "core.excludesFile", path.join(root, "global-ignore")])
            assert.throws(() => prepareArtifactPersistence(root), /in \.gitignore/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("revalidates when the local root changes from a directory to a symlink", () => {
        const root = repository()
        const source = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-local-source-"))
        try {
            writeConfig(root, config())
            fs.writeFileSync(path.join(root, ".gitignore"), `${LEGACY_PROJECT_LOCAL_IGNORE}\n`)
            const local = path.join(root, ".project", ".local")
            fs.mkdirSync(local)
            assertArtifactPersistencePrepared(root)
            fs.rmSync(local, { recursive: true })
            fs.symlinkSync(source, local)
            assert.throws(() => assertArtifactPersistencePrepared(root), /symlink/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
            fs.rmSync(source, { recursive: true, force: true })
        }
    })

    it("creates a missing project-local folder once the ignore rule is in place", () => {
        const root = repository()
        try {
            writeConfig(root, config())
            const local = path.join(root, ".project", ".local")
            assert.throws(() => prepareArtifactPersistence(root), /in \.gitignore/)
            assert.equal(fs.existsSync(local), false)
            fs.writeFileSync(path.join(root, ".gitignore"), `${PROJECT_LOCAL_IGNORE}\n`)
            prepareArtifactPersistence(root)
            assert.ok(fs.statSync(local).isDirectory())
            assert.equal(git(root, ["status", "--porcelain", "--untracked-files=all", "--", ".project/.local"]), "")
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("requires a linked project-local folder only in the sandbox runtime", () => {
        const root = repository()
        const source = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-local-source-"))
        const previous = process.env.PI_AF_RUNTIME
        try {
            writeConfig(root, config())
            fs.writeFileSync(path.join(root, ".gitignore"), `${PROJECT_LOCAL_IGNORE}\n`)
            const local = path.join(root, ".project", ".local")

            delete process.env.PI_AF_RUNTIME
            assertSandboxArtifactsLinked(root)
            fs.mkdirSync(local)
            assertSandboxArtifactsLinked(root)

            process.env.PI_AF_RUNTIME = "sandbox"
            assert.throws(() => assertSandboxArtifactsLinked(root), /isn't linked to its source checkout/)
            fs.rmSync(local, { recursive: true })
            assert.throws(() => assertSandboxArtifactsLinked(root), /isn't linked to its source checkout/)
            fs.symlinkSync(path.join(source, "missing"), local)
            assert.throws(() => assertSandboxArtifactsLinked(root), /isn't linked to its source checkout/)
            fs.rmSync(local)
            fs.symlinkSync(source, local)
            assertSandboxArtifactsLinked(root)
        } finally {
            if (previous === undefined) delete process.env.PI_AF_RUNTIME
            else process.env.PI_AF_RUNTIME = previous
            fs.rmSync(root, { recursive: true, force: true })
            fs.rmSync(source, { recursive: true, force: true })
        }
    })

    it("commits project configuration while ignoring every entity artifact", () => {
        const root = repository()
        try {
            writeConfig(root, config())
            fs.writeFileSync(path.join(root, ".gitignore"), `${PROJECT_LOCAL_IGNORE}\n`)
            const gig = path.join(root, ".project", ".local", "gigs", "example")
            fs.mkdirSync(gig, { recursive: true })
            fs.writeFileSync(path.join(gig, "metadata.json"), "{}\n")
            prepareArtifactPersistence(root)
            git(root, ["add", ".gitignore", ".project"])
            assert.deepEqual(git(root, ["diff", "--cached", "--name-only"]).split("\n"), [
                ".gitignore",
                ".project/config.json",
            ])
            assertArtifactPersistencePrepared(root)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("asserts a missing local-settings exclusion without writing and prepares it once", () => {
        const root = repository()
        try {
            writeConfig(root, config({ format: "username/identifier-title" }))
            fs.writeFileSync(path.join(root, ".gitignore"), `${PROJECT_LOCAL_IGNORE}\n`)
            writeWorkflowSettings(path.join(root, ".project", "config.local.json"), "alex")
            const exclude = path.join(root, ".git", "info", "exclude")
            const before = fs.readFileSync(exclude, "utf-8")
            assert.throws(() => assertArtifactPersistencePrepared(root), /not prepared/)
            assert.equal(fs.readFileSync(exclude, "utf-8"), before)
            prepareArtifactPersistence(root)
            prepareArtifactPersistence(root)
            assert.equal(
                fs
                    .readFileSync(exclude, "utf-8")
                    .split(/\r?\n/)
                    .filter((line) => line === LOCAL_PROJECT_CONFIG_EXCLUDE).length,
                1,
            )
            assert.equal(assertArtifactPersistencePrepared(root).branches.username, "alex")
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("rejects project-local artifacts in Git, including staged deletions, without changing the index", () => {
        const root = repository()
        try {
            writeConfig(root, config())
            fs.writeFileSync(path.join(root, ".gitignore"), `${PROJECT_LOCAL_IGNORE}\n`)
            const gig = path.join(root, ".project", ".local", "gigs", "example")
            fs.mkdirSync(gig, { recursive: true })
            fs.writeFileSync(path.join(gig, "notes.md"), "# Notes\n")
            git(root, ["add", "-f", ".project/.local/gigs/example/notes.md"])
            const indexBefore = git(root, ["ls-files", "--stage"])
            assert.throws(() => prepareArtifactPersistence(root), /\.project\/\.local\/ must remain outside Git/)
            assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)

            git(root, ["commit", "-m", "tracked local artifact"])
            git(root, ["rm", "--cached", ".project/.local/gigs/example/notes.md"])
            const stagedBefore = git(root, ["diff", "--cached", "--raw"])
            assert.throws(() => prepareArtifactPersistence(root), /must remain outside Git/)
            assert.equal(git(root, ["diff", "--cached", "--raw"]), stagedBefore)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
