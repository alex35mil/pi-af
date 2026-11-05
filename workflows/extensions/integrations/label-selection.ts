import { type Static, Type } from "typebox"

import {
    isUnknownLabel,
    type Cardinality,
    type GitHubLabelGroup,
    type GitHubLabels,
    groupValuesFor,
    KIND_GROUP_KEY,
    type LabelItemType,
    type LinearLabelGroup,
    type LinearLabels,
    type LinearPhaseGroup,
    type WorkflowKind,
} from "./labels.js"

/**
 * Runtime label selection: which values of each label group an item carries. The `kind` group
 * never appears here; its value comes from the item's workflow Kind.
 */

const KeySchema = Type.String({ pattern: "^[a-z][a-z0-9-]*$" })
export const LabelSelectionSchema = Type.Record(KeySchema, Type.Array(KeySchema, { uniqueItems: true }), {
    additionalProperties: false,
    description:
        "Value keys for every label group, other than `kind`, that applies to this item type; an empty list for an optional group with no value",
})
export type LabelSelection = Static<typeof LabelSelectionSchema>

const NameSchema = Type.String({ minLength: 1 })

/**
 * The item's labels, read fresh for this change: label names on GitHub, or on Linear the label
 * catalog of the item's kind (issue or Project labels) and the applied label IDs, as for Phase.
 */
export const LabelFactsSchema = Type.Union([
    Type.Object(
        { provider: Type.Enum(["github"], { type: "string" }), names: Type.Array(NameSchema) },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            provider: Type.Enum(["linear"], { type: "string" }),
            catalog: Type.Array(
                Type.Object(
                    {
                        id: NameSchema,
                        name: NameSchema,
                        team: Type.Optional(NameSchema),
                        parentId: Type.Optional(NameSchema),
                        isGroup: Type.Boolean(),
                        retiredAt: Type.Optional(NameSchema),
                    },
                    { additionalProperties: false },
                ),
            ),
            applied: Type.Array(NameSchema, { uniqueItems: true }),
        },
        { additionalProperties: false },
    ),
])
export type LabelFacts = Static<typeof LabelFactsSchema>

export type LabelSelectionError =
    | { kind: "kindInSelection" }
    | { kind: "unknownGroup"; group: string; groups: string[] }
    | { kind: "missingGroup"; group: string; values: string[] }
    | { kind: "unknownValue"; group: string; value: string; values: string[] }
    | { kind: "cardinality"; group: string; cardinality: Cardinality; selected: string[] }
    | { kind: "missingLabel"; name: string }

export class LabelSelectionFailure extends Error {
    constructor(readonly reason: LabelSelectionError) {
        super(describe(reason))
    }
}

function describe(reason: LabelSelectionError): string {
    const list = (values: string[]) => values.map((value) => JSON.stringify(value)).join(", ") || "none"
    switch (reason.kind) {
        case "kindInSelection":
            return "the `kind` label comes from the item's Kind; leave it out of the selection"
        case "unknownGroup":
            return `label group ${JSON.stringify(reason.group)} doesn't apply to this item; groups: ${list(reason.groups)}`
        case "missingGroup":
            return `label group ${JSON.stringify(reason.group)} needs a selection (an empty list when optional); values: ${list(reason.values)}`
        case "unknownValue":
            return `label group ${JSON.stringify(reason.group)} has no value ${JSON.stringify(reason.value)}; values: ${list(reason.values)}`
        case "cardinality":
            return `label group ${JSON.stringify(reason.group)} is ${reason.cardinality} but has ${list(reason.selected)}; correct the item's labels`
        case "missingLabel":
            return `label ${JSON.stringify(reason.name)} is missing or retired on the tracker; run /project-setup`
    }
}

type AnyGroup = GitHubLabelGroup | LinearLabelGroup
type AnyLabels = GitHubLabels | LinearLabels

/** A group's value keys and label names for one item type. */
function groupValues(key: string, group: AnyGroup, itemType: LabelItemType): [string, string][] {
    return groupValuesFor(key, group, itemType).map(([value, definition]) => [value, definition.name])
}

function groupsFor(labels: AnyLabels | undefined, itemType: LabelItemType): [string, AnyGroup][] {
    return Object.entries(labels?.groups ?? {}).filter(([, group]) => group.appliesTo.includes(itemType))
}

