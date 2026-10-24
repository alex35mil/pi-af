import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"

import {
    EntityInitializationSchema,
    EpicInitializationSchema,
    TaskInitializationSchema,
    GigInitializationSchema,
    initializeEntity,
    type InitializedEntity,
    setEpicTaskTarget,
} from "./entity.js"
import { workflowTools } from "../__lib/tools.js"
import { observeMcpTools } from "../../../extensions/__lib/mcp.js"
import { EpicDeliverySchema } from "./delivery.js"
import {
    GitHubInitializationSourceSchema,
    LinearProjectInitializationSourceSchema,
    LinearTaskInitializationSourceSchema,
    LinearGigInitializationSourceSchema,
} from "../integrations/records.js"
import { resolveLinearTrackerBranchRendererForInitialization } from "../integrations/tracker/linear.js"
import { seedInitializedEntityResourceIds } from "./resource-ids.js"

const SetEpicTaskTargetSchema = Type.Object(
    {
        entityDir: Type.String({ minLength: 1 }),
        target: Type.Enum(["epic", "default"], { type: "string" }),
        epicDelivery: Type.Optional(EpicDeliverySchema),
    },
    { additionalProperties: false },
)

export default function (pi: ExtensionAPI): void {
    const tools = workflowTools(pi, "initialization")
    const mcpTools = observeMcpTools(pi)
    const entities = [
        {
            entity: "epic",
            schema: EpicInitializationSchema,
            linear: LinearProjectInitializationSourceSchema,
            resource: "project",
        },
        {
            entity: "task",
            schema: TaskInitializationSchema,
            linear: LinearTaskInitializationSourceSchema,
            resource: "task-issue",
        },
        {
            entity: "gig",
            schema: GigInitializationSchema,
            linear: LinearGigInitializationSourceSchema,
            resource: "gig-issue",
        },
    ] as const
    for (const variant of entities) {
        const common = Type.Omit(variant.schema, ["entity", "source"])
        const sources = [
            { name: `init_${variant.entity}`, source: undefined, fixed: { mode: "new" } },
            {
                name: `adopt_github_${variant.entity}`,
                source: GitHubInitializationSourceSchema,
                fixed: { mode: "external", provider: "github" },
            },
            {
                name: `adopt_linear_${variant.entity}`,
                source: variant.linear,
                fixed: { mode: "external", provider: "linear", resource: variant.resource },
            },
        ] as const
        for (const source of sources) {
            const parameters = Type.Object(
                {
                    ...common.properties,
                    ...(source.source ? { source: Type.Omit(source.source, ["mode", "provider", "resource"]) } : {}),
                },
                { additionalProperties: false },
            )
            tools.registerTool({
                name: source.name,
                label: source.name,
                description: `${source.source ? "Adopt explicitly selected tracker work as" : "Initialize"} an approved ${variant.entity} with its identity, artifacts, and exact branch contract. Preserve approved title, Request, Priority, and required adoption evidence.`,
                parameters,
                async execute(_toolCallId, params, signal, _onUpdate, ctx) {
                    const supplied = Value.Parse(parameters, params)
                    const sourceFields = source.source
                        ? Value.Parse(Type.Omit(source.source, ["mode", "provider", "resource"]), supplied.source)
                        : {}
                    const input = Value.Parse(EntityInitializationSchema, {
                        ...supplied,
                        entity: variant.entity,
                        source: { ...sourceFields, ...source.fixed },
                    })
                    const renderTrackerBranch = await resolveLinearTrackerBranchRendererForInitialization(
                        ctx.cwd,
                        ctx.isProjectTrusted(),
                        input,
                        signal,
                    )
                    const initialized = initializeEntity(input, { cwd: ctx.cwd, renderTrackerBranch, tools: mcpTools })
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
            "Set where future Tasks start and deliver. Default requires local Epic ancestry or exact GitHub confirmation that the matching Epic revision was merged into its stored target. Existing Tasks keep their targets.",
        parameters: SetEpicTaskTargetSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input = Value.Parse(SetEpicTaskTargetSchema, params)
            const status = setEpicTaskTarget(input.entityDir, input.target, {
                cwd: ctx.cwd,
                epicDelivery: input.epicDelivery,
                tools: mcpTools,
            })
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
