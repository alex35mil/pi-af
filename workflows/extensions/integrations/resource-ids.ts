import * as fs from "node:fs"
import * as path from "node:path"
import { isDeepStrictEqual } from "node:util"

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent"
import { type Static, type TSchema, Type } from "typebox"
import { Value } from "typebox/value"

import { writeTextAtomically } from "../__lib/files.js"

export const RESOURCE_IDS_CACHE_FILE = ".local/metadata.json"

const OneLine = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })
const PositiveInteger = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const Repository = Type.Object({ owner: OneLine, repo: OneLine }, { additionalProperties: false })
const Project = Type.Object(
    { owner: OneLine, ownerType: Type.Union([Type.Literal("user"), Type.Literal("org")]), number: PositiveInteger },
    { additionalProperties: false },
)
const commonScope = { entityId: OneLine, mcpServer: OneLine }
const githubIssueScope = { ...commonScope, repository: Repository, issueNumber: PositiveInteger }

export const GitHubIssueResourceIdsScopeSchema = Type.Object(
    { ...githubIssueScope, kind: Type.Literal("github-issue") },
    { additionalProperties: false },
)
export const GitHubProjectItemResourceIdsScopeSchema = Type.Object(
    { ...githubIssueScope, kind: Type.Literal("github-project-item"), project: Project },
    { additionalProperties: false },
)
export const LinearProjectResourceIdsScopeSchema = Type.Object(
    { ...commonScope, kind: Type.Literal("linear-project"), team: OneLine, projectId: OneLine },
    { additionalProperties: false },
)
export const LinearIssueResourceIdsScopeSchema = Type.Object(
    {
        ...commonScope,
        kind: Type.Literal("linear-issue"),
        team: OneLine,
        issueId: OneLine,
        relationship: Type.Union([
            Type.Object({ kind: Type.Literal("projectless") }, { additionalProperties: false }),
            Type.Object({ kind: Type.Literal("project"), projectId: OneLine }, { additionalProperties: false }),
        ]),
    },
    { additionalProperties: false },
)
export const GitHubPullRequestResourceIdsScopeSchema = Type.Object(
    {
        ...commonScope,
        kind: Type.Literal("github-pull-request"),
        repository: Repository,
        head: OneLine,
        target: OneLine,
    },
    { additionalProperties: false },
)
export const ProviderResourceIdsScopeSchema = Type.Union([
    GitHubIssueResourceIdsScopeSchema,
    GitHubProjectItemResourceIdsScopeSchema,
    LinearProjectResourceIdsScopeSchema,
    LinearIssueResourceIdsScopeSchema,
    GitHubPullRequestResourceIdsScopeSchema,
])
export type ResourceIdsScope = Static<typeof ProviderResourceIdsScopeSchema>

function entry<S extends TSchema, V extends TSchema>(scope: S, value: V) {
    return Type.Object({ scope, value }, { additionalProperties: false })
}

export const ResourceIdsSchema = Type.Union([
    entry(
        GitHubIssueResourceIdsScopeSchema,
        Type.Object({ issueId: PositiveInteger, url: OneLine }, { additionalProperties: false }),
    ),
    entry(
        GitHubProjectItemResourceIdsScopeSchema,
        Type.Object({ itemId: PositiveInteger }, { additionalProperties: false }),
    ),
    entry(LinearProjectResourceIdsScopeSchema, Type.Object({ url: OneLine }, { additionalProperties: false })),
    entry(
        LinearIssueResourceIdsScopeSchema,
        Type.Object({ identifier: OneLine, url: OneLine }, { additionalProperties: false }),
    ),
    entry(
        GitHubPullRequestResourceIdsScopeSchema,
        Type.Object({ number: PositiveInteger, url: OneLine }, { additionalProperties: false }),
    ),
])
export type ResourceIds = Static<typeof ResourceIdsSchema>

export function isResourceIdsKind<K extends ResourceIdsScope["kind"]>(
    ids: ResourceIds,
    kind: K,
): ids is Extract<ResourceIds, { scope: { kind: K } }> {
    return ids.scope.kind === kind
}

