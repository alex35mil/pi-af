import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, type TSchema, Type } from "typebox"

import { compile, describeErrors } from "../../../extensions/__lib/schema.js"
import * as project from "../../../extensions/__lib/project.js"
import { INTEGRATION_CONFIG_PATH, type IntegrationConfig, IntegrationConfigValidator } from "../integrations/config.js"
import {
    assertGitHubLabels,
    assertLinearLabels,
    GitHubLabelsSchema,
    LinearLabelCatalogSchema,
    LinearLabelScopeSchema,
    LinearLabelsSchema,
    LinearPhaseGroupsSchema,
    type GitHubLabels,
    type LinearLabels,
} from "../integrations/labels.js"
import { type LinearClient, linearClientFor } from "../integrations/tracker/linear.js"
import { clientFor, type GitHubClient } from "./github-project.js"
import {
    type CatalogAction,
    type CatalogKey,
    type CatalogPlan,
    type CatalogScope,
    entryKey,
    githubListEntries,
    githubManagedEntries,
    type GroupType,
    linearListEntries,
    linearManagedEntries,
    type ListEntry,
    type ManagedEntry,
    planCatalog,
    planHash,
    type RemapEntry,
    type TrackerLabel,
} from "./label-catalog.js"

const EnvironmentNameSchema = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" })
const RepositorySchema = Type.Object(
    { owner: Type.String({ minLength: 1 }), repo: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
)

const GitHubTargetSchema = Type.Object(
    {
        provider: Type.Enum(["github"], { type: "string" }),
        credentialEnv: EnvironmentNameSchema,
        repository: RepositorySchema,
    },
    { additionalProperties: false },
)
const LinearTargetSchema = Type.Object(
    {
        provider: Type.Enum(["linear"], { type: "string" }),
        credentialEnv: EnvironmentNameSchema,
        team: Type.String({ minLength: 1, description: "The configured Linear team's name, key, or ID" }),
    },
    { additionalProperties: false },
)
const TargetSchema = Type.Union([GitHubTargetSchema, LinearTargetSchema], {
    description: "Tracker identity and the environment variable holding its API credential",
})

const AnswersSchema = Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 }), {
    description: "The user's answer to each reported decision, keyed by decision id",
})

const KeySchema = Type.String({ pattern: "^[a-z][a-z0-9-]*$" })
const LabelNameSchema = Type.String({ minLength: 1 })
const GitHubRemapSchema = Type.Object(
    { name: LabelNameSchema, group: KeySchema, value: KeySchema },
    { additionalProperties: false },
)
const LinearRemapSchema = Type.Object(
    {
        name: LabelNameSchema,
        catalog: LinearLabelCatalogSchema,
        scope: LinearLabelScopeSchema,
        group: KeySchema,
        // Absent: the label becomes the group's native label group.
        value: Type.Optional(KeySchema),
    },
    { additionalProperties: false },
)
const remapDescription =
    "Existing labels the user maps onto configured values; setup renames, moves, and restyles each in place, so items keep it. Each value takes at most one label."
const approvedPlanHash = Type.String({ pattern: "^[a-f0-9]{64}$" })

const GitHubDesired = {
    target: GitHubTargetSchema,
    labels: GitHubLabelsSchema,
    remap: Type.Optional(Type.Array(GitHubRemapSchema)),
    answers: Type.Optional(AnswersSchema),
}
const LinearDesired = {
    target: LinearTargetSchema,
    labels: LinearLabelsSchema,
    phase: LinearPhaseGroupsSchema,
    remap: Type.Optional(Type.Array(LinearRemapSchema)),
    answers: Type.Optional(AnswersSchema),
}
const object = <T extends Record<string, TSchema>>(properties: T) =>
    Type.Object(properties, { additionalProperties: false })

