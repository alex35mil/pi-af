import { createHash } from "node:crypto"

import {
    isUnknownLabel,
    type LabelLocation,
    type GitHubLabelEntry,
    type GitHubLabels,
    groupValuesFor,
    type LabelDefinition,
    type LabelItemType,
    type LinearLabelCatalog,
    type LinearLabelEntry,
    type LinearLabels,
    type LinearLabelScope,
    type LinearPhaseGroups,
} from "../integrations/labels.js"

/**
 * Label catalog planning, shared by both trackers. A GitHub repository has one flat catalog. A
 * Linear workspace has an issue catalog and a Project catalog, each with workspace and team labels
 * and one level of native groups. The planner is pure: adapters read and write the provider.
 */

export type CatalogKey = "repository" | LinearLabelCatalog
export type CatalogScope = "repository" | LinearLabelScope
export type GroupType = "singleSelect" | "multiSelect"

/** One label as the tracker currently has it, in a place setup reads. */
export interface TrackerLabel {
    id: string
    name: string
    color: string
    description: string
    retired: boolean
    catalog: CatalogKey
    scope: CatalogScope
    parentId: string | null
    isGroup: boolean
    groupType: GroupType | null
    /** Items carrying the label; a lower bound when `usageTruncated`. Native groups carry nothing directly. */
    usage: number
    usageTruncated: boolean
}

/** One label the configuration manages. `value: null` is a native Linear group itself. */
export interface ManagedEntry {
    key: string
    catalog: CatalogKey
    scope: CatalogScope
    group: string
    value: string | null
    definition: LabelDefinition
    parentKey: string | null
    groupType: GroupType | null
}

export type ListEntry = { name: string; catalog: CatalogKey; scope: CatalogScope }

/** The planner key of a configured value, or of a Linear native group when `value` is null. */
export const entryKey = (catalog: CatalogKey, group: string, value: string | null) =>
    value === null ? `${catalog}:${group}` : `${catalog}:${group}:${value}`

function groupTypeFor(cardinality: string): GroupType {
    return cardinality === "exactlyOne" || cardinality === "zeroOrOne" ? "singleSelect" : "multiSelect"
}

export function githubManagedEntries(labels: GitHubLabels | undefined): ManagedEntry[] {
    return Object.entries(labels?.groups ?? {}).flatMap(([group, config]) =>
        Object.entries(config.values).map(([value, definition]) => ({
            key: entryKey("repository", group, value),
            catalog: "repository" as const,
            scope: "repository" as const,
            group,
            value,
            definition,
            parentKey: null,
            groupType: null,
        })),
    )
}

function linearCatalogItemType(catalog: LinearLabelCatalog): LabelItemType {
    return catalog === "issue" ? "deliverable" : "epic"
}

export function linearManagedEntries(labels: LinearLabels | undefined, phase: LinearPhaseGroups): ManagedEntry[] {
    const entries: ManagedEntry[] = []
    for (const catalog of ["issue", "project"] as const) {
        const itemType = linearCatalogItemType(catalog)
        const phaseGroup = catalog === "issue" ? phase.issues : phase.projects
        const phaseKey = entryKey(catalog, "phase", null)
        entries.push({
            key: phaseKey,
            catalog,
            scope: phaseGroup.scope,
            group: "phase",
            value: null,
            definition: phaseGroup.group,
            parentKey: null,
            groupType: "singleSelect",
        })
        for (const [value, definition] of Object.entries(phaseGroup.values)) {
            entries.push({
                key: entryKey(catalog, "phase", value),
                catalog,
                scope: phaseGroup.scope,
                group: "phase",
                value,
                definition,
                parentKey: phaseKey,
                groupType: null,
            })
        }
        for (const [group, config] of Object.entries(labels?.groups ?? {})) {
            const values = groupValuesFor(group, config, itemType)
            if (values.length === 0) continue
            const groupKey = config.nativeGroup ? entryKey(catalog, group, null) : null
            if (config.nativeGroup && groupKey) {
                entries.push({
                    key: groupKey,
                    catalog,
                    scope: config.scope,
                    group,
                    value: null,
                    definition: config.nativeGroup,
                    parentKey: null,
                    groupType: groupTypeFor(config.cardinality),
                })
            }
            for (const [value, definition] of values) {
                entries.push({
                    key: entryKey(catalog, group, value),
                    catalog,
                    scope: config.scope,
                    group,
                    value,
                    definition,
                    parentKey: groupKey,
                    groupType: null,
                })
            }
        }
    }
    return entries
}

export function githubListEntries(entries: readonly GitHubLabelEntry[] | undefined): ListEntry[] {
    return (entries ?? []).map((entry) => ({ name: entry.name, catalog: "repository", scope: "repository" }))
}

export function linearListEntries(entries: readonly LinearLabelEntry[] | undefined): ListEntry[] {
    return (entries ?? []).map((entry) => ({ name: entry.name, catalog: entry.catalog, scope: entry.scope }))
}

export type CatalogAction =
    | {
          kind: "create"
          key: string
          catalog: CatalogKey
          scope: CatalogScope
          definition: LabelDefinition
          parentKey: string | null
          groupType: GroupType | null
          description: string
      }
    | {
          kind: "update"
          labelId: string
          name: string
          change: {
              name?: string
              color?: string
              description?: string
              groupType?: GroupType
              /** The managed group key to move under, or null to leave its group. */
              parentKey?: string | null
          }
          description: string
      }
    | { kind: "restore"; labelId: string; name: string; description: string }
    | {
          kind: "retire" | "delete"
          labelId: string
          name: string
          catalog: CatalogKey
          scope: CatalogScope
          isGroup: boolean
          /** `managed`: the configuration dropped it; `unknown`: the user removed it; `replaced`: a configured label replaces it. */
          origin: "managed" | "unknown" | "replaced"
          usage: number
          usageTruncated: boolean
          description: string
      }