export const ResourceIdsCacheSchema = Type.Object(
    { entityId: OneLine, resourceIds: Type.Array(ResourceIdsSchema) },
    { additionalProperties: false },
)
export type ResourceIdsCache = Static<typeof ResourceIdsCacheSchema>

export function parseResourceIdsScope(raw: unknown): ResourceIdsScope {
    if (!Value.Check(ProviderResourceIdsScopeSchema, raw)) throw new Error("invalid resource IDs scope")
    return normalizeScope(raw)
}

export function parseResourceIds(raw: unknown): ResourceIds {
    if (!Value.Check(ResourceIdsSchema, raw)) throw new Error("invalid resource IDs")
    const result = { ...structuredClone(raw), scope: normalizeScope(raw.scope) } as ResourceIds
    if (isResourceIdsKind(result, "github-issue")) {
        assertGitHubResourceUrl(result.value.url, result.scope.repository, "issues", result.scope.issueNumber)
    } else if (isResourceIdsKind(result, "github-pull-request")) {
        assertGitHubResourceUrl(result.value.url, result.scope.repository, "pull", result.value.number)
    } else if (isResourceIdsKind(result, "linear-project") || isResourceIdsKind(result, "linear-issue")) {
        const url = new URL(result.value.url)
        if (
            url.protocol !== "https:" ||
            url.hostname !== "linear.app" ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        ) {
            throw new Error("resource IDs requires a Linear resource URL")
        }
        const resource = result.scope.kind === "linear-project" ? "project" : "issue"
        if (!new RegExp(`^/[^/]+/${resource}/[^/]+(?:/[^/]+)?$`).test(url.pathname)) {
            throw new Error("resource IDs has the wrong Linear resource URL")
        }
    }
    return result
}

export function gitHubResourceNumber(
    url: string,
    repository: Static<typeof Repository>,
    resource: "issues" | "pull",
): number {
    const parsed = new URL(url)
    const match = /\/(\d+)$/.exec(parsed.pathname)
    if (!match) throw new Error("provider response has no GitHub resource number")
    const number = Number(match[1])
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("invalid GitHub resource number")
    assertGitHubResourceUrl(url, repository, resource, number)
    return number
}

function assertGitHubResourceUrl(
    url: string,
    repository: Static<typeof Repository>,
    resource: "issues" | "pull",
    number: number,
): void {
    const parsed = new URL(url)
    const expected = `/${repository.owner}/${repository.repo}/${resource}/${number}`.toLowerCase()
    if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "github.com" ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname.toLowerCase() !== expected
    ) {
        throw new Error("resource IDs URL does not match the exact GitHub resource")
    }
}

function normalizeScope(scope: ResourceIdsScope): ResourceIdsScope {
    const result = structuredClone(scope)
    if ("repository" in result) {
        result.repository.owner = result.repository.owner.toLowerCase()
        result.repository.repo = result.repository.repo.toLowerCase()
    }
    if ("project" in result) result.project.owner = result.project.owner.toLowerCase()
    return result
}

export function readResourceIdsCache(entityDirectory: string): ResourceIdsCache | undefined {
    const file = path.resolve(entityDirectory, RESOURCE_IDS_CACHE_FILE)
    if (!fs.existsSync(file)) return undefined
    try {
        const raw: unknown = JSON.parse(fs.readFileSync(file, "utf-8"))
        if (!Value.Check(ResourceIdsCacheSchema, raw)) throw new Error("cache schema does not match")
        const kinds = new Set<ResourceIdsScope["kind"]>()
        const resourceIds = raw.resourceIds.map((ids) => {
            const parsed = parseResourceIds(ids)
            if (parsed.scope.entityId !== raw.entityId) throw new Error("entry does not belong to the cache entity")
            if (kinds.has(parsed.scope.kind)) throw new Error(`duplicate ${parsed.scope.kind} entry`)
            kinds.add(parsed.scope.kind)
            return parsed
        })
        return { entityId: raw.entityId, resourceIds }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(
            `invalid resource IDs cache in ${file}: ${reason}; inspect or remove this disposable cache; agent investigation must establish IDs before recording them`,
        )
    }
}

function ownedCache(entityDirectory: string, entityId: string): ResourceIdsCache {
    const cache = readResourceIdsCache(entityDirectory)
    return cache?.entityId === entityId ? cache : { entityId, resourceIds: [] }
}

