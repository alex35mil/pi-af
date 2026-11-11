import * as path from "node:path"

import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

import { parse } from "../../../extensions/__lib/schema.js"
import type { McpToolCatalog } from "../../../extensions/__lib/mcp.js"
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
    SetWorkflowPhaseValidator,
    setWorkflowPhase,
    LinearPhaseInputSchema,
    LinearPhaseInputValidator,
    linearPhaseFacts,
} from "./phase.js"
import { GitHubPhaseInputSchema, GitHubPhaseInputValidator, githubPhaseFacts } from "./github-phase-evidence.js"
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

export function registerWorkflowOperations(pi: ExtensionAPI, mcpTools: McpToolCatalog): void {
    const tools = workflowTools(pi, "integrations")
    const properties = Type.Omit(SetWorkflowPhaseSchema, ["native"]).properties
    const phaseOperations = [
        ["set_github_workflow_phase", GitHubPhaseInputSchema, "the actual Project field and item reads"],
        [
            "set_linear_workflow_phase",
            LinearPhaseInputSchema,
            "fresh label catalog and selection facts; omit only genuinely empty native leaf values",
        ],
    ] as const
    for (const [name, nativeSchema, facts] of phaseOperations) {
        const parameters = Type.Object({ ...properties, native: nativeSchema }, { additionalProperties: false })
        tools.registerTool({
            name,
            label: name,
            description: `Set In Progress workflow Phase and calculate reconciliation from ${facts}. Local metadata only; apply a changed assignment through the configured MCP tool. Does not change lifecycle or grant approval.`,
            parameters,
            async execute(_id, params, _signal, _update, ctx) {
                const result = await updateEntity(ctx.cwd, params.entityDir, (status, environment, directory) => {
                    const native =
                        name === "set_github_workflow_phase"
                            ? githubPhaseFacts(
                                  environment.tracker,
                                  { name: path.basename(directory), status },
                                  parse(GitHubPhaseInputValidator, params.native),
                                  mcpTools,
                              )
                            : linearPhaseFacts(parse(LinearPhaseInputValidator, params.native))
                    return setWorkflowPhase(
                        status,
                        environment,
                        parse(SetWorkflowPhaseValidator, { ...params, native }),
                    )
                })
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
    }
}
