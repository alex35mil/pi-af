import { type Static, Type } from "typebox"

import { type DeliverableKind, DeliverableKindSchema, type EntityType } from "../__lib/domain.js"

/** Workflow items that carry labels: Epics, and Deliverables (Tasks and Gigs). */
export const LabelItemTypeSchema = Type.Enum(["epic", "deliverable"], { type: "string" })
export type LabelItemType = Static<typeof LabelItemTypeSchema>

export function labelItemType(entity: EntityType): LabelItemType {
    switch (entity) {
        case "epic":
            return "epic"
        case "task":
        case "gig":
            return "deliverable"
    }
}

export const CardinalitySchema = Type.Enum(["exactlyOne", "zeroOrOne", "oneOrMore", "zeroOrMore"], {
    type: "string",
})
export type Cardinality = Static<typeof CardinalitySchema>

const LabelKeySchema = Type.String({ pattern: "^[a-z][a-z0-9-]*$" })
const LabelNameSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })

/** One tracker label as setup provisions it. Runtime reads only `name`. */
export const LabelDefinitionSchema = Type.Object(
    {
        name: LabelNameSchema,
        color: Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" }),
        description: Type.String(),
    },
    { additionalProperties: false },
)
export type LabelDefinition = Static<typeof LabelDefinitionSchema>

const LabelValuesSchema = Type.Record(LabelKeySchema, LabelDefinitionSchema, {
    minProperties: 1,
    additionalProperties: false,
})

const groupProperties = {
    appliesTo: Type.Array(LabelItemTypeSchema, { minItems: 1, uniqueItems: true }),
    cardinality: CardinalitySchema,
    values: LabelValuesSchema,
}

export const GitHubLabelGroupSchema = Type.Object(groupProperties, { additionalProperties: false })
export type GitHubLabelGroup = Static<typeof GitHubLabelGroupSchema>

export const LinearLabelScopeSchema = Type.Enum(["workspace", "team"], { type: "string" })
export type LinearLabelScope = Static<typeof LinearLabelScopeSchema>

export const LinearLabelGroupSchema = Type.Object(
    {
        ...groupProperties,
        scope: LinearLabelScopeSchema,
        // Absent: the values are Linear labels with no native group.
        nativeGroup: Type.Optional(LabelDefinitionSchema),
    },
    { additionalProperties: false },
)
export type LinearLabelGroup = Static<typeof LinearLabelGroupSchema>

export const GitHubLabelEntrySchema = Type.Object({ name: LabelNameSchema }, { additionalProperties: false })
export type GitHubLabelEntry = Static<typeof GitHubLabelEntrySchema>

export const LinearLabelCatalogSchema = Type.Enum(["issue", "project"], { type: "string" })
export type LinearLabelCatalog = Static<typeof LinearLabelCatalogSchema>

export const LinearLabelEntrySchema = Type.Object(
    { name: LabelNameSchema, catalog: LinearLabelCatalogSchema, scope: LinearLabelScopeSchema },
    { additionalProperties: false },
)
export type LinearLabelEntry = Static<typeof LinearLabelEntrySchema>

const GroupsSchema = <T extends typeof GitHubLabelGroupSchema | typeof LinearLabelGroupSchema>(group: T) =>
    Type.Optional(Type.Record(LabelKeySchema, group, { additionalProperties: false }))

export const GitHubLabelsSchema = Type.Object(
    {
        groups: GroupsSchema(GitHubLabelGroupSchema),
        // Labels outside the configuration that the user chose to keep.
        unmanaged: Type.Optional(
            Type.Object({ keep: Type.Array(GitHubLabelEntrySchema) }, { additionalProperties: false }),
        ),
        // Retired (archived) labels that are accounted for, so runtime doesn't report them.
        retired: Type.Optional(Type.Array(GitHubLabelEntrySchema)),
    },
    { additionalProperties: false },
)
export type GitHubLabels = Static<typeof GitHubLabelsSchema>

export const LinearLabelsSchema = Type.Object(
    {
        groups: GroupsSchema(LinearLabelGroupSchema),
        unmanaged: Type.Optional(
            Type.Object({ keep: Type.Array(LinearLabelEntrySchema) }, { additionalProperties: false }),
        ),
        retired: Type.Optional(Type.Array(LinearLabelEntrySchema)),
    },
    { additionalProperties: false },
)
export type LinearLabels = Static<typeof LinearLabelsSchema>

