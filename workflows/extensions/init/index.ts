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
    TaskInitializationPropertiesSchema,
} from "./entity.js"
import { restoreEpic, restoreEpicPlanSource, RestoreEpicPlanSourceSchema, RestoreEpicSchema } from "./restore.js"
import { workflowTools } from "../__lib/tools.js"
import { observeMcpTools } from "../../../extensions/__lib/mcp.js"
import {
    GitHubTrackerObjectSchema,
    LinearGigIssueObjectSchema,
    LinearProjectObjectSchema,
    LinearTaskIssueObjectSchema,
} from "../integrations/records.js"
import { seedInitializedEntityResourceIds } from "./resource-ids.js"

export default function (pi: ExtensionAPI): void {
    const tools = workflowTools(pi, "initialization")
    const mcpTools = observeMcpTools(pi)
    const entities = [
        // Rebuild as strict objects; Omit alone doesn't keep additionalProperties: false.
        {
            entity: "epic",
            common: Type.Object(Type.Omit(EpicPreflightSchema, ["entity"]).properties, { additionalProperties: false }),
            linear: LinearProjectObjectSchema,
        },
        { entity: "task", common: TaskInitializationPropertiesSchema, linear: LinearTaskIssueObjectSchema },
        {
            entity: "gig",
            common: Type.Object(Type.Omit(GigPreflightSchema, ["entity"]).properties, { additionalProperties: false }),
            linear: LinearGigIssueObjectSchema,
        },
    ] as const
    for (const variant of entities) {
        const common = variant.common
        // A Task never creates its tracker issue: it starts from the queued issue its
        // parent Epic's issue processing created, so it has no preflight.
        if (variant.entity !== "task")
            tools.registerTool({
                name: `preflight_${variant.entity}`,
                label: `preflight_${variant.entity}`,
                description: `Run every local check for an approved new ${variant.entity} before its tracker object is created. Changes nothing; a failure means nothing should be created on the tracker.`,
                parameters: common,
                async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                    const input = Value.Parse(PreflightSchema, {
                        ...Value.Parse(common, params),
                        entity: variant.entity,
                    })
                    const result = preflightEntity(input, { cwd: ctx.cwd, tools: mcpTools })
                    return {
                        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                        details: result,
                    }
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
                description:
                    variant.entity === "task"
                        ? `Start a Task from its parent Epic's queued ${provider === "github" ? "GitHub issue" : "Linear issue"}, selected by the marker its plan section carries. Takes the Kind from that section, names the directory and branch from the issue, and records its Resource IDs.`
                        : `Initialize an approved ${variant.entity} from its existing ${provider === "github" ? "GitHub issue" : "Linear object"}, newly created or explicitly selected. Names the directory and branch from the tracker object and records its Resource IDs.`,
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
        name: "restore_epic",
        label: "restore_epic",
        description:
            "Recreate a missing local Epic from its tracker read and its single published plan: directory, metadata, brief, and epic.md. Never runs over an existing local Epic for the same tracker item, and creates no branch.",
        parameters: RestoreEpicSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const result = restoreEpic(ctx.cwd, Value.Parse(RestoreEpicSchema, params), mcpTools)
            return {
                content: [{ type: "text" as const, text: `Restored ${result.directory}.` }],
                details: result,
            }
        },
    })

    tools.registerTool({
        name: "restore_epic_plan_source",
        label: "restore_epic_plan_source",
        description:
            "Return an existing local Epic's published plan as epic.md source, for comparing with the local copy. Writes nothing.",
        parameters: RestoreEpicPlanSourceSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const result = restoreEpicPlanSource(ctx.cwd, Value.Parse(RestoreEpicPlanSourceSchema, params), mcpTools)
            return { content: [{ type: "text" as const, text: result.source }], details: result }
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
