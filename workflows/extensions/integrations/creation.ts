import * as path from "node:path"

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent"

import { isMcpTool, mcpResponsePayload, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import { ENTITY_METADATA_FILE, readEntityStatus, resolveEntityDirectory, writeEntityStatus } from "../__lib/entity.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { loadIntegrationConfig } from "./config.js"
import { gitHubResourceNumber, parseResourceIds, recordResourceIds } from "./resource-ids.js"
import { resolveResourceIdsContext, type ProviderEvidence } from "./resource-id-operations.js"

// PR creation: save the immutable repository, head, and target intent, then record the
// created PR's number and URL. Tracker objects are created before the entity exists.
export async function beginPullRequestCreation(cwd: string, entityDir: string) {
    const root = project.resolveRootDir(cwd)
    assertArtifactPersistencePrepared(root)
    const forge = loadIntegrationConfig(root).forge
    const directory = resolveEntityDirectory(root, cwd, entityDir)
    return withFileMutationQueue(path.join(directory, ENTITY_METADATA_FILE), async () => {
        const status = readEntityStatus(directory)
        if (status.entity === "epic") throw new Error("Epics never create pull requests")
        if (status.forge) throw new Error("PR intent already exists; reconcile it instead of creating a replacement")
        writeEntityStatus(directory, {
            ...status,
            forge: {
                provider: "github",
                repository: { ...forge.repository },
                head: status.branch.name,
                target: status.branch.target,
            },
        })
        return {
            entity: path.basename(directory),
            state: "intent" as const,
            authorization:
                "checkpoint only; call the registered provider mutation under its existing user approval and permissions",
        }
    })
}

export async function recordPullRequestCreation(
    cwd: string,
    entityDir: string,
    evidence: ProviderEvidence,
    tools: McpToolCatalog,
) {
    const { status, scope, directory } = resolveResourceIdsContext(cwd, entityDir, "github-pull-request")
    if (scope.kind !== "github-pull-request") throw new Error("PR recording requires prepared forge intent")
    const response = mcpResponsePayload(evidence.response)
    if (!isMcpTool(evidence.tool, scope.mcpServer, "create_pull_request", tools))
        throw new Error("creation evidence must come from the configured registered tool")
    const expected = { ...scope.repository, head: scope.head, base: scope.target, title: status.title }
    for (const [key, value] of Object.entries(expected))
        if (JSON.stringify(evidence.arguments[key]) !== JSON.stringify(value))
            throw new Error(`creation evidence ${key} does not match the intended request`)
    if (typeof response.url !== "string" || !response.url)
        throw new Error("creation response omits required identity; preserve the intent and reconcile")
    const url = response.url
    const ids = parseResourceIds({ scope, value: { number: gitHubResourceNumber(url, scope.repository, "pull"), url } })
    await recordResourceIds(directory, [ids])
    return { entity: path.basename(directory), resourceIds: [ids] }
}
