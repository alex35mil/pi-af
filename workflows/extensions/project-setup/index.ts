import * as fs from "node:fs"
import * as path from "node:path"

import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"
import { workflowTools } from "../__lib/tools.js"

import { MCP_TOOL_CATALOG_EVENT, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import { getExtensionSettingsPaths } from "../../../extensions/__lib/project.js"
import { EXTENSION as PERMISSIONS_EXTENSION } from "../../../extensions/permissions/index.js"
import { EPIC_ROOT, GIG_ROOT } from "../__lib/domain.js"
import * as Git from "../__lib/git.js"
import {
    getWorkflowSettingsPaths,
    LEGACY_PROJECT_LOCAL_IGNORE,
    prepareArtifactPersistence,
    PROJECT_LOCAL_IGNORE,
} from "../__lib/project-config.js"
import { inspectProjectMcp } from "../integrations/mcp.js"
import { inspectLinearWorkspace, LinearWorkspaceInspectionToolSchema } from "../integrations/tracker/linear.js"
import { GitHubProjectSetupToolSchema, runGitHubProjectSetup } from "./github-project.js"
import { configureProjectMcp, ProjectMcpConfigurationSchema } from "./mcp.js"
import { INCOMING_PR_WORKFLOW_PATH, IncomingPrIntakeSchema, renderIncomingPrIntake } from "./incoming-pr-intake.js"
import {
    configureProjectPermissions,
    inspectProjectPermissions,
    PermissionInspectionSchema,
    ProjectPermissionConfigurationSchema,
} from "./permissions.js"

const EmptySchema = Type.Object({}, { additionalProperties: false })

export default function (pi: ExtensionAPI): void {
    const tools = workflowTools(pi, "setup")
    let mcpCatalog: McpToolCatalog = new Map()
    const disposeCatalog = pi.events.on(MCP_TOOL_CATALOG_EVENT, (data) => {
        mcpCatalog = data instanceof Map ? new Map(data as McpToolCatalog) : new Map()
    })
    pi.on("session_shutdown", () => {
        disposeCatalog()
        mcpCatalog = new Map()
    })

    pi.registerCommand("project-setup", {
        description: "Interactively configure project workflows for this repository",
        handler: async (args, ctx) => {
            pi.sendUserMessage(
                projectSetupKickoffPrompt(args.trim(), inspectProjectSetup(ctx.cwd, ctx.isProjectTrusted())),
            )
        },
    })

    tools.registerTool({
        name: "inspect_project_setup",
        label: "inspect_project_setup",
        description:
            "Read credential-safe GitHub repository identity, project setup files, Git safety facts, tracker bindings, and credential-redacted MCP registrations without modifying files or requiring valid workflow configuration.",
        parameters: EmptySchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            Value.Parse(EmptySchema, params)
            const snapshot = inspectProjectSetup(ctx.cwd, ctx.isProjectTrusted())
            return {
                content: [{ type: "text" as const, text: JSON.stringify(snapshot, null, 2) }],
                details: snapshot,
            }
        },
    })

    tools.registerTool({
        name: "prepare_artifacts",
        label: "prepare_artifacts",
        description:
            "Validate that .project/.local/ is ignored and untracked, and prepare the local settings exclusion, without changing the Git index.",
        parameters: EmptySchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            Value.Parse(EmptySchema, params)
            const prepared = prepareArtifactPersistence(ctx.cwd)
            return {
                content: [
                    {
                        type: "text" as const,
                        text: "Workflow artifact persistence is ready.",
                    },
                ],
                details: prepared,
            }
        },
    })

    tools.registerTool({
        name: "configure_mcp",
        label: "configure_mcp",
        description:
            "Add approved official Linear/GitHub MCP registrations to committed or local project settings without storing credentials or changing the Git index.",
        parameters: ProjectMcpConfigurationSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            if (!ctx.isProjectTrusted())
                throw new Error("Trust this project before configuring project MCP registrations")
            const configured = configureProjectMcp(ctx.cwd, params)
            return {
                content: [
                    {
                        type: "text" as const,
                        text:
                            configured.files.length > 0
                                ? `Configured MCP servers in ${configured.files.join(", ")}. Restart Pi to load them.`
                                : "The requested MCP servers are already configured.",
                    },
                ],
                details: configured,
            }
        },
    })

    tools.registerTool({
        name: "inspect_permissions",
        label: "inspect_permissions",
        description:
            "Inspect candidate MCP allow rules against persistent global/project/local permissions and live MCP annotations. Report coverage, unavailable tools, and ask/deny conflicts without changing settings or calling providers.",
        parameters: PermissionInspectionSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const inspected = inspectProjectPermissions(ctx.cwd, params, mcpCatalog)
            return {
                content: [{ type: "text" as const, text: JSON.stringify(inspected, null, 2) }],
                details: inspected,
            }
        },
    })

    tools.registerTool({
        name: "configure_permissions",
        label: "configure_permissions",
        description:
            "Merge approved MCP allow and ask rules into project or local permission settings. Skip covered or blocked allows, preserve ask/deny and unrelated settings, and keep local settings outside Git.",
        parameters: ProjectPermissionConfigurationSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const parsed = Value.Parse(ProjectPermissionConfigurationSchema, params)
            const file = getExtensionSettingsPaths(PERMISSIONS_EXTENSION, ctx.cwd)[parsed.target]
            const configured = await withFileMutationQueue(file, async () =>
                configureProjectPermissions(ctx.cwd, parsed, mcpCatalog),
            )
            return {
                content: [{ type: "text" as const, text: JSON.stringify(configured, null, 2) }],
                details: configured,
            }
        },
    })

    tools.registerTool({
        name: "inspect_linear_workspace",
        label: "inspect_linear_workspace",
        description:
            "Read Linear workspace identity, viewer Full Name/Username, teams, issue statuses, Project statuses, and branch format through the public GraphQL API without exposing credentials or performing mutations.",
        parameters: LinearWorkspaceInspectionToolSchema,
        async execute(_toolCallId, params, signal) {
            const result = await inspectLinearWorkspace(params, { signal })
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                details: result,
            }
        },
    })

    tools.registerTool({
        name: "render_incoming_pr_intake",
        label: "render_incoming_pr_intake",
        description:
            "Render an opt-in fork-only Project membership workflow from approved GitHub forge/tracker configuration and an Actions secret name. Returns an exact local file candidate and activation prerequisites; no writes, credentials, provider calls or deployment. Uses native Backlog defaults and never changes existing item Status.",
        parameters: IncomingPrIntakeSchema,
        async execute(_toolCallId, params) {
            const result = renderIncomingPrIntake(params)
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                details: result,
            }
        },
    })

    const [repository, inspect, project, preview, apply] = GitHubProjectSetupToolSchema.anyOf
    const operations = [
        ["inspect_github_repository_setup", "inspectRepository", repository],
        ["inspect_github_project_setup", "inspect", inspect],
        ["inspect_github_project", "inspectProject", project],
        ["preview_github_project_setup", "preview", preview],
        ["apply_github_project_setup", "apply", apply],
    ] as const
    for (const [name, operation, schema] of operations) {
        const parameters = Type.Omit(schema, ["operation"])
        tools.registerTool({
            name,
            label: name,
            description:
                "Inspect Projects and views, preview or apply explicitly approved fields, labels, repository association, and view presentation through GitHub's documented APIs. Return guided UI steps for unsupported settings; never claim manual completion or expose credentials.",
            parameters,
            async execute(_toolCallId, params, signal) {
                const input = Value.Parse(GitHubProjectSetupToolSchema, {
                    ...Value.Parse(parameters, params),
                    operation,
                })
                const result = await runGitHubProjectSetup(input, { signal })
                return {
                    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                    details: result,
                }
            },
        })
    }
}

