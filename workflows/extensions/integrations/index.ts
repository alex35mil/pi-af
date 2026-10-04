import * as path from "node:path"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import {
    assertEntityBranchReady,
    readEntityStatus,
    resolveEntityDirectory,
    type EntityStatus,
} from "../__lib/entity.js"
import { loadIntegrationConfig } from "./config.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import * as Git from "../__lib/git.js"
import {
    resolveForgePolicy,
    resolveWorkflowEnvironment,
    resolveWorkflowPolicy,
    type WorkflowEnvironment,
} from "./policy.js"
import { renderProviderBody, verifyMarkdownProjection } from "./projection.js"
import { isResourceIdsKind, OperationResourceIdsMemo, readCachedResourceIds } from "./resource-ids.js"
import { finishReadDecision, resolveResourceIdsContext, type FinishReadDecision } from "./resource-id-operations.js"
import { EvidenceSchema, registerResourceIds } from "./resource-id-tool.js"
import { finalizeLinearBranch } from "./tracker/linear.js"

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

const ContextEntitySchema = Type.Union([Type.Literal("epic"), Type.Literal("task"), Type.Literal("gig")])
export const IntegrationContextSchema = Type.Union([
    Type.Object({ operation: Type.Literal("inspect") }, { additionalProperties: false }),
    Type.Object(
        {
            operation: Type.Literal("queueIntake"),
            entity: ContextEntitySchema,
            priority: Type.String({ minLength: 1 }),
            kind: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
    ),
    Type.Object({ operation: Type.Literal("adopt"), entity: ContextEntitySchema }, { additionalProperties: false }),
    Type.Object(
        { operation: Type.Literal("finishMerge"), entityDir: Type.String({ minLength: 1 }), evidence: EvidenceSchema },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            operation: Type.Literal("trackerMutation"),
            entityDir: Type.String({ minLength: 1 }),
            change: Type.Union([
                Type.Literal("labels"),
                Type.Literal("lifecycle"),
                Type.Literal("priority"),
                Type.Literal("hierarchy"),
            ]),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            operation: Type.Union([
                Type.Literal("initialize"),
                Type.Literal("resume"),
                Type.Literal("artifactProjection"),
                Type.Literal("pullRequest"),
                Type.Literal("finishRead"),
            ]),
            entityDir: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
    ),
])

export type IntegrationContextInput = Static<typeof IntegrationContextSchema>

export default function (pi: ExtensionAPI): void {
    const resourceIdsMemo = new OperationResourceIdsMemo()
    registerResourceIds(pi, resourceIdsMemo)
    pi.on("session_shutdown", async () => resourceIdsMemo.reset())

    pi.registerTool({
        name: "finalize_linear_branch",
        label: "finalize_linear_branch",
        description:
            "Finalize a Linear Task/Gig branch from its durable exact saved-name contract. Safely resumes interrupted branch creation.",
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
            "Read local tracker/forge configuration, workflow authority and entity state. Validate supplied finish evidence against the locally recorded PR and source branch. Never inspect provider-tool schemas or perform external operations.",
        parameters: IntegrationContextSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input = Value.Parse(IntegrationContextSchema, params)
            resourceIdsMemo.reset()
            const result = buildIntegrationContext(ctx, input)
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                details: result,
            }
        },
    })
}

