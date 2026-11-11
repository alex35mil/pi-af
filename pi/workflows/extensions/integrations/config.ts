import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, Type } from "typebox"

import { compile, describeErrors } from "../../../extensions/__lib/schema.js"
import * as project from "../../../extensions/__lib/project.js"
import { PRIORITY_NOT_SET } from "../__lib/domain.js"
import {
    assertGitHubLabels,
    assertLinearLabels,
    GitHubLabelsSchema,
    LinearLabelsSchema,
    LinearPhaseGroupsSchema,
} from "./labels.js"
import { linearPriorityNumber } from "./records.js"

export const INTEGRATION_CONFIG_PATH = ".project/integrations.json"

const FieldNameSchema = Type.String({ minLength: 1 })

const PriorityOptionSchema = Type.String({ minLength: 1, pattern: "^(?!not set$)[^\\r\\n]+$" })

export const PriorityFieldSchema = Type.Union([
    Type.Object(
        {
            scope: Type.Enum(["issue"], { type: "string" }),
            field: FieldNameSchema,
            values: Type.Array(PriorityOptionSchema, { minItems: 1, uniqueItems: true }),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            scope: Type.Enum(["project"], { type: "string" }),
            field: FieldNameSchema,
            values: Type.Array(PriorityOptionSchema, { minItems: 1, uniqueItems: true }),
        },
        { additionalProperties: false },
    ),
])
export const PriorityFieldValidator = compile(PriorityFieldSchema)
export type PriorityField = Static<typeof PriorityFieldSchema>

export const PhaseValuesSchema = Type.Object(
    {
        planning: FieldNameSchema,
        execution: FieldNameSchema,
        selfReview: FieldNameSchema,
    },
    { additionalProperties: false },
)
export type PhaseValues = Static<typeof PhaseValuesSchema>

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
    provider: Type.Enum(["github"], { type: "string" }),
    mcpServer: McpServerSchema,
    repository: GitHubRepositorySchema,
}

export const GitHubTrackerSchema = Type.Object(
    {
        ...GitHubRoleProperties,
        project: Type.Object(
            {
                owner: Type.String({ minLength: 1 }),
                ownerType: Type.Enum(["user", "org"], { type: "string" }),
                number: Type.Integer({ minimum: 1 }),
            },
            { additionalProperties: false },
        ),
        // Managed labels are applied only when configured.
        labels: Type.Optional(GitHubLabelsSchema),
        fields: Type.Object(
            {
                status: Type.Object(
                    {
                        field: FieldNameSchema,
                        values: StatusValuesSchema,
                    },
                    { additionalProperties: false },
                ),
                phase: Type.Object(
                    { field: FieldNameSchema, values: PhaseValuesSchema },
                    { additionalProperties: false },
                ),
                priority: PriorityFieldSchema,
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
)
export const GitHubTrackerValidator = compile(GitHubTrackerSchema)
export type GitHubTracker = Static<typeof GitHubTrackerSchema>

export const LinearTrackerSchema = Type.Object(
    {
        provider: Type.Enum(["linear"], { type: "string" }),
        mcpServer: McpServerSchema,
        team: Type.String({ minLength: 1 }),
        phase: LinearPhaseGroupsSchema,
        labels: Type.Optional(LinearLabelsSchema),
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
export const LinearTrackerValidator = compile(LinearTrackerSchema)
export type LinearTracker = Static<typeof LinearTrackerSchema>

export const TrackerConfigSchema = Type.Union([GitHubTrackerSchema, LinearTrackerSchema])
export type TrackerConfig = Static<typeof TrackerConfigSchema>

export const GitHubForgeSchema = Type.Object(GitHubRoleProperties, { additionalProperties: false })
export type GitHubForge = Static<typeof GitHubForgeSchema>

export const IntegrationConfigSchema = Type.Object(
    { tracker: TrackerConfigSchema, forge: GitHubForgeSchema },
    { additionalProperties: false },
)
export const IntegrationConfigValidator = compile(IntegrationConfigSchema)
export type IntegrationConfig = Static<typeof IntegrationConfigSchema>

export function assertConfiguredPriority(config: TrackerConfig, priority: string): void {
    if (config.provider === "linear") {
        linearPriorityNumber(priority)
        return
    }
    if (priority === PRIORITY_NOT_SET || config.fields.priority.values.includes(priority)) return
    throw new Error(`priority is not configured for the GitHub tracker: ${JSON.stringify(priority)}`)
}

function assertDistinctStatuses(provider: string, scope: string, statuses: Static<typeof StatusValuesSchema>): void {
    const options = Object.values(statuses)
    if (new Set(options).size !== options.length) {
        throw new Error(`${provider} ${scope} Status mappings must use distinct options`)
    }
}

export function assertDistinctPhases(values: PhaseValues): void {
    const options = Object.values(values)
    if (new Set(options).size !== options.length) throw new Error("Phase mappings must use distinct options")
}

function assertGitHubTrackerInvariants(config: GitHubTracker): void {
    assertDistinctPhases(config.fields.phase.values)
    const statusOptions = Object.values(config.fields.status.values)
    if (new Set(statusOptions).size !== statusOptions.length) {
        throw new Error("GitHub Status mappings must use distinct options")
    }

    assertGitHubLabels(config.labels)

    const projectFieldNames = [
        config.fields.status.field,
        config.fields.phase.field,
        ...(config.fields.priority.scope === "project" ? [config.fields.priority.field] : []),
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

// Workflows need both a tracker and a GitHub forge.
export function loadIntegrationConfig(cwd: string): IntegrationConfig {
    const configPath = path.join(project.resolveRootDir(cwd), INTEGRATION_CONFIG_PATH)
    if (!fs.existsSync(configPath))
        throw new Error(`missing required ${INTEGRATION_CONFIG_PATH}: configure a tracker and a forge`)
    return validateIntegrationConfig(readIntegrationConfig(configPath))
}

function readIntegrationConfig(configPath: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(configPath, "utf-8"))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`invalid ${INTEGRATION_CONFIG_PATH}: ${message}`)
    }
}

function validateIntegrationConfig(value: unknown): IntegrationConfig {
    if (!IntegrationConfigValidator.check(value)) {
        const details = describeErrors(IntegrationConfigValidator.errors(value)).join("; ")
        throw new Error(`invalid ${INTEGRATION_CONFIG_PATH}: ${details}`)
    }
    try {
        if (value.tracker.provider === "github") assertGitHubTrackerInvariants(value.tracker)
        if (value.tracker.provider === "linear") {
            assertLinearLabels(value.tracker.labels, value.tracker.phase)
            assertDistinctStatuses("Linear", "issue", value.tracker.statuses.issues)
            assertDistinctStatuses("Linear", "Project", value.tracker.statuses.projects)
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`invalid ${INTEGRATION_CONFIG_PATH}: ${message}`)
    }

    return value
}
