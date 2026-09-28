import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export default function (pi: ExtensionAPI): void {
    pi.registerCommand("gig", {
        description: "Start or resume a standalone Deliverable",
        handler: async (args, ctx) => {
            const input = args.trim()
            if (!input) {
                ctx.ui.notify("Usage: /gig <description or existing .project/gigs path>", "error")
                return
            }
            pi.sendUserMessage(["Gig:", "", input, "", "Use the gig skill."].join("\n"))
        },
    })
}