export type DecisionOption =
    | "remove"
    | "keep"
    | "leaveRetired"
    | "restoreKeep"
    | "delete"
    | "restore"
    | "recreate"
    | "proceed"
    | "adopt"
    | "replace"

export interface DecisionLabel {
    name: string
    catalog: CatalogKey
    scope: CatalogScope
    usage: string
    retired?: true
    children?: string[]
}

/** A question the user answers with one of `options`. */
export interface QuestionDecision {
    id: string
    kind:
        | "unknownLabel"
        | "unknownRetiredLabel"
        | "managedRetired"
        | "managedMissing"
        | "groupTypeNarrowing"
        | "misplacedLabel"
        | "singleSelectMerge"
    message: string
    options: DecisionOption[]
    label?: DecisionLabel
}

/** A problem no answer fixes; `resolution` says what to change before previewing again. */
export interface ConflictDecision {
    id: string
    kind: "conflict"
    message: string
    resolution: string
}

export type Decision = QuestionDecision | ConflictDecision

/** An existing label the user maps onto a configured key; setup renames and moves it in place. */
export interface RemapEntry {
    name: string
    catalog: CatalogKey
    scope: CatalogScope
    key: string
}

export interface CatalogPlanInput {
    catalog: readonly TrackerLabel[]
    desired: readonly ManagedEntry[]
    /** The managed set setup last applied, or null when there is none. */
    previous: readonly ManagedEntry[] | null
    keep: readonly ListEntry[]
    retired: readonly ListEntry[]
    answers: Readonly<Record<string, string>>
    remap: readonly RemapEntry[]
}

type UpdateChange = Extract<CatalogAction, { kind: "update" }>["change"]

export interface CatalogPlan {
    actions: CatalogAction[]
    /** Desired keys already resolved to an existing tracker label, so creates can name their parent. */
    resolvedIds: Record<string, string>
    /** Desired keys already matching a tracker label they didn't match before, shown for transparency. */
    adopted: string[]
    keyMoves: { from: string; to: string; name: string }[]
    decisions: Decision[]
    keep: ListEntry[]
    retired: ListEntry[]
    droppedEntries: { list: "keep" | "retired"; entry: ListEntry; reason: string }[]
}

const lower = (value: string) => value.toLowerCase()
const usageText = (label: TrackerLabel) => `${label.usage}${label.usageTruncated ? "+" : ""}`
const where = (catalog: CatalogKey, scope: CatalogScope) =>
    catalog === "repository" ? "repository" : `${scope} ${catalog} labels`
const sameEntry = (a: ListEntry, b: ListEntry) =>
    a.catalog === b.catalog && a.scope === b.scope && lower(a.name) === lower(b.name)
const unknownId = (label: TrackerLabel) => `unknown:${label.catalog}:${label.scope}:${label.name}`
const unused = (label: TrackerLabel) => label.usage === 0 && !label.usageTruncated
const EARLY_DELETE = "an unused label is deleted before configured labels are created"

class Planner {
    readonly actions: CatalogAction[] = []
    readonly adopted: string[] = []
    readonly keyMoves: CatalogPlan["keyMoves"] = []
    readonly decisions: Decision[] = []
    readonly droppedEntries: CatalogPlan["droppedEntries"] = []
    /** Desired key → tracker label id, or `new:<key>` for a label this plan creates. */
    readonly resolved = new Map<string, string>()
    readonly claimed = new Set<string>()
    readonly answered = new Set<string>()
    keep: ListEntry[]
    retired: ListEntry[]
    readonly previousByKey: Map<string, ManagedEntry>
    readonly desiredByKey: Map<string, ManagedEntry>
    /** Unknown labels the user's answers delete, so they no longer hold a configured name. */
    readonly deleting: Set<string>
    /** Configured key → the existing label the user remaps onto it. */
    readonly remapByKey = new Map<string, TrackerLabel>()
    /** Configured group keys whose own decision is still unanswered. */
    readonly pendingGroups = new Set<string>()

    groupPending(key: string): boolean {
        return this.pendingGroups.has(key)
    }

    constructor(readonly input: CatalogPlanInput) {
        this.keep = [...input.keep]
        this.retired = [...input.retired]
        this.previousByKey = new Map((input.previous ?? []).map((entry) => [entry.key, entry]))
        this.desiredByKey = new Map(input.desired.map((entry) => [entry.key, entry]))
        this.deleting = this.answeredDeletions()
        this.readRemap()
    }

    childrenOf(label: TrackerLabel): TrackerLabel[] {
        return this.input.catalog.filter((child) => child.parentId === label.id)
    }

    /**
     * Labels that an unknown-label answer deletes rather than retires: a retired label answered
     * `delete`, or an active one answered `remove` that no item carries (a group with all its
     * children). A retired label keeps its name taken, so only these clear a name clash. A child
     * label of a kept group has its own answer; a child of a removed group goes with the group.
     */
    answeredDeletions(): Set<string> {
        const ids = new Set<string>()
        for (const label of this.input.catalog) {
            const answer = this.input.answers[unknownId(label)]
            const children = this.childrenOf(label)
            const deleted = label.retired
                ? answer === "delete"
                : answer === "remove" && unused(label) && children.every(unused)
            if (!deleted) continue
            ids.add(label.id)
            for (const child of children) ids.add(child.id)
        }
        return ids
    }

