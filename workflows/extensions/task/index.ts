import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export default function (pi: ExtensionAPI): void {
    pi.registerCommand("task", {
        description: "Start or resume a Deliverable belonging to one Epic",
        handler: async (args, ctx) => {
            const input = args.trim()
            if (!input) {
                ctx.ui.notify("Usage: /task <description, parent Epic, or existing Task path>", "error")
                return
            }
            pi.sendUserMessage(["Task:", "", input, "", "Use the task skill."].join("\n"))
        },
    })
}
