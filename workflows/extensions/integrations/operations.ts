import * as path from "node:path"

import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import {
    ENTITY_METADATA_FILE,
    readEntityStatus,
    resolveEntityDirectory,
    writeEntityStatus,
    type EntityStatus,
} from "../__lib/entity.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { loadIntegrationConfig } from "./config.js"
import { ConfirmTrackerInitializationSchema, confirmTrackerInitialization } from "./initialization.js"
import { SetWorkflowPhaseSchema, setWorkflowPhase } from "./phase.js"
import { resolveWorkflowEnvironment, type WorkflowEnvironment } from "./policy.js"

async function updateEntity<T extends { status: EntityStatus; changed: boolean }>(
    cwd: string,
    raw: string,
    operation: (status: EntityStatus, environment: WorkflowEnvironment, directory: string) => T,
) {
    const root = project.resolveRootDir(cwd)
    const directory = resolveEntityDirectory(root, cwd, raw.replace(/^@/, ""))
    return withFileMutationQueue(path.join(directory, ENTITY_METADATA_FILE), async () => {
        const config = assertArtifactPersistencePrepared(root)
        const loaded = loadIntegrationConfig(root)
        const environment = resolveWorkflowEnvironment(config, loaded.state === "enabled" ? loaded.config : undefined)
        const result = operation(readEntityStatus(directory), environment, directory)
        if (result.changed) writeEntityStatus(directory, result.status)
        const { status, ...outcome } = result
        return { entityId: status.id, phase: status.phase, ...outcome }
    })
}

export function registerWorkflowOperations(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "set_workflow_phase",
        label: "set_workflow_phase",
        description:
            "Set the existing Phase of In Progress work and calculate native reconciliation from fresh observed facts. Local metadata only; apply a changed assignment through the configured MCP tool. Does not change lifecycle or grant approval.",
        parameters: SetWorkflowPhaseSchema,
        async execute(_id, params, _signal, _update, ctx) {
            const input = Value.Parse(SetWorkflowPhaseSchema, params)
            const result = await updateEntity(ctx.cwd, input.entityDir, (status, environment) =>
                setWorkflowPhase(status, environment, input),
            )
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result }
        },
    })
    pi.registerTool({
        name: "confirm_tracker_initialization",
        label: "confirm_tracker_initialization",
        description:
            "Confirm an identified pending tracker binding against normalized observed initialization outcomes. Updates existing metadata only; does not execute provider calls, change branches, or independently establish fact freshness/provenance.",
        parameters: ConfirmTrackerInitializationSchema,
        async execute(_id, params, _signal, _update, ctx) {
            const input = Value.Parse(ConfirmTrackerInitializationSchema, params)
            const result = await updateEntity(ctx.cwd, input.entityDir, (status, environment, directory) => {
                const parent = status.entity === "task" ? readEntityStatus(path.dirname(path.dirname(directory))) : null
                return confirmTrackerInitialization(status, environment, input.facts, parent)
            })
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result }
        },
    })
}
