import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import { PRIORITY_NOT_SET } from "../__lib/domain.js"
import { linearPriorityNumber } from "./records.js"

export const INTEGRATION_CONFIG_PATH = ".project/integrations.json"

const FieldNameSchema = Type.String({ minLength: 1 })

export const ScopedFieldSchema = Type.Union([
    Type.Object({ scope: Type.Literal("issue"), field: FieldNameSchema }, { additionalProperties: false }),
    Type.Object({ scope: Type.Literal("project"), field: FieldNameSchema }, { additionalProperties: false }),
])
export type ScopedField = Static<typeof ScopedFieldSchema>

const PriorityOptionSchema = Type.String({ minLength: 1, pattern: "^(?!not set$)[^\\r\\n]+$" })

export const PriorityFieldSchema = Type.Union([
    Type.Object(
        {
            scope: Type.Literal("issue"),
            field: FieldNameSchema,
            values: Type.Array(PriorityOptionSchema, { minItems: 1, uniqueItems: true }),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            scope: Type.Literal("project"),
            field: FieldNameSchema,
            values: Type.Array(PriorityOptionSchema, { minItems: 1, uniqueItems: true }),
        },
        { additionalProperties: false },
    ),
])
export type PriorityField = Static<typeof PriorityFieldSchema>

const DeliverableKindValuesSchema = Type.Object(
    {
        feature: Type.String({ minLength: 1 }),
        bugfix: Type.String({ minLength: 1 }),
        research: Type.String({ minLength: 1 }),
        refactor: Type.String({ minLength: 1 }),
        audit: Type.String({ minLength: 1 }),
        chore: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
)

export const TypeProjectionSchema = Type.Union([
    Type.Object(
        {
            scope: Type.Literal("issue"),
            epic: Type.String({ minLength: 1 }),
            deliverableKinds: DeliverableKindValuesSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            scope: Type.Literal("project"),
            field: FieldNameSchema,
            epic: Type.String({ minLength: 1 }),
            deliverableKinds: DeliverableKindValuesSchema,
        },
        { additionalProperties: false },
    ),
])
export type TypeProjection = Static<typeof TypeProjectionSchema>

const StatusValuesSchema = Type.Object(
    {
        backlog: Type.String({ minLength: 1 }),
        todo: Type.String({ minLength: 1 }),
        inProgress: Type.String({ minLength: 1 }),
        inReview: Type.String({ minLength: 1 }),
        done: Type.String({ minLength: 1 }),
        canceled: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
)

const McpServerSchema = Type.String({ minLength: 1, pattern: "^[A-Za-z0-9_.-]+$" })
const GitHubRepositorySchema = Type.Object(
    { owner: Type.String({ minLength: 1 }), repo: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
)
const GitHubRoleProperties = {
    provider: Type.Literal("github"),
    mcpServer: McpServerSchema,
    repository: GitHubRepositorySchema,
}

export const GitHubTrackerSchema = Type.Object(
    {
        ...GitHubRoleProperties,
        project: Type.Object(
            {
                owner: Type.String({ minLength: 1 }),
                ownerType: Type.Union([Type.Literal("user"), Type.Literal("org")]),
                number: Type.Integer({ minimum: 1 }),
            },
            { additionalProperties: false },
        ),
        labels: Type.Object({ planning: FieldNameSchema }, { additionalProperties: false }),
        fields: Type.Object(
            {
                status: Type.Object(
                    {
                        field: FieldNameSchema,
                        values: StatusValuesSchema,
                    },
                    { additionalProperties: false },
                ),
                priority: PriorityFieldSchema,
                internalId: ScopedFieldSchema,
                type: TypeProjectionSchema,
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
)
export type GitHubTracker = Static<typeof GitHubTrackerSchema>

export const LinearTrackerSchema = Type.Object(
    {
        provider: Type.Literal("linear"),
        mcpServer: McpServerSchema,
        team: Type.String({ minLength: 1 }),
        statuses: Type.Object(
            {
                issues: StatusValuesSchema,
                projects: StatusValuesSchema,
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
)
export type LinearTracker = Static<typeof LinearTrackerSchema>

export const TrackerConfigSchema = Type.Union([GitHubTrackerSchema, LinearTrackerSchema])
export type TrackerConfig = Static<typeof TrackerConfigSchema>

export const GitHubForgeSchema = Type.Object(GitHubRoleProperties, { additionalProperties: false })
export type GitHubForge = Static<typeof GitHubForgeSchema>

export const IntegrationConfigSchema = Type.Union([
    Type.Object(
        { tracker: TrackerConfigSchema, forge: Type.Optional(GitHubForgeSchema) },
        { additionalProperties: false },
    ),
    Type.Object(
        { tracker: Type.Optional(TrackerConfigSchema), forge: GitHubForgeSchema },
        { additionalProperties: false },
    ),
])
export type IntegrationConfig = Static<typeof IntegrationConfigSchema>

export function assertConfiguredPriority(config: TrackerConfig, priority: string): void {
    if (config.provider === "linear") {
        linearPriorityNumber(priority)
        return
    }
    if (priority === PRIORITY_NOT_SET || config.fields.priority.values.includes(priority)) return
    throw new Error(`priority is not configured for the GitHub tracker: ${JSON.stringify(priority)}`)
}

export type LoadedIntegrationConfig =
    | { state: "disabled"; path: string }
    | { state: "enabled"; path: string; config: IntegrationConfig }

function assertDistinctStatuses(provider: string, scope: string, statuses: Static<typeof StatusValuesSchema>): void {
    const options = Object.values(statuses)
    if (new Set(options).size !== options.length) {
        throw new Error(`${provider} ${scope} Status mappings must use distinct options`)
    }
}

function assertGitHubTrackerInvariants(config: GitHubTracker): void {
    const statusOptions = Object.values(config.fields.status.values)
    if (new Set(statusOptions).size !== statusOptions.length) {
        throw new Error("GitHub Status mappings must use distinct options")
    }

    const projectFieldNames = [
        config.fields.status.field,
        ...(config.fields.priority.scope === "project" ? [config.fields.priority.field] : []),
        ...(config.fields.internalId.scope === "project" ? [config.fields.internalId.field] : []),
        ...(config.fields.type.scope === "project" ? [config.fields.type.field] : []),
    ]
    const duplicateProjectFields = projectFieldNames.filter(
        (field, index) => projectFieldNames.indexOf(field) !== index,
    )
    if (duplicateProjectFields.length > 0) {
        throw new Error(
            `GitHub Project field names must be distinct: ${[...new Set(duplicateProjectFields)].map((field) => JSON.stringify(field)).join(", ")}`,
        )
    }
}

export function loadIntegrationConfig(cwd: string): LoadedIntegrationConfig {
    const configPath = path.join(project.resolveRootDir(cwd), INTEGRATION_CONFIG_PATH)
    if (!fs.existsSync(configPath)) return { state: "disabled", path: configPath }

    let value: unknown
    try {
        value = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`invalid ${INTEGRATION_CONFIG_PATH}: ${message}`)
    }

    if (!Value.Check(IntegrationConfigSchema, value)) {
        const details = [...Value.Errors(IntegrationConfigSchema, value)]
            .map((error) => `${error.instancePath || "/"}: ${error.message}`)
            .join("; ")
        throw new Error(`invalid ${INTEGRATION_CONFIG_PATH}: ${details}`)
    }
    try {
        if (value.tracker?.provider === "github") assertGitHubTrackerInvariants(value.tracker)
        if (value.tracker?.provider === "linear") {
            assertDistinctStatuses("Linear", "issue", value.tracker.statuses.issues)
            assertDistinctStatuses("Linear", "Project", value.tracker.statuses.projects)
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`invalid ${INTEGRATION_CONFIG_PATH}: ${message}`)
    }

    return { state: "enabled", path: configPath, config: value }
}
