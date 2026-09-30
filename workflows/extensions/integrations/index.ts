import * as path from "node:path"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"

import { MCP_TOOL_CATALOG_EVENT, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import {
    assertEntityBranchReady,
    readEntityStatus,
    resolveEntityDirectory,
    type EntityStatus,
} from "../__lib/entity.js"
import { loadIntegrationConfig } from "./config.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import {
    resolveForgePolicy,
    resolveWorkflowEnvironment,
    resolveWorkflowPolicy,
    type WorkflowEnvironment,
} from "./policy.js"
import { resolveIntegrationOperationPolicy, type IntegrationOperation } from "./capabilities.js"
import { resolveGitHubForge } from "./forge/github.js"
import { renderProviderBody, verifyMarkdownProjection } from "./projection.js"
import { resolveGitHubTracker } from "./tracker/github.js"
import { finalizeLinearBranch, resolveLinearTracker } from "./tracker/linear.js"

const FinalizeBranchSchema = Type.Object({ entityDir: Type.String({ minLength: 1 }) }, { additionalProperties: false })

const ProjectionVerificationSchema = Type.Object(
    {
        expected: Type.String(),
        actual: Type.String(),
    },
    { additionalProperties: false },
)

export const RenderProviderBodySchema = Type.Object(
    {
        entityDir: Type.String({ minLength: 1 }),
        destination: Type.Union([Type.Literal("tracker"), Type.Literal("pullRequest")]),
        source: Type.String(),
    },
    { additionalProperties: false },
)

