import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"

import { EntityInitializationSchema, initializeEntity, type InitializedEntity, setEpicTaskTarget } from "./entity.js"
import { resolveLinearTrackerBranchRendererForInitialization } from "../integrations/tracker/linear.js"
import { seedInitializedEntityResourceIds } from "./resource-ids.js"

const SetEpicTaskTargetSchema = Type.Object(
    {
        entityDir: Type.String({ minLength: 1 }),
        target: Type.Union([Type.Literal("epic"), Type.Literal("default")]),
    },
    { additionalProperties: false },
)

export default function (pi: ExtensionAPI): void {
    pi.registerTool({
        name: "init",
        label: "init",
        description:
            "Initialize an approved Epic, Task, or Gig with its ID, authoritative artifacts, and exact branch contract.",
        parameters: EntityInitializationSchema,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            const input = Value.Parse(EntityInitializationSchema, params)
            const renderTrackerBranch = await resolveLinearTrackerBranchRendererForInitialization(
                ctx.cwd,
                input,
                signal,
            )
            const initialized = initializeEntity(input, { cwd: ctx.cwd, renderTrackerBranch })
            await seedInitializedEntityResourceIds(initialized, ctx.cwd)
            return {
                content: [{ type: "text" as const, text: formatInitializedEntity(initialized) }],
                details: initialized,
            }
        },
    })

    pi.registerTool({
        name: "set_epic_task_target",
        label: "set_epic_task_target",
        description:
            "Set whether future Tasks use the Epic branch or repository default branch. Default requires a locally verified merged Epic branch.",
        parameters: SetEpicTaskTargetSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input = Value.Parse(SetEpicTaskTargetSchema, params)
            const status = setEpicTaskTarget(input.entityDir, input.target, { cwd: ctx.cwd })
            if (status.entity !== "epic" || status.branch.state !== "ready") {
                throw new Error("updated entity is not a ready Epic")
            }
            const branch = status.taskTarget === "epic" ? status.branch.name : status.branch.target
            return {
                content: [{ type: "text" as const, text: `Future Tasks will start from and target ${branch}.` }],
                details: status,
            }
        },
    })
}

export function formatInitializedEntity(initialized: Pick<InitializedEntity, "directory" | "status">): string {
    const integrationSummary = initialized.status.integrations.map(
        (integration) => `${integration.role}/${integration.provider}: ${integration.state}`,
    )
    const branch = initialized.status.branch
    return [
        `Initialized ${initialized.status.id}.`,
        `Directory: ${initialized.directory}`,
        branch.state === "ready" ? `Branch: ${branch.name}` : "Branch: pending tracker branch name",
        `Start/target: ${branch.start}`,
        branch.state === "ready"
            ? "Switch to the stored branch before implementation. Do not push it automatically."
            : "Finish tracker binding and call finalize_linear_branch before planning work.",
        ...(integrationSummary.length > 0 ? [`Integrations: ${integrationSummary.join(", ")}`] : []),
    ].join("\n")
}
