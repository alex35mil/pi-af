import * as path from "node:path"

import * as project from "../../../extensions/__lib/project.js"
import { parseResourceIds, recordResourceIds, type ResourceIds } from "../integrations/resource-ids.js"
import type { WorkflowEnvironment } from "../integrations/policy.js"
import type { EntityInitialization, InitializedEntity } from "./entity.js"

export function resourceIdsFromAdoption(
    input: EntityInitialization,
    environment: WorkflowEnvironment,
    entityId: string,
): ResourceIds[] {
    if (input.source.mode === "new") return []
    const source = input.source
    const tracker = environment.tracker
    if (source.provider === "github" && tracker.kind === "github") {
        const scope = {
            entityId,
            mcpServer: tracker.config.mcpServer,
            repository: tracker.config.repository,
            issueNumber: source.issueNumber,
        }
        return [
            parseResourceIds({
                scope: { ...scope, kind: "github-issue" },
                value: { issueId: source.issueId, url: source.issueUrl },
            }),
            parseResourceIds({
                scope: { ...scope, kind: "github-project-item", project: tracker.config.project },
                value: { itemId: source.projectItemId },
            }),
        ]
    }
    if (source.provider === "linear" && tracker.kind === "linear") {
        const scope = { entityId, mcpServer: tracker.config.mcpServer, team: tracker.config.team }
        return [
            source.resource === "project"
                ? parseResourceIds({
                      scope: { ...scope, kind: "linear-project", projectId: source.projectId },
                      value: { url: source.projectUrl },
                  })
                : parseResourceIds({
                      scope: {
                          ...scope,
                          kind: "linear-issue",
                          issueId: source.issueId,
                          relationship:
                              source.resource === "task-issue"
                                  ? { kind: "project", projectId: source.projectId }
                                  : { kind: "projectless" },
                      },
                      value: { identifier: source.identifier, url: source.issueUrl },
                  }),
        ]
    }
    throw new Error("adoption evidence does not match the configured tracker")
}

export async function seedInitializedEntityResourceIds(initialized: InitializedEntity, cwd: string): Promise<void> {
    const root = project.resolveRootDir(cwd)
    try {
        await recordResourceIds(path.join(root, initialized.directory), initialized.adoptionResourceIds)
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(
            `initialized ${initialized.status.id} at ${initialized.directory}, but local resource ID recording failed: ${reason}; preserve this work and resume its cache recording, do not initialize a replacement`,
        )
    }
}