    readRemap(): void {
        const mapped = new Set<string>()
        for (const remap of this.input.remap) {
            const subject = `remap of ${JSON.stringify(remap.name)}`
            const target = this.desiredByKey.get(remap.key)
            if (!target) throw new Error(`${subject}: ${remap.key} isn't a configured label or label group`)
            if (target.catalog !== remap.catalog || target.scope !== remap.scope)
                throw new Error(
                    `${subject}: the label is in ${where(remap.catalog, remap.scope)}, but ${remap.key} is configured in ${where(target.catalog, target.scope)}`,
                )
            const matches = this.input.catalog.filter(
                (label) => label.catalog === remap.catalog && label.scope === remap.scope && label.name === remap.name,
            )
            if (matches.length !== 1)
                throw new Error(
                    `${subject}: ${matches.length} labels with that name exist in ${where(remap.catalog, remap.scope)}`,
                )
            const label = matches[0]
            if (label.retired) throw new Error(`${subject}: the label is retired; only active labels can be remapped`)
            const targetIsGroup = target.value === null
            if (label.isGroup !== targetIsGroup)
                throw new Error(
                    `${subject}: it's a ${label.isGroup ? "label group" : "label"}, but ${remap.key} is a ${targetIsGroup ? "label group" : "label"}`,
                )
            if (this.deleting.has(label.id))
                throw new Error(`${subject}: the label is also answered for removal; choose one`)
            if (mapped.has(label.id)) throw new Error(`${subject}: the label is remapped more than once`)
            if (this.remapByKey.has(remap.key))
                throw new Error(
                    `${subject}: ${remap.key} already receives another label; setup doesn't merge labels, because items carry each label separately`,
                )
            mapped.add(label.id)
            this.remapByKey.set(remap.key, label)
        }
    }

    labelInfo(label: TrackerLabel): DecisionLabel {
        const children = this.childrenOf(label)
        return {
            name: label.name,
            catalog: label.catalog,
            scope: label.scope,
            usage: label.isGroup
                ? `${children.reduce((sum, child) => sum + child.usage, 0)}${children.some((child) => child.usageTruncated) ? "+" : ""}`
                : usageText(label),
            ...(label.retired ? { retired: true as const } : {}),
            ...(label.isGroup ? { children: children.map((child) => child.name) } : {}),
        }
    }

    answer(decision: QuestionDecision): DecisionOption | undefined {
        const value = this.input.answers[decision.id]
        if (value === undefined) {
            this.decisions.push(decision)
            return undefined
        }
        if (!decision.options.includes(value as DecisionOption))
            throw new Error(
                `answer ${JSON.stringify(value)} isn't an option for decision ${decision.id}; options: ${decision.options.join(", ") || "none"}`,
            )
        this.answered.add(decision.id)
        return value as DecisionOption
    }

    conflict(id: string, message: string, resolution: string): void {
        this.decisions.push({ id: `conflict:${id}`, kind: "conflict", message, resolution })
    }

    /** Labels in one place that keep their name through this plan: answered deletions don't. */
    place(entry: { catalog: CatalogKey; scope: CatalogScope }, isGroup: boolean): TrackerLabel[] {
        return this.input.catalog.filter(
            (label) =>
                label.catalog === entry.catalog &&
                label.scope === entry.scope &&
                label.isGroup === isGroup &&
                !this.deleting.has(label.id),
        )
    }

    /** The tracker parent id a desired entry should have: a real id, a planned create, or none. */
    parentFor(entry: ManagedEntry): string | null {
        return entry.parentKey ? (this.resolved.get(entry.parentKey) ?? `new:${entry.parentKey}`) : null
    }

    pushUpdate(label: TrackerLabel, change: UpdateChange, subject = `Update ${JSON.stringify(label.name)}`): void {
        const parts = Object.entries(change).map(([field, value]) =>
            field === "name" ? `rename to ${JSON.stringify(value)}` : `${field} ${JSON.stringify(value)}`,
        )
        if (parts.length === 0) return
        this.actions.push({
            kind: "update",
            labelId: label.id,
            name: label.name,
            change,
            description: `${subject}: ${parts.join(", ")}`,
        })
    }

    metadataChange(label: TrackerLabel, entry: ManagedEntry) {
        return {
            ...(lower(label.color) !== lower(entry.definition.color) ? { color: entry.definition.color } : {}),
            ...(label.description !== entry.definition.description
                ? { description: entry.definition.description }
                : {}),
        }
    }

    create(entry: ManagedEntry): void {
        this.resolved.set(entry.key, `new:${entry.key}`)
        this.actions.push({
            kind: "create",
            key: entry.key,
            catalog: entry.catalog,
            scope: entry.scope,
            definition: entry.definition,
            parentKey: entry.parentKey,
            groupType: entry.groupType,
            description: `Create ${entry.value === null ? "label group" : "label"} ${JSON.stringify(entry.definition.name)} in ${where(entry.catalog, entry.scope)}`,
        })
    }

    restore(label: TrackerLabel, entry: ManagedEntry | null): void {
        this.claimed.add(label.id)
        if (entry) this.resolved.set(entry.key, label.id)
        this.actions.push({
            kind: "restore",
            labelId: label.id,
            name: label.name,
            description: `Restore retired label ${JSON.stringify(label.name)}`,
        })
        this.dropFrom("retired", label, "the label is restored")
    }

    /** Removes a label's entry from the keep or retired list, recording why for the preview. */
    dropFrom(
        list: "keep" | "retired",
        label: { name: string; catalog: CatalogKey; scope: CatalogScope },
        reason: string,
    ): void {
        const current = list === "keep" ? this.keep : this.retired
        const entry = current.find((item) => sameEntry(item, label))
        if (!entry) return
        const remaining = current.filter((item) => item !== entry)
        if (list === "keep") this.keep = remaining
        else this.retired = remaining
        this.droppedEntries.push({ list, entry, reason })
    }

