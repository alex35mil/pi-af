import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export default function (pi: ExtensionAPI) {
    pi.registerCommand("epic", {
        description: "Shape a large idea into an initiative and ordered prospective Tasks",
        handler: async (args, ctx) => {
            const input = args.trim()
            if (!input) {
                ctx.ui.notify("Usage: /epic <description or existing Epic>", "error")
                return
            }

            pi.sendUserMessage(["Epic:", "", input, "", "Use the epic skill."].join("\n"))
        },
    })
}
