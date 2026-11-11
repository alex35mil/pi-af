import { type Static, Type } from "typebox"

import { compile } from "../../../extensions/__lib/schema.js"
import { mcpResponsePayload, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import type { EntityStatus } from "../__lib/entity.js"
import type { TrackerConfig } from "./config.js"
import { itemFieldValue, singleSelectField } from "./github-project-reads.js"
import type { NativePhaseFacts } from "./phase.js"
import { resourceIdsFromRead } from "./resource-id-operations.js"
import { EvidenceSchema } from "./resource-id-tool.js"

export const GitHubPhaseInputSchema = Type.Object(
    {
        field: {
            ...EvidenceSchema,
            description: "Unmodified projects_get get_project_field read of the configured Phase field.",
        },
        item: {
            ...EvidenceSchema,
            description:
                "Unmodified projects_get get_project_item read of this entity's Project item, with field_names including Phase.",
        },
    },
    { additionalProperties: false },
)
export const GitHubPhaseInputValidator = compile(GitHubPhaseInputSchema)
export type GitHubPhaseInput = Static<typeof GitHubPhaseInputSchema>

/** Extracts Phase facts from the actual Project field and item reads of an initialized GitHub entity. */
export function githubPhaseFacts(
    tracker: TrackerConfig,
    entity: { name: string; status: EntityStatus },
    input: GitHubPhaseInput,
    tools: McpToolCatalog,
): NativePhaseFacts {
    const bound = entity.status.tracker
    if (tracker.provider !== "github" || bound.provider !== "github")
        throw new Error("GitHub Phase requires the configured GitHub tracker and a GitHub tracker issue")
    const name = tracker.fields.phase.field
    const field = singleSelectField({ mcpServer: tracker.mcpServer, ...tracker.project }, input.field, name, tools)
    // Identity is the same check that records the entity's Project item ID.
    resourceIdsFromRead(
        {
            kind: "github-project-item",
            entity: entity.name,
            mcpServer: tracker.mcpServer,
            repository: bound.repository,
            issueNumber: bound.external.issueNumber,
            project: tracker.project,
        },
        input.item,
        tools,
    )
    const requested = input.item.arguments.field_names
    if (!Array.isArray(requested) || !requested.includes(name))
        throw new Error(`Read the configured ${name} field on this entity's Project item with field_names`)
    const current = itemFieldValue(mcpResponsePayload(input.item.response), field)
    if (current.state === "absent")
        throw new Error(`Project item read returned no ${name} entry; read the item again with field_names`)
    return {
        provider: "github",
        field: { name: field.name, dataType: field.dataType, options: field.options },
        current: current.value,
    }
}