    /** The group and group-type changes that put a label where a desired entry belongs. */
    placementChange(label: TrackerLabel, entry: ManagedEntry): Pick<UpdateChange, "parentKey" | "groupType"> {
        const change: Pick<UpdateChange, "parentKey" | "groupType"> = {}
        if ((entry.value !== null || entry.groupType === null) && (label.parentId ?? null) !== this.parentFor(entry))
            change.parentKey = entry.parentKey
        if (entry.groupType !== null && label.groupType !== entry.groupType) change.groupType = entry.groupType
        return change
    }

    /**
     * Places a desired entry onto an existing label: moves it into its group, sets its group type
     * (asking before narrowing a used group), and syncs color, description, and, for a remap, name.
     */
    adopt(label: TrackerLabel, entry: ManagedEntry, remapped: boolean): boolean {
        this.claimed.add(label.id)
        const placement = this.placementChange(label, entry)
        const used = this.childrenOf(label).some((child) => !unused(child))
        if (placement.groupType === "singleSelect" && used) {
            const answer = this.answer({
                id: `group-type:${entry.key}`,
                kind: "groupTypeNarrowing",
                message: `Changing label group ${JSON.stringify(label.name)} to single-select while items carry its labels. Items keep the labels they carry, so an item with several of them then holds more than one label from a single-select group, which Linear doesn't document.`,
                options: ["proceed"],
            })
            if (answer !== "proceed") {
                this.pendingGroups.add(entry.key)
                return false
            }
        }
        this.resolved.set(entry.key, label.id)
        const rename = remapped && label.name !== entry.definition.name ? { name: entry.definition.name } : {}
        this.pushUpdate(
            label,
            { ...rename, ...placement, ...this.metadataChange(label, entry) },
            remapped
                ? `Remap ${JSON.stringify(label.name)} to ${entry.key} (${this.labelInfo(label).usage} items keep it)`
                : undefined,
        )
        return true
    }

    /**
     * On first setup, a label with the configured name but in the wrong group or of the wrong group
     * type is the user's choice: adopt it in place, or, when nothing carries it and it has no
     * children, replace it. Either way it's this key's label, so it's never asked about as unknown.
     */
    planMisplaced(label: TrackerLabel, entry: ManagedEntry): void {
        this.claimed.add(label.id)
        const placement = this.placementChange(label, entry)
        const children = this.childrenOf(label)
        const replaceable = unused(label) && children.length === 0
        const parentName = (id: string | null) =>
            id === null ? null : (this.input.catalog.find((candidate) => candidate.id === id)?.name ?? id)
        const configuredParent = entry.parentKey ? this.desiredByKey.get(entry.parentKey)?.definition.name : null
        const reason =
            placement.groupType !== undefined
                ? `it's a ${label.groupType ?? "untyped"} label group, and the configuration needs ${entry.groupType}`
                : `it's ${label.parentId ? `in label group ${JSON.stringify(parentName(label.parentId))}` : "not in a label group"}, and the configuration puts it ${configuredParent ? `in ${JSON.stringify(configuredParent)}` : "outside label groups"}`
        const noReplace = children.length > 0 ? "it has child labels" : "items carry it"
        const answer = this.answer({
            id: `misplaced:${entry.key}`,
            kind: "misplacedLabel",
            message: `${label.retired ? "Retired " : ""}${label.isGroup ? "label group" : "label"} ${JSON.stringify(label.name)} in ${where(label.catalog, label.scope)} has the configured name, but ${reason}. Adopt it to ${label.retired ? "restore it and " : ""}move it into place, keeping the items that carry it${replaceable ? ", or replace it: delete it, then create the configured label" : `; replacing isn't offered because ${noReplace}`}.`,
            options: replaceable ? ["adopt", "replace"] : ["adopt"],
            label: this.labelInfo(label),
        })
        if (answer === "adopt") {
            if (label.retired) this.restore(label, entry)
            if (this.adopt(label, entry, false)) {
                this.adopted.push(entry.key)
                this.dropFrom("keep", label, "the configuration now manages it")
                this.dropFrom("retired", label, "the configuration now manages it")
            }
        } else if (answer === "replace") {
            this.pushRemoval(label, "delete", "replaced")
            this.dropFrom("keep", label, "the label is replaced")
            this.create(entry)
        } else if (entry.value === null) {
            this.pendingGroups.add(entry.key)
        }
    }

    planRemap(label: TrackerLabel, entry: ManagedEntry): void {
        this.claimed.add(label.id)
        const taken = this.input.catalog.find(
            (other) =>
                other.id !== label.id &&
                other.catalog === entry.catalog &&
                other.scope === entry.scope &&
                !this.deleting.has(other.id) &&
                lower(other.name) === lower(entry.definition.name),
        )
        if (taken) {
            this.conflict(
                `remap-target:${entry.key}`,
                `can't remap ${JSON.stringify(label.name)} to ${entry.key}: ${JSON.stringify(taken.name)} already has the name ${JSON.stringify(entry.definition.name)} in ${where(entry.catalog, entry.scope)}`,
                `Remap ${JSON.stringify(taken.name)} to ${entry.key} instead, or remove it (${EARLY_DELETE}), then preview again.`,
            )
            return
        }
        if (this.adopt(label, entry, true)) {
            const reason = `it's remapped to ${entry.key}`
            this.dropFrom("keep", label, reason)
            this.dropFrom("retired", label, reason)
        }
    }