const PhaseLabelValuesSchema = Type.Object(
    {
        planning: LabelDefinitionSchema,
        execution: LabelDefinitionSchema,
        selfReview: LabelDefinitionSchema,
    },
    { additionalProperties: false },
)

/** A Linear Phase label group: always single-select, with one child per Phase. */
export const LinearPhaseGroupSchema = Type.Object(
    {
        scope: LinearLabelScopeSchema,
        group: LabelDefinitionSchema,
        values: PhaseLabelValuesSchema,
    },
    { additionalProperties: false },
)
export type LinearPhaseGroup = Static<typeof LinearPhaseGroupSchema>

export const LinearPhaseGroupsSchema = Type.Object(
    { issues: LinearPhaseGroupSchema, projects: LinearPhaseGroupSchema },
    { additionalProperties: false },
)
export type LinearPhaseGroups = Static<typeof LinearPhaseGroupsSchema>

/** The reserved group whose value comes from the item's workflow Kind. */
export const KIND_GROUP_KEY = "kind"

export type WorkflowKind = "epic" | DeliverableKind

const DELIVERABLE_KINDS: readonly DeliverableKind[] = DeliverableKindSchema.enum

function kindValuesFor(itemType: LabelItemType): readonly WorkflowKind[] {
    switch (itemType) {
        case "epic":
            return ["epic"]
        case "deliverable":
            return DELIVERABLE_KINDS
    }
}

function kindItemType(kind: WorkflowKind): LabelItemType {
    return kind === "epic" ? "epic" : "deliverable"
}

type AnyLabels = GitHubLabels | LinearLabels

/** The configured `kind` label for an item's Kind, or none when no `kind` group covers its item type. */
export function kindLabelName(labels: AnyLabels | undefined, kind: WorkflowKind): string | undefined {
    const group = labels?.groups?.[KIND_GROUP_KEY]
    if (!group || !group.appliesTo.includes(kindItemType(kind))) return undefined
    return group.values[kind]?.name
}

// Linear rejects these label names because they duplicate native features.
const LINEAR_RESERVED_LABEL_NAMES = new Set([
    "assignee",
    "cycle",
    "effort",
    "estimate",
    "hours",
    "priority",
    "project",
    "state",
    "status",
])
const GITHUB_DESCRIPTION_LIMIT = 100

function assertKindGroup(group: GitHubLabelGroup | LinearLabelGroup): void {
    if (group.cardinality !== "exactlyOne") throw new Error("the `kind` label group must be `exactlyOne`")
    const expected = group.appliesTo.flatMap((itemType) => [...kindValuesFor(itemType)]).sort()
    const actual = Object.keys(group.values).sort()
    if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
        throw new Error(
            `the \`kind\` label group values must be exactly ${expected.map((key) => JSON.stringify(key)).join(", ")} for its \`appliesTo\``,
        )
    }
}

/** Value keys of a group that apply to one item type; only `kind` splits values by item type. */
function valuesForItemType(key: string, group: GitHubLabelGroup | LinearLabelGroup, itemType: LabelItemType) {
    if (!group.appliesTo.includes(itemType)) return []
    const entries = Object.entries(group.values)
    if (key !== KIND_GROUP_KEY) return entries
    const allowed = new Set<string>(kindValuesFor(itemType))
    return entries.filter(([value]) => allowed.has(value))
}

function assertDistinctNames(domain: string, names: readonly string[]): Set<string> {
    const seen = new Set<string>()
    for (const name of names) {
        const normalized = name.toLowerCase()
        if (seen.has(normalized))
            throw new Error(`label name ${JSON.stringify(name)} is used more than once in ${domain}`)
        seen.add(normalized)
    }
    return seen
}

function assertEntries<T extends { name: string }>(
    keep: readonly T[],
    retired: readonly T[],
    location: (entry: T) => string,
    managed: (entry: T) => Set<string>,
): void {
    const seen = new Map<string, "keep" | "retired">()
    for (const [list, entries] of [
        ["keep", keep],
        ["retired", retired],
    ] as const) {
        for (const entry of entries) {
            const id = `${location(entry)}\u0000${entry.name.toLowerCase()}`
            const previous = seen.get(id)
            if (previous === list) throw new Error(`label ${JSON.stringify(entry.name)} is listed twice in ${list}`)
            if (previous) throw new Error(`label ${JSON.stringify(entry.name)} can't be both kept and retired`)
            seen.set(id, list)
            if (managed(entry).has(entry.name.toLowerCase()))
                throw new Error(`${list} label ${JSON.stringify(entry.name)} names a managed label`)
        }
    }
}

