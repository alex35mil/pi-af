import type { EntityStatus } from "../__lib/entity.js"
import type { GitHubForge, IntegrationConfig, TrackerConfig } from "./config.js"

// Every workflow project has exactly one tracker and a GitHub forge.
export interface WorkflowEnvironment {
    tracker: TrackerConfig
    forge: GitHubForge
}

export function resolveWorkflowEnvironment(config: IntegrationConfig): WorkflowEnvironment {
    return { tracker: config.tracker, forge: config.forge }
}

export function assertEntityEnvironment(status: EntityStatus, environment: WorkflowEnvironment): void {
    const tracker = status.tracker
    if (tracker.provider !== environment.tracker.provider)
        throw new Error(`${status.slug} is bound to ${tracker.provider}, not the configured tracker`)
    if (
        tracker.provider === "github" &&
        environment.tracker.provider === "github" &&
        !sameRepository(tracker.repository, environment.tracker.repository)
    )
        throw new Error(`${status.slug} tracker repository differs from the configured repository`)
    if (status.forge && !sameRepository(status.forge.repository, environment.forge.repository))
        throw new Error(`${status.slug} forge repository differs from the configured repository`)
}

export function sameRepository(left: { owner: string; repo: string }, right: { owner: string; repo: string }) {
    return (
        left.owner.toLowerCase() === right.owner.toLowerCase() && left.repo.toLowerCase() === right.repo.toLowerCase()
    )
}
