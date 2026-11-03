import * as path from "node:path"

import { isMcpTool, mcpResponsePayload, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import { readEntityStatus, resolveEntityDirectory, type EntityStatus } from "../__lib/entity.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { loadIntegrationConfig } from "./config.js"
import {
    invalidateResourceIds,
    isResourceIdsKind,
    OperationResourceIdsMemo,
    parseResourceIds,
    recordResourceIds,
    resolveCachedResourceIds,
    type ResourceIds,
    type ResourceIdsScope,
} from "./resource-ids.js"
import { requireProjectCall } from "./github-project-reads.js"
import { sameRepository } from "./policy.js"
import { requireProviderCall } from "./provider-evidence.js"
import { planGitHubMerge, type GitHubMergeDecision } from "./forge/github/merge.js"

export type ResourceKind = ResourceIdsScope["kind"]
export interface ProviderEvidence {
    tool: string
    arguments: Record<string, unknown>
    response: unknown
}
export interface ResourceIdsContext {
    directory: string
    status: EntityStatus
    scope: ResourceIdsScope
}

export function resolveResourceIdsContext(cwd: string, entityDir: string, resource: ResourceKind): ResourceIdsContext {
    const root = project.resolveRootDir(cwd)
    assertArtifactPersistencePrepared(root)
    const config = loadIntegrationConfig(root)
    const directory = resolveEntityDirectory(root, cwd, entityDir)
    const status = readEntityStatus(directory)
    const tracker = status.tracker
    const common = { entity: path.basename(directory) }
    let scope: ResourceIdsScope
    switch (resource) {
        case "github-issue":
        case "github-project-item": {
            const configured = config.tracker
            if (configured.provider !== "github" || tracker.provider !== "github")
                throw new Error("resource IDs require a GitHub tracker issue")
            if (!sameRepository(tracker.repository, configured.repository))
                throw new Error("tracker repository differs from the configured repository")
            const issue = {
                ...common,
                mcpServer: configured.mcpServer,
                repository: tracker.repository,
                issueNumber: tracker.external.issueNumber,
            }
            scope =
                resource === "github-issue"
                    ? { ...issue, kind: resource }
                    : { ...issue, kind: resource, project: configured.project }
            break
        }
        case "linear-project": {
            const configured = config.tracker
            if (configured.provider !== "linear" || tracker.provider !== "linear" || tracker.resource !== "project")
                throw new Error("resource IDs require a Linear Project")
            scope = {
                ...common,
                kind: resource,
                mcpServer: configured.mcpServer,
                team: configured.team,
                projectId: tracker.external.projectId,
            }
            break
        }
        case "linear-issue": {
            const configured = config.tracker
            if (configured.provider !== "linear" || tracker.provider !== "linear" || tracker.resource === "project")
                throw new Error("resource IDs require a Linear issue")
            scope = {
                ...common,
                kind: resource,
                mcpServer: configured.mcpServer,
                team: configured.team,
                issueId: tracker.external.issueId,
                relationship:
                    tracker.resource === "task-issue"
                        ? { kind: "project", projectId: tracker.external.projectId }
                        : { kind: "projectless" },
            }
            break
        }
        case "github-pull-request": {
            const forge = status.forge
            if (!forge) throw new Error("PR resource IDs require immutable forge intent prepared before submission")
            if (!sameRepository(forge.repository, config.forge.repository))
                throw new Error("forge repository differs from the configured repository")
            scope = {
                ...common,
                kind: resource,
                mcpServer: config.forge.mcpServer,
                repository: forge.repository,
                head: forge.head,
                target: forge.target,
            }
            break
        }
        default:
            resource satisfies never
            throw new Error("unknown resource kind")
    }
    return { directory, status, scope }
}

function responseObject(evidence: ProviderEvidence): Record<string, unknown> {
    return mcpResponsePayload(evidence.response)
}
function requireCall(
    evidence: ProviderEvidence,
    scope: ResourceIdsScope,
    operation: string,
    expected: Record<string, unknown>,
    tools: McpToolCatalog,
): void {
    requireProviderCall(evidence, { server: scope.mcpServer, operation, expected }, tools, "provider")
}
/** Project-scoped evidence: `owner_type` may be omitted but must match when passed (#148). */
function requireProjectItemCall(
    evidence: ProviderEvidence,
    scope: Extract<ResourceIdsScope, { kind: "github-project-item" }>,
    operation: string,
    expected: Record<string, unknown>,
    tools: McpToolCatalog,
): void {
    requireProjectCall(
        { mcpServer: scope.mcpServer, ...scope.project },
        evidence,
        operation,
        expected,
        tools,
        "provider",
    )
}

export function resourceIdsFromRead(
    scope: ResourceIdsScope,
    evidence: ProviderEvidence,
    tools: McpToolCatalog,
): ResourceIds {
    const response = responseObject(evidence)
    switch (scope.kind) {
        case "github-issue": {
            requireCall(
                evidence,
                scope,
                "issue_read",
                { method: "get", ...scope.repository, issue_number: scope.issueNumber },
                tools,
            )
            if (response.number !== scope.issueNumber)
                throw new Error("provider issue number does not match durable identity")
            if (response.id === undefined)
                throw new Error(
                    "exact issue response omits numeric ID; do not repeat this read merely to populate cache",
                )
            return parseResourceIds({
                scope,
                value: { issueId: positiveInteger(response.id, "issue ID"), url: text(response.html_url, "issue URL") },
            })
        }
        case "github-project-item": {
            requireProjectItemCall(evidence, scope, "projects_get", { method: "get_project_item" }, tools)
            const content = object(response.content, "Project item content")
            if (
                response.content_type !== "Issue" ||
                content.repository?.toString().toLowerCase() !==
                    `${scope.repository.owner}/${scope.repository.repo}`.toLowerCase() ||
                content.number !== scope.issueNumber
            )
                throw new Error("Project item does not belong to the exact durable issue")
            const itemId = positiveInteger(response.id, "Project item ID")
            requireCall(evidence, scope, "projects_get", { item_id: itemId }, tools)
            return parseResourceIds({ scope, value: { itemId } })
        }
        case "linear-project": {
            requireCall(evidence, scope, "get_project", { query: scope.projectId }, tools)
            if (response.uuid !== scope.projectId) throw new Error("Linear Project does not match durable identity")
            return parseResourceIds({ scope, value: { url: text(response.url, "Project URL") } })
        }
        case "linear-issue": {
            requireCall(evidence, scope, "get_issue", { id: scope.issueId }, tools)
            if (response.uuid !== scope.issueId) throw new Error("Linear issue does not match durable identity")
            if (scope.relationship.kind === "project") {
                if (response.projectId !== scope.relationship.projectId)
                    throw new Error("Linear issue does not match the durable Task Project")
            } else if (response.projectId !== undefined && response.projectId !== null)
                throw new Error("Linear Gig issue is not projectless")
            return parseResourceIds({
                scope,
                value: { identifier: text(response.id, "issue identifier"), url: text(response.url, "issue URL") },
            })
        }
        case "github-pull-request": {
            requireCall(evidence, scope, "pull_request_read", { method: "get", ...scope.repository }, tools)
            const number = positiveInteger(response.number, "PR number")
            requireCall(evidence, scope, "pull_request_read", { pullNumber: number }, tools)
            if (!pullRequestMatches(scope, response))
                throw new Error("PR does not match the exact durable repository/head/target association")
            return parseResourceIds({ scope, value: { number, url: text(response.html_url, "PR URL") } })
        }
        default:
            return scope satisfies never
    }
}

export function shippingReadDecision(
    scope: Extract<ResourceIdsScope, { kind: "github-pull-request" }>,
    evidence: ProviderEvidence,
    localHeadSha: string,
    expectedPrNumber: number,
    tools: McpToolCatalog,
): GitHubMergeDecision {
    try {
        const resourceIds = resourceIdsFromRead(scope, evidence, tools)
        if (!isResourceIdsKind(resourceIds, "github-pull-request"))
            throw new Error("shipping requires exact PR evidence")
        if (resourceIds.value.number !== expectedPrNumber)
            throw new Error("shipping PR does not match the locally recorded PR")
        return planGitHubMerge(
            {
                mcpServer: scope.mcpServer,
                repository: scope.repository,
                number: expectedPrNumber,
                base: scope.target,
                head: { repository: scope.repository, ref: scope.head },
                expectedHeadSha: localHeadSha,
            },
            evidence,
            tools,
        )
    } catch (error) {
        return { state: "blocked", reason: error instanceof Error ? error.message : String(error) }
    }
}

export async function resolveResourceIds(context: ResourceIdsContext, memo: OperationResourceIdsMemo) {
    const memoized = memo.resolve(context.scope)
    const cached = memoized ?? (await resolveCachedResourceIds(context.directory, context.scope))
    if (!cached)
        return {
            state: "missing" as const,
            resource: context.scope.kind,
            reason: "resource IDs are missing; investigate through the configured provider tools and record actual evidence",
        }
    return {
        state: "resolved" as const,
        source: memoized ? ("operation" as const) : ("cache" as const),
        resourceIds: memo.record(cached),
    }
}

export async function selectPullRequestResourceIds(
    context: ResourceIdsContext,
    evidence: ProviderEvidence,
    memo: OperationResourceIdsMemo,
    tools: McpToolCatalog,
) {
    if (context.scope.kind !== "github-pull-request") throw new Error("explicit selection requires a PR")
    const resourceIds = resourceIdsFromRead(context.scope, evidence, tools)
    if (!isResourceIdsKind(resourceIds, "github-pull-request"))
        throw new Error("PR selection requires exact PR evidence")
    await recordResourceIds(context.directory, [resourceIds])
    return memo.record(resourceIds)
}

export async function recordResourceIdsEvidence(
    context: ResourceIdsContext,
    evidence: ProviderEvidence,
    memo: OperationResourceIdsMemo,
    tools: McpToolCatalog,
) {
    let primary: ResourceIds
    if (
        context.scope.kind === "github-project-item" &&
        isMcpTool(evidence.tool, context.scope.mcpServer, "projects_write", tools)
    ) {
        requireProjectItemCall(
            evidence,
            context.scope,
            "projects_write",
            {
                method: "add_project_item",
                item_owner: context.scope.repository.owner,
                item_repo: context.scope.repository.repo,
                item_type: "issue",
                issue_number: context.scope.issueNumber,
            },
            tools,
        )
        primary = parseResourceIds({
            scope: context.scope,
            value: { itemId: positiveInteger(responseObject(evidence).item_id, "Project item ID") },
        })
    } else primary = resourceIdsFromRead(context.scope, evidence, tools)
    const resourceIds = [primary]
    if (context.scope.kind === "github-project-item" && responseObject(evidence).content !== undefined) {
        const content = object(responseObject(evidence).content, "Project item content")
        if (content.id !== undefined && content.html_url !== undefined) {
            const { project: _project, ...issueScope } = context.scope
            resourceIds.push(
                parseResourceIds({
                    scope: { ...issueScope, kind: "github-issue" },
                    value: {
                        issueId: positiveInteger(content.id, "issue ID"),
                        url: text(content.html_url, "issue URL"),
                    },
                }),
            )
        }
    }
    await recordResourceIds(context.directory, resourceIds)
    for (const ids of resourceIds) memo.record(ids)
    return primary
}

function pullRequestMatches(
    scope: Extract<ResourceIdsScope, { kind: "github-pull-request" }>,
    response: Record<string, unknown>,
): boolean {
    const head = object(response.head, "PR head")
    const base = object(response.base, "PR base")
    const repository = `${scope.repository.owner}/${scope.repository.repo}`.toLowerCase()
    return (
        text(head.ref, "PR head ref") === scope.head &&
        text(base.ref, "PR base ref") === scope.target &&
        text(object(head.repo, "head repository").full_name, "head repository name").toLowerCase() === repository &&
        text(object(base.repo, "base repository").full_name, "base repository name").toLowerCase() === repository
    )
}

export async function invalidateStaleResourceIds(
    context: ResourceIdsContext,
    evidence: ProviderEvidence,
    memo: OperationResourceIdsMemo,
    tools: McpToolCatalog,
) {
    const resourceIds =
        memo.resolve(context.scope) ?? (await resolveCachedResourceIds(context.directory, context.scope))
    if (!resourceIds) throw new Error("there are no exact scoped cached resource IDs to invalidate")
    const response = responseObject(evidence)
    let stale: boolean
    if (isResourceIdsKind(resourceIds, "github-project-item")) {
        requireProjectItemCall(
            evidence,
            resourceIds.scope,
            "projects_get",
            { method: "get_project_item", item_id: resourceIds.value.itemId },
            tools,
        )
        if (positiveInteger(response.id, "Project item ID") !== resourceIds.value.itemId)
            throw new Error("response does not establish the requested cached item")
        const content = object(response.content, "Project item content")
        stale =
            response.content_type !== "Issue" ||
            text(content.repository, "content repository").toLowerCase() !==
                `${resourceIds.scope.repository.owner}/${resourceIds.scope.repository.repo}`.toLowerCase() ||
            positiveInteger(content.number, "content issue number") !== resourceIds.scope.issueNumber
    } else if (isResourceIdsKind(resourceIds, "github-pull-request")) {
        requireCall(
            evidence,
            resourceIds.scope,
            "pull_request_read",
            {
                method: "get",
                ...resourceIds.scope.repository,
                pullNumber: resourceIds.value.number,
            },
            tools,
        )
        if (positiveInteger(response.number, "PR number") !== resourceIds.value.number)
            throw new Error("response does not establish the requested cached PR")
        stale = !pullRequestMatches(resourceIds.scope, response)
    } else throw new Error("record the exact required read for this immutable object ID instead")
    if (!stale)
        throw new Error("the required read confirms the cached relationship; no stale resource IDs were established")
    await invalidateResourceIds(context.directory, context.scope)
    memo.invalidate(context.scope)
    return {
        state: "missing" as const,
        resource: context.scope.kind,
        reason: "stale resource IDs removed; investigate the provider response before recording replacement IDs or changing an explicit selection",
    }
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid ${label}`)
    return value as Record<string, unknown>
}
function text(value: unknown, label: string): string {
    if (typeof value !== "string" || !value) throw new Error(`invalid ${label}`)
    return value
}
function positiveInteger(value: unknown, label: string): number {
    const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
    if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`invalid ${label}`)
    return parsed
}
