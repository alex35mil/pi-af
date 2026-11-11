import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

import { compile, parse } from "../../../extensions/__lib/schema.js"
import {
    EntityInitializationValidator,
    EpicInitializationPropertiesSchema,
    EpicPreflightSchema,
    GigInitializationPropertiesSchema,
    GigPreflightSchema,
    initializeEntity,
    type InitializedEntity,
    preflightEntity,
    PreflightValidator,
    TaskInitializationPropertiesSchema,
} from "./entity.js"
import {
    restoreEpic,
    restoreEpicPlanSource,
    RestoreEpicPlanSourceSchema,
    RestoreEpicPlanSourceValidator,
    RestoreEpicSchema,
    RestoreEpicValidator,
} from "./restore.js"
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
            preflight: Type.Object(Type.Omit(EpicPreflightSchema, ["entity"]).properties, {
                additionalProperties: false,
            }),
            common: EpicInitializationPropertiesSchema,
            linear: LinearProjectObjectSchema,
        },
        {
            entity: "task",
            preflight: undefined,
            common: TaskInitializationPropertiesSchema,
            linear: LinearTaskIssueObjectSchema,
        },
        {
            entity: "gig",
            preflight: Type.Object(Type.Omit(GigPreflightSchema, ["entity"]).properties, {
                additionalProperties: false,
            }),
            common: GigInitializationPropertiesSchema,
            linear: LinearGigIssueObjectSchema,
        },
    ] as const
    for (const variant of entities) {
        const common = variant.common
        const preflight = variant.preflight
        // A Task never creates its tracker issue: it starts from the queued issue its
        // parent Epic's issue processing created, so it has no preflight.
        const preflightValidator = preflight ? compile(preflight) : undefined
        if (preflight && preflightValidator)
            tools.registerTool({
                name: `preflight_${variant.entity}`,
                label: `preflight_${variant.entity}`,
                description: `Run every local check for an approved new ${variant.entity} before its tracker object is created, and return the labels to create it with. Changes nothing; a failure means nothing should be created on the tracker.`,
                parameters: preflight,
                async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                    const input = parse(PreflightValidator, {
                        ...parse(preflightValidator, params),
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
            const validator = compile(parameters)
            tools.registerTool({
                name,
                label: name,
                description:
                    variant.entity === "task"
                        ? `Start a Task from its parent Epic's queued ${provider === "github" ? "GitHub issue" : "Linear issue"}, selected by the marker its plan section carries. Takes the Kind from that section, names the directory and branch from the issue, and records its Resource IDs.`
                        : `Initialize an approved ${variant.entity} from its existing ${provider === "github" ? "GitHub issue" : "Linear object"}, newly created or explicitly selected. Names the directory and branch from the tracker object and records its Resource IDs.`,
                parameters,
                async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                    const input = parse(EntityInitializationValidator, {
                        ...parse(validator, params),
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
            const result = restoreEpic(ctx.cwd, parse(RestoreEpicValidator, params), mcpTools)
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
            const result = restoreEpicPlanSource(ctx.cwd, parse(RestoreEpicPlanSourceValidator, params), mcpTools)
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
        "Next: set up the board (Project membership, Status, Priority, Phase, Assignee, labels when configured). Switch to the stored branch before implementation. Do not push it automatically.",
    ].join("\n")
}
