import * as fs from "node:fs"
import * as path from "node:path"

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"

import * as Git from "../__lib/git.js"
import { getWorkflowSettingsPaths, prepareArtifactPersistence } from "../__lib/project-config.js"
import { inspectProjectMcp } from "../integrations/mcp.js"
import { inspectLinearWorkspace, LinearWorkspaceInspectionToolSchema } from "../integrations/tracker/linear.js"
import { GitHubProjectSetupToolSchema, runGitHubProjectSetup } from "./github-project.js"
import { configureProjectMcp, ProjectMcpConfigurationSchema } from "./mcp.js"
import { configureProjectPermissions, ProjectPermissionConfigurationSchema } from "./permissions.js"

const EmptySchema = Type.Object({}, { additionalProperties: false })

export default function (pi: ExtensionAPI): void {
    pi.registerCommand("project-setup", {
        description: "Interactively configure project workflows for this repository",
        handler: async (args, ctx) => {
            pi.sendUserMessage(projectSetupKickoffPrompt(args.trim(), inspectProjectSetup(ctx.cwd)))
        },
    })

    pi.registerTool({
        name: "prepare_artifacts",
        label: "prepare_artifacts",
        description:
            "Validate configured versioned artifact rules or prepare unversioned artifact exclusion for .project without changing the Git index.",
        parameters: EmptySchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            Value.Parse(EmptySchema, params)
            const prepared = prepareArtifactPersistence(ctx.cwd)
            return {
                content: [
                    {
                        type: "text" as const,
                        text:
                            prepared.mode === "unversioned"
                                ? `Prepared unversioned artifact mode using ${prepared.excludePath}.`
                                : "Versioned artifact persistence is ready.",
                    },
                ],
                details: prepared,
            }
        },
    })

    pi.registerTool({
        name: "configure_mcp",
        label: "configure_mcp",
        description:
            "Add approved official Linear/GitHub MCP registrations to committed or local project settings without storing credentials or changing the Git index.",
        parameters: ProjectMcpConfigurationSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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

    pi.registerTool({
        name: "configure_permissions",
        label: "configure_permissions",
        description:
            "Add approved ask rules to committed or local project permission settings while preserving unrelated settings and keeping local settings outside Git.",
        parameters: ProjectPermissionConfigurationSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const configured = configureProjectPermissions(ctx.cwd, params)
            return {
                content: [
                    {
                        type: "text" as const,
                        text: configured.changed
                            ? `Configured permission gates in ${configured.file}.`
                            : `The requested permission gates are already configured in ${configured.file}.`,
                    },
                ],
                details: configured,
            }
        },
    })

    pi.registerTool({
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

    pi.registerTool({
        name: "provision_github_project",
        label: "provision_github_project",
        description:
            "Inspect, preview, or apply an explicitly approved GitHub Project and field configuration through GitHub's HTTPS APIs without exposing credentials.",
        parameters: GitHubProjectSetupToolSchema,
        async execute(_toolCallId, params, signal) {
            const result = await runGitHubProjectSetup(params, { signal })
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                details: result,
            }
        },
    })
}

const PROJECT_SETUP_FILES = [
    ".project/config.json",
    ".project/config.local.json",
    ".project/integrations.json",
    ".project/policies.md",
    ".gitignore",
    ".agents/permission.settings.json",
    ".agents/permission.settings.local.json",
] as const

export function inspectProjectSetup(cwd: string) {
    const root = path.resolve(Git.run(cwd, ["rev-parse", "--show-toplevel"]))
    const excludePath = path.resolve(root, Git.run(root, ["rev-parse", "--git-path", "info/exclude"]))
    const workflowSettings = getWorkflowSettingsPaths(root)
    return {
        repositoryRoot: root,
        files: PROJECT_SETUP_FILES.map((file) => snapshotFile(root, file)),
        globalWorkflowSettings: snapshotAbsoluteFile(root, workflowSettings.global),
        localExclude: snapshotAbsoluteFile(root, excludePath),
        mcp: inspectProjectMcp(root),
        boundEntityTrackers: inspectBoundEntityTrackers(root),
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

function splitLines(value: string): string[] {
    return value ? value.split(/\r?\n/).filter(Boolean) : []
}

function inspectBoundEntityTrackers(root: string) {
    const results: Array<{ path: string; id: string; provider: string; state: string }> = []
    const visit = (directory: string): void => {
        if (!fs.existsSync(directory)) return
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name)
            if (entry.isDirectory()) {
                if (entry.name !== ".local") visit(absolute)
                continue
            }
            if (entry.name !== "metadata.json") continue
            try {
                const metadata = JSON.parse(fs.readFileSync(absolute, "utf-8")) as Record<string, unknown>
                if (!Array.isArray(metadata.integrations)) continue
                for (const rawIntegration of metadata.integrations) {
                    if (!rawIntegration || typeof rawIntegration !== "object") continue
                    const integration = rawIntegration as Record<string, unknown>
                    if (
                        integration.role !== "tracker" ||
                        typeof integration.provider !== "string" ||
                        typeof integration.state !== "string" ||
                        !("external" in integration)
                    )
                        continue
                    results.push({
                        path: path.relative(root, absolute),
                        id: typeof metadata.id === "string" ? metadata.id : "unknown",
                        provider: integration.provider,
                        state: integration.state,
                    })
                }
            } catch {
                results.push({
                    path: path.relative(root, absolute),
                    id: "invalid-metadata",
                    provider: "unknown",
                    state: "invalid",
                })
            }
        }
    }
    visit(path.join(root, ".project", "epics"))
    visit(path.join(root, ".project", "gigs"))
    return results.sort((left, right) => left.path.localeCompare(right.path))
}
