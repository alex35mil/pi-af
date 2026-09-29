import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { formatBranchName, validateRawId } from "../workflows/extensions/__lib/domain.ts"
import { inspectProjectMcp, registeredCredentialEnvironment } from "../workflows/extensions/integrations/mcp.ts"
import { configureProjectMcp, LOCAL_MCP_SETTINGS_EXCLUDE } from "../workflows/extensions/project-setup/mcp.ts"
import {
    configureProjectPermissions,
    LOCAL_PERMISSION_SETTINGS_EXCLUDE,
} from "../workflows/extensions/project-setup/permissions.ts"
import {
    assertArtifactPersistencePrepared,
    ENTITY_LOCAL_IGNORE,
    loadProjectConfig,
    LOCAL_PROJECT_CONFIG_EXCLUDE,
    prepareArtifactPersistence,
    UNVERSIONED_PROJECT_EXCLUDE,
} from "../workflows/extensions/__lib/project-config.ts"
import { resolveLinearTrackerBranchRendererForInitialization } from "../workflows/extensions/integrations/tracker/linear.ts"
import registerProjectSetup from "../workflows/extensions/project-setup/index.ts"

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
    it("loads operational Markdown dependencies from workflow references", () => {
        const skill = fs.readFileSync("workflows/skills/project-setup/SKILL.md", "utf-8")
        const setupReference = fs.readFileSync("workflows/references/setup.md", "utf-8")
        const markdownDependencies = [...skill.matchAll(/`(\.\.\/\.\.\/[^`\n]+\.md)`/g)].map((match) => match[1])

        assert.ok(markdownDependencies.length > 0)
        assert.ok(markdownDependencies.every((dependency) => dependency.startsWith("../../references/")))
        assert.match(skill, /references\/setup\.md/)
        assert.match(setupReference, /Accepted-artifact permission gates/)
        assert.match(setupReference, /\.project\/integrations\.json/)
    })

    it("starts guided setup without creating artifacts", async () => {
        const root = repository()
        let sent = ""
        let setup: { handler: (args: string, ctx: { cwd: string }) => Promise<void> } | undefined
        const tools: string[] = []
        const pi = {
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
                path.join(root, ".agents", "mcp.settings.json"),
                JSON.stringify({
                    servers: {
                        existing: {
                            url: "https://example.com/mcp",
                            headers: { Authorization: "Bearer top-secret" },
                        },
                    },
                }),
            )
            registerProjectSetup(pi)
            assert.ok(setup)
            assert.ok(tools.includes("configure_mcp"))
            assert.ok(tools.includes("configure_permissions"))
            assert.ok(tools.includes("inspect_linear_workspace"))
            assert.ok(tools.includes("provision_github_project"))
            await setup.handler("Use unversioned artifact mode", { cwd: root })
            assert.match(sent, /Use unversioned artifact mode/)
            assert.match(sent, /Use the project-setup skill/)
            assert.match(sent, /"repositoryRoot":/)
            assert.match(sent, /"path": "\.project\/config\.json"/)
            assert.match(sent, /"path": "\.project\/config\.local\.json"/)
            assert.match(sent, /"globalWorkflowSettings":/)
            assert.match(sent, /"path": "\.agents\/permission\.settings\.local\.json"/)
            assert.match(sent, /"name": "existing"/)
            assert.match(sent, /"boundEntityTrackers": \[\]/)
            assert.match(sent, /"projectPathsInGit": \[\]/)
            assert.doesNotMatch(sent, /top-secret|defaultBranch/)
            assert.equal(fs.existsSync(path.join(root, ".project")), false)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("reports reusable official MCP credential environment references without exposing values", () => {
        const root = repository()
        try {
            fs.mkdirSync(path.join(root, ".agents"))
            fs.writeFileSync(
                path.join(root, ".agents", "mcp.settings.json"),
                JSON.stringify({
                    servers: {
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

            const inspected = inspectProjectMcp(root)
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
            assert.equal(registeredCredentialEnvironment(root, "linear", "linear"), "LINEAR_SETUP_KEY")
            assert.throws(
                () => registeredCredentialEnvironment(root, "custom", "linear"),
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
                path.join(root, ".agents", "mcp.settings.json"),
                JSON.stringify({
                    servers: {
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
        const globalSettingsPath = path.join(root, "global-mcp.settings.json")
        try {
            fs.mkdirSync(path.join(root, ".agents"))
            fs.writeFileSync(
                path.join(root, ".agents", "mcp.settings.local.json"),
                `${JSON.stringify({ servers: { existing: { command: "noop" } }, preserved: true }, null, 4)}\n`,
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
            assert.doesNotThrow(() => git(root, ["check-ignore", "-q", ".agents/mcp.settings.local.json"]))
            assert.ok(
                fs
                    .readFileSync(path.join(root, ".git", "info", "exclude"), "utf-8")
                    .split(/\r?\n/)
                    .includes(LOCAL_MCP_SETTINGS_EXCLUDE),
            )

            const local = JSON.parse(fs.readFileSync(path.join(root, ".agents", "mcp.settings.local.json"), "utf-8"))
            assert.equal(local.preserved, true)
            assert.deepEqual(local.servers.existing, { command: "noop" })
            assert.deepEqual(local.servers["linear-workflow"], {
                url: "https://mcp.linear.app/mcp",
                headers: { Authorization: "Bearer ${LINEAR_WORKFLOW_TOKEN}" },
            })

            assert.deepEqual(local.servers["github-workflow"], {
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
            const project = JSON.parse(fs.readFileSync(path.join(root, ".agents", "mcp.settings.json"), "utf-8"))
            assert.deepEqual(project.servers["github-committed"], {
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
            const settingsPath = path.join(root, ".agents", "permission.settings.local.json")
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

            const configured = configureProjectPermissions(root, { target: "local", rules })

            assert.deepEqual(configured.addedRules, rules)
            assert.equal(configured.changed, true)
            assert.equal(configured.localExclusionChanged, true)
            assert.equal(git(root, ["ls-files", "--stage"]), indexBefore)
            assert.doesNotThrow(() => git(root, ["check-ignore", "-q", ".agents/permission.settings.local.json"]))
            assert.ok(
                fs
                    .readFileSync(path.join(root, ".git", "info", "exclude"), "utf-8")
                    .split(/\r?\n/)
                    .includes(LOCAL_PERMISSION_SETTINGS_EXCLUDE),
            )

            const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
            assert.equal(settings.defaultMode, "deny")
            assert.deepEqual(settings.allow, ["read"])
            assert.deepEqual(settings.ask, ["write(existing.md)", ...rules])
            assert.deepEqual(settings.keybindings, { autoAcceptEdits: "ctrl+shift+a" })

            assert.deepEqual(configureProjectPermissions(root, { target: "local", rules }), {
                target: "local",
                file: ".agents/permission.settings.local.json",
                addedRules: [],
                changed: false,
                localExclusionChanged: false,
            })
            assert.throws(
                () => configureProjectPermissions(root, { target: "project", rules: ["mcp__github__issue_read"] }),
                /legacy mcp__ rules are not supported/,
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it("requires strict explicit configuration", () => {
        const root = repository()
        const globalSettingsPath = path.join(root, "global-workflows.settings.json")
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
        const globalSettingsPath = path.join(root, "global-workflows.settings.json")
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
