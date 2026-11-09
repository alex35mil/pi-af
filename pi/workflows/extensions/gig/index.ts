import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { GIG_ROOT } from "../__lib/domain.js"

export default function (pi: ExtensionAPI): void {
    pi.registerCommand("gig", {
        description: "Start or resume a standalone Deliverable",
        handler: async (args, ctx) => {
            const input = args.trim()
            if (!input) {
                ctx.ui.notify(`Usage: /gig <description or existing ${GIG_ROOT} path>`, "error")
                return
            }
            pi.sendUserMessage(["Gig:", "", input, "", "Use the gig skill."].join("\n"))
        },
    })
}
