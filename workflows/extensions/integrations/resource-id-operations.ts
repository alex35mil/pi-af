import { isDeepStrictEqual } from "node:util"

import { getMcpToolName } from "../../../extensions/__lib/mcp.js"
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
import { resolveWorkflowEnvironment } from "./policy.js"
import type { DeliveryCleanupInput } from "../deliverable/cleanup.js"

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
    const config = assertArtifactPersistencePrepared(root)
    const loaded = loadIntegrationConfig(root)
    const environment = resolveWorkflowEnvironment(config, loaded.state === "enabled" ? loaded.config : undefined)
    const directory = resolveEntityDirectory(root, cwd, entityDir)
    const status = readEntityStatus(directory)
    const tracker = status.integrations.find((entry) => entry.role === "tracker")
    const common = { entityId: status.id }
    let scope: ResourceIdsScope
    switch (resource) {
        case "github-issue":
        case "github-project-item": {
            if (
                environment.tracker.kind !== "github" ||
                !tracker ||
                tracker.provider !== "github" ||
                !("external" in tracker)
            )
                throw new Error("resource IDs require an identified GitHub tracker issue")
            const configured = environment.tracker.config
            if (!sameRepository(tracker.repository, configured.repository))
                throw new Error("tracker repository changed; see workflows/MIGRATIONS.md")
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
            if (
                environment.tracker.kind !== "linear" ||
                !tracker ||
                tracker.provider !== "linear" ||
                tracker.resource !== "project" ||
                !("external" in tracker)
            )
                throw new Error("resource IDs require an identified Linear Project")
            scope = {
                ...common,
                kind: resource,
                mcpServer: environment.tracker.config.mcpServer,
                team: environment.tracker.config.team,
                projectId: tracker.external.projectId,
            }
            break
        }
        case "linear-issue": {
            if (
                environment.tracker.kind !== "linear" ||
                !tracker ||
                tracker.provider !== "linear" ||
                tracker.resource === "project" ||
                !("external" in tracker)
            )
                throw new Error("resource IDs require an identified Linear issue")
            scope = {
                ...common,
                kind: resource,
                mcpServer: environment.tracker.config.mcpServer,
                team: environment.tracker.config.team,
                issueId: tracker.external.issueId,
                relationship:
                    tracker.resource === "task-issue"
                        ? { kind: "project", projectId: tracker.external.projectId }
                        : { kind: "projectless" },
            }
            break
        }
        case "github-pull-request": {
            const forge = status.integrations.find((entry) => entry.role === "forge")
            if (environment.forge.kind !== "github" || !forge || status.branch.state !== "ready")
                throw new Error("PR resource IDs require immutable forge intent prepared before submission")
            if (!sameRepository(forge.repository, environment.forge.config.repository))
                throw new Error("forge repository changed; see workflows/MIGRATIONS.md")
            scope = {
                ...common,
                kind: resource,
                mcpServer: environment.forge.config.mcpServer,
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

function sameRepository(left: { owner: string; repo: string }, right: { owner: string; repo: string }): boolean {
    return (
        left.owner.toLowerCase() === right.owner.toLowerCase() && left.repo.toLowerCase() === right.repo.toLowerCase()
    )
}
function responseObject(evidence: ProviderEvidence): Record<string, unknown> {
    return object(evidence.response, "provider response")
}
function assertArguments(evidence: ProviderEvidence, expected: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(expected)) {
        const actual = evidence.arguments[key]
        const repositoryName = ["owner", "repo", "item_owner", "item_repo"].includes(key)
        const matches =
            repositoryName && typeof actual === "string" && typeof value === "string"
                ? actual.toLowerCase() === value.toLowerCase()
                : isDeepStrictEqual(actual, value)
        if (!matches) throw new Error(`provider evidence argument ${key} does not match the required resource`)
    }
}
function requireTool(evidence: ProviderEvidence, scope: ResourceIdsScope, tool: string): void {
    if (evidence.tool !== getMcpToolName(scope.mcpServer, tool))
        throw new Error("provider evidence does not come from the configured registered tool")
}

export function resourceIdsFromRead(scope: ResourceIdsScope, evidence: ProviderEvidence): ResourceIds {
    const response = responseObject(evidence)
    switch (scope.kind) {
        case "github-issue": {
            requireTool(evidence, scope, "issue_read")
            assertArguments(evidence, { method: "get", ...scope.repository, issue_number: scope.issueNumber })
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
            requireTool(evidence, scope, "projects_get")
            assertArguments(evidence, {
                method: "get_project_item",
                owner: scope.project.owner,
                owner_type: scope.project.ownerType,
                project_number: scope.project.number,
            })
            const content = object(response.content, "Project item content")
            if (
                response.content_type !== "Issue" ||
                content.repository?.toString().toLowerCase() !==
                    `${scope.repository.owner}/${scope.repository.repo}`.toLowerCase() ||
                content.number !== scope.issueNumber
            )
                throw new Error("Project item does not belong to the exact durable issue")
            const itemId = positiveInteger(response.id, "Project item ID")
            assertArguments(evidence, { item_id: itemId })
            return parseResourceIds({ scope, value: { itemId } })
        }
        case "linear-project": {
            requireTool(evidence, scope, "get_project")
            assertArguments(evidence, { query: scope.projectId })
            if (response.uuid !== scope.projectId) throw new Error("Linear Project does not match durable identity")
            return parseResourceIds({ scope, value: { url: text(response.url, "Project URL") } })
        }
        case "linear-issue": {
            requireTool(evidence, scope, "get_issue")
            assertArguments(evidence, { id: scope.issueId })
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
            requireTool(evidence, scope, "pull_request_read")
            const number = positiveInteger(response.number, "PR number")
            assertArguments(evidence, { method: "get", ...scope.repository, pullNumber: number })
            if (!pullRequestMatches(scope, response))
                throw new Error("PR does not match the exact durable repository/head/target association")
            return parseResourceIds({ scope, value: { number, url: text(response.html_url, "PR URL") } })
        }
        default:
            return scope satisfies never
    }
}

export type FinishReadDecision =
    | { state: "blocked"; reason: string }
    | {
          state: "merge-needed"
          arguments: {
              owner: string
              repo: string
              pullNumber: number
              merge_method: "squash"
              expectedHeadSha: string
          }
      }
    | { state: "merged"; merge: Extract<DeliveryCleanupInput["merge"], { kind: "github-pr" }> }

export function finishReadDecision(
    scope: Extract<ResourceIdsScope, { kind: "github-pull-request" }>,
    evidence: ProviderEvidence,
    localHeadSha: string,
    expectedPrNumber: number,
): FinishReadDecision {
    try {
        const resourceIds = resourceIdsFromRead(scope, evidence)
        if (!isResourceIdsKind(resourceIds, "github-pull-request")) throw new Error("finish requires exact PR evidence")
        if (resourceIds.value.number !== expectedPrNumber)
            throw new Error("finish PR does not match the locally recorded PR")
        const response = responseObject(evidence)
        const headCommitSha = text(object(response.head, "PR head").sha, "PR head SHA")
        if (!/^[0-9a-fA-F]{40,64}$/.test(localHeadSha) || headCommitSha.toLowerCase() !== localHeadSha.toLowerCase())
            throw new Error("finish PR head does not match the local Deliverable head")
        if (response.merged === false)
            return {
                state: "merge-needed",
                arguments: {
                    ...scope.repository,
                    pullNumber: resourceIds.value.number,
                    merge_method: "squash",
                    expectedHeadSha: localHeadSha,
                },
            }
        if (response.merged !== true) throw new Error("exact PR get does not establish merged state")
        return {
            state: "merged",
            merge: {
                kind: "github-pr",
                source: "pull_request_read:get",
                repository: scope.repository,
                pullRequestNumber: resourceIds.value.number,
                merged: true,
                mergedAt: text(response.merged_at, "PR merge timestamp"),
                head: scope.head,
                headCommitSha,
                base: scope.target,
            },
        }
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
) {
    if (context.scope.kind !== "github-pull-request") throw new Error("explicit selection requires a PR")
    const resourceIds = resourceIdsFromRead(context.scope, evidence)
    if (!isResourceIdsKind(resourceIds, "github-pull-request"))
        throw new Error("PR selection requires exact PR evidence")
    await recordResourceIds(context.directory, [resourceIds])
    return memo.record(resourceIds)
}

export async function recordResourceIdsEvidence(
    context: ResourceIdsContext,
    evidence: ProviderEvidence,
    memo: OperationResourceIdsMemo,
) {
    let primary: ResourceIds
    if (
        context.scope.kind === "github-project-item" &&
        evidence.tool === getMcpToolName(context.scope.mcpServer, "projects_write")
    ) {
        assertArguments(evidence, {
            method: "add_project_item",
            owner: context.scope.project.owner,
            owner_type: context.scope.project.ownerType,
            project_number: context.scope.project.number,
            item_owner: context.scope.repository.owner,
            item_repo: context.scope.repository.repo,
            item_type: "issue",
            issue_number: context.scope.issueNumber,
        })
        primary = parseResourceIds({
            scope: context.scope,
            value: { itemId: positiveInteger(responseObject(evidence).id, "Project item ID") },
        })
    } else primary = resourceIdsFromRead(context.scope, evidence)
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
) {
    const resourceIds =
        memo.resolve(context.scope) ?? (await resolveCachedResourceIds(context.directory, context.scope))
    if (!resourceIds) throw new Error("there are no exact scoped cached resource IDs to invalidate")
    const response = responseObject(evidence)
    let stale: boolean
    if (isResourceIdsKind(resourceIds, "github-project-item")) {
        requireTool(evidence, resourceIds.scope, "projects_get")
        assertArguments(evidence, {
            method: "get_project_item",
            owner: resourceIds.scope.project.owner,
            owner_type: resourceIds.scope.project.ownerType,
            project_number: resourceIds.scope.project.number,
            item_id: resourceIds.value.itemId,
        })
        if (positiveInteger(response.id, "Project item ID") !== resourceIds.value.itemId)
            throw new Error("response does not establish the requested cached item")
        const content = object(response.content, "Project item content")
        stale =
            response.content_type !== "Issue" ||
            text(content.repository, "content repository").toLowerCase() !==
                `${resourceIds.scope.repository.owner}/${resourceIds.scope.repository.repo}`.toLowerCase() ||
            positiveInteger(content.number, "content issue number") !== resourceIds.scope.issueNumber
    } else if (isResourceIdsKind(resourceIds, "github-pull-request")) {
        requireTool(evidence, resourceIds.scope, "pull_request_read")
        assertArguments(evidence, {
            method: "get",
            ...resourceIds.scope.repository,
            pullNumber: resourceIds.value.number,
        })
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
