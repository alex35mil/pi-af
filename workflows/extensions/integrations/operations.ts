import * as path from "node:path"

import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import { workflowTools } from "../__lib/tools.js"
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
        const environment = resolveWorkflowEnvironment(loadIntegrationConfig(root))
        const result = operation(readEntityStatus(directory), environment, directory)
        if (result.changed) writeEntityStatus(directory, result.status)
        const { status, ...outcome } = result
        return { entity: path.basename(directory), phase: status.phase, ...outcome }
    })
}

export function registerWorkflowOperations(pi: ExtensionAPI): void {
    const tools = workflowTools(pi, "integrations")
    const properties = Type.Omit(SetWorkflowPhaseSchema, ["native"]).properties
    const phaseOperations = [
        ["set_github_workflow_phase", GitHubPhaseInputSchema],
        ["set_linear_workflow_phase", LinearPhaseInputSchema],
    ] as const
    for (const [name, nativeSchema] of phaseOperations) {
        const parameters = Type.Object({ ...properties, native: nativeSchema }, { additionalProperties: false })
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
                const input = Value.Parse(SetWorkflowPhaseSchema, { ...params, native })
                const result = await updateEntity(ctx.cwd, input.entityDir, (status, environment) =>
                    setWorkflowPhase(status, environment, input),
                )
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
    }
}
