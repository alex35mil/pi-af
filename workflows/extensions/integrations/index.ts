import * as path from "node:path"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import { workflowTools } from "../__lib/tools.js"

import * as project from "../../../extensions/__lib/project.js"
import { observeMcpTools, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import { readEntityStatus, resolveEntityDirectory } from "../__lib/entity.js"
import { loadIntegrationConfig } from "./config.js"
import { LifecycleStateSchema } from "../__lib/domain.js"
import {
    NativePhaseFactsSchema,
    GitHubPhaseInputSchema,
    LinearPhaseInputSchema,
    githubPhaseFacts,
    linearPhaseFacts,
    phaseProjectionContract,
    planPhaseMutation,
} from "./phase.js"
import { assertArtifactPersistencePrepared, resolveWorkflowProject } from "../__lib/project-config.js"
import * as Git from "../__lib/git.js"
import {
    resolveWorkflowEnvironment,
    assertEntityEnvironment,
    sameRepository,
    type WorkflowEnvironment,
} from "./policy.js"
import { renderProviderBody, verifyMarkdownProjection } from "./projection.js"
import { isResourceIdsKind, OperationResourceIdsMemo, readCachedResourceIds } from "./resource-ids.js"
import { shippingReadDecision, resolveResourceIdsContext } from "./resource-id-operations.js"
import type { GitHubMergeDecision } from "./forge/github/merge.js"
import { EvidenceSchema, registerResourceIds } from "./resource-id-tool.js"
import { registerWorkflowOperations } from "./operations.js"
import { registerWorkflowPublication } from "./publication-mcp.js"
import { registerTrackerPublication } from "./tracker-publication.js"
import { incomingPullRequestContext } from "./forge/github/incoming-pr-context.js"
import {
    IncomingMergeContextSchema,
    incomingMergeContext,
    type IncomingMergeContextInput,
} from "./forge/github/incoming-pr-merge.js"
import {
    IncomingProjectContextSchema,
    incomingProjectContext,
    type IncomingProjectContextInput,
} from "./forge/github/incoming-pr-project.js"

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
        destination: Type.Enum(["tracker", "pullRequest"], { type: "string" }),
        source: Type.String(),
    },
    { additionalProperties: false },
)