    planDesired(entry: ManagedEntry): void {
        if (entry.parentKey !== null && !this.resolved.has(entry.parentKey) && this.groupPending(entry.parentKey)) {
            // Its group waits on a user answer; its children are planned once that's answered.
            for (const label of this.input.catalog)
                if (
                    label.catalog === entry.catalog &&
                    label.scope === entry.scope &&
                    label.name === entry.definition.name
                )
                    this.claimed.add(label.id)
            const remapped = this.remapByKey.get(entry.key)
            if (remapped) this.claimed.add(remapped.id)
            return
        }
        const remapped = this.remapByKey.get(entry.key)
        if (remapped) {
            this.planRemap(remapped, entry)
            return
        }
        const renamedAway = [...this.remapByKey].find(
            ([, label]) =>
                label.catalog === entry.catalog &&
                label.scope === entry.scope &&
                lower(label.name) === lower(entry.definition.name),
        )
        if (renamedAway) {
            this.conflict(
                `remap-name:${entry.key}`,
                `${JSON.stringify(renamedAway[1].name)} is remapped to ${renamedAway[0]}, but its current name is configured for ${entry.key}`,
                "Setup can't free a name and reuse it in one run. Apply without one of these changes, then preview again.",
            )
            return
        }
        const isGroup = entry.value === null
        const otherKind = this.place(entry, !isGroup).find(
            (label) => lower(label.name) === lower(entry.definition.name),
        )
        if (otherKind) {
            this.conflict(
                `kind-mismatch:${entry.key}`,
                `${JSON.stringify(otherKind.name)} exists in ${where(entry.catalog, entry.scope)} as a ${otherKind.isGroup ? "label group" : "label"}, but the configuration needs a ${isGroup ? "label group" : "label"}`,
                unused(otherKind) && this.childrenOf(otherKind).every(unused)
                    ? `Remove it (${EARLY_DELETE}), rename it in the tracker, or change the configured name, then preview again.`
                    : "Rename it in the tracker or change the configured name, then preview again. Items carry it, so removing it would only retire it, and a retired label keeps its name taken.",
            )
            return
        }
        const candidates = this.place(entry, isGroup)
        const exact = candidates.filter((label) => label.name === entry.definition.name)
        const activeExact = exact.filter((label) => !label.retired)
        const previous = this.previousByKey.get(entry.key)
        if (activeExact.length > 1) {
            this.conflict(
                `ambiguous:${entry.key}`,
                `${activeExact.length} labels named ${JSON.stringify(entry.definition.name)} exist in ${where(entry.catalog, entry.scope)}`,
                `Keep one: remove the others (${EARLY_DELETE}) or rename them in the tracker, then preview again.`,
            )
            return
        }
        if (activeExact.length === 1) {
            const label = activeExact[0]
            if (!previous && Object.keys(this.placementChange(label, entry)).length > 0) {
                this.planMisplaced(label, entry)
                return
            }
            if (this.adopt(label, entry, false)) {
                if (!previous) this.adopted.push(entry.key)
                this.dropFrom("keep", activeExact[0], "the configuration now manages it")
                this.dropFrom("retired", activeExact[0], "the configuration now manages it")
            }
            return
        }
        if (previous && previous.definition.name === entry.definition.name) {
            const retiredExact = exact.filter((label) => label.retired)
            if (retiredExact.length === 1) {
                // It's still this key's label, whatever the answer, so it never counts as unknown.
                this.claimed.add(retiredExact[0].id)
                const answer = this.answer({
                    id: `managed-retired:${entry.key}`,
                    kind: "managedRetired",
                    message: `Managed label ${JSON.stringify(entry.definition.name)} was retired outside setup, so it can't be applied. Restore it, or remove the value from the configuration and preview again.`,
                    options: ["restore"],
                })
                if (answer === "restore") {
                    this.restore(retiredExact[0], entry)
                    this.pushUpdate(retiredExact[0], this.metadataChange(retiredExact[0], entry))
                }
                return
            }
            this.missing(entry)
            return
        }
        if (previous) {
            const sources = candidates.filter((label) => label.name === previous.definition.name && !label.retired)
            if (sources.length > 1) {
                this.conflict(
                    `ambiguous:${entry.key}`,
                    `${sources.length} labels named ${JSON.stringify(previous.definition.name)} exist in ${where(entry.catalog, entry.scope)}`,
                    `Keep one: remove the others (${EARLY_DELETE}) or rename them in the tracker, then preview again.`,
                )
                return
            }
            if (sources.length === 1) {
                const source = sources[0]
                const taken = candidates.some(
                    (label) => label.id !== source.id && lower(label.name) === lower(entry.definition.name),
                )
                if (taken) {
                    this.conflict(
                        `rename-target:${entry.key}`,
                        `can't rename ${JSON.stringify(source.name)} to ${JSON.stringify(entry.definition.name)}: a label with that name already exists in ${where(entry.catalog, entry.scope)}`,
                        `Remove the label that has that name (${EARLY_DELETE}), or choose a different configured name, then preview again.`,
                    )
                    return
                }
                this.claimed.add(source.id)
                this.resolved.set(entry.key, source.id)
                this.pushUpdate(source, { name: entry.definition.name, ...this.metadataChange(source, entry) })
                return
            }
            this.missing(entry)
            return
        }
        const caseOnly = candidates.filter(
            (label) => !label.retired && lower(label.name) === lower(entry.definition.name),
        )
        if (caseOnly.length > 0) {
            this.conflict(
                `case:${entry.key}`,
                `${JSON.stringify(caseOnly[0].name)} in ${where(entry.catalog, entry.scope)} differs from the configured ${JSON.stringify(entry.definition.name)} only in case`,
                `Remap it to ${entry.key} to rename it in place, remove it (${EARLY_DELETE}), or change the configured name to match, then preview again.`,
            )
            return
        }
        const retiredExact = exact.filter((label) => label.retired)
        if (retiredExact.length > 1) {
            this.conflict(
                `ambiguous-retired:${entry.key}`,
                `${retiredExact.length} retired labels named ${JSON.stringify(entry.definition.name)} exist in ${where(entry.catalog, entry.scope)}`,
                "Answer delete for all but one of them, then preview again.",
            )
            return
        }
        if (retiredExact.length === 1) {
            if (Object.keys(this.placementChange(retiredExact[0], entry)).length > 0) {
                this.planMisplaced(retiredExact[0], entry)
                return
            }
            this.restore(retiredExact[0], entry)
            this.pushUpdate(retiredExact[0], this.metadataChange(retiredExact[0], entry))
            this.dropFrom("keep", retiredExact[0], "the configuration now manages it")
            return
        }
        this.create(entry)
    }

