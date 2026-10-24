import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { Value } from "typebox/value"
import { workflowTools } from "../__lib/tools.js"
import { AncestryDeliveryCleanupInputSchema, GitHubDeliveryCleanupInputSchema, runDeliveryCleanup } from "./cleanup.js"

export default function (pi: ExtensionAPI): void {
    const tools = workflowTools(pi, "delivery")
    const operations = [
        ["cleanup_ancestry_delivery_branch", AncestryDeliveryCleanupInputSchema],
        ["cleanup_github_delivery_branch", GitHubDeliveryCleanupInputSchema],
    ] as const
    for (const [name, parameters] of operations) {
        tools.registerTool({
            name,
            label: name,
            description:
                "Execute an explicitly approved post-merge Task/Gig branch cleanup in the current clone. Validates current state and never deletes a remote branch.",
            parameters,
            async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                const input = Value.Parse(parameters, params)
                const completion =
                    input.completionAuthority === "workflow"
                        ? { kind: "workflow" }
                        : { kind: "tracker", provider: input.completionAuthority, lifecycle: "done" }
                const merge =
                    name === "cleanup_github_delivery_branch"
                        ? {
                              ...Value.Parse(GitHubDeliveryCleanupInputSchema, params).merge,
                              kind: "github-pr",
                              source: "pull_request_read:get",
                          }
                        : { kind: "git-ancestry" }
                const result = runDeliveryCleanup({ entityDir: input.entityDir, completion, merge }, { cwd: ctx.cwd })
                return {
                    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                    details: result,
                }
            },
        })
    }
}
