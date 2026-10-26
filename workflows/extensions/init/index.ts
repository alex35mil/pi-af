import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"

import {
    EntityInitializationSchema,
    EpicPreflightSchema,
    GigPreflightSchema,
    initializeEntity,
    type InitializedEntity,
    preflightEntity,
    PreflightSchema,
    setEpicTaskTarget,
    TaskPreflightSchema,
} from "./entity.js"
import { workflowTools } from "../__lib/tools.js"
import { observeMcpTools } from "../../../extensions/__lib/mcp.js"
import {
    GitHubTrackerObjectSchema,
    LinearGigIssueObjectSchema,
    LinearProjectObjectSchema,
    LinearTaskIssueObjectSchema,
} from "../integrations/records.js"
import { seedInitializedEntityResourceIds } from "./resource-ids.js"

const SetEpicTaskTargetSchema = Type.Object(
    {
        entityDir: Type.String({ minLength: 1 }),
        target: Type.Enum(["epic", "default"], { type: "string" }),
    },
    { additionalProperties: false },
)

export default function (pi: ExtensionAPI): void {
    const tools = workflowTools(pi, "initialization")
    const mcpTools = observeMcpTools(pi)
    const entities = [
        { entity: "epic", preflight: EpicPreflightSchema, linear: LinearProjectObjectSchema },
        { entity: "task", preflight: TaskPreflightSchema, linear: LinearTaskIssueObjectSchema },
        { entity: "gig", preflight: GigPreflightSchema, linear: LinearGigIssueObjectSchema },
    ] as const
    for (const variant of entities) {
        // Rebuild as a strict object; Omit alone doesn't keep additionalProperties: false.
        const common = Type.Object(Type.Omit(variant.preflight, ["entity"]).properties, { additionalProperties: false })
        tools.registerTool({
            name: `preflight_${variant.entity}`,
            label: `preflight_${variant.entity}`,
            description: `Run every local check for an approved new ${variant.entity} before its tracker object is created. Changes nothing; a failure means nothing should be created on the tracker.`,
            parameters: common,
            async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                const input = Value.Parse(PreflightSchema, { ...Value.Parse(common, params), entity: variant.entity })
                const result = preflightEntity(input, { cwd: ctx.cwd, tools: mcpTools })
                return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
        for (const [provider, object] of [
            ["github", GitHubTrackerObjectSchema],
            ["linear", variant.linear],
        ] as const) {
            const name = `init_${provider}_${variant.entity}`
            const parameters = Type.Object({ ...common.properties, object }, { additionalProperties: false })
            tools.registerTool({
                name,
                label: name,
                description: `Initialize an approved ${variant.entity} from its existing ${provider === "github" ? "GitHub issue" : "Linear object"}, newly created or explicitly selected. Names the directory and branch from the tracker object and records its Resource IDs.`,
                parameters,
                async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                    const input = Value.Parse(EntityInitializationSchema, {
                        ...Value.Parse(parameters, params),
                        entity: variant.entity,
                    })
                    const initialized = initializeEntity(input, { cwd: ctx.cwd, tools: mcpTools })
                    await seedInitializedEntityResourceIds(initialized, ctx.cwd)
                    return {
                        content: [{ type: "text" as const, text: formatInitializedEntity(initialized) }],
                        details: initialized,
                    }
                },
            })
        }
    }

    tools.registerTool({
        name: "set_epic_task_target",
        label: "set_epic_task_target",
        description:
            "Record the approved routing intent for future Tasks at Epic plan acceptance; it stays local. This does not prove delivery; every default-target Task initialization verifies delivery independently. Existing Tasks keep their targets.",
        parameters: SetEpicTaskTargetSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input = Value.Parse(SetEpicTaskTargetSchema, params)
            const status = setEpicTaskTarget(input.entityDir, input.target, { cwd: ctx.cwd })
            if (status.entity !== "epic") throw new Error("updated entity is not an Epic")
            const branch = status.taskTarget === "epic" ? status.branch.name : status.branch.target
            return {
                content: [{ type: "text" as const, text: `Future Tasks will start from and target ${branch}.` }],
                details: status,
            }
        },
    })
}

export function formatInitializedEntity(initialized: Pick<InitializedEntity, "directory" | "status">): string {
    const branch = initialized.status.branch
    return [
        `Initialized ${initialized.directory}.`,
        `Branch: ${branch.name}`,
        `Start/target: ${branch.start}`,
        "Next: set up the board (Project membership, Status, Priority, Phase, Kind label when configured). Switch to the stored branch before implementation. Do not push it automatically.",
    ].join("\n")
}