/** The exact input for each operation and provider; validation picks one by `target.provider`. */
const providerSchemas = {
    inspect: { github: object({ target: GitHubTargetSchema }), linear: object({ target: LinearTargetSchema }) },
    preview: { github: object(GitHubDesired), linear: object(LinearDesired) },
    apply: {
        github: object({ ...GitHubDesired, approvedPlanHash }),
        linear: object({ ...LinearDesired, approvedPlanHash }),
    },
} as const
const providerValidators = {
    inspect: {
        github: compile(providerSchemas.inspect.github),
        linear: compile(providerSchemas.inspect.linear),
    },
    preview: {
        github: compile(providerSchemas.preview.github),
        linear: compile(providerSchemas.preview.linear),
    },
    apply: { github: compile(providerSchemas.apply.github), linear: compile(providerSchemas.apply.linear) },
}

type GitHubPreviewInput = Static<typeof providerSchemas.preview.github>
type LinearPreviewInput = Static<typeof providerSchemas.preview.linear>
type DesiredInput = GitHubPreviewInput | LinearPreviewInput

export type LabelSetupToolInput =
    | { operation: "inspect"; target: Static<typeof TargetSchema> }
    | ({ operation: "preview" } & DesiredInput)
    | ({ operation: "apply"; approvedPlanHash: string } & DesiredInput)
export type LabelSetupOperation = LabelSetupToolInput["operation"]

/*
 * The registered parameters describe both providers for the model. They're deliberately loose:
 * `parseLabelSetupInput` validates against the target provider's exact schema, so errors come
 * from that provider only, never from the other branch of a union.
 */
const desiredProperties = {
    target: TargetSchema,
    labels: Type.Union([GitHubLabelsSchema, LinearLabelsSchema], {
        description: "The complete desired `tracker.labels` section, including the current keep and retired lists",
    }),
    phase: Type.Optional(
        Type.Union([LinearPhaseGroupsSchema], { description: "Linear only: the desired `tracker.phase` groups" }),
    ),
    remap: Type.Optional(
        Type.Union([Type.Array(GitHubRemapSchema), Type.Array(LinearRemapSchema)], {
            description: `${remapDescription} GitHub entries name the label, group, and value; Linear entries also name the catalog and scope, and omit value to map a label group onto the group's native label group.`,
        }),
    ),
    answers: Type.Optional(AnswersSchema),
}

export const InspectLabelSetupSchema = Type.Object({ target: TargetSchema }, { additionalProperties: false })
export const PreviewLabelSetupSchema = Type.Object(desiredProperties, { additionalProperties: false })
export const ApplyLabelSetupSchema = Type.Object(
    { ...desiredProperties, approvedPlanHash },
    { additionalProperties: false },
)

/**
 * Validates tool input against the exact schema for its operation and `target.provider`, and
 * reports only that schema's errors.
 */
export function parseLabelSetupInput(operation: LabelSetupOperation, raw: unknown): LabelSetupToolInput {
    const provider = (raw as { target?: { provider?: unknown } } | null)?.target?.provider
    if (provider !== "github" && provider !== "linear")
        throw new Error('label setup input is invalid: target.provider must be "github" or "linear"')
    const validator = providerValidators[operation][provider]
    if (!validator.check(raw)) {
        const errors = [...new Set(describeErrors(validator.errors(raw)))].map((line) => `  - ${line}`)
        throw new Error(`label setup input for ${provider} is invalid:\n${errors.join("\n")}`)
    }
    return { operation, ...(raw as object) } as LabelSetupToolInput
}

export interface LabelSetupOptions {
    cwd: string
    fetch?: typeof fetch
    env?: NodeJS.ProcessEnv
    signal?: AbortSignal
}

interface ProviderAdapter {
    readCatalog(): Promise<TrackerLabel[]>
    apply(action: CatalogAction, resolveParent: (key: string | null) => string | null): Promise<string | undefined>
    /** Whether a saved tracker configuration describes this target, so its managed set applies. */
    sameTarget(tracker: IntegrationConfig["tracker"]): Promise<boolean>
}