const ContextEntitySchema = Type.Enum(["epic", "task", "gig"], { type: "string" })
const ContextTargetSchema = Type.Enum(["current", "workflow"], { type: "string" })
export const IntegrationContextSchema = Type.Union([
    IncomingMergeContextSchema,
    IncomingProjectContextSchema,
    Type.Object(
        { operation: Type.Literal("incomingPullRequest"), reference: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
    ),
    Type.Object({ operation: Type.Literal("inspect"), target: ContextTargetSchema }, { additionalProperties: false }),
    Type.Object(
        {
            operation: Type.Literal("queueIntake"),
            target: ContextTargetSchema,
            entity: ContextEntitySchema,
            priority: Type.String({ minLength: 1 }),
            kind: Type.Enum(["not set", "feature", "bugfix", "research", "refactor", "audit", "chore", "epic"], {
                type: "string",
                description: "Approved Kind, or not set. Applied as a label only when Kind labels are configured.",
            }),
        },
        { additionalProperties: false },
    ),
    Type.Object({ operation: Type.Literal("adopt"), entity: ContextEntitySchema }, { additionalProperties: false }),
    Type.Object(
        {
            operation: Type.Literal("shippingMerge"),
            entityDir: Type.String({ minLength: 1 }),
            evidence: EvidenceSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            operation: Type.Literal("trackerMutation"),
            entityDir: Type.String({ minLength: 1 }),
            change: Type.Enum(["labels", "lifecycle", "priority", "hierarchy"], { type: "string" }),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            operation: Type.Literal("trackerMutation"),
            entityDir: Type.String({ minLength: 1 }),
            change: Type.Literal("phase"),
            lifecycle: LifecycleStateSchema,
            native: NativePhaseFactsSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            operation: Type.Enum(["initialize", "resume", "artifactProjection", "pullRequest", "shippingRead"], {
                type: "string",
            }),
            entityDir: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
    ),
])

export type IntegrationContextInput = Static<typeof IntegrationContextSchema>

export default function (pi: ExtensionAPI): void {
    const toolsApi = workflowTools(pi, "integrations")
    registerWorkflowPublication(pi)
    const tools = observeMcpTools(pi)
    const resourceIdsMemo = new OperationResourceIdsMemo()
    registerResourceIds(pi, resourceIdsMemo, tools)
    registerTrackerPublication(pi, tools)
    registerWorkflowOperations(pi)
    pi.on("session_shutdown", async () => resourceIdsMemo.reset())

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

    toolsApi.registerTool({
        name: "render_provider_body",
        label: "render_provider_body",
        description:
            "Render a reviewed ## Overview visibly and collapse the remaining accepted source using GitHub or Linear syntax for the configured destination. Preserves content and adds eligible GitHub PR closing references outside the fold. Reads local configuration and metadata without external mutation.",
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

    toolsApi.registerTool({
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

    const [merge, , incoming, inspect, queue, adopt, shippingMerge, mutation, phase, entity] =
        IntegrationContextSchema.anyOf
    const contexts = [
        ["inspect_integrations", "inspect", inspect],
        ["inspect_queue_intake", "queueIntake", queue],
        ["inspect_adoption", "adopt", adopt],
        ["initialize_integration", "initialize", entity],
        ["resume_integration", "resume", entity],
        ["prepare_integration_projection", "artifactProjection", entity],
        ["prepare_integration_pull_request", "pullRequest", entity],
        ["prepare_integration_shipping", "shippingRead", entity],
        ["prepare_integration_merge", "shippingMerge", shippingMerge],
        ["prepare_tracker_mutation", "trackerMutation", mutation],
        ["inspect_incoming_pr_context", "incomingPullRequest", incoming],
        ["plan_incoming_pr_merge", "incomingPullRequestMerge", merge],
    ] as const
    for (const [name, operation, schema] of contexts) {
        const parameters = Type.Omit(schema, ["operation"])
        toolsApi.registerTool({
            name,
            label: name,
            description: `${name.replaceAll("_", " ")}: read the exact configured tracker/forge context and required evidence. Select current/workflow explicitly when required. Return context or approved-operation arguments only; never execute provider operations or change configuration.`,
            parameters,
            async execute(_id, params, _signal, _onUpdate, ctx) {
                const input = Value.Parse(IntegrationContextSchema, { ...Value.Parse(parameters, params), operation })
                resourceIdsMemo.reset()
                const result = buildIntegrationContext(ctx, input, tools)
                return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
    }
    const phaseContexts = [
        ["prepare_github_phase_mutation", GitHubPhaseInputSchema],
        ["prepare_linear_phase_mutation", LinearPhaseInputSchema],
    ] as const
    for (const [name, native] of phaseContexts) {
        const parameters = Type.Object(
            { ...Type.Omit(phase, ["operation", "change", "native"]).properties, native },
            { additionalProperties: false },
        )
        toolsApi.registerTool({
            name,
            label: name,
            description:
                "Calculate the native Phase assignment from fresh lifecycle and provider-specific metadata/selection facts. Omit only observed empty native leaves. Never execute a provider mutation or change lifecycle.",
            parameters,
            async execute(_id, params, _signal, _onUpdate, ctx) {
                const native =
                    name === "prepare_github_phase_mutation"
                        ? githubPhaseFacts(Value.Parse(GitHubPhaseInputSchema, params.native))
                        : linearPhaseFacts(Value.Parse(LinearPhaseInputSchema, params.native))
                const input = Value.Parse(IntegrationContextSchema, {
                    ...params,
                    operation: "trackerMutation",
                    change: "phase",
                    native,
                })
                resourceIdsMemo.reset()
                const result = buildIntegrationContext(ctx, input, tools)
                return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
    }
    const [intake, projectAction] = IncomingProjectContextSchema.anyOf
    const projects = [
        ["plan_incoming_pr_intake", "intake", intake],
        ["plan_incoming_pr_review", "review", projectAction],
        ["plan_incoming_pr_shipping", "shipping", projectAction],
        ["plan_incoming_pr_cancellation", "cancellation", projectAction],
    ] as const
    for (const [name, action, schema] of projects) {
        const parameters = Type.Omit(schema, ["operation", "action"])
        toolsApi.registerTool({
            name,
            label: name,
            description: `Plan scoped incoming-PR Project ${action} from complete exact native membership, field, and PR evidence. Return native operation arguments without executing them; preserve maintainer-controlled Status and separate approval requirements.`,
            parameters,
            async execute(_id, params, _signal, _onUpdate, ctx) {
                const input = Value.Parse(IntegrationContextSchema, {
                    ...Value.Parse(parameters, params),
                    operation: "incomingPullRequestProject",
                    action,
                })
                resourceIdsMemo.reset()
                const result = buildIntegrationContext(ctx, input, tools)
                return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
    }
}

type IncomingContextInput = Extract<IntegrationContextInput, { operation: "incomingPullRequest" }>
type WorkflowContextInput = Exclude<
    IntegrationContextInput,
    IncomingContextInput | IncomingMergeContextInput | IncomingProjectContextInput
>
type WorkflowContext = ReturnType<typeof buildWorkflowIntegrationContext>
type IncomingContext = ReturnType<typeof incomingPullRequestContext>
type IncomingMergeContext = ReturnType<typeof incomingMergeContext>
type IncomingProjectContext = ReturnType<typeof incomingProjectContext>

export function buildIntegrationContext(
    ctx: ExtensionContext,
    input: IncomingContextInput,
    tools: McpToolCatalog,
): IncomingContext
export function buildIntegrationContext(
    ctx: ExtensionContext,
    input: IncomingMergeContextInput,
    tools: McpToolCatalog,
): IncomingMergeContext
export function buildIntegrationContext(
    ctx: ExtensionContext,
    input: IncomingProjectContextInput,
    tools: McpToolCatalog,
): IncomingProjectContext
export function buildIntegrationContext(
    ctx: ExtensionContext,
    input: WorkflowContextInput,
    tools: McpToolCatalog,
): WorkflowContext
export function buildIntegrationContext(
    ctx: ExtensionContext,
    input: IntegrationContextInput,
    tools: McpToolCatalog,
): IncomingContext | IncomingMergeContext | IncomingProjectContext | WorkflowContext
export function buildIntegrationContext(ctx: ExtensionContext, input: IntegrationContextInput, tools: McpToolCatalog) {
    if (!Value.Check(IntegrationContextSchema, input))
        throw new Error("invalid integration context request: select the exact operation and its required inputs")
    if (input.operation === "incomingPullRequest") return incomingPullRequestContext(ctx.cwd, input.reference, tools)
    if (input.operation === "incomingPullRequestMerge") return incomingMergeContext(ctx.cwd, input, tools)
    if (input.operation === "incomingPullRequestProject") return incomingProjectContext(ctx.cwd, input, tools)
    return buildWorkflowIntegrationContext(ctx, input, tools)
}

function buildWorkflowIntegrationContext(ctx: ExtensionContext, input: WorkflowContextInput, tools: McpToolCatalog) {
    const selection =
        "target" in input
            ? {
                  target: input.target,
                  projectRoot:
                      input.target === "workflow" ? resolveWorkflowProject(ctx.cwd) : project.resolveRootDir(ctx.cwd),
              }
            : undefined
    const cwd = selection?.projectRoot ?? ctx.cwd
    try {
        const result = readProjectIntegrationContext(cwd, input, tools)
        return { ...result, ...selection }
    } catch (error) {
        if (selection?.target !== "workflow") throw error
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Workflow project ${cwd}: ${message}`)
    }
}

function readProjectIntegrationContext(cwd: string, input: WorkflowContextInput, tools: McpToolCatalog) {
    const operation = input.operation
    const entityDir = "entityDir" in input ? input.entityDir : undefined
    const trackerOnly = ["queueIntake", "adopt", "artifactProjection", "trackerMutation"].includes(operation)
    const forgeOnly = ["pullRequest", "shippingRead", "shippingMerge"].includes(operation)
    const environment = resolveWorkflowEnvironment(loadIntegrationConfig(cwd))
    assertArtifactPersistencePrepared(cwd)
    const entity = entityDir ? readWorkflowEntity(cwd, entityDir) : undefined
    if (entity) assertEntityEnvironment(entity.status, environment)
    if ((operation === "shippingRead" || operation === "shippingMerge") && entity?.status.entity === "epic")
        throw new Error("shipping operations require a Task or Gig")
    let shipping: GitHubMergeDecision | undefined
    if (input.operation === "shippingMerge") {
        const status = entity!.status
        if (status.phase !== "selfReview") {
            shipping = { state: "blocked", reason: "shipping requires completed Self-Review" }
        } else {
            const context = resolveResourceIdsContext(cwd, input.entityDir, "github-pull-request")
            if (context.scope.kind !== "github-pull-request") throw new Error("shipping requires PR addressing")
            const saved = readCachedResourceIds(context.directory, context.scope)
            shipping =
                saved && isResourceIdsKind(saved, "github-pull-request")
                    ? shippingReadDecision(
                          context.scope,
                          input.evidence,
                          Git.run(cwd, ["rev-parse", `refs/heads/${status.branch.name}`]),
                          saved.value.number,
                          tools,
                      )
                    : {
                          state: "blocked",
                          reason: "shipping requires locally recorded PR resource IDs; investigate and record the exact PR first",
                      }
        }
    }
    const tracker = forgeOnly
        ? undefined
        : environment.tracker.provider === "github"
          ? { state: "enabled" as const, provider: "github" as const, config: environment.tracker }
          : { state: "enabled" as const, provider: "linear" as const, config: environment.tracker }
    const phaseMutation =
        input.operation === "trackerMutation" && input.change === "phase"
            ? planPhaseMutation(
                  environment.tracker,
                  entity!.status.entity,
                  entity!.status.phase,
                  input.lifecycle,
                  input.native,
              )
            : undefined
    const forge = trackerOnly
        ? undefined
        : {
              state: "enabled" as const,
              provider: "github" as const,
              config: environment.forge,
              ...(shipping ? { shipping } : {}),
          }
    const github = environment.tracker.provider === "github"
    const kindLabel = input.operation === "queueIntake" ? queueKindLabel(environment, input.kind) : undefined

    return {
        state: "enabled" as const,
        operation,
        ...(entity && tracker && operation !== "artifactProjection"
            ? { phaseProjection: phaseProjectionContract(entity.status.phase, tracker.config, entity.status.entity) }
            : {}),
        ...(phaseMutation ? { phaseMutation } : {}),
        ...(input.operation === "queueIntake" ? { kindLabel: kindLabel ?? null } : {}),
        projection: {
            source: "exact accepted epic.md or plan.md",
            contentPolicy:
                "lossless: preserve the complete accepted source wording, sections, technical detail, and ordinary repository paths; keep its reviewed overview prose visible and collapse all remaining sections; never summarize or condense during publication",
            rendering: github
                ? "Call prepare_tracker_publication with the complete approved source; execute its exact registered comment mutation and save first-creation evidence with record_tracker_publication. Preserve issue title/description. Workflow publication code applies communication attribution; keep source artifacts signature-free."
                : "Call prepare_tracker_publication with the complete approved source; execute its exact registered document mutation and save first-creation evidence with record_tracker_publication. Preserve issue/Project title/name and description. Published documents require prepare_tracker_publication_update with exact get_document and parent read evidence. Workflow publication code applies communication attribution; keep source artifacts signature-free.",
            ...(entity
                ? entity.status.tracker.provider === "github"
                    ? { planComment: entity.status.tracker.planComment }
                    : { planDocument: entity.status.tracker.planDocument }
                : {}),
            attribution:
                "AI-assisted text is signed by workflow publication code using current runtime identity. Automatically select local __pi_authorship: user-verbatim for complete unchanged user-written messages, without special user opt-out wording; generated or reworded content remains ai-assisted. Code strips the local mode before sending. Use complete text, not patches or template-only content.",
            changedCandidateGate:
                "deterministic renderer output needs no second approval; code-owned communication attribution also needs no second approval; any substantive omission, rewrite, addition, or new summary requires the complete candidate or exact diff, reasons for every change, and explicit user approval",
            authority: "local accepted artifact" as const,
            outcomeProof:
                "publish the complete rendered approved body directly; trust established clear provider success without requiring a full echo or a routine confirmation read",
            recovery: github
                ? "after uncertain or partial creation, reconcile complete registered comment pages with recover_tracker_publication; pending creation never automatically retries. For uncertain updates, read the exact saved comment body and retry only confirmed non-application."
                : "after uncertain creation, use recover_tracker_publication with an exact parent UUID/identifier read, complete list_documents cursor pages, and full get_document reads requested for matching-parent candidates. Listings truncate content. Preserve pending state on missing/ambiguous evidence; never automatically create again. After uncertain or partial updates, read the exact saved document and reconcile before retrying only confirmed non-application.",
            discussion:
                "keep discussion in comments; requirements and agreed decisions belong in the accepted source artifact",
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

// The configured GitHub Kind label for queued work; none for Linear, `not set`, or no label set.
function queueKindLabel(environment: WorkflowEnvironment, kind: string): string | undefined {
    const labels = environment.tracker.provider === "github" ? environment.tracker.labels?.kind : undefined
    if (!labels || kind === "not set") return undefined
    return kind === "epic" ? labels.epic : labels.deliverableKinds[kind as keyof typeof labels.deliverableKinds]
}

export function renderEntityProviderBody(
    ctx: ExtensionContext,
    input: { entityDir: string; destination: "tracker" | "pullRequest"; source: string },
): string {
    assertArtifactPersistencePrepared(ctx.cwd)
    const environment = resolveWorkflowEnvironment(loadIntegrationConfig(ctx.cwd))
    const entity = readWorkflowEntity(ctx.cwd, input.entityDir)
    assertEntityEnvironment(entity.status, environment)

    if (input.destination === "tracker") {
        return renderProviderBody(input.source, {
            kind: environment.tracker.provider === "github" ? "github-plan-comment" : "linear-plan-document",
        })
    }
    const tracker = entity.status.tracker
    const closes =
        tracker.provider === "github" &&
        environment.tracker.provider === "github" &&
        sameRepository(environment.tracker.repository, environment.forge.repository)
            ? tracker.external.issueNumber
            : undefined
    return renderProviderBody(input.source, {
        kind: "github-pull-request",
        ...(closes ? { githubIssueNumber: closes } : {}),
    })
}

function readWorkflowEntity(cwd: string, raw: string) {
    const root = project.resolveRootDir(cwd)
    const resolved = resolveEntityDirectory(root, cwd, raw)
    return { directory: path.relative(root, resolved), status: readEntityStatus(resolved) }
}