export function assertGitHubLabels(labels: GitHubLabels | undefined): void {
    const groups = Object.entries(labels?.groups ?? {})
    for (const [key, group] of groups) if (key === KIND_GROUP_KEY) assertKindGroup(group)
    const definitions = groups.flatMap(([, group]) => Object.values(group.values))
    for (const definition of definitions) {
        if (definition.description.length > GITHUB_DESCRIPTION_LIMIT)
            throw new Error(
                `GitHub label ${JSON.stringify(definition.name)} description exceeds ${GITHUB_DESCRIPTION_LIMIT} characters`,
            )
    }
    const managed = assertDistinctNames(
        "the GitHub repository",
        definitions.map((definition) => definition.name),
    )
    assertEntries(
        labels?.unmanaged?.keep ?? [],
        labels?.retired ?? [],
        () => "repository",
        () => managed,
    )
}

function linearCatalogItemType(catalog: LinearLabelCatalog): LabelItemType {
    switch (catalog) {
        case "issue":
            return "deliverable"
        case "project":
            return "epic"
    }
}

/**
 * An item in the configured team sees workspace and team labels together, and runtime applies
 * labels by name, so each catalog's workspace and team scopes form one collision domain.
 */
export function assertLinearLabels(labels: LinearLabels | undefined, phase: LinearPhaseGroups): void {
    const groups = Object.entries(labels?.groups ?? {})
    for (const [key, group] of groups) if (key === KIND_GROUP_KEY) assertKindGroup(group)
    const managedByCatalog = new Map<LinearLabelCatalog, Set<string>>()
    for (const catalog of LinearLabelCatalogSchema.enum) {
        const itemType = linearCatalogItemType(catalog)
        const phaseGroup = catalog === "issue" ? phase.issues : phase.projects
        const names = [
            phaseGroup.group.name,
            ...Object.values(phaseGroup.values).map((value) => value.name),
            ...groups.flatMap(([key, group]) => {
                const values = valuesForItemType(key, group, itemType)
                if (values.length === 0) return []
                return [
                    ...(group.nativeGroup ? [group.nativeGroup.name] : []),
                    ...values.map(([, value]) => value.name),
                ]
            }),
        ]
        for (const name of names) {
            if (LINEAR_RESERVED_LABEL_NAMES.has(name.toLowerCase()))
                throw new Error(`Linear reserves the label name ${JSON.stringify(name)}`)
        }
        managedByCatalog.set(catalog, assertDistinctNames(`the Linear ${catalog} label catalog`, names))
    }
    assertEntries(
        labels?.unmanaged?.keep ?? [],
        labels?.retired ?? [],
        (entry) => `${entry.catalog}\u0000${entry.scope}`,
        (entry) => managedByCatalog.get(entry.catalog)!,
    )
}

/** Where a label lives: one GitHub repository, or a Linear catalog at workspace or team level. */
export type LabelLocation =
    | { catalog: "repository"; scope: "repository" }
    | { catalog: LinearLabelCatalog; scope: LinearLabelScope }

/** A label as the unknown-label rule sees it; managed labels are excluded before it's asked. */
export interface UnknownLabelCandidate {
    name: string
    location: LabelLocation
    /** The label's native Linear group, when it has one. */
    parentName: string | null
}

export interface UnknownLabelLists {
    keep: readonly { name: string; location: LabelLocation }[]
    retired: readonly { name: string; location: LabelLocation }[]
}

const sameLocation = (a: LabelLocation, b: LabelLocation) => a.catalog === b.catalog && a.scope === b.scope

/**
 * The one rule for an unknown label, shared by setup and runtime: a label that isn't managed is
 * unknown unless it, or the native group it belongs to, is on the keep list, or it's on the retired
 * list. Setup lists exactly these labels, so runtime never mentions one setup won't ask about.
 */
export function isUnknownLabel(label: UnknownLabelCandidate, lists: UnknownLabelLists): boolean {
    const listed = (entries: UnknownLabelLists["keep"], name: string) =>
        entries.some(
            (entry) => sameLocation(entry.location, label.location) && entry.name.toLowerCase() === name.toLowerCase(),
        )
    if (listed(lists.keep, label.name) || listed(lists.retired, label.name)) return false
    return label.parentName === null || !listed(lists.keep, label.parentName)
}