export async function runLabelSetup(
    input: LabelSetupToolInput,
    options: LabelSetupOptions,
): Promise<Record<string, unknown>> {
    parseLabelSetupInput(input.operation, withoutOperation(input))
    const adapter = adapterFor(input.target, options)
    const previous = await readPrevious(options.cwd, adapter)
    const catalog = await adapter.readCatalog()
    if (input.operation === "inspect") {
        return {
            target: describeTarget(input.target),
            catalog,
            previous: previous
                ? { labels: previous.labels, ...(previous.phase ? { phase: previous.phase } : {}) }
                : null,
        }
    }
    const desired = desiredFor(input)
    const plan = planCatalog({
        catalog,
        desired: desired.entries,
        previous: previous ? previous.entries : null,
        keep: desired.keep,
        retired: desired.retired,
        answers: input.answers ?? {},
        remap: desired.remap,
    })
    const hash = planHash({
        target: input.target,
        desired: desired.raw,
        remap: input.remap ?? [],
        answers: input.answers ?? {},
        catalog,
        plan,
    })
    const removals = plan.actions.filter((action) => action.kind === "retire" || action.kind === "delete")
    // Built and validated before any write, so an invalid result never follows tracker changes.
    const configuration = plan.decisions.length === 0 ? configurationFor(input, plan) : undefined
    const preview = {
        state: plan.decisions.length > 0 ? ("decisions-needed" as const) : ("ready" as const),
        target: describeTarget(input.target),
        actions: plan.actions.filter((action) => action.kind !== "retire" && action.kind !== "delete"),
        removals,
        keyMoves: plan.keyMoves,
        adopted: plan.adopted,
        decisions: plan.decisions,
        droppedEntries: plan.droppedEntries,
        planHash: hash,
    }
    if (input.operation === "preview") return preview
    if (preview.state !== "ready") throw new Error("label setup has unanswered decisions or conflicts; preview again")
    if (input.approvedPlanHash !== hash)
        throw new Error("label setup changed after approval; preview and approve the new exact plan")
    if (!configuration) throw new Error("unreachable: a ready plan has a configuration")
    const result = await applyPlan(plan, adapter)
    const verifiedCatalog = await adapter.readCatalog()
    verify(desired.entries, verifiedCatalog)
    return {
        state: "applied",
        target: describeTarget(input.target),
        applied: plan.actions.map((action) => action.description),
        ...(result.recovered.length > 0 ? { recovered: result.recovered } : {}),
        created: result.created,
        configuration,
    }
}

function withoutOperation<T extends { operation: string }>(input: T): Omit<T, "operation"> {
    const { operation: _operation, ...rest } = input
    return rest
}

function describeTarget(target: LabelSetupToolInput["target"]) {
    return target.provider === "github"
        ? { provider: "github", repository: target.repository }
        : { provider: "linear", team: target.team }
}

/**
 * The desired input is the current configuration plus the user's change, so its keep and retired
 * lists may still name a label the change makes managed again. The planner drops those entries and
 * shows the drop; validation here checks everything else, and the returned configuration is
 * validated in full.
 */
function withoutManagedListEntries<T extends GitHubLabels | LinearLabels>(
    labels: T,
    entries: readonly ManagedEntry[],
): T {
    const managed = (name: string, catalog?: string) =>
        entries.some(
            (entry) =>
                entry.definition.name.toLowerCase() === name.toLowerCase() &&
                (catalog === undefined || entry.catalog === catalog),
        )
    const keepList = (labels.unmanaged?.keep ?? []) as { name: string; catalog?: string }[]
    const retiredList = (labels.retired ?? []) as { name: string; catalog?: string }[]
    const keep = keepList.filter((entry) => !managed(entry.name, entry.catalog))
    const retired = retiredList.filter((entry) => !managed(entry.name, entry.catalog))
    return {
        ...labels,
        ...(labels.unmanaged ? { unmanaged: { keep } } : {}),
        ...(labels.retired ? { retired } : {}),
    } as T
}