export function readCachedResourceIds(entityDirectory: string, rawScope: unknown): ResourceIds | undefined {
    const scope = parseResourceIdsScope(rawScope)
    const ids = ownedCache(entityDirectory, scope.entityId).resourceIds.find((entry) =>
        isDeepStrictEqual(entry.scope, scope),
    )
    return ids ? structuredClone(ids) : undefined
}

function writeCache(file: string, cache: ResourceIdsCache): void {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    writeTextAtomically(file, `${JSON.stringify(cache, null, 2)}\n`)
}

export async function recordResourceIds(entityDirectory: string, raw: readonly unknown[]): Promise<ResourceIds[]> {
    const resourceIds = raw.map(parseResourceIds)
    if (resourceIds.length === 0) return []
    const entityId = resourceIds[0].scope.entityId
    const kinds = new Set<ResourceIdsScope["kind"]>()
    for (const ids of resourceIds) {
        if (ids.scope.entityId !== entityId)
            throw new Error("cannot record resource IDs for different entities together")
        if (kinds.has(ids.scope.kind)) throw new Error(`duplicate ${ids.scope.kind} update`)
        kinds.add(ids.scope.kind)
    }
    const file = path.resolve(entityDirectory, RESOURCE_IDS_CACHE_FILE)
    return withFileMutationQueue(file, async () => {
        const cache = ownedCache(entityDirectory, entityId)
        const next = {
            entityId,
            resourceIds: [...cache.resourceIds.filter((ids) => !kinds.has(ids.scope.kind)), ...resourceIds],
        }
        if (!isDeepStrictEqual(cache, next)) writeCache(file, next)
        return structuredClone(resourceIds)
    })
}

export async function resolveCachedResourceIds(
    entityDirectory: string,
    rawScope: unknown,
): Promise<ResourceIds | undefined> {
    const scope = parseResourceIdsScope(rawScope)
    const file = path.resolve(entityDirectory, RESOURCE_IDS_CACHE_FILE)
    return withFileMutationQueue(file, async () => {
        const cache = ownedCache(entityDirectory, scope.entityId)
        const ids = cache.resourceIds.find((candidate) => candidate.scope.kind === scope.kind)
        if (!ids) return undefined
        if (isDeepStrictEqual(ids.scope, scope)) return structuredClone(ids)
        writeCache(file, { ...cache, resourceIds: cache.resourceIds.filter((candidate) => candidate !== ids) })
        return undefined
    })
}

// Call only after the provider establishes that these exact resource IDs are stale.
export async function invalidateResourceIds(entityDirectory: string, rawScope: unknown): Promise<void> {
    const scope = parseResourceIdsScope(rawScope)
    const file = path.resolve(entityDirectory, RESOURCE_IDS_CACHE_FILE)
    await withFileMutationQueue(file, async () => {
        const cache = ownedCache(entityDirectory, scope.entityId)
        const resourceIds = cache.resourceIds.filter((ids) => !isDeepStrictEqual(ids.scope, scope))
        if (resourceIds.length !== cache.resourceIds.length) writeCache(file, { ...cache, resourceIds })
    })
}

// Memoize only validated addressing facts recorded from actual evidence.
export class OperationResourceIdsMemo {
    private resourceIds = new Map<ResourceIdsScope["kind"], ResourceIds>()

    reset(): void {
        this.resourceIds.clear()
    }

    record(raw: unknown): ResourceIds {
        const ids = parseResourceIds(raw)
        this.resourceIds.set(ids.scope.kind, ids)
        return structuredClone(ids)
    }

    resolve(rawScope: unknown): ResourceIds | undefined {
        const scope = parseResourceIdsScope(rawScope)
        const ids = this.resourceIds.get(scope.kind)
        return ids && isDeepStrictEqual(ids.scope, scope) ? structuredClone(ids) : undefined
    }

    invalidate(rawScope: unknown): void {
        const scope = parseResourceIdsScope(rawScope)
        const ids = this.resourceIds.get(scope.kind)
        if (ids && isDeepStrictEqual(ids.scope, scope)) this.resourceIds.delete(scope.kind)
    }
}