export function buildIntegrationContext(ctx: ExtensionContext, input: IntegrationContextInput) {
    if (!Value.Check(IntegrationContextSchema, input))
        throw new Error("invalid integration context request: select the exact operation and its required inputs")
    const operation = input.operation
    const entityDir = "entityDir" in input ? input.entityDir : undefined
    const trackerOnly = ["queueIntake", "adopt", "artifactProjection", "trackerMutation"].includes(operation)
    const requiresTracker = ["queueIntake", "adopt", "trackerMutation"].includes(operation)
    const forgeOnly = ["pullRequest", "finishRead", "finishMerge"].includes(operation)
    const loaded = loadIntegrationConfig(ctx.cwd)
    let projectConfig = entityDir ? assertArtifactPersistencePrepared(ctx.cwd) : undefined
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
        if (requiresTracker) throw new Error(`${operation} requires a configured tracker`)
        if (forgeOnly) throw new Error(`${operation} requires a configured forge`)
        return { state: "disabled" as const }
    }
    if (!projectConfig || !environment) throw new Error(`${operation} requires prepared project configuration`)
    const workflowPolicy = resolveWorkflowPolicy(environment)
    const forgePolicy = resolveForgePolicy(environment)
    if (requiresTracker && environment.tracker.kind === "none") {
        throw new Error(`${operation} requires a configured tracker`)
    }
    if (operation === "artifactProjection" && environment.tracker.kind === "none") {
        return { state: "skipped" as const, operation, reason: "no tracker is configured", entity }
    }
    if (forgeOnly && environment.forge.kind === "none") {
        throw new Error(`${operation} requires a configured forge`)
    }
    if (forgeOnly && entity) assertEntityBranchReady(entity.status)
    if ((operation === "finishRead" || operation === "finishMerge") && entity?.status.entity === "epic")
        throw new Error("finish operations require a Task or Gig")
    let finish: FinishReadDecision | undefined
    if (input.operation === "finishMerge") {
        const status = entity!.status
        assertEntityBranchReady(status)
        if (status.workStage !== "execution") {
            finish = { state: "blocked", reason: "finish requires execution" }
        } else {
            const context = resolveResourceIdsContext(ctx.cwd, input.entityDir, "github-pull-request")
            if (context.scope.kind !== "github-pull-request") throw new Error("finish requires PR addressing")
            const saved = readCachedResourceIds(context.directory, context.scope)
            finish =
                saved && isResourceIdsKind(saved, "github-pull-request")
                    ? finishReadDecision(
                          context.scope,
                          input.evidence,
                          Git.run(ctx.cwd, ["rev-parse", `refs/heads/${status.branch.name}`]),
                          saved.value.number,
                      )
                    : {
                          state: "blocked",
                          reason: "finish requires locally recorded PR resource IDs; investigate and record the exact PR first",
                      }
        }
    }
    const tracker = (() => {
        if (forgeOnly) return undefined
        switch (environment.tracker.kind) {
            case "none":
                return undefined
            case "github":
                return { state: "enabled" as const, provider: "github" as const, config: environment.tracker.config }
            case "linear":
                return { state: "enabled" as const, provider: "linear" as const, config: environment.tracker.config }
        }
    })()
    const forge =
        !trackerOnly && environment.forge.kind !== "none"
            ? {
                  state: "enabled" as const,
                  provider: environment.forge.kind,
                  config: environment.forge.config,
                  ...(finish ? { finish } : {}),
              }
            : undefined

    return {
        state: "enabled" as const,
        operation,
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
                          "remove the first Markdown H1 and its following blank line; for same-repository GitHub tracker and forge work, append a horizontal rule, a blank line, and `Closes #<number>` in pull-request bodies",
                      changedCandidateGate:
                          "except for root-H1 removal and the same-repository GitHub closing reference, before mutation present the complete candidate or exact diff, list every omission, rewrite, or addition with its reason, and require explicit user approval",
                      ownership: "workflow" as const,
                      outcomeProof:
                          "publish the complete rendered approved body directly; trust established clear provider success without requiring a full echo or a routine confirmation read",
                      recovery:
                          "after uncertain or partial success, read the exact provider body and reconcile before retrying; retry only confirmed non-application",
                      discussion:
                          "keep discussion in comments; requirements and agreed decisions belong in the accepted source artifact",
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
            "Call configured Pi-registered MCP tools directly. A denial or failed call must never be replaced with HTTP, gh, another client, or provider SDK.",
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
                throw new Error(
                    `${status.id} requires tracker migration before using the current configuration; see workflows/MIGRATIONS.md`,
                )
            }
            if (environment.tracker.kind === "github") {
                const tracker = status.integrations.find((entry) => entry.role === "tracker")
                if (
                    !tracker ||
                    tracker.provider !== "github" ||
                    tracker.repository.owner.toLowerCase() !==
                        environment.tracker.config.repository.owner.toLowerCase() ||
                    tracker.repository.repo.toLowerCase() !== environment.tracker.config.repository.repo.toLowerCase()
                ) {
                    throw new Error(`${status.id} tracker repository changed; see workflows/MIGRATIONS.md`)
                }
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
            if (
                forgeRecord &&
                (forgeRecord.repository.owner.toLowerCase() !==
                    environment.forge.config.repository.owner.toLowerCase() ||
                    forgeRecord.repository.repo.toLowerCase() !==
                        environment.forge.config.repository.repo.toLowerCase())
            ) {
                throw new Error(`${status.id} forge repository changed; see workflows/MIGRATIONS.md`)
            }
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