function desiredFor(input: DesiredInput) {
    if (input.target.provider === "github") {
        const { labels, remap } = input as GitHubPreviewInput
        const entries = githubManagedEntries(labels)
        assertGitHubLabels(withoutManagedListEntries(labels, entries))
        return {
            raw: labels,
            entries,
            keep: githubListEntries(labels.unmanaged?.keep),
            retired: githubListEntries(labels.retired),
            remap: (remap ?? []).map(
                (entry): RemapEntry => ({
                    name: entry.name,
                    catalog: "repository",
                    scope: "repository",
                    key: entryKey("repository", entry.group, entry.value),
                }),
            ),
        }
    }
    const { labels, phase, remap } = input as LinearPreviewInput
    assertLinearLabels(withoutManagedListEntries(labels, linearManagedEntries(labels, phase)), phase)
    return {
        raw: { labels, phase },
        entries: linearManagedEntries(labels, phase),
        keep: linearListEntries(labels.unmanaged?.keep),
        retired: linearListEntries(labels.retired),
        remap: (remap ?? []).map(
            (entry): RemapEntry => ({
                name: entry.name,
                catalog: entry.catalog,
                scope: entry.scope,
                key: entryKey(entry.catalog, entry.group, entry.value ?? null),
            }),
        ),
    }
}

/**
 * The managed set setup last applied: the working-tree configuration, committed or not, when it
 * validates and describes the same tracker target. Anything else, such as an older shape or
 * another repository or team, means there's none.
 */
async function readPrevious(cwd: string, adapter: ProviderAdapter) {
    const file = path.join(project.resolveRootDir(cwd), INTEGRATION_CONFIG_PATH)
    if (!fs.existsSync(file)) return null
    let value: unknown
    try {
        value = JSON.parse(fs.readFileSync(file, "utf-8"))
    } catch {
        return null
    }
    if (!IntegrationConfigValidator.check(value)) return null
    const tracker = value.tracker
    if (!(await adapter.sameTarget(tracker))) return null
    return tracker.provider === "github"
        ? { labels: tracker.labels ?? {}, phase: undefined, entries: githubManagedEntries(tracker.labels) }
        : {
              labels: tracker.labels ?? {},
              phase: tracker.phase,
              entries: linearManagedEntries(tracker.labels, tracker.phase),
          }
}

/**
 * Runs the plan in order. When a write fails, it reads the catalog again and continues only when
 * that action is confirmed applied; otherwise it rethrows the provider error. It never repeats a
 * write blindly.
 */
async function applyPlan(plan: CatalogPlan, adapter: ProviderAdapter) {
    const created: Record<string, string> = {}
    const recovered: string[] = []
    const resolveParent = (key: string | null) => {
        if (key === null) return null
        const id = created[key] ?? plan.resolvedIds[key]
        if (!id)
            throw new Error(`label group ${key} has no tracker ID; it must be created or exist before its children`)
        return id
    }
    for (const action of plan.actions) {
        try {
            const id = await adapter.apply(action, resolveParent)
            if (action.kind === "create" && id) created[action.key] = id
        } catch (error) {
            let catalog: TrackerLabel[]
            try {
                catalog = await adapter.readCatalog()
            } catch {
                throw error
            }
            const confirmed = confirmApplied(action, catalog, resolveParent)
            if (confirmed === false) throw error
            if (action.kind === "create" && typeof confirmed === "string") created[action.key] = confirmed
            recovered.push(action.description)
        }
    }
    return { created, recovered }
}