/** Every managed label name for an item type, the `kind` group included. */
export function managedLabelNames(labels: AnyLabels | undefined, itemType: LabelItemType): string[] {
    return groupsFor(labels, itemType).flatMap(([key, group]) =>
        groupValues(key, group, itemType).map(([, name]) => name),
    )
}

function cardinalityHolds(cardinality: Cardinality, count: number): boolean {
    switch (cardinality) {
        case "exactlyOne":
            return count === 1
        case "zeroOrOne":
            return count <= 1
        case "oneOrMore":
            return count >= 1
        case "zeroOrMore":
            return true
    }
}

/** The label names an item should carry: its selection checked against cardinality, plus its `kind` label. */
export function selectedLabelNames(
    labels: AnyLabels | undefined,
    itemType: LabelItemType,
    kind: WorkflowKind | undefined,
    selection: LabelSelection,
): string[] {
    if (KIND_GROUP_KEY in selection) throw new LabelSelectionFailure({ kind: "kindInSelection" })
    const groups = groupsFor(labels, itemType).filter(([key]) => key !== KIND_GROUP_KEY)
    for (const key of Object.keys(selection)) {
        if (!groups.some(([group]) => group === key))
            throw new LabelSelectionFailure({
                kind: "unknownGroup",
                group: key,
                groups: groups.map(([group]) => group),
            })
    }
    const names: string[] = []
    for (const [key, group] of groups) {
        const values = groupValues(key, group, itemType)
        const chosen = selection[key]
        if (!chosen)
            throw new LabelSelectionFailure({
                kind: "missingGroup",
                group: key,
                values: values.map(([value]) => value),
            })
        for (const value of chosen) {
            const match = values.find(([candidate]) => candidate === value)
            if (!match)
                throw new LabelSelectionFailure({
                    kind: "unknownValue",
                    group: key,
                    value,
                    values: values.map(([candidate]) => candidate),
                })
            names.push(match[1])
        }
        if (!cardinalityHolds(group.cardinality, chosen.length))
            throw new LabelSelectionFailure({
                kind: "cardinality",
                group: key,
                cardinality: group.cardinality,
                selected: chosen,
            })
    }
    const kindGroup = labels?.groups?.[KIND_GROUP_KEY]
    if (kind && kindGroup?.appliesTo.includes(itemType)) {
        const name = kindGroup.values[kind]?.name
        if (name) names.push(name)
    }
    return names
}

/**
 * A selection with every applicable group present: groups the partial selection leaves out are
 * empty, so a required group still fails its cardinality check. Unknown groups stay and fail.
 */
export function completeSelection(
    labels: AnyLabels | undefined,
    itemType: LabelItemType,
    partial: LabelSelection,
): LabelSelection {
    const empty = Object.fromEntries(
        groupsFor(labels, itemType)
            .filter(([key]) => key !== KIND_GROUP_KEY)
            .map(([key]) => [key, [] as string[]]),
    )
    return { ...empty, ...partial }
}

/** The current selection an item's applied labels express, for changes that keep the other groups. */
function selectionFromNames(labels: AnyLabels | undefined, itemType: LabelItemType, applied: readonly string[]) {
    const present = new Set(applied.map((name) => name.toLowerCase()))
    return Object.fromEntries(
        groupsFor(labels, itemType)
            .filter(([key]) => key !== KIND_GROUP_KEY)
            .map(([key, group]) => [
                key,
                groupValues(key, group, itemType)
                    .filter(([, name]) => present.has(name.toLowerCase()))
                    .map(([value]) => value),
            ]),
    )
}

export interface LabelUpdate<T> {
    labels: T[]
    changed: boolean
    /** Applied labels outside the configuration and the keep and retired lists, to mention to the user. */
    unknown: string[]
}

/**
 * The complete GitHub label set for an item: managed labels of its groups replaced by the selection,
 * every other label kept. Without a selection, the current one is kept and only `kind` follows the Kind.
 */
