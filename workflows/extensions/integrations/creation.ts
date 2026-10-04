import * as path from "node:path"

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent"

import { getMcpToolName } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import { ENTITY_METADATA_FILE, readEntityStatus, resolveEntityDirectory, writeEntityStatus } from "../__lib/entity.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { loadIntegrationConfig } from "./config.js"
import { gitHubResourceNumber, parseResourceIds, recordResourceIds, type ResourceIds } from "./resource-ids.js"
import { resolveResourceIdsContext, type ProviderEvidence } from "./resource-id-operations.js"
import { resolveWorkflowEnvironment } from "./policy.js"
import type { IntegrationRecord } from "./records.js"

export type CreationRole = "tracker" | "forge"

function environmentFor(cwd: string, entityDir: string) {
    const root = project.resolveRootDir(cwd)
    const config = assertArtifactPersistencePrepared(root)
    const loaded = loadIntegrationConfig(root)
    return {
        directory: resolveEntityDirectory(root, cwd, entityDir),
        config,
        environment: resolveWorkflowEnvironment(config, loaded.state === "enabled" ? loaded.config : undefined),
    }
}

export async function beginProviderCreation(cwd: string, entityDir: string, role: CreationRole) {
    const { directory, environment } = environmentFor(cwd, entityDir)
    return withFileMutationQueue(path.join(directory, ENTITY_METADATA_FILE), async () => {
        const status = readEntityStatus(directory)
        const existing = status.integrations.find((entry) => entry.role === role)
        let checkpoint: IntegrationRecord
        if (role === "tracker") {
            if (!existing || existing.role !== "tracker" || existing.state !== "awaiting")
                throw new Error(
                    "tracker creation is not a first unattempted create; reconcile existing identity/checkpoint instead",
                )
            const { operation, ...identity } = existing
            checkpoint = { ...identity, state: "pending", operations: [operation] }
        } else {
            if (existing)
                throw new Error(
                    "a forge creation/association already exists; reconcile it instead of creating a replacement",
                )
            if (environment.forge.kind !== "github" || status.branch.state !== "ready")
                throw new Error("forge creation requires a configured GitHub forge and ready branch")
            checkpoint = {
                role: "forge",
                provider: "github",
                repository: environment.forge.config.repository,
                head: status.branch.name,
                target: status.branch.target,
                state: "intent",
            }
        }
        const prepared = {
            ...status,
            integrations: [...status.integrations.filter((entry) => entry.role !== role), checkpoint],
        }
        writeEntityStatus(directory, prepared)
        return {
            entityId: status.id,
            role,
            state: checkpoint.state,
            authorization:
                "checkpoint only; call the registered provider mutation under its existing user approval and permissions",
        }
    })
}

