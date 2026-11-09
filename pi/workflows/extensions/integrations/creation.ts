import * as path from "node:path"

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent"

import {
    getMcpToolName,
    mcpResponsePayload,
    requireMcpTool,
    type McpToolCatalog,
} from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import { ENTITY_METADATA_FILE, readEntityStatus, resolveEntityDirectory, writeEntityStatus } from "../__lib/entity.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { loadIntegrationConfig } from "./config.js"
import { gitHubResourceNumber, parseResourceIds, recordResourceIds } from "./resource-ids.js"
import { resolveResourceIdsContext, type ProviderEvidence } from "./resource-id-operations.js"

const CREATE_OPERATION = "create_pull_request"

// The create call's required arguments; the returned call and the evidence check share them.
function pullRequestCreateArguments(
    repository: { owner: string; repo: string },
    head: string,
    target: string,
    title: string,
) {
    return { owner: repository.owner, repo: repository.repo, head, base: target, title }
}

// PR creation: save the immutable repository, head, and target intent and return the exact
// create call, then record the created PR's number and URL. Tracker objects are created
// before the entity exists.
export async function beginPullRequestCreation(cwd: string, entityDir: string, tools: McpToolCatalog) {
    const root = project.resolveRootDir(cwd)
    assertArtifactPersistencePrepared(root)
    const forge = loadIntegrationConfig(root).forge
    const directory = resolveEntityDirectory(root, cwd, entityDir)
    return withFileMutationQueue(path.join(directory, ENTITY_METADATA_FILE), async () => {
        const status = readEntityStatus(directory)
        if (status.entity === "epic") throw new Error("Epics never create pull requests")
        if (status.forge) throw new Error("PR intent already exists; reconcile it instead of creating a replacement")
        const tool = getMcpToolName(forge.mcpServer, CREATE_OPERATION, tools)
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
            mutation: {
                tool,
                arguments: pullRequestCreateArguments(
                    forge.repository,
                    status.branch.name,
                    status.branch.target,
                    status.title,
                ),
            },
            authorization:
                "checkpoint only; add the rendered body as arguments.body and run mutation unchanged under the existing submission approval and permissions",
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
    requireMcpTool(evidence.tool, scope.mcpServer, CREATE_OPERATION, tools, "PR creation evidence")
    const expected = pullRequestCreateArguments(scope.repository, scope.head, scope.target, status.title)
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
