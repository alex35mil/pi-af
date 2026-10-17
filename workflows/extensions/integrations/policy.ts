import type { EntityStatus } from "../__lib/entity.js"
import type { ProjectConfig } from "../__lib/project-config.js"
import type { IntegrationConfig, GitHubForge, GitHubTracker, LinearTracker } from "./config.js"

export type ArtifactPersistence = { kind: "versioned" } | { kind: "unversioned" }
export type TrackerRole =
    | { kind: "none" }
    | { kind: "github"; config: GitHubTracker }
    | { kind: "linear"; config: LinearTracker }
export type ForgeRole = { kind: "none" } | { kind: "github"; config: GitHubForge }

export interface WorkflowEnvironment {
    artifacts: ArtifactPersistence
    tracker: TrackerRole
    forge: ForgeRole
}

const WORKFLOW_AUTHORITY = {
    lifecycleAuthority: "workflow",
    priorityAuthority: "workflow",
    localStatus: "required",
    projection: "none",
    systemMetadataProjection: false,
} as const
const TRACKER_AUTHORITY = {
    lifecycleAuthority: "tracker",
    priorityAuthority: "tracker",
    localStatus: "forbidden",
} as const
const FULL_PROJECTION = { ...TRACKER_AUTHORITY, projection: "full", systemMetadataProjection: true } as const
const RESTRICTED_PROJECTION = {
    ...TRACKER_AUTHORITY,
    projection: "restricted",
    systemMetadataProjection: false,
} as const

export type WorkflowPolicy =
    | ({ case: "versioned/no-tracker" | "unversioned/no-tracker" } & typeof WORKFLOW_AUTHORITY)
    | ({ case: "versioned/github" | "versioned/linear" } & typeof FULL_PROJECTION)
    | ({ case: "unversioned/github" | "unversioned/linear" } & typeof RESTRICTED_PROJECTION)

export type ForgePolicy =
    | { case: "versioned/no-forge"; pullRequests: false }
    | { case: "versioned/github"; pullRequests: true }
    | { case: "unversioned/no-forge"; pullRequests: false }
    | { case: "unversioned/github"; pullRequests: true }

export function resolveWorkflowEnvironment(
    projectConfig: ProjectConfig,
    integrationConfig?: IntegrationConfig,
): WorkflowEnvironment {
    const artifacts: ArtifactPersistence = (() => {
        switch (projectConfig.artifacts) {
            case "versioned":
                return { kind: "versioned" }
            case "unversioned":
                return { kind: "unversioned" }
            default:
                return projectConfig.artifacts satisfies never
        }
    })()
    const tracker: TrackerRole = (() => {
        const configured = integrationConfig?.tracker
        if (!configured) return { kind: "none" }
        switch (configured.provider) {
            case "github":
                return { kind: "github", config: configured }
            case "linear":
                return { kind: "linear", config: configured }
            default:
                return configured satisfies never
        }
    })()
    const forge: ForgeRole = integrationConfig?.forge
        ? { kind: "github", config: integrationConfig.forge }
        : { kind: "none" }
    return { artifacts, tracker, forge }
}

export function assertEntityEnvironment(status: EntityStatus, environment: WorkflowEnvironment): void {
    const forgeRecord = status.integrations.find((integration) => integration.role === "forge")
    switch (environment.tracker.kind) {
        case "none":
            if (status.authority.kind !== "workflow") {
                throw new Error(`${status.id} requires tracker migration before using the current configuration`)
            }
            break
        case "github":
        case "linear":
            if (status.authority.kind !== "tracker" || status.authority.provider !== environment.tracker.kind) {
                throw new Error(
                    `${status.id} requires tracker migration before using the current configuration; see workflows/MIGRATIONS.md`,
                )
            }
            if (environment.tracker.kind === "github") {
                const tracker = status.integrations.find((entry) => entry.role === "tracker")
                if (
                    !tracker ||
                    tracker.provider !== "github" ||
                    tracker.repository.owner.toLowerCase() !==
                        environment.tracker.config.repository.owner.toLowerCase() ||
                    tracker.repository.repo.toLowerCase() !== environment.tracker.config.repository.repo.toLowerCase()
                ) {
                    throw new Error(`${status.id} tracker repository changed; see workflows/MIGRATIONS.md`)
                }
            }
            break
        default:
            environment.tracker satisfies never
    }
    switch (environment.forge.kind) {
        case "none":
            if (forgeRecord)
                throw new Error(`${status.id} requires forge migration before removing its configured forge`)
            break
        case "github":
            if (
                forgeRecord &&
                (forgeRecord.repository.owner.toLowerCase() !==
                    environment.forge.config.repository.owner.toLowerCase() ||
                    forgeRecord.repository.repo.toLowerCase() !==
                        environment.forge.config.repository.repo.toLowerCase())
            ) {
                throw new Error(`${status.id} forge repository changed; see workflows/MIGRATIONS.md`)
            }
            break
        default:
            environment.forge satisfies never
    }
}

export function resolveWorkflowPolicy(environment: WorkflowEnvironment): WorkflowPolicy {
    switch (environment.artifacts.kind) {
        case "versioned":
            switch (environment.tracker.kind) {
                case "none":
                    return { case: "versioned/no-tracker", ...WORKFLOW_AUTHORITY }
                case "github":
                case "linear":
                    return { case: `versioned/${environment.tracker.kind}`, ...FULL_PROJECTION }
                default:
                    return environment.tracker satisfies never
            }
        case "unversioned":
            switch (environment.tracker.kind) {
                case "none":
                    return { case: "unversioned/no-tracker", ...WORKFLOW_AUTHORITY }
                case "github":
                case "linear":
                    return { case: `unversioned/${environment.tracker.kind}`, ...RESTRICTED_PROJECTION }
                default:
                    return environment.tracker satisfies never
            }
        default:
            return environment.artifacts satisfies never
    }
}

export function resolveForgePolicy(environment: WorkflowEnvironment): ForgePolicy {
    switch (environment.artifacts.kind) {
        case "versioned":
            switch (environment.forge.kind) {
                case "none":
                    return { case: "versioned/no-forge", pullRequests: false }
                case "github":
                    return { case: "versioned/github", pullRequests: true }
                default:
                    return environment.forge satisfies never
            }
        case "unversioned":
            switch (environment.forge.kind) {
                case "none":
                    return { case: "unversioned/no-forge", pullRequests: false }
                case "github":
                    return { case: "unversioned/github", pullRequests: true }
                default:
                    return environment.forge satisfies never
            }
        default:
            return environment.artifacts satisfies never
    }
}