    missing(entry: ManagedEntry): void {
        const answer = this.answer({
            id: `managed-missing:${entry.key}`,
            kind: "managedMissing",
            message: `Managed label ${JSON.stringify(entry.definition.name)} is missing from ${where(entry.catalog, entry.scope)}; it was deleted or renamed outside setup. Recreate it, or remove the value from the configuration and preview again.`,
            options: ["recreate"],
        })
        if (answer === "recreate") this.create(entry)
    }

    /** Linear applies labels by name, and an item sees workspace and team labels together. */
    checkLevelCollisions(): void {
        for (const entry of this.input.desired) {
            if (entry.catalog === "repository") continue
            const other = this.input.catalog.filter(
                (label) =>
                    label.catalog === entry.catalog &&
                    label.scope !== entry.scope &&
                    !this.deleting.has(label.id) &&
                    lower(label.name) === lower(entry.definition.name),
            )
            for (const label of other) {
                const removable = unused(label) && this.childrenOf(label).every(unused)
                this.conflict(
                    `level:${entry.key}:${label.id}`,
                    `${JSON.stringify(entry.definition.name)} is configured as a ${entry.scope} label, and a ${label.scope} label ${JSON.stringify(label.name)} exists in the same ${entry.catalog} catalog; runtime applies labels by name and can't tell them apart`,
                    `Configure the group with scope ${label.scope}, ${removable ? `remove that label (${EARLY_DELETE})` : "rename that label in the tracker"}, or change the configured name, then preview again.`,
                )
            }
        }
    }

    removal(label: TrackerLabel, origin: "managed" | "unknown" | "replaced"): void {
        this.claimed.add(label.id)
        if (label.isGroup) return // Decided after its children, in finishGroups.
        const kind = label.usage > 0 ? "retire" : "delete"
        this.pushRemoval(label, kind, origin)
    }

    pushRemoval(label: TrackerLabel, kind: "retire" | "delete", origin: "managed" | "unknown" | "replaced"): void {
        const subject = `${label.isGroup ? "label group" : "label"} ${JSON.stringify(label.name)}`
        this.actions.push({
            kind,
            labelId: label.id,
            name: label.name,
            catalog: label.catalog,
            scope: label.scope,
            isGroup: label.isGroup,
            origin,
            usage: label.usage,
            usageTruncated: label.usageTruncated,
            description:
                origin === "replaced"
                    ? `Delete ${subject} to replace it with the configured one (no items carry it)`
                    : kind === "delete"
                      ? `Delete ${origin} ${subject} (no items carry it)`
                      : `Retire ${origin} ${subject} (${usageText(label)} items keep it)`,
        })
        if (kind === "retire") {
            const entry = { name: label.name, catalog: label.catalog, scope: label.scope }
            if (!this.retired.some((item) => sameEntry(item, entry))) this.retired.push(entry)
        } else {
            this.dropFrom("retired", label, "the label is deleted")
        }
    }

    planRemovals(): void {
        for (const previous of this.previousByKey.values()) {
            if (this.desiredByKey.has(previous.key)) continue
            const samePlace = (entry: ManagedEntry) =>
                entry.catalog === previous.catalog &&
                entry.scope === previous.scope &&
                (entry.value === null) === (previous.value === null) &&
                !this.previousByKey.has(entry.key)
            const moved = this.input.desired.find(
                (entry) => samePlace(entry) && entry.definition.name === previous.definition.name,
            )
            if (moved) {
                this.keyMoves.push({ from: previous.key, to: moved.key, name: moved.definition.name })
                continue
            }
            const caseMoved = this.input.desired.find(
                (entry) => samePlace(entry) && lower(entry.definition.name) === lower(previous.definition.name),
            )
            if (caseMoved) {
                this.conflict(
                    `key-move:${previous.key}`,
                    `key ${previous.key} was removed and ${caseMoved.key} added with ${JSON.stringify(caseMoved.definition.name)}, which differs from ${JSON.stringify(previous.definition.name)} only in case`,
                    "Change the key and the name's case in separate runs: apply one change, then preview the other.",
                )
                continue
            }
            const label = this.place(previous, previous.value === null).find(
                (candidate) => candidate.name === previous.definition.name && !this.claimed.has(candidate.id),
            )
            if (!label) continue
            if (label.retired) {
                this.claimed.add(label.id)
                const entry = { name: label.name, catalog: label.catalog, scope: label.scope }
                if (!this.retired.some((item) => sameEntry(item, entry))) this.retired.push(entry)
                continue
            }
            this.removal(label, "managed")
        }
    }