const PROJECT_SETUP_FILES = [
    ".project/config.json",
    ".project/config.local.json",
    ".project/integrations.json",
    ".project/policies.md",
    ".gitignore",
    `.agents/${PERMISSIONS_EXTENSION}.json`,
    `.agents/${PERMISSIONS_EXTENSION}.local.json`,
    INCOMING_PR_WORKFLOW_PATH,
] as const

export function inspectProjectSetup(cwd: string, projectTrusted: boolean) {
    const root = path.resolve(Git.run(cwd, ["rev-parse", "--show-toplevel"]))
    const excludePath = path.resolve(root, Git.run(root, ["rev-parse", "--git-path", "info/exclude"]))
    const workflowSettings = getWorkflowSettingsPaths(root)
    return {
        repositoryRoot: root,
        repositoryIdentity: inspectRepositoryIdentity(root),
        files: PROJECT_SETUP_FILES.map((file) => snapshotFile(root, file)),
        globalWorkflowSettings: snapshotAbsoluteFile(root, workflowSettings.global),
        localExclude: snapshotAbsoluteFile(root, excludePath),
        mcp: inspectProjectMcp(cwd, projectTrusted),
        boundEntityTrackers: inspectBoundEntityTrackers(root),
        projectLocalIgnore: inspectProjectLocalIgnore(root),
        projectPathsInGit: splitLines(Git.run(root, ["ls-files", "--cached", "--", ".project"])),
        stagedProjectPaths: splitLines(Git.run(root, ["diff", "--cached", "--name-only", "--", ".project"])),
    }
}

export function projectSetupKickoffPrompt(request: string, context: ReturnType<typeof inspectProjectSetup>): string {
    return [
        "Project workflow setup:",
        ...(request ? ["", request] : []),
        "",
        "Read-only setup context:",
        JSON.stringify(context, null, 2),
        "",
        "Use the project-setup skill. Use this snapshot instead of running Git or shell discovery. Ask only the required configuration questions; do not initialize work. Linear setup API access is read-only; mutate providers only through an exact approved GitHub Project provisioning preview.",
    ].join("\n")
}

