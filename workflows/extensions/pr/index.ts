import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { registerIncomingCheckout } from "./checkout.js"

export default function (pi: ExtensionAPI): void {
    registerIncomingCheckout(pi)
    pi.registerCommand("pr", {
        description: "Select an incoming GitHub PR for Project intake and private review",
        handler: async (args, ctx) => {
            const reference = args.trim()
            if (!reference) {
                ctx.ui.notify("Usage: /pr <GitHub PR URL or #NN>", "error")
                return
            }
            pi.sendUserMessage(
                [
                    "Incoming pull request:",
                    "",
                    reference,
                    "",
                    "Use the pr skill. Select the PR and inspect Project membership; ask for a missing intake choice. A reference alone is not review-start or shipping approval; this does not authorize publication, fixes, pushing, closing, or merging.",
                ].join("\n"),
                { deliverAs: "followUp" },
            )
        },
    })
}