/** The created label's ID, true for another confirmed action, or false when it didn't take effect. */
function confirmApplied(
    action: CatalogAction,
    catalog: readonly TrackerLabel[],
    resolveParent: (key: string | null) => string | null,
): string | boolean {
    const byId = catalog.find((label) => "labelId" in action && label.id === action.labelId)
    switch (action.kind) {
        case "create": {
            const matches = catalog.filter(
                (label) =>
                    label.catalog === action.catalog &&
                    label.scope === action.scope &&
                    label.name === action.definition.name &&
                    label.isGroup === (action.groupType !== null) &&
                    !label.retired &&
                    (action.parentKey === null || label.parentId === resolveParent(action.parentKey)),
            )
            return matches.length === 1 ? matches[0].id : false
        }
        case "update": {
            if (!byId) return false
            const { name, color, description, groupType, parentKey } = action.change
            return (
                (name === undefined || byId.name === name) &&
                (color === undefined || byId.color.toLowerCase() === color.toLowerCase()) &&
                (description === undefined || byId.description === description) &&
                (groupType === undefined || byId.groupType === groupType) &&
                (parentKey === undefined || byId.parentId === resolveParent(parentKey))
            )
        }
        case "restore":
            return byId !== undefined && !byId.retired
        case "retire":
            return byId !== undefined && byId.retired
        case "delete":
            return byId === undefined
    }
}

function verify(desired: readonly ManagedEntry[], catalog: readonly TrackerLabel[]): void {
    const problems: string[] = []
    const byKey = new Map<string, TrackerLabel>()
    for (const entry of [...desired].sort((a, b) => Number(b.value === null) - Number(a.value === null))) {
        const matches = catalog.filter(
            (label) =>
                label.catalog === entry.catalog &&
                label.scope === entry.scope &&
                label.isGroup === (entry.value === null) &&
                label.name === entry.definition.name,
        )
        if (matches.length !== 1) {
            problems.push(`${JSON.stringify(entry.definition.name)}: ${matches.length} matching labels`)
            continue
        }
        const label = matches[0]
        byKey.set(entry.key, label)
        if (label.retired) problems.push(`${JSON.stringify(label.name)} is retired`)
        if (label.color.toLowerCase() !== entry.definition.color.toLowerCase())
            problems.push(`${JSON.stringify(label.name)} has color ${label.color}`)
        if (label.description !== entry.definition.description)
            problems.push(`${JSON.stringify(label.name)} has a different description`)
        if (entry.groupType !== null && label.groupType !== entry.groupType)
            problems.push(`${JSON.stringify(label.name)} is ${label.groupType ?? "untyped"}`)
        const parent = entry.parentKey ? byKey.get(entry.parentKey)?.id : null
        if (entry.value !== null && (label.parentId ?? null) !== (parent ?? null))
            problems.push(`${JSON.stringify(label.name)} is in the wrong label group`)
    }
    if (problems.length > 0) throw new Error(`label setup verification failed: ${problems.join("; ")}`)
}

function configurationFor(input: DesiredInput, plan: CatalogPlan) {
    const withLists = <T extends GitHubLabels | LinearLabels>(labels: T, keep: unknown[], retired: unknown[]): T => {
        const { unmanaged: _unmanaged, retired: _retired, ...rest } = labels
        return {
            ...rest,
            ...(keep.length > 0 ? { unmanaged: { keep } } : {}),
            ...(retired.length > 0 ? { retired } : {}),
        } as T
    }
    if (input.target.provider === "github") {
        const strip = (entries: ListEntry[]) => entries.map((entry) => ({ name: entry.name }))
        const labels = withLists((input as GitHubPreviewInput).labels, strip(plan.keep), strip(plan.retired))
        assertGitHubLabels(labels)
        return { labels }
    }
    const linear = (entries: ListEntry[]) =>
        entries.map((entry) => ({ name: entry.name, catalog: entry.catalog, scope: entry.scope }))
    const { phase, labels: desired } = input as LinearPreviewInput
    const labels = withLists(desired, linear(plan.keep), linear(plan.retired))
    assertLinearLabels(labels, phase)
    return { labels, phase }
}

function adapterFor(target: LabelSetupToolInput["target"], options: LabelSetupOptions): ProviderAdapter {
    return target.provider === "github"
        ? githubAdapter(clientFor(target.credentialEnv, options), target.repository)
        : linearAdapter(linearClientFor(target.credentialEnv, options), target.team)
}

