import * as path from "node:path"

import * as project from "../../../extensions/__lib/project.js"
import { parseResourceIds, recordResourceIds, type ResourceIds } from "../integrations/resource-ids.js"
import type { WorkflowEnvironment } from "../integrations/policy.js"
import type { TrackerObject } from "../integrations/records.js"
import type { InitializedEntity } from "./entity.js"

// Resource IDs the tracker object's create or selection evidence already proved.
export function resourceIdsFromTrackerObject(
    object: TrackerObject,
    environment: WorkflowEnvironment,
    entity: string,
): ResourceIds[] {
    const tracker = environment.tracker
    if (object.provider === "github" && tracker.provider === "github") {
        const scope = {
            entity,
            mcpServer: tracker.mcpServer,
            repository: tracker.repository,
            issueNumber: object.issueNumber,
        }
        return [
            parseResourceIds({
                scope: { ...scope, kind: "github-issue" },
                value: { issueId: object.issueId, url: object.issueUrl },
            }),
            ...(object.projectItemId === undefined
                ? []
                : [
                      parseResourceIds({
                          scope: { ...scope, kind: "github-project-item", project: tracker.project },
                          value: { itemId: object.projectItemId },
                      }),
                  ]),
        ]
    }
    if (object.provider === "linear" && tracker.provider === "linear") {
        const scope = { entity, mcpServer: tracker.mcpServer, team: tracker.team }
        if (object.resource === "project")
            return [
                parseResourceIds({
                    scope: { ...scope, kind: "linear-project", projectId: object.projectId },
                    value: { url: object.projectUrl },
                }),
            ]
        return [
            parseResourceIds({
                scope: {
                    ...scope,
                    kind: "linear-issue",
                    issueId: object.issueId,
                    relationship:
                        object.resource === "task-issue"
                            ? { kind: "project", projectId: object.projectId }
                            : { kind: "projectless" },
                },
                value: { identifier: object.identifier, url: object.issueUrl },
            }),
        ]
    }
    throw new Error("tracker object does not match the configured tracker")
}

export async function seedInitializedEntityResourceIds(initialized: InitializedEntity, cwd: string): Promise<void> {
    const root = project.resolveRootDir(cwd)
    try {
        await recordResourceIds(path.join(root, initialized.directory), initialized.resourceIds)
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(
            `initialized ${initialized.directory}, but local resource ID recording failed: ${reason}; keep this entity and record the IDs again; do not initialize a replacement`,
        )
    }
}
