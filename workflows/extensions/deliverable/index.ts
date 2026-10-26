import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { Value } from "typebox/value"
import { observeMcpTools, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import * as Git from "../__lib/git.js"
import { workflowTools } from "../__lib/tools.js"
import { shippingReadDecision, resolveResourceIdsContext } from "../integrations/resource-id-operations.js"
import { isResourceIdsKind, readCachedResourceIds } from "../integrations/resource-ids.js"
import { DeliveryCleanupInputSchema, runDeliveryCleanup } from "./cleanup.js"

export default function (pi: ExtensionAPI): void {
    const tools = workflowTools(pi, "delivery")
    const catalog = observeMcpTools(pi)
    tools.registerTool({
        name: "cleanup_delivery_branch",
        label: "cleanup_delivery_branch",
        description:
            "Execute an explicitly approved post-merge Task/Gig branch cleanup in the current clone from the exact configured pull_request_read get evidence for the recorded PR. Validates current state and never deletes a remote branch.",
        parameters: DeliveryCleanupInputSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input = Value.Parse(DeliveryCleanupInputSchema, params)
            const merge = githubMergeProof(ctx.cwd, input, catalog)
            const result = runDeliveryCleanup({ entityDir: input.entityDir, merge }, { cwd: ctx.cwd })
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                details: result,
            }
        },
    })
}

// Extracts merged-state proof from PR-get evidence with the same validation as prepare_integration_merge.
export function githubMergeProof(
    cwd: string,
    input: { entityDir: string; evidence: { tool: string; arguments: Record<string, unknown>; response: unknown } },
    catalog: McpToolCatalog,
) {
    const context = resolveResourceIdsContext(cwd, input.entityDir, "github-pull-request")
    if (context.scope.kind !== "github-pull-request") throw new Error("cleanup requires PR addressing")
    const saved = readCachedResourceIds(context.directory, context.scope)
    if (!saved || !isResourceIdsKind(saved, "github-pull-request"))
        throw new Error("cleanup requires locally recorded PR resource IDs; investigate and record the exact PR first")
    const root = project.resolveRootDir(cwd)
    const headSha = Git.run(root, ["rev-parse", `refs/heads/${context.scope.head}`])
    const decision = shippingReadDecision(context.scope, input.evidence, headSha, saved.value.number, catalog)
    if (decision.state === "blocked") throw new Error(`merge evidence rejected: ${decision.reason}`)
    if (decision.state !== "merged") throw new Error("merge evidence does not show a merged PR; branch was preserved")
    return decision.merge
}
