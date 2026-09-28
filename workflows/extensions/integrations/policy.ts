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
    | { case: "versioned/no-forge"; pullRequests: false; artifactLinks: "unavailable" }
    | {
          case: "versioned/github"
          pullRequests: true
          artifactLinks: "pull-request" | "pull-request-and-tracker"
      }
    | { case: "unversioned/no-forge"; pullRequests: false; artifactLinks: "unavailable" }
    | { case: "unversioned/github"; pullRequests: true; artifactLinks: "forbidden" }

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
                    return { case: "versioned/no-forge", pullRequests: false, artifactLinks: "unavailable" }
                case "github":
                    return {
                        case: "versioned/github",
                        pullRequests: true,
                        artifactLinks:
                            environment.tracker.kind === "none" ? "pull-request" : "pull-request-and-tracker",
                    }
                default:
                    return environment.forge satisfies never
            }
        case "unversioned":
            switch (environment.forge.kind) {
                case "none":
                    return { case: "unversioned/no-forge", pullRequests: false, artifactLinks: "unavailable" }
                case "github":
                    return { case: "unversioned/github", pullRequests: true, artifactLinks: "forbidden" }
                default:
                    return environment.forge satisfies never
            }
        default:
            return environment.artifacts satisfies never
    }
}