    planUnknown(): void {
        const listed = (list: readonly ListEntry[], label: TrackerLabel) => list.some((item) => sameEntry(item, label))
        const asLocation = (entry: { catalog: CatalogKey; scope: CatalogScope }) => entry as LabelLocation
        // The keep list decides through the shared rule; a retired entry whose label is active again is
        // handled below, because setup drops that stale entry and asks about the label anew.
        const kept = (label: TrackerLabel) =>
            !isUnknownLabel(
                {
                    name: label.name,
                    location: asLocation(label),
                    parentName: label.parentId
                        ? (this.input.catalog.find((candidate) => candidate.id === label.parentId)?.name ?? null)
                        : null,
                },
                { keep: this.keep.map((entry) => ({ name: entry.name, location: asLocation(entry) })), retired: [] },
            )
        const unclaimed = this.input.catalog.filter((label) => !this.claimed.has(label.id))
        const unknownGroups = new Map<string, TrackerLabel[]>()
        for (const label of unclaimed) {
            if (!label.isGroup) continue
            const children = this.input.catalog.filter((child) => child.parentId === label.id)
            if (children.some((child) => this.claimed.has(child.id))) continue
            unknownGroups.set(label.id, children)
        }
        for (const label of unclaimed) {
            if (label.parentId && unknownGroups.has(label.parentId)) continue
            if (label.isGroup && !unknownGroups.has(label.id)) continue
            if (kept(label)) continue
            const onRetiredList = listed(this.retired, label)
            if (onRetiredList && label.retired) continue
            if (onRetiredList) this.dropFrom("retired", label, "the label is active again")
            const children = unknownGroups.get(label.id) ?? []
            const info = this.labelInfo(label)
            const shared = label.scope === "workspace" ? " It's a workspace label that other teams may use." : ""
            const subject = `${label.isGroup ? "Label group" : "Label"} ${JSON.stringify(label.name)} in ${where(label.catalog, label.scope)}`
            if (label.retired) {
                const answer = this.answer({
                    id: unknownId(label),
                    kind: "unknownRetiredLabel",
                    message: `${subject} isn't in the configuration and was retired outside setup.${shared}`,
                    options: ["leaveRetired", "restoreKeep", "delete"],
                    label: info,
                })
                if (answer === "leaveRetired") {
                    this.claimed.add(label.id)
                    this.retired.push({ name: label.name, catalog: label.catalog, scope: label.scope })
                } else if (answer === "restoreKeep") {
                    this.restore(label, null)
                    this.keep.push({ name: label.name, catalog: label.catalog, scope: label.scope })
                } else if (answer === "delete") {
                    this.claimed.add(label.id)
                    for (const child of children) this.pushRemoval(child, "delete", "unknown")
                    this.pushRemoval(label, "delete", "unknown")
                }
                continue
            }
            const answer = this.answer({
                id: unknownId(label),
                kind: "unknownLabel",
                message: `${subject} isn't in the configuration.${shared}`,
                options: ["remove", "keep"],
                label: info,
            })
            if (answer === "keep") {
                this.claimed.add(label.id)
                this.keep.push({ name: label.name, catalog: label.catalog, scope: label.scope })
            } else if (answer === "remove") {
                for (const child of children) this.removal(child, "unknown")
                this.removal(label, "unknown")
            }
        }
    }

    /** A removed native group is deleted when every child goes away, and retired otherwise. */
    finishGroups(): void {
        for (const group of this.input.catalog) {
            if (!group.isGroup || !this.claimed.has(group.id)) continue
            const removedHere = this.actions.some(
                (action) => (action.kind === "retire" || action.kind === "delete") && action.labelId === group.id,
            )
            const removedByKey = [...this.previousByKey.values()].some(
                (entry) =>
                    entry.value === null &&
                    !this.desiredByKey.has(entry.key) &&
                    entry.catalog === group.catalog &&
                    entry.scope === group.scope &&
                    entry.definition.name === group.name,
            )
            const unknownRemoval = this.actions.some(
                (action) =>
                    (action.kind === "retire" || action.kind === "delete") &&
                    action.origin === "unknown" &&
                    this.input.catalog.find((label) => label.id === action.labelId)?.parentId === group.id,
            )
            if (removedHere || !(removedByKey || unknownRemoval)) continue
            const kept = new Set(this.resolved.values())
            if (kept.has(group.id)) continue
            // Children that stay managed move out of the group before it's removed.
            const children = this.input.catalog.filter((child) => child.parentId === group.id && !kept.has(child.id))
            const allDeleted = children.every((child) =>
                this.actions.some((action) => action.kind === "delete" && action.labelId === child.id),
            )
            this.pushRemoval(group, allDeleted ? "delete" : "retire", removedByKey ? "managed" : "unknown")
        }
    }

    dropStaleRetired(): void {
        this.retired = this.retired.filter((entry) => {
            const exists = this.input.catalog.some((label) => sameEntry(entry, label))
            const removed = this.actions.some(
                (action) => action.kind === "retire" && sameEntry(entry, { ...action, name: action.name }),
            )
            if (exists || removed) return true
            this.droppedEntries.push({ list: "retired", entry, reason: "the label no longer exists" })
            return false
        })
    }

    /**
     * Linear keeps one label of a single-select group per item: moving a label into one drops it from
     * items that already carry another of its labels. Usage reads stop at one item, so this asks
     * whenever two used labels end up in the group and at least one of them moves in now.
     */
    checkSingleSelectMoves(): void {
        for (const group of this.input.desired) {
            if (group.value !== null || group.groupType !== "singleSelect") continue
            const groupId = this.resolved.get(group.key)
            if (groupId === undefined) continue
            const updates = new Map(
                this.actions.flatMap((action) => (action.kind === "update" ? [[action.labelId, action.change]] : [])),
            )
            const removed = new Set(
                this.actions.flatMap((action) =>
                    action.kind === "retire" || action.kind === "delete" ? [action.labelId] : [],
                ),
            )
            const restored = new Set(
                this.actions.flatMap((action) => (action.kind === "restore" ? [action.labelId] : [])),
            )
            const moving: TrackerLabel[] = []
            const staying: TrackerLabel[] = []
            for (const label of this.input.catalog) {
                // Retired labels stay on their items; one this plan restores is active again.
                const retiredAfter = label.retired && !restored.has(label.id)
                if (label.isGroup || retiredAfter || removed.has(label.id) || unused(label)) continue
                const parentKey = updates.get(label.id)?.parentKey
                if (parentKey === group.key) moving.push(label)
                else if (parentKey === undefined && label.parentId !== null && label.parentId === groupId)
                    staying.push(label)
            }
            if (moving.length === 0 || moving.length + staying.length < 2) continue
            const names = (labels: TrackerLabel[]) =>
                labels.map((label) => `${JSON.stringify(label.name)} (${usageText(label)} items)`).join(", ")
            this.answer({
                id: `single-select:${group.key}`,
                kind: "singleSelectMerge",
                message: `Moving ${names(moving)} into single-select label group ${JSON.stringify(group.definition.name)}${staying.length > 0 ? `, which already holds ${names(staying)},` : ""} can drop labels: Linear keeps only one label of a single-select group on an item, so an item that carries several of them loses all but one. Proceed to move them anyway. Otherwise, make the group multi-select (cardinality zeroOrMore or oneOrMore) or drop a remap, then preview again.`,
                options: ["proceed"],
            })
        }
    }

