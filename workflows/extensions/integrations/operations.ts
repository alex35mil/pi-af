import * as path from "node:path"

import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"
import { workflowTools } from "../__lib/tools.js"

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
import {
    ConfirmTrackerInitializationSchema,
    confirmTrackerInitialization,
    GitHubInitializationInputSchema,
    LinearInitializationInputSchema,
} from "./initialization.js"
import {
    SetWorkflowPhaseSchema,
    setWorkflowPhase,
    GitHubPhaseInputSchema,
    LinearPhaseInputSchema,
    githubPhaseFacts,
    linearPhaseFacts,
} from "./phase.js"
import { resolveWorkflowEnvironment, type WorkflowEnvironment } from "./policy.js"

async function updateEntity<T extends { status: EntityStatus; changed: boolean }>(
    cwd: string,
    raw: string,
    operation: (status: EntityStatus, environment: WorkflowEnvironment, directory: string) => T,
) {
    const root = project.resolveRootDir(cwd)
    const directory = resolveEntityDirectory(root, cwd, raw.replace(/^@/, ""))
    return withFileMutationQueue(path.join(directory, ENTITY_METADATA_FILE), async () => {
        assertArtifactPersistencePrepared(root)
        const loaded = loadIntegrationConfig(root)
        const environment = resolveWorkflowEnvironment(loaded.state === "enabled" ? loaded.config : undefined)
        const result = operation(readEntityStatus(directory), environment, directory)
        if (result.changed) writeEntityStatus(directory, result.status)
        const { status, ...outcome } = result
        return { entityId: status.id, phase: status.phase, ...outcome }
    })
}

export function registerWorkflowOperations(pi: ExtensionAPI): void {
    const tools = workflowTools(pi, "integrations")
    const [local, tracker] = SetWorkflowPhaseSchema.anyOf
    const trackerProperties = Type.Omit(tracker, ["authority", "native"]).properties
    tools.registerTool({
        name: "set_local_workflow_phase",
        label: "set_local_workflow_phase",
        description: "Set the Phase of trackerless In Progress work. Does not change lifecycle or grant approval.",
        parameters: Type.Omit(local, ["authority"]),
        async execute(_id, params, _signal, _update, ctx) {
            const input = Value.Parse(SetWorkflowPhaseSchema, { ...params, authority: "workflow" })
            const result = await updateEntity(ctx.cwd, input.entityDir, (status, environment) =>
                setWorkflowPhase(status, environment, input),
            )
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result }
        },
    })
    const phaseOperations = [
        ["set_github_workflow_phase", GitHubPhaseInputSchema],
        ["set_linear_workflow_phase", LinearPhaseInputSchema],
    ] as const
    for (const [name, nativeSchema] of phaseOperations) {
        const parameters = Type.Object({ ...trackerProperties, native: nativeSchema }, { additionalProperties: false })
        tools.registerTool({
            name,
            label: name,
            description:
                "Set In Progress workflow Phase and calculate reconciliation from fresh provider-specific native facts. Omit only genuinely empty native leaf values. Local metadata only; apply a changed assignment through the configured MCP tool. Does not change lifecycle or grant approval.",
            parameters,
            async execute(_id, params, _signal, _update, ctx) {
                const native =
                    name === "set_github_workflow_phase"
                        ? githubPhaseFacts(Value.Parse(GitHubPhaseInputSchema, params.native))
                        : linearPhaseFacts(Value.Parse(LinearPhaseInputSchema, params.native))
                const input = Value.Parse(SetWorkflowPhaseSchema, { ...params, authority: "tracker", native })
                const result = await updateEntity(ctx.cwd, input.entityDir, (status, environment) =>
                    setWorkflowPhase(status, environment, input),
                )
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
    }
    const confirmations = [
        ["confirm_github_tracker", GitHubInitializationInputSchema],
        ["confirm_linear_tracker", LinearInitializationInputSchema],
    ] as const
    for (const [name, parameters] of confirmations) {
        tools.registerTool({
            name,
            label: name,
            description:
                "Confirm an identified pending tracker binding from complete fresh initialization outcomes. Omitted nullable leaves mean observed native empty values. Updates existing metadata only; does not call providers, change branches, or independently establish freshness/provenance.",
            parameters,
            async execute(_id, params, _signal, _update, ctx) {
                const supplied = Value.Parse(parameters, params)
                const facts =
                    name === "confirm_linear_tracker"
                        ? (() => {
                              const value = Value.Parse(LinearInitializationInputSchema, supplied).facts
                              return {
                                  ...value,
                                  provider: "linear",
                                  projectId: value.projectId ?? null,
                                  phase: linearPhaseFacts(value.phase),
                              }
                          })()
                        : (() => {
                              const value = Value.Parse(GitHubInitializationInputSchema, supplied).facts
                              return {
                                  ...value,
                                  provider: "github",
                                  parentIssueNumber: value.parentIssueNumber ?? null,
                                  phase: githubPhaseFacts(value.phase),
                              }
                          })()
                const input = Value.Parse(ConfirmTrackerInitializationSchema, { entityDir: supplied.entityDir, facts })
                const result = await updateEntity(ctx.cwd, input.entityDir, (status, environment, directory) => {
                    const parent =
                        status.entity === "task" ? readEntityStatus(path.dirname(path.dirname(directory))) : null
                    return confirmTrackerInitialization(status, environment, input.facts, parent)
                })
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
    }
}
