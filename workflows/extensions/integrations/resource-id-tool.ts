import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"
import { workflowTools } from "../__lib/tools.js"

import type { McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import { OperationResourceIdsMemo } from "./resource-ids.js"
import { beginPullRequestCreation, recordPullRequestCreation } from "./creation.js"
import {
    invalidateStaleResourceIds,
    recordResourceIdsEvidence,
    selectPullRequestResourceIds,
    resolveResourceIdsContext,
    resolveResourceIds,
} from "./resource-id-operations.js"

const ResourceSchema = Type.Enum(
    ["github-issue", "github-project-item", "linear-project", "linear-issue", "github-pull-request"],
    { type: "string" },
)
const common = { entityDir: Type.String({ minLength: 1 }), resource: ResourceSchema }
export const EvidenceSchema = Type.Object(
    {
        tool: Type.String({ minLength: 1 }),
        arguments: Type.Record(Type.String(), Type.Unknown()),
        response: Type.Unknown({ description: "Actual provider JSON or complete native MCP result." }),
    },
    { additionalProperties: false },
)
export const ResourceIdsToolSchema = Type.Union([
    Type.Object(
        { entityDir: common.entityDir, action: Type.Literal("beginCreation") },
        { additionalProperties: false },
    ),
    Type.Object(
        { entityDir: common.entityDir, action: Type.Literal("recordCreation"), evidence: EvidenceSchema },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            entityDir: common.entityDir,
            resource: Type.Literal("github-pull-request"),
            action: Type.Literal("select"),
            evidence: EvidenceSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object({ ...common, action: Type.Literal("resolve") }, { additionalProperties: false }),
    Type.Object(
        { ...common, action: Type.Literal("record"), evidence: EvidenceSchema },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...common, action: Type.Literal("invalidate"), evidence: EvidenceSchema },
        { additionalProperties: false },
    ),
])

export function registerResourceIds(pi: ExtensionAPI, memo: OperationResourceIdsMemo, tools: McpToolCatalog): void {
    const toolsApi = workflowTools(pi, "integrations")
    const [begin, creation, select, resolve, record, invalidate] = ResourceIdsToolSchema.anyOf
    const operations = [
        ["begin_resource_creation", "beginCreation", begin],
        ["record_resource_creation", "recordCreation", creation],
        ["select_pull_request_resource", "select", select],
        ["resolve_resource_ids", "resolve", resolve],
        ["record_resource_ids", "record", record],
        ["invalidate_resource_ids", "invalidate", invalidate],
    ] as const
    for (const [name, action, schema] of operations) {
        const parameters = Type.Omit(schema, action === "select" ? ["action", "resource"] : ["action"])
        toolsApi.registerTool({
            name,
            label: name,
            description: `${name.replaceAll("_", " ")} for one initialized entity. Never execute or authorize provider calls. Record actual clear-success mutation/read evidence. Missing/stale IDs and uncertain outcomes require agent investigation through configured provider tools. Identity, lifecycle and merge state are not disposable cache values.`,
            parameters,
            async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                const input = Value.Parse(ResourceIdsToolSchema, {
                    ...Value.Parse(parameters, params),
                    action,
                    ...(action === "select" ? { resource: "github-pull-request" } : {}),
                })
                const entityDir = input.entityDir.replace(/^@/, "")
                const result = await (async () => {
                    if (input.action === "beginCreation") return beginPullRequestCreation(ctx.cwd, entityDir)
                    if (input.action === "recordCreation") {
                        const recorded = await recordPullRequestCreation(ctx.cwd, entityDir, input.evidence, tools)
                        for (const ids of recorded.resourceIds) memo.record(ids)
                        return recorded
                    }
                    const context = resolveResourceIdsContext(ctx.cwd, entityDir, input.resource)
                    if (input.action === "resolve") return resolveResourceIds(context, memo)
                    if (input.action === "invalidate")
                        return invalidateStaleResourceIds(context, input.evidence, memo, tools)
                    return {
                        state: "resolved" as const,
                        source: input.action === "select" ? ("user-selection" as const) : ("evidence" as const),
                        resourceIds:
                            input.action === "select"
                                ? await selectPullRequestResourceIds(context, input.evidence, memo, tools)
                                : await recordResourceIdsEvidence(context, input.evidence, memo, tools),
                    }
                })()
                return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
    }
}