function inspectRepositoryIdentity(root: string) {
    const candidates = new Map<string, { owner: string; repo: string; remotes: string[] }>()
    for (const remote of splitLines(Git.run(root, ["remote"]))) {
        // Never expose remote URLs or Git diagnostics: both can contain credentials.
        for (const url of splitLines(Git.tryRun(root, ["remote", "get-url", "--all", remote]))) {
            const identity = githubRemoteIdentity(url)
            if (!identity) continue
            const key = `${identity.owner}/${identity.repo}`.toLowerCase()
            const candidate = candidates.get(key)
            if (candidate) {
                if (!candidate.remotes.includes(remote)) candidate.remotes.push(remote)
            } else candidates.set(key, { ...identity, remotes: [remote] })
        }
    }
    return { githubCandidates: [...candidates.values()] }
}

function githubRemoteIdentity(value: string): { owner: string; repo: string } | undefined {
    let pathname: string
    const scp = /^(?:[^@/\s]+@)?github\.com:([^?#]+)(?:[?#].*)?$/i.exec(value)
    if (scp) pathname = scp[1]
    else {
        try {
            const url = new URL(value)
            if (url.hostname !== "github.com" || !["https:", "ssh:"].includes(url.protocol)) return
            pathname = url.pathname.replace(/^\//, "")
        } catch {
            return
        }
    }
    const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)\/?$/.exec(pathname)
    if (!match) return
    const repo = match[2].replace(/\.git$/, "")
    if (!repo || repo === "." || repo === "..") return
    return { owner: match[1], repo }
}

function snapshotFile(root: string, file: string) {
    const absolute = path.join(root, file)
    return { path: file, ...fileContent(absolute) }
}

function snapshotAbsoluteFile(root: string, absolute: string) {
    const relative = path.relative(root, absolute)
    const displayPath = relative && !relative.startsWith("..") ? relative : absolute
    return { path: displayPath, ...fileContent(absolute) }
}

function fileContent(file: string): { exists: false } | { exists: true; content: string } {
    return fs.existsSync(file) ? { exists: true, content: fs.readFileSync(file, "utf-8") } : { exists: false }
}

// What setup must do to .gitignore: nothing, replace the directory-only legacy line, or append the rule.
function inspectProjectLocalIgnore(root: string) {
    const file = path.join(root, ".gitignore")
    const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf-8").split(/\r?\n/) : []
    if (lines.includes(PROJECT_LOCAL_IGNORE)) return { state: "present" as const, rule: PROJECT_LOCAL_IGNORE }
    if (lines.includes(LEGACY_PROJECT_LOCAL_IGNORE)) {
        return { state: "replace" as const, from: LEGACY_PROJECT_LOCAL_IGNORE, rule: PROJECT_LOCAL_IGNORE }
    }
    return { state: "append" as const, rule: PROJECT_LOCAL_IGNORE }
}

function splitLines(value: string): string[] {
    return value ? value.split(/\r?\n/).filter(Boolean) : []
}

// Lists entities whose tracker record is bound to a provider object, so setup never
// replaces a tracker that existing work is linked to.
function inspectBoundEntityTrackers(root: string) {
    const results: Array<{ path: string; entity: string; provider: string; reference: string }> = []
    const visit = (directory: string): void => {
        if (!fs.existsSync(directory)) return
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name)
            if (entry.isDirectory()) {
                // Review rounds and scratch hold copies and probes, never entity metadata.
                if (entry.name !== "reviews" && entry.name !== "scratch") visit(absolute)
                continue
            }
            if (entry.name !== "metadata.json") continue
            const entity = path.basename(directory)
            try {
                const metadata = JSON.parse(fs.readFileSync(absolute, "utf-8")) as Record<string, unknown>
                const tracker = metadata.tracker as Record<string, unknown> | undefined
                const external = tracker?.external as Record<string, unknown> | undefined
                if (!tracker || typeof tracker.provider !== "string" || !external) continue
                const reference =
                    typeof external.issueNumber === "number"
                        ? `#${external.issueNumber}`
                        : typeof external.identifier === "string"
                          ? external.identifier
                          : typeof external.projectId === "string"
                            ? `project ${external.projectId}`
                            : "unknown"
                results.push({ path: path.relative(root, absolute), entity, provider: tracker.provider, reference })
            } catch {
                results.push({ path: path.relative(root, absolute), entity, provider: "unknown", reference: "invalid" })
            }
        }
    }
    visit(path.join(root, EPIC_ROOT))
    visit(path.join(root, GIG_ROOT))
    return results.sort((left, right) => left.path.localeCompare(right.path))
}
