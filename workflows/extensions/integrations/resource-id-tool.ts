import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"

import { OperationResourceIdsMemo } from "./resource-ids.js"
import { beginProviderCreation, recordProviderCreation } from "./creation.js"
import {
    invalidateStaleResourceIds,
    recordResourceIdsEvidence,
    selectPullRequestResourceIds,
    resolveResourceIdsContext,
    resolveResourceIds,
} from "./resource-id-operations.js"

const ResourceSchema = Type.Union([
    Type.Literal("github-issue"),
    Type.Literal("github-project-item"),
    Type.Literal("linear-project"),
    Type.Literal("linear-issue"),
    Type.Literal("github-pull-request"),
])
const common = { entityDir: Type.String({ minLength: 1 }), resource: ResourceSchema }
export const EvidenceSchema = Type.Object(
    {
        tool: Type.String({ minLength: 1 }),
        arguments: Type.Record(Type.String(), Type.Unknown()),
        response: Type.Unknown(),
    },
    { additionalProperties: false },
)
const creationCommon = {
    entityDir: common.entityDir,
    role: Type.Union([Type.Literal("tracker"), Type.Literal("forge")]),
}
export const ResourceIdsToolSchema = Type.Union([
    Type.Object({ ...creationCommon, action: Type.Literal("beginCreation") }, { additionalProperties: false }),
    Type.Object(
        { ...creationCommon, action: Type.Literal("recordCreation"), evidence: EvidenceSchema },
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

export function registerResourceIds(pi: ExtensionAPI, memo: OperationResourceIdsMemo): void {
    pi.registerTool({
        name: "resource_ids",
        label: "resource_ids",
        description:
            "Use/record local resource IDs or prepare/record creation checkpoints for one initialized entity. Never execute or authorize provider calls. Record actual clear-success mutation/read evidence. Missing/stale IDs and uncertain outcomes require agent investigation through configured provider tools. Identity, lifecycle and merge state are not disposable cache values.",
        parameters: ResourceIdsToolSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input = Value.Parse(ResourceIdsToolSchema, params)
            const entityDir = input.entityDir.replace(/^@/, "")
            const result = await (async () => {
                if (input.action === "beginCreation") return beginProviderCreation(ctx.cwd, entityDir, input.role)
                if (input.action === "recordCreation") {
                    const recorded = await recordProviderCreation(ctx.cwd, entityDir, input.role, input.evidence)
                    for (const ids of recorded.resourceIds) memo.record(ids)
                    return recorded
                }
                const context = resolveResourceIdsContext(ctx.cwd, entityDir, input.resource)
                if (input.action === "resolve") return resolveResourceIds(context, memo)
                if (input.action === "invalidate") return invalidateStaleResourceIds(context, input.evidence, memo)
                return {
                    state: "resolved" as const,
                    source: input.action === "select" ? ("user-selection" as const) : ("evidence" as const),
                    resourceIds:
                        input.action === "select"
                            ? await selectPullRequestResourceIds(context, input.evidence, memo)
                            : await recordResourceIdsEvidence(context, input.evidence, memo),
                }
            })()
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: result }
        },
    })
}
