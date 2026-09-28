import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { DeliveryCleanupSchema, runDeliveryCleanup } from "./cleanup.js"

export default function (pi: ExtensionAPI): void {
    pi.registerTool({
        name: "cleanup_delivery_branch",
        label: "cleanup_delivery_branch",
        description:
            "Execute an explicitly approved post-merge Task/Gig branch cleanup in the current clone. Validates current state and never deletes a remote branch.",
        parameters: DeliveryCleanupSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const result = runDeliveryCleanup(params, { cwd: ctx.cwd })
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                details: result,
            }
        },
    })
}