export async function recordProviderCreation(
    cwd: string,
    entityDir: string,
    role: CreationRole,
    evidence: ProviderEvidence,
) {
    const { directory, environment, config } = environmentFor(cwd, entityDir)
    if (role === "forge") {
        if (environment.forge.kind !== "github") throw new Error("forge creation requires configured GitHub")
        const { status, scope } = resolveResourceIdsContext(cwd, entityDir, "github-pull-request")
        if (scope.kind !== "github-pull-request") throw new Error("PR recording requires prepared forge intent")
        const response = record(evidence.response)
        requireTool(evidence, scope.mcpServer, "create_pull_request")
        requireArguments(evidence, {
            ...scope.repository,
            head: scope.head,
            base: scope.target,
            title: status.title,
        })
        const url = text(response.url)
        const ids = parseResourceIds({
            scope,
            value: {
                number: gitHubResourceNumber(url, scope.repository, "pull"),
                url,
            },
        })
        await recordResourceIds(directory, [ids])
        return { entityId: status.id, role, resourceIds: [ids] }
    }
    return withFileMutationQueue(path.join(directory, ENTITY_METADATA_FILE), async () => {
        const status = readEntityStatus(directory)
        const existing = status.integrations.find((entry) => entry.role === role)
        const response = record(evidence.response)
        const resourceIds: ResourceIds[] = []
        let identified: IntegrationRecord
        let branch = status.branch
        if (!existing || existing.role !== "tracker" || existing.state !== "pending")
            throw new Error("tracker creation recording requires its durable attempted-create checkpoint")
        const tracker = environment.tracker
        if (existing.provider === "github" && tracker.kind === "github") {
            requireTool(evidence, tracker.config.mcpServer, "issue_write")
            requireArguments(evidence, {
                method: "create",
                ...existing.repository,
                title: status.title,
            })
            const url = text(response.url)
            const issueNumber = gitHubResourceNumber(url, existing.repository, "issues")
            identified = {
                role: "tracker",
                provider: "github",
                repository: existing.repository,
                state: "issue-bound-pending",
                external: { issueNumber },
                operations: ["finish configured Project membership, fields and initialization"],
            }
            resourceIds.push(
                parseResourceIds({
                    scope: {
                        entityId: status.id,
                        mcpServer: tracker.config.mcpServer,
                        kind: "github-issue",
                        repository: existing.repository,
                        issueNumber,
                    },
                    value: { issueId: integer(response.id), url },
                }),
            )
        } else if (existing.provider === "linear" && tracker.kind === "linear") {
            const scope = {
                entityId: status.id,
                mcpServer: tracker.config.mcpServer,
                team: tracker.config.team,
            }
            if (existing.resource === "project") {
                requireTool(evidence, tracker.config.mcpServer, "save_project")
                requireArguments(evidence, {
                    name: status.title,
                    addTeams: [tracker.config.team],
                })
                const projectId = text(response.uuid)
                identified = {
                    role: "tracker",
                    provider: "linear",
                    resource: "project",
                    state: "bound-pending",
                    external: { projectId },
                    operations: ["confirm requested initialization fields"],
                }
                resourceIds.push(
                    parseResourceIds({
                        scope: { ...scope, kind: "linear-project", projectId },
                        value: { url: text(response.url) },
                    }),
                )
            } else {
                requireTool(evidence, tracker.config.mcpServer, "save_issue")
                requireArguments(evidence, {
                    title: status.title,
                    team: tracker.config.team,
                })
                const issueId = text(response.uuid)
                const projectId = existing.resource === "task-issue" ? parentProjectId(directory) : undefined
                if (projectId) requireArguments(evidence, { project: projectId })
                if (
                    projectId
                        ? response.projectId !== projectId
                        : response.projectId !== undefined && response.projectId !== null
                )
                    throw new Error("created Linear issue has the wrong Task/Gig Project relationship")
                identified =
                    existing.resource === "task-issue"
                        ? {
                              role: "tracker",
                              provider: "linear",
                              resource: "task-issue",
                              state: "bound-pending",
                              external: { issueId, projectId: projectId! },
                              operations: ["confirm requested initialization fields"],
                          }
                        : {
                              role: "tracker",
                              provider: "linear",
                              resource: "gig-issue",
                              state: "bound-pending",
                              external: { issueId },
                              operations: ["confirm requested initialization fields"],
                          }
                resourceIds.push(
                    parseResourceIds({
                        scope: {
                            ...scope,
                            kind: "linear-issue",
                            issueId,
                            relationship: projectId ? { kind: "project", projectId } : { kind: "projectless" },
                        },
                        value: { identifier: text(response.id), url: text(response.url) },
                    }),
                )
                if (
                    config.branches.format === "tracker" &&
                    branch.state === "tracker-pending" &&
                    response.gitBranchName !== undefined
                ) {
                    branch = {
                        state: "tracker-named",
                        provider: "linear",
                        name: text(response.gitBranchName),
                        start: branch.start,
                        target: branch.target,
                    }
                }
            }
        } else throw new Error("creation response does not match the durable/configured tracker")
        // Durable known identity precedes disposable cache; a cache failure leaves
        // this checkpoint recoverable rather than allowing another create.
        const integrations = [...status.integrations.filter((entry) => entry.role !== role), identified]
        writeEntityStatus(directory, { ...status, branch, integrations })
        await recordResourceIds(directory, resourceIds)
        return { entityId: status.id, role, resourceIds, state: identified.state }
    })
}

function parentProjectId(directory: string): string {
    const parent = readEntityStatus(path.dirname(path.dirname(directory)))
    const tracker = parent.integrations.find((entry) => entry.role === "tracker")
    if (
        parent.entity !== "epic" ||
        !tracker ||
        tracker.provider !== "linear" ||
        tracker.resource !== "project" ||
        !("external" in tracker)
    )
        throw new Error("Linear Task creation requires its identified parent Epic Project")
    return tracker.external.projectId
}
function requireTool(evidence: ProviderEvidence, server: string, name: string): void {
    if (evidence.tool !== getMcpToolName(server, name))
        throw new Error("creation evidence must come from the configured registered tool")
}
function requireArguments(evidence: ProviderEvidence, expected: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(expected))
        if (JSON.stringify(evidence.arguments[key]) !== JSON.stringify(value))
            throw new Error(`creation evidence ${key} does not match the intended request`)
}
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("creation outcome is not established; preserve the checkpoint and reconcile before retry")
    return value as Record<string, unknown>
}
function text(value: unknown): string {
    if (typeof value !== "string" || !value)
        throw new Error("creation response omits required identity; preserve checkpoint and reconcile")
    return value
}
function integer(value: unknown): number {
    const result = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 1)
        throw new Error("creation response omits a valid numeric ID; reconcile before retry")
    return result
}