    checkDoubleTargets(): void {
        const writes = new Map<string, string[]>()
        for (const action of this.actions) {
            if (action.kind === "create") continue
            const kinds = writes.get(action.labelId) ?? []
            kinds.push(action.kind)
            writes.set(action.labelId, kinds)
        }
        for (const [labelId, kinds] of writes) {
            const restoreThenUpdate = kinds.length === 2 && kinds[0] === "restore" && kinds[1] === "update"
            if (kinds.length > 1 && !restoreThenUpdate) {
                const label = this.input.catalog.find((candidate) => candidate.id === labelId)
                this.conflict(
                    `double-target:${labelId}`,
                    `the plan changes ${JSON.stringify(label?.name ?? labelId)} more than once (${kinds.join(", ")})`,
                    "Change the remap entries or answers so each label is changed once, then preview again.",
                )
            }
        }
        const names = new Map<string, number>()
        for (const action of this.actions) {
            const name =
                action.kind === "create"
                    ? `${action.catalog}:${action.scope}:${lower(action.definition.name)}`
                    : action.kind === "update" && action.change.name
                      ? `${this.input.catalog.find((label) => label.id === action.labelId)?.catalog}:${this.input.catalog.find((label) => label.id === action.labelId)?.scope}:${lower(action.change.name)}`
                      : undefined
            if (name) names.set(name, (names.get(name) ?? 0) + 1)
        }
        for (const [name, count] of names) {
            if (count > 1)
                this.conflict(
                    `double-name:${name}`,
                    `the plan gives ${count} labels the same name (${name})`,
                    "Give the configured values distinct names, or change the remap entries, then preview again.",
                )
        }
    }
}

export function planCatalog(input: CatalogPlanInput): CatalogPlan {
    const planner = new Planner(input)
    const groupsFirst = [...input.desired].sort((a, b) => Number(b.value === null) - Number(a.value === null))
    for (const entry of groupsFirst) planner.planDesired(entry)
    planner.checkLevelCollisions()
    planner.planRemovals()
    planner.planUnknown()
    planner.finishGroups()
    planner.dropStaleRetired()
    planner.checkDoubleTargets()
    planner.checkSingleSelectMoves()
    for (const id of Object.keys(input.answers)) {
        if (!planner.answered.has(id) && !planner.decisions.some((decision) => decision.id === id))
            throw new Error(`answer for ${id} doesn't match any current decision; preview again without it`)
    }
    // A delete that frees a name this plan creates or renames to runs first: trackers reject a
    // duplicate name, across labels and groups and, on Linear, across workspace and team. A freed
    // group's children, all deleted with it, run just before it.
    const byId = new Map(input.catalog.map((label) => [label.id, label]))
    const claimedNames = new Set(
        planner.actions.flatMap((action) =>
            action.kind === "create"
                ? [`${action.catalog}:${lower(action.definition.name)}`]
                : action.kind === "update" && action.change.name !== undefined
                  ? [`${byId.get(action.labelId)?.catalog}:${lower(action.change.name)}`]
                  : [],
        ),
    )
    const early = new Set(
        planner.actions
            .filter((action) => action.kind === "delete" && claimedNames.has(`${action.catalog}:${lower(action.name)}`))
            .map((action) => (action as { labelId: string }).labelId),
    )
    for (const action of planner.actions) {
        const parentId = action.kind === "delete" ? byId.get(action.labelId)?.parentId : null
        if (action.kind === "delete" && parentId && early.has(parentId)) early.add(action.labelId)
    }
    // Writes run in dependency order: groups before children, removals of children before groups.
    const order = (action: CatalogAction) => {
        switch (action.kind) {
            case "restore":
                return 0
            case "create":
                return action.parentKey === null ? 1 : 2
            case "update":
                return 3
            case "retire":
                return action.isGroup ? 5 : 4
            case "delete":
                if (early.has(action.labelId)) return action.isGroup ? -1 : -2
                return action.isGroup ? 5 : 4
        }
    }
    const actions = planner.actions
        .map((action, index) => ({ action, index }))
        .sort((a, b) => order(a.action) - order(b.action) || a.index - b.index)
        .map(({ action }) => action)
    const moved = new Set(planner.keyMoves.map((move) => move.to))
    return {
        actions,
        resolvedIds: Object.fromEntries([...planner.resolved].filter(([, id]) => !id.startsWith("new:"))),
        adopted: planner.adopted.filter((key) => !moved.has(key)),
        keyMoves: planner.keyMoves,
        decisions: planner.decisions,
        keep: planner.keep,
        retired: planner.retired,
        droppedEntries: planner.droppedEntries,
    }
}

export function planHash(value: unknown): string {
    return createHash("sha256").update(stableJson(value)).digest("hex")
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
    if (value && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
            .join(",")}}`
    return JSON.stringify(value)
}
