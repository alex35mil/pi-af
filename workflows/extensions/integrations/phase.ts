import { type Static, Type } from "typebox"

import { type LifecycleState, type Phase, projectedPhase } from "../__lib/domain.js"
import type { EntityType } from "../__lib/domain.js"
import type { GitHubTracker, LinearTracker, PhaseLabelGroup, TrackerConfig } from "./config.js"

const NameSchema = Type.String({ minLength: 1 })
const NullableNameSchema = Type.Union([NameSchema, Type.Null()])

// Normalized facts from complete, fresh native reads; never cached provider state.
export const NativePhaseFactsSchema = Type.Union([
    Type.Object(
        {
            provider: Type.Literal("github"),
            field: Type.Object(
                {
                    name: NameSchema,
                    dataType: NameSchema,
                    options: Type.Array(NameSchema, { uniqueItems: true }),
                },
                { additionalProperties: false },
            ),
            current: NullableNameSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            provider: Type.Literal("linear"),
            catalog: Type.Array(
                Type.Object(
                    {
                        id: NameSchema,
                        name: NameSchema,
                        team: NullableNameSchema,
                        parentId: NullableNameSchema,
                        isGroup: Type.Boolean(),
                        groupType: Type.Union([Type.Literal("singleSelect"), Type.Literal("multiSelect"), Type.Null()]),
                        retiredAt: NullableNameSchema,
                    },
                    { additionalProperties: false },
                ),
            ),
            applied: Type.Array(NameSchema, { uniqueItems: true }),
        },
        { additionalProperties: false },
    ),
])
export type NativePhaseFacts = Static<typeof NativePhaseFactsSchema>
type LinearFacts = Extract<NativePhaseFacts, { provider: "linear" }>

export function phaseProjectionContract(phase: Phase, tracker: TrackerConfig, entity: EntityType) {
    const representation =
        tracker.provider === "github"
            ? { provider: tracker.provider, field: tracker.fields.phase }
            : { provider: tracker.provider, labels: linearGroup(tracker, entity) }
    return {
        phase,
        inProgress: projectedPhase("inProgress", phase),
        otherwise: projectedPhase("inReview", phase),
        representation,
        authority: "read fresh native lifecycle; do not infer it from metadata or cached facts",
    }
}

function linearGroup(tracker: LinearTracker, entity: EntityType): PhaseLabelGroup {
    return entity === "epic" ? tracker.phase.projects : tracker.phase.issues
}

export function validateGitHubPhaseField(
    tracker: GitHubTracker,
    facts: Extract<NativePhaseFacts, { provider: "github" }>,
): void {
    if (facts.field.name !== tracker.fields.phase.field || facts.field.dataType !== "SINGLE_SELECT") {
        throw new Error("configured GitHub Phase requires its exact Project single-select field")
    }
    for (const name of Object.values(tracker.fields.phase.values)) {
        if (!facts.field.options.includes(name)) throw new Error(`GitHub Phase option is missing: ${name}`)
    }
}

export function resolveLinearPhaseGroup(tracker: LinearTracker, entity: EntityType, catalog: LinearFacts["catalog"]) {
    const configured = linearGroup(tracker, entity)
    const team = configured.scope === "workspace" ? null : tracker.team
    const groups = catalog.filter((label) => label.name === configured.group && label.team === team)
    if (groups.length !== 1 || !groups[0].isGroup || groups[0].retiredAt !== null) {
        throw new Error("Linear Phase requires one active group in the exact configured scope")
    }
    const group = groups[0]
    // Project label groups are single-select by the provider's documented contract.
    if (entity !== "epic" && group.groupType !== "singleSelect") {
        throw new Error("Linear issue Phase requires a single-select group")
    }
    const children = catalog.filter((label) => label.parentId === group.id)
    const values = Object.fromEntries(
        Object.entries(configured.values).map(([phase, name]) => {
            const matches = children.filter((label) => label.name === name)
            if (
                matches.length !== 1 ||
                matches[0].isGroup ||
                matches[0].retiredAt !== null ||
                matches[0].team !== team
            ) {
                throw new Error(`Linear Phase requires one active child in its configured group: ${name}`)
            }
            return [phase, matches[0].id]
        }),
    ) as Record<Phase, string>
    return { groupId: group.id, childIds: children.map((label) => label.id), values }
}

export function planPhaseMutation(
    tracker: TrackerConfig,
    entity: EntityType,
    phase: Phase,
    lifecycle: LifecycleState,
    facts: NativePhaseFacts,
) {
    const projected = projectedPhase(lifecycle, phase)
    if (tracker.provider === "github" && facts.provider === "github") {
        validateGitHubPhaseField(tracker, facts)
        const value = projected === null ? null : tracker.fields.phase.values[projected]
        return {
            provider: "github" as const,
            field: tracker.fields.phase.field,
            value,
            changed: facts.current !== value,
        }
    }
    if (tracker.provider === "linear" && facts.provider === "linear") {
        const group = resolveLinearPhaseGroup(tracker, entity, facts.catalog)
        const managed = new Set(group.childIds)
        const labels = facts.applied.filter((id) => !managed.has(id))
        if (projected !== null) labels.push(group.values[projected])
        const current = new Set(facts.applied)
        return {
            provider: "linear" as const,
            labels,
            changed: labels.length !== current.size || labels.some((id) => !current.has(id)),
        }
    }
    throw new Error("native Phase facts do not match the configured tracker provider")
}