export function planGitHubLabelUpdate(
    labels: GitHubLabels | undefined,
    itemType: LabelItemType,
    kind: WorkflowKind | undefined,
    selection: LabelSelection | undefined,
    current: readonly string[],
): LabelUpdate<string> {
    const desired = selectedLabelNames(
        labels,
        itemType,
        kind,
        selection ?? selectionFromNames(labels, itemType, current),
    )
    const managed = new Set(managedLabelNames(labels, itemType).map((name) => name.toLowerCase()))
    const kept = current.filter((name) => !managed.has(name.toLowerCase()))
    const next = [...kept, ...desired]
    const lower = (values: readonly string[]) => new Set(values.map((value) => value.toLowerCase()))
    const before = lower(current)
    const after = lower(next)
    const everyManaged = lower(
        Object.values(labels?.groups ?? {}).flatMap((group) => Object.values(group.values).map((value) => value.name)),
    )
    const repository = { catalog: "repository", scope: "repository" } as const
    const lists = {
        keep: (labels?.unmanaged?.keep ?? []).map((entry) => ({ name: entry.name, location: repository })),
        retired: (labels?.retired ?? []).map((entry) => ({ name: entry.name, location: repository })),
    }
    return {
        labels: next,
        changed: before.size !== after.size || [...after].some((name) => !before.has(name)),
        unknown: kept.filter(
            (name) =>
                !everyManaged.has(name.toLowerCase()) &&
                isUnknownLabel({ name, location: repository, parentName: null }, lists),
        ),
    }
}

export interface LinearCatalogLabel {
    id: string
    name: string
    /** The configured team for a team label; null for a workspace label. */
    team: string | null
    parentId: string | null
    isGroup: boolean
    retiredAt: string | null
}

/**
 * The complete Linear label-ID set for an item, from the fresh catalog of its label kind (issue
 * labels for Deliverables, Project labels for Epics) and its applied IDs. Phase labels and labels
 * outside the managed groups are kept.
 */
export function planLinearLabelUpdate(
    labels: LinearLabels | undefined,
    phase: LinearPhaseGroup,
    team: string,
    itemType: LabelItemType,
    kind: WorkflowKind | undefined,
    selection: LabelSelection | undefined,
    facts: { catalog: readonly LinearCatalogLabel[]; applied: readonly string[] },
): LabelUpdate<string> {
    const byId = new Map(facts.catalog.map((label) => [label.id, label]))
    const appliedNames = facts.applied.flatMap((id) => (byId.has(id) ? [byId.get(id)!.name] : []))
    const desiredNames = selectedLabelNames(
        labels,
        itemType,
        kind,
        selection ?? selectionFromNames(labels, itemType, appliedNames),
    )
    const scopeTeam = (scope: "workspace" | "team") => (scope === "workspace" ? null : team)
    const find = (name: string, scope: "workspace" | "team") =>
        facts.catalog.filter((label) => !label.isGroup && label.name === name && label.team === scopeTeam(scope))
    const managedIds = new Set<string>()
    const nameScope = new Map<string, "workspace" | "team">()
    for (const [key, group] of Object.entries(labels?.groups ?? {})) {
        for (const [, name] of groupValues(key, group, itemType)) {
            nameScope.set(name, group.scope)
            for (const label of find(name, group.scope)) managedIds.add(label.id)
        }
    }
    const desiredIds = desiredNames.map((name) => {
        const active = find(name, nameScope.get(name) ?? "workspace").filter((label) => label.retiredAt === null)
        if (active.length !== 1) throw new LabelSelectionFailure({ kind: "missingLabel", name })
        return active[0].id
    })
    const phaseGroup = facts.catalog.find(
        (label) => label.isGroup && label.name === phase.group.name && label.team === scopeTeam(phase.scope),
    )
    const phaseIds = new Set(
        phaseGroup ? facts.catalog.filter((label) => label.parentId === phaseGroup.id).map((label) => label.id) : [],
    )
    const kept = facts.applied.filter((id) => !managedIds.has(id))
    const next = [...kept, ...desiredIds.filter((id) => !kept.includes(id))]
    const catalogKind = itemType === "epic" ? "project" : "issue"
    const locationOf = (label: LinearCatalogLabel) =>
        ({ catalog: catalogKind, scope: label.team === null ? "workspace" : "team" }) as const
    const lists = {
        keep: (labels?.unmanaged?.keep ?? []).map((entry) => ({ name: entry.name, location: entry })),
        retired: (labels?.retired ?? []).map((entry) => ({ name: entry.name, location: entry })),
    }
    const unknown = kept.flatMap((id) => {
        const label = byId.get(id)
        if (!label || phaseIds.has(id)) return []
        const parentName = label.parentId ? (byId.get(label.parentId)?.name ?? null) : null
        return isUnknownLabel({ name: label.name, location: locationOf(label), parentName }, lists) ? [label.name] : []
    })
    const before = new Set(facts.applied)
    return {
        labels: next,
        changed: next.length !== before.size || next.some((id) => !before.has(id)),
        unknown,
    }
}