function githubAdapter(client: GitHubClient, repository: Static<typeof RepositorySchema>): ProviderAdapter {
    let byId = new Map<string, TrackerLabel>()
    return {
        async readCatalog() {
            const labels = await client.listRepositoryLabels(repository)
            const usage = await client.repositoryLabelUsage(
                repository,
                labels.map((label) => label.name),
            )
            const catalog = labels.map((label) => ({
                id: label.id,
                name: label.name,
                color: label.color,
                description: label.description,
                retired: label.archived,
                catalog: "repository" as const,
                scope: "repository" as const,
                parentId: null,
                isGroup: false,
                groupType: null,
                usage: usage.get(label.name) ?? 0,
                usageTruncated: false,
            }))
            byId = new Map(catalog.map((label) => [label.id, label]))
            return catalog
        },
        async sameTarget(tracker) {
            return (
                tracker.provider === "github" &&
                tracker.repository.owner.toLowerCase() === repository.owner.toLowerCase() &&
                tracker.repository.repo.toLowerCase() === repository.repo.toLowerCase()
            )
        },
        async apply(action) {
            switch (action.kind) {
                case "create":
                    await client.createRepositoryLabel(repository, action.definition)
                    return undefined
                case "update": {
                    const { name, color, description } = action.change
                    await client.updateRepositoryLabel(repository, currentName(byId, action), {
                        name,
                        color,
                        description,
                    })
                    return undefined
                }
                case "restore":
                    await client.updateRepositoryLabel(repository, currentName(byId, action), { archived: false })
                    return undefined
                case "retire":
                    await client.updateRepositoryLabel(repository, currentName(byId, action), { archived: true })
                    return undefined
                case "delete":
                    await client.deleteRepositoryLabel(repository, currentName(byId, action))
                    return undefined
            }
        },
    }
}

function currentName(byId: Map<string, TrackerLabel>, action: { labelId: string; name: string }): string {
    return byId.get(action.labelId)?.name ?? action.name
}

const LINEAR_LABEL_FIELDS = `id name color description isGroup groupType retiredAt team { id } parent { id }`