const IntegrationContextSchema = Type.Union([
    Type.Object({ operation: Type.Literal("inspect") }, { additionalProperties: false }),
    Type.Object({ operation: Type.Literal("queueIntake") }, { additionalProperties: false }),
    Type.Object(
        {
            operation: Type.Union([
                Type.Literal("initialize"),
                Type.Literal("resume"),
                Type.Literal("artifactProjection"),
                Type.Literal("pullRequest"),
            ]),
            entityDir: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
    ),
])

export default function (pi: ExtensionAPI): void {
    let catalog: McpToolCatalog = new Map()
    const dispose = pi.events.on(MCP_TOOL_CATALOG_EVENT, (value) => {
        catalog = value instanceof Map ? new Map(value as McpToolCatalog) : new Map()
    })

    pi.on("session_shutdown", async () => {
        dispose()
        catalog = new Map()
    })

    pi.registerTool({
        name: "finalize_linear_branch",
        label: "finalize_linear_branch",
        description:
            "Finalize a new Linear Task/Gig branch from the exact bound issue gitBranchName. Safely resumes interrupted branch creation.",
        parameters: FinalizeBranchSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input = Value.Parse(FinalizeBranchSchema, params)
            const status = finalizeLinearBranch(input.entityDir, { cwd: ctx.cwd })
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Finalized branch ${status.branch.state === "ready" ? status.branch.name : ""}.`,
                    },
                ],
                details: status,
            }
        },
    })

    for (const queue of [
        {
            command: "backlog",
            label: "Backlog",
            usage: "potential work",
            skill: "backlog",
            description: "Add potential work to the configured external Backlog",
        },
        {
            command: "todo",
            label: "Todo",
            usage: "queued work",
            skill: "todo",
            description: "Add queued work to the configured external Todo queue",
        },
    ] as const) {
        pi.registerCommand(queue.command, {
            description: `${queue.description} without initializing workflow work`,
            handler: async (args, ctx) => {
                const request = args.trim()
                if (!request) {
                    ctx.ui.notify(`Usage: /${queue.command} <${queue.usage}>`, "error")
                    return
                }
                pi.sendUserMessage(
                    [
                        `${queue.label} intake:`,
                        "",
                        request,
                        "",
                        `Use the ${queue.skill} skill. This is external ${queue.label} intake, not Epic/Task/Gig initialization.`,
                    ].join("\n"),
                )
            },
        })
    }

    pi.registerTool({
        name: "render_provider_body",
        label: "render_provider_body",
        description:
            "Render a tracker or pull-request body from an accepted artifact. Removes the root heading and adds the same-repository GitHub closing block when applicable. Reads workflow configuration and entity metadata without external mutation.",
        parameters: RenderProviderBodySchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input = Value.Parse(RenderProviderBodySchema, params)
            const result = { markdown: renderEntityProviderBody(ctx, input) }
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                details: result,
            }
        },
    })

    pi.registerTool({
        name: "verify_artifact_projection",
        label: "verify_artifact_projection",
        description:
            "Compare expected and provider-returned Markdown byte-for-byte and explain how to follow up on repeated provider-only formatting differences. Performs no external operation.",
        parameters: ProjectionVerificationSchema,
        async execute(_toolCallId, params) {
            const input = Value.Parse(ProjectionVerificationSchema, params)
            const result = verifyMarkdownProjection(input.expected, input.actual)
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                details: result,
            }
        },
    })

    pi.registerTool({
        name: "integration_context",
        label: "integration_context",
        description:
            "Read and validate optional tracker/forge configuration and registered MCP capabilities. Never performs external mutations.",
        parameters: IntegrationContextSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input = Value.Parse(IntegrationContextSchema, params)
            const result = buildIntegrationContext(
                ctx,
                catalog,
                input.operation,
                "entityDir" in input ? input.entityDir : undefined,
            )
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                details: result,
            }
        },
    })
}

export function buildIntegrationContext(
    ctx: ExtensionContext,
    catalog: McpToolCatalog,
    operation: IntegrationOperation,
    entityDir?: string,
) {
    const operationPolicy = resolveIntegrationOperationPolicy(operation)
    if (operationPolicy.entity && !entityDir) throw new Error(`${operation} requires entityDir`)
    if (!operationPolicy.entity && entityDir) throw new Error(`${operation} does not accept entityDir`)
    const registeredMcpServers = [...new Set([...catalog.values()].map(({ serverName }) => serverName))].sort()
    const loaded = loadIntegrationConfig(ctx.cwd)
    let projectConfig = operationPolicy.entity ? assertArtifactPersistencePrepared(ctx.cwd) : undefined
    if (loaded.state === "enabled") projectConfig ??= assertArtifactPersistencePrepared(ctx.cwd)
    const environment = projectConfig
        ? resolveWorkflowEnvironment(projectConfig, loaded.state === "enabled" ? loaded.config : undefined)
        : undefined
    const entity = entityDir ? readWorkflowEntity(ctx.cwd, entityDir) : undefined
    if (entity) {
        if (!environment) throw new Error(`${operation} requires prepared project configuration`)
        assertEntityEnvironment(entity.status, environment)
    }
    if (loaded.state === "disabled") {
        if (operationPolicy.tracker === "required") throw new Error(`${operation} requires a configured tracker`)
        if (operationPolicy.forge === "required") throw new Error(`${operation} requires a configured forge`)
        return { state: "disabled" as const, registeredMcpServers }
    }
    if (!projectConfig || !environment) throw new Error(`${operation} requires prepared project configuration`)
    const workflowPolicy = resolveWorkflowPolicy(environment)
    const forgePolicy = resolveForgePolicy(environment)
    if (operationPolicy.tracker === "required" && environment.tracker.kind === "none") {
        throw new Error(`${operation} requires a configured tracker`)
    }
    if (operation === "artifactProjection" && environment.tracker.kind === "none") {
        return { state: "skipped" as const, operation, reason: "no tracker is configured", entity }
    }
    if (operationPolicy.forge === "required" && environment.forge.kind === "none") {
        throw new Error(`${operation} requires a configured forge`)
    }
    if (operationPolicy.forge === "required" && entity) assertEntityBranchReady(entity.status)

    const tracker = (() => {
        if (operationPolicy.tracker === "none") return undefined
        switch (environment.tracker.kind) {
            case "none":
                return undefined
            case "github":
                return resolveGitHubTracker(catalog, environment.tracker.config, operation, environment.artifacts.kind)
            case "linear":
                return resolveLinearTracker(catalog, environment.tracker.config, operation, entity?.status)
            default:
                return environment.tracker satisfies never
        }
    })()
    const forge = (() => {
        if (operationPolicy.forge === "none") return undefined
        switch (environment.forge.kind) {
            case "none":
                return undefined
            case "github":
                return resolveGitHubForge(catalog, environment.forge.config, operationPolicy.forgeCapabilities)
            default:
                return environment.forge satisfies never
        }
    })()

    if (operationPolicy.tracker === "required" && tracker?.state === "unavailable") {
        throw new Error(`configured tracker is unavailable: ${tracker.error}`)
    }
    if (operationPolicy.forge === "required" && operationPolicy.forgeCapabilities && forge?.state === "unavailable") {
        throw new Error(`configured forge is unavailable: ${forge.error}`)
    }

    return {
        state: "enabled" as const,
        operation,
        registeredMcpServers,
        workflowPolicy,
        forgePolicy,
        artifactMode: environment.artifacts.kind,
        projection:
            workflowPolicy.projection === "none"
                ? { mode: "none" as const }
                : {
                      mode: workflowPolicy.projection,
                      source: "exact accepted epic.md or plan.md",
                      contentPolicy:
                          "lossless: preserve all structure, wording, technical detail, and ordinary repository paths; never summarize or condense",
                      automaticPresentationNormalization:
                          "remove the first Markdown H1 and its following blank line; for same-repository GitHub tracker and forge work, append a horizontal rule followed by `Closes #<number>.` in pull-request bodies",
                      changedCandidateGate:
                          "except for root-H1 removal and the same-repository GitHub closing reference, before mutation present the complete candidate or exact diff, list every omission, rewrite, or addition with its reason, and require explicit user approval",
                      postWriteVerification:
                          "re-read the provider description/body and call verify_artifact_projection; only exact bytes verify, while every difference keeps the existing approval gate and returns a concise hint to consider Markdown parsing and normalized comparison when harmless formatting makes byte-for-byte comparison annoying",
                      preserveUnrelatedProviderContent: true as const,
                      ...(workflowPolicy.projection === "restricted"
                          ? {
                                allowed: [
                                    "approved entity title and Request/task-definition content",
                                    "ordinary repository paths",
                                    "native lifecycle",
                                    "native priority",
                                    "native hierarchy",
                                    "exact provider branch",
                                    "approved pull request reference",
                                ],
                                forbidden: [
                                    "qualified workflow IDs",
                                    ".project paths, links, or raw artifact structure",
                                    "entity or kind labels/types",
                                    "workflow or review terminology",
                                ],
                            }
                          : {}),
                  },
        roles: {
            ...(tracker ? { tracker } : {}),
            ...(forge ? { forge } : {}),
        },
        entity,
        permissionBoundary:
            "Call returned Pi-registered MCP tools directly. A denial or failed call must never be replaced with HTTP, gh, another client, or provider SDK.",
    }
}

export function renderEntityProviderBody(
    ctx: ExtensionContext,
    input: { entityDir: string; destination: "tracker" | "pullRequest"; source: string },
): string {
    const projectConfig = assertArtifactPersistencePrepared(ctx.cwd)
    const loaded = loadIntegrationConfig(ctx.cwd)
    const environment = resolveWorkflowEnvironment(
        projectConfig,
        loaded.state === "enabled" ? loaded.config : undefined,
    )
    const entity = readWorkflowEntity(ctx.cwd, input.entityDir)
    assertEntityEnvironment(entity.status, environment)

    if (
        input.destination !== "pullRequest" ||
        environment.tracker.kind !== "github" ||
        environment.forge.kind !== "github" ||
        environment.tracker.config.repository.owner.toLowerCase() !==
            environment.forge.config.repository.owner.toLowerCase() ||
        environment.tracker.config.repository.repo.toLowerCase() !==
            environment.forge.config.repository.repo.toLowerCase()
    ) {
        return renderProviderBody(input.source)
    }

    const tracker = entity.status.integrations.find(
        (integration) =>
            integration.role === "tracker" && integration.provider === "github" && "external" in integration,
    )
    return renderProviderBody(input.source, {
        ...(tracker ? { githubIssueNumber: tracker.external.issueNumber } : {}),
    })
}

function assertEntityEnvironment(status: EntityStatus, environment: WorkflowEnvironment): void {
    const forgeRecord = status.integrations.find((integration) => integration.role === "forge")
    switch (environment.tracker.kind) {
        case "none":
            if (status.authority.kind !== "workflow") {
                throw new Error(`${status.id} requires tracker migration before using the current configuration`)
            }
            break
        case "github":
        case "linear":
            if (status.authority.kind !== "tracker" || status.authority.provider !== environment.tracker.kind) {
                throw new Error(`${status.id} requires tracker migration before using the current configuration`)
            }
            break
        default:
            environment.tracker satisfies never
    }
    switch (environment.forge.kind) {
        case "none":
            if (forgeRecord)
                throw new Error(`${status.id} requires forge migration before removing its configured forge`)
            break
        case "github":
            break
        default:
            environment.forge satisfies never
    }
}

function readWorkflowEntity(cwd: string, raw: string) {
    const root = project.resolveRootDir(cwd)
    const resolved = resolveEntityDirectory(root, cwd, raw)
    return { directory: path.relative(root, resolved), status: readEntityStatus(resolved) }
}
