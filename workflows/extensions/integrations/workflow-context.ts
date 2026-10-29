import * as fs from "node:fs"
import * as path from "node:path"

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import * as project from "../../../extensions/__lib/project.js"
import { INTEGRATION_CONFIG_PATH } from "./config.js"

export const WORKFLOW_CONTEXT_SECTION = "workflows"

export const WORKFLOW_CONTEXT =
    "This repository uses workflows. Every repository change happens inside a workflow entity: a Gig (`/gig`) for standalone work, or a Task (`/task`) for work planned in an Epic. Before implementing anything, start or resume one, and follow its lifecycle through planning, review, delivery, and shipping. Never edit, commit, or ship repository changes outside it unless the user explicitly approves. Questions and design discussion need no entity until you decide to implement."

// In a workflow-configured repository, every agent run gets the workflow rule in its system prompt.
// Checked per run, so adding or removing the configuration takes effect on the next run.
export function registerWorkflowContext(pi: ExtensionAPI): void {
    pi.on("before_agent_start", async (event, ctx) => {
        const configured = fs.existsSync(path.join(project.resolveRootDir(ctx.cwd), INTEGRATION_CONFIG_PATH))
        if (configured) event.systemPromptOptions.sections[WORKFLOW_CONTEXT_SECTION] = WORKFLOW_CONTEXT
        else delete event.systemPromptOptions.sections[WORKFLOW_CONTEXT_SECTION]
    })
}