function linearAdapter(client: LinearClient, team: string): ProviderAdapter {
    let teams: { id: string; key: string; name: string }[] | undefined
    const teamIdFor = async (reference: string) => {
        if (!teams) {
            const data = await client.graphql(`query LabelSetupTeams { teams(first: 250) { nodes { id key name } } }`)
            teams = (data.teams as { nodes: { id: string; key: string; name: string }[] }).nodes
        }
        const matches = teams.filter(
            (node) => node.id === reference || node.key === reference || node.name === reference,
        )
        return matches.length === 1 ? matches[0].id : undefined
    }
    const resolveTeam = async () => {
        const id = await teamIdFor(team)
        if (!id) throw new Error(`Linear team ${JSON.stringify(team)} doesn't match exactly one team`)
        return id
    }
    const readKind = async (catalog: "issue" | "project", ownTeam: string): Promise<TrackerLabel[]> => {
        const field = catalog === "issue" ? "issueLabels" : "projectLabels"
        const usageField = catalog === "issue" ? "issues" : "projects"
        const labels: TrackerLabel[] = []
        let after: string | null = null
        do {
            const data = await client.graphql(
                `query LabelSetupCatalog($after: String) {
                    ${field}(first: 100, after: $after, includeArchived: true) {
                        nodes { ${LINEAR_LABEL_FIELDS} ${usageField}(first: 1, includeArchived: true) { nodes { id } } }
                        pageInfo { hasNextPage endCursor }
                    }
                }`,
                { after },
            )
            const connection = data[field] as {
                nodes: Array<Record<string, unknown>>
                pageInfo: { hasNextPage: boolean; endCursor: string | null }
            }
            for (const node of connection.nodes) {
                const nodeTeam = (node.team as { id: string } | null)?.id ?? null
                if (nodeTeam !== null && nodeTeam !== ownTeam) continue
                const used = ((node[usageField] as { nodes: unknown[] }).nodes ?? []).length > 0
                labels.push({
                    id: String(node.id),
                    name: String(node.name),
                    color: String(node.color).toUpperCase(),
                    description: typeof node.description === "string" ? node.description : "",
                    retired: typeof node.retiredAt === "string",
                    catalog,
                    scope: nodeTeam === null ? "workspace" : "team",
                    parentId: (node.parent as { id: string } | null)?.id ?? null,
                    isGroup: node.isGroup === true,
                    groupType: groupTypeOf(catalog, node),
                    usage: used ? 1 : 0,
                    usageTruncated: used,
                })
            }
            after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
        } while (after)
        return labels
    }
    let catalogById = new Map<string, TrackerLabel>()
    const mutation = (catalog: CatalogKey, verb: string) =>
        `${catalog === "issue" ? "issueLabel" : "projectLabel"}${verb}`
    return {
        async readCatalog() {
            const ownTeam = await resolveTeam()
            const catalog = [...(await readKind("issue", ownTeam)), ...(await readKind("project", ownTeam))]
            catalogById = new Map(catalog.map((label) => [label.id, label]))
            return catalog
        },
        async sameTarget(tracker) {
            if (tracker.provider !== "linear") return false
            const configured = await teamIdFor(tracker.team)
            return configured !== undefined && configured === (await resolveTeam())
        },
        async apply(action, resolveParent) {
            const labelCatalog = (id: string) => {
                const label = catalogById.get(id)
                if (!label) throw new Error(`label ${id} isn't in the catalog read`)
                return label.catalog
            }
            switch (action.kind) {
                case "create": {
                    const name = mutation(action.catalog, "Create")
                    const input: Record<string, unknown> = {
                        name: action.definition.name,
                        color: action.definition.color,
                        description: action.definition.description,
                        ...(action.groupType ? { isGroup: true, groupType: action.groupType } : {}),
                        ...(action.parentKey ? { parentId: resolveParent(action.parentKey) } : {}),
                        ...(action.scope === "team" ? { teamId: await resolveTeam() } : {}),
                    }
                    const data = await client.graphql(
                        `mutation LabelCreate($input: ${pascal(name)}Input!) { ${name}(input: $input) { success ${action.catalog === "issue" ? "issueLabel" : "projectLabel"} { id } } }`,
                        { input },
                    )
                    const payload = data[name] as Record<string, { id: string }>
                    return payload[action.catalog === "issue" ? "issueLabel" : "projectLabel"].id
                }
                case "update": {
                    const catalog = labelCatalog(action.labelId)
                    const name = mutation(catalog, "Update")
                    const { parentKey, ...rest } = action.change
                    const input: Record<string, unknown> = {
                        ...rest,
                        ...(parentKey !== undefined ? { parentId: resolveParent(parentKey) } : {}),
                    }
                    await client.graphql(
                        `mutation LabelUpdate($id: String!, $input: ${pascal(name)}Input!) { ${name}(id: $id, input: $input) { success } }`,
                        { id: action.labelId, input },
                    )
                    return undefined
                }
                case "restore":
                case "retire":
                case "delete": {
                    const catalog = labelCatalog(action.labelId)
                    const verb = action.kind === "restore" ? "Restore" : action.kind === "retire" ? "Retire" : "Delete"
                    const name = mutation(catalog, verb)
                    await client.graphql(`mutation LabelChange($id: String!) { ${name}(id: $id) { success } }`, {
                        id: action.labelId,
                    })
                    return undefined
                }
            }
        },
    }
}

/** Linear documents a Project label group without a type as single-select; issue groups always report one. */
function groupTypeOf(catalog: "issue" | "project", node: Record<string, unknown>): GroupType | null {
    if (node.isGroup !== true) return null
    const type = (node.groupType as GroupType | null) ?? null
    return type === null && catalog === "project" ? "singleSelect" : type
}

function pascal(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1)
}

export type { CatalogScope }
