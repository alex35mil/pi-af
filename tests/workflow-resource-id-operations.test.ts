import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { Value } from "typebox/value"
import { phaseValues } from "./workflow-phase-fixtures.ts"

import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { readEntityStatus } from "../workflows/extensions/__lib/entity.ts"
import { beginProviderCreation, recordProviderCreation } from "../workflows/extensions/integrations/creation.ts"
import { buildIntegrationContext } from "../workflows/extensions/integrations/index.ts"
import {
    OperationResourceIdsMemo,
    readResourceIdsCache,
    recordResourceIds,
} from "../workflows/extensions/integrations/resource-ids.ts"
import { ResourceIdsToolSchema } from "../workflows/extensions/integrations/resource-id-tool.ts"
import {
    shippingReadDecision,
    invalidateStaleResourceIds,
    recordResourceIdsEvidence,
    resourceIdsFromRead,
    resolveResourceIdsContext,
    resolveResourceIds,
    selectPullRequestResourceIds,
} from "../workflows/extensions/integrations/resource-id-operations.ts"

import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"

const mcpTools = workflowMcpCatalog("github", "linear")

const repo = { owner: "alex", repo: "example" }
const common = { entityId: "GIG-01M3S2H283", mcpServer: "github" }
const prScope = {
    ...common,
    kind: "github-pull-request" as const,
    repository: repo,
    head: "gig-branch",
    target: "main",
}
const itemScope = {
    ...common,
    kind: "github-project-item" as const,
    repository: repo,
    issueNumber: 23,
    project: { owner: "alex", ownerType: "user" as const, number: 2 },
}
const pr = {
    number: 7,
    state: "open",
    draft: false,
    html_url: "https://github.com/alex/example/pull/7",
    head: { ref: "gig-branch", repo: { full_name: "alex/example" } },
    base: { ref: "main", repo: { full_name: "alex/example" } },
}
const evidence = {
    tool: "mcp__github__pull_request_read",
    arguments: { method: "get", ...repo, pullNumber: 7 },
    response: pr,
}

function fixture(artifacts: "versioned" | "unversioned" = "versioned") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workflow-resource-ids-")))
    const git = (args: string[]) => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim()
    git(["init", "-q"])
    fs.writeFileSync(path.join(root, ".gitignore"), ".project/**/.local/\n")
    fs.mkdirSync(path.join(root, ".project"))
    fs.writeFileSync(
        path.join(root, ".project/config.json"),
        JSON.stringify({ artifacts, branches: { format: "identifier" } }),
    )
    const statuses = {
        backlog: "Backlog",
        todo: "Todo",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        canceled: "Canceled",
    }
    fs.writeFileSync(
        path.join(root, ".project/integrations.json"),
        JSON.stringify({
            tracker: {
                provider: "github",
                mcpServer: "github",
                repository: repo,
                project: itemScope.project,
                labels: {
                    kind: {
                        epic: "Epic",
                        deliverableKinds: {
                            feature: "Feature",
                            bugfix: "Bugfix",
                            research: "Research",
                            refactor: "Refactor",
                            audit: "Audit",
                            chore: "Chore",
                        },
                    },
                },
                fields: {
                    status: { field: "Status", values: statuses },
                    phase: { field: "Phase", values: { ...phaseValues } },
                    priority: { scope: "project", field: "Priority", values: ["High"] },
                    internalId: { scope: "project", field: "ID" },
                },
            },
            forge: { provider: "github", mcpServer: "github", repository: repo },
        }),
    )
    prepareArtifactPersistence(root)
    const directory = path.join(root, ".project/gigs/20260930-1452.GIG-01M3S2H283.example")
    fs.mkdirSync(directory, { recursive: true })
    const metadata = {
        id: common.entityId,
        rawId: "01M3S2H283",
        slug: "example",
        title: "Example",
        createdAt: "2026-10-01T00:00:00Z",
        phase: "selfReview",
        entity: "gig",
        kind: "refactor",
        authority: { kind: "tracker", provider: "github" },
        branch: { state: "ready", name: prScope.head, start: "main", target: "main", source: "generated" },
        integrations: [
            {
                role: "tracker",
                provider: "github",
                repository: repo,
                planComment: { state: "unpublished" },
                state: "bound",
                external: { issueNumber: 23 },
            },
            {
                role: "forge",
                provider: "github",
                repository: repo,
                head: prScope.head,
                target: prScope.target,
                state: "intent",
            },
        ],
    }
    const file = path.join(directory, "metadata.json")
    fs.writeFileSync(file, JSON.stringify(metadata))
    return {
        root,
        directory,
        file,
        git,
        metadata,
        context: () => resolveResourceIdsContext(root, directory, "github-pull-request"),
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    }
}

describe("resource ID operations", () => {
    it("uses native MCP results for exact cached-ID reads", () => {
        const response = { content: [{ type: "text", text: JSON.stringify(pr) }] }
        assert.deepEqual(resourceIdsFromRead(prScope, { ...evidence, response }, mcpTools).value, {
            number: 7,
            url: pr.html_url,
        })
        assert.throws(
            () => resourceIdsFromRead(prScope, { ...evidence, response: { ...response, isError: true } }, mcpTools),
            /MCP error/,
        )
    })

    it("reports missing IDs without lookup instructions or recovery actions", async () => {
        const f = fixture()
        try {
            const result = await resolveResourceIds(f.context(), new OperationResourceIdsMemo())
            assert.equal(result.state, "missing")
            assert.equal("tool" in result, false)
            assert.equal(readResourceIdsCache(f.directory), undefined)
            assert.equal(
                Value.Check(ResourceIdsToolSchema, {
                    entityDir: f.directory,
                    resource: "github-pull-request",
                    action: "recover",
                    pages: [evidence],
                }),
                false,
            )
        } finally {
            f.cleanup()
        }
    })

    it("uses cached IDs and operation memo without provider capabilities", async () => {
        const f = fixture()
        try {
            await recordResourceIds(f.directory, [{ scope: prScope, value: { number: 7, url: pr.html_url } }])
            const memo = new OperationResourceIdsMemo()
            assert.equal((await resolveResourceIds(f.context(), memo)).source, "cache")
            assert.equal((await resolveResourceIds(f.context(), memo)).source, "operation")
            memo.reset()
            assert.equal((await resolveResourceIds(f.context(), memo)).source, "cache")
        } finally {
            f.cleanup()
        }
    })

    it("records native Project-addition database IDs in the cache and operation memo", async () => {
        const f = fixture()
        try {
            const context = resolveResourceIdsContext(f.root, f.directory, "github-project-item")
            const payload = { id: "PVTI_example", item_id: 42, full_database_id: "42" }
            for (const response of [
                payload,
                { content: [{ type: "text", text: JSON.stringify(payload) }] },
                { content: [], structuredContent: payload },
            ]) {
                const memo = new OperationResourceIdsMemo()
                const recorded = await recordResourceIdsEvidence(
                    context,
                    {
                        tool: "mcp__github__projects_write",
                        arguments: {
                            method: "add_project_item",
                            owner: "alex",
                            owner_type: "user",
                            project_number: 2,
                            item_owner: "alex",
                            item_repo: "example",
                            item_type: "issue",
                            issue_number: 23,
                        },
                        response,
                    },
                    memo,
                    mcpTools,
                )
                assert.deepEqual(recorded.value, { itemId: 42 })
                assert.deepEqual(memo.resolve(context.scope), recorded)
                assert.deepEqual(readResourceIdsCache(f.directory)!.resourceIds, [recorded])
            }
        } finally {
            f.cleanup()
        }
    })

    it("preserves Project IDs when addition evidence has invalid identity or scope", async () => {
        const f = fixture()
        try {
            const context = resolveResourceIdsContext(f.root, f.directory, "github-project-item")
            const memo = new OperationResourceIdsMemo()
            await recordResourceIds(f.directory, [{ scope: itemScope, value: { itemId: 77 } }])
            await resolveResourceIds(context, memo)
            const before = readResourceIdsCache(f.directory)
            const previous = memo.resolve(context.scope)
            const addition = {
                tool: "mcp__github__projects_write",
                arguments: {
                    method: "add_project_item",
                    owner: "alex",
                    owner_type: "user",
                    project_number: 2,
                    item_owner: "alex",
                    item_repo: "example",
                    item_type: "issue",
                    issue_number: 23,
                },
                response: { id: "PVTI_example", item_id: 42, full_database_id: "42" },
            }
            for (const item_id of [undefined, null, "PVTI_example", "42.5", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
                await assert.rejects(
                    recordResourceIdsEvidence(
                        context,
                        { ...addition, response: { ...addition.response, item_id } },
                        memo,
                        mcpTools,
                    ),
                    /invalid Project item ID/,
                )
                assert.deepEqual(readResourceIdsCache(f.directory), before)
                assert.deepEqual(memo.resolve(context.scope), previous)
            }
            for (const invalid of [
                { ...addition, tool: "mcp__other__projects_write" },
                { ...addition, response: { isError: true, content: [], structuredContent: addition.response } },
                ...Object.entries({
                    method: "update_project_item",
                    owner: "other",
                    owner_type: "org",
                    project_number: 3,
                    item_owner: "other",
                    item_repo: "other",
                    item_type: "pull_request",
                    issue_number: 24,
                }).map(([key, value]) => ({ ...addition, arguments: { ...addition.arguments, [key]: value } })),
            ]) {
                await assert.rejects(recordResourceIdsEvidence(context, invalid, memo, mcpTools))
                assert.deepEqual(readResourceIdsCache(f.directory), before)
                assert.deepEqual(memo.resolve(context.scope), previous)
            }
        } finally {
            f.cleanup()
        }
    })

    it("records the exact required Project read and reuses its issue ID", async () => {
        const f = fixture()
        try {
            const context = resolveResourceIdsContext(f.root, f.directory, "github-project-item")
            await recordResourceIdsEvidence(
                context,
                {
                    tool: "mcp__github__projects_get",
                    arguments: {
                        method: "get_project_item",
                        owner: "alex",
                        owner_type: "user",
                        project_number: 2,
                        item_id: 42,
                    },
                    response: {
                        id: 42,
                        content_type: "Issue",
                        content: {
                            id: 101,
                            number: 23,
                            repository: "alex/example",
                            html_url: "https://github.com/alex/example/issues/23",
                        },
                    },
                },
                new OperationResourceIdsMemo(),
                mcpTools,
            )
            assert.deepEqual(
                readResourceIdsCache(f.directory)!.resourceIds.map((x) => x.scope.kind),
                ["github-project-item", "github-issue"],
            )
            assert.throws(
                () => resourceIdsFromRead(prScope, { ...evidence, tool: "mcp__other__pull_request_read" }, mcpTools),
                /configured registered tool/,
            )
            assert.throws(
                () =>
                    resourceIdsFromRead(
                        prScope,
                        {
                            ...evidence,
                            response: { ...pr, head: { ...pr.head, ref: "other" } },
                        },
                        mcpTools,
                    ),
                /exact durable/,
            )
        } finally {
            f.cleanup()
        }
    })

    it("removes only proven-stale IDs without finding replacements", async () => {
        const f = fixture()
        try {
            const memo = new OperationResourceIdsMemo()
            await selectPullRequestResourceIds(f.context(), evidence, memo, mcpTools)
            await recordResourceIds(f.directory, [{ scope: itemScope, value: { itemId: 42 } }])
            await assert.rejects(
                invalidateStaleResourceIds(f.context(), { ...evidence, response: "403 denied" }, memo, mcpTools),
                /Provider evidence requires an object response/,
            )
            await assert.rejects(
                invalidateStaleResourceIds(f.context(), evidence, memo, mcpTools),
                /confirms the cached relationship/,
            )
            assert.equal(readResourceIdsCache(f.directory)!.resourceIds.length, 2)
            const result = await invalidateStaleResourceIds(
                f.context(),
                { ...evidence, response: { ...pr, head: { ...pr.head, ref: "changed" } } },
                memo,
                mcpTools,
            )
            assert.equal(result.state, "missing")
            assert.equal("tool" in result, false)
            assert.deepEqual(
                readResourceIdsCache(f.directory)!.resourceIds.map((x) => x.scope.kind),
                ["github-project-item"],
            )
            assert.deepEqual(fs.readdirSync(path.join(f.directory, ".local")), ["metadata.json"])
        } finally {
            f.cleanup()
        }
    })

    it("checks the recorded PR and local head directly for merge and completion", async () => {
        const f = fixture()
        try {
            f.git(["add", "."])
            f.git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "Fixture"])
            f.git(["branch", prScope.head])
            const sha = f.git(["rev-parse", prScope.head])
            const actual = { ...pr, head: { ...pr.head, sha }, merged: false }
            const read = { ...evidence, response: actual }
            await selectPullRequestResourceIds(f.context(), read, new OperationResourceIdsMemo(), mcpTools)
            const decision = shippingReadDecision(prScope, read, sha, 7, mcpTools)
            assert.deepEqual(decision, {
                state: "merge-needed",
                arguments: {
                    ...repo,
                    pullNumber: 7,
                    merge_method: "squash",
                    expectedHeadSha: sha,
                },
            })
            const context = buildIntegrationContext(
                { cwd: f.root } as never,
                {
                    operation: "shippingMerge",
                    entityDir: f.directory,
                    evidence: read,
                },
                mcpTools,
            )
            if (context.state !== "enabled") assert.fail("enabled shipping expected")
            assert.deepEqual(context.roles.forge?.shipping, decision)
            const merged = { ...actual, merged: true, merged_at: "2026-10-01T08:10:44Z" }
            assert.equal(shippingReadDecision(prScope, { ...read, response: merged }, sha, 7, mcpTools).state, "merged")
            for (const response of [
                { ...actual, number: 8, html_url: "https://github.com/alex/example/pull/8" },
                { ...actual, head: { ...actual.head, sha: "0".repeat(40) } },
                { ...actual, head: { ...actual.head, ref: "other" } },
                { ...actual, merged: true },
            ])
                assert.equal(shippingReadDecision(prScope, { ...read, response }, sha, 7, mcpTools).state, "blocked")
            const selected = { ...actual, number: 8, html_url: "https://github.com/alex/example/pull/8" }
            await selectPullRequestResourceIds(
                f.context(),
                {
                    ...read,
                    arguments: { ...read.arguments, pullNumber: 8 },
                    response: selected,
                },
                new OperationResourceIdsMemo(),
                mcpTools,
            )
            const mismatch = buildIntegrationContext(
                { cwd: f.root } as never,
                {
                    operation: "shippingMerge",
                    entityDir: f.directory,
                    evidence: read,
                },
                mcpTools,
            )
            if (mismatch.state !== "enabled") assert.fail("enabled shipping expected")
            assert.equal(mismatch.roles.forge?.shipping?.state, "blocked")
        } finally {
            f.cleanup()
        }
    })

    it("keeps desired initial Priority when recording a tracker create", async () => {
        const f = fixture()
        try {
            fs.writeFileSync(
                f.file,
                JSON.stringify({
                    ...f.metadata,
                    authority: {
                        kind: "tracker",
                        provider: "github",
                        desired: { lifecycle: "inProgress", priority: "High" },
                    },
                    integrations: [
                        {
                            role: "tracker",
                            provider: "github",
                            planComment: { state: "unpublished" },
                            repository: repo,
                            state: "awaiting",
                            operation: "create issue",
                        },
                    ],
                }),
            )
            await beginProviderCreation(f.root, f.directory, "tracker")
            await recordProviderCreation(
                f.root,
                f.directory,
                "tracker",
                {
                    tool: "mcp__github__issue_write",
                    arguments: { method: "create", ...repo, title: "Example" },
                    response: { id: "101", url: "https://github.com/alex/example/issues/23" },
                },
                mcpTools,
            )
            assert.deepEqual(readEntityStatus(f.directory).authority, {
                kind: "tracker",
                provider: "github",
                desired: { lifecycle: "inProgress", priority: "High" },
            })
        } finally {
            f.cleanup()
        }
    })

    for (const artifacts of ["versioned", "unversioned"] as const) {
        for (const format of ["payload", "mcpText", "mcpStructured"] as const) {
            it(`records creation and selection locally after one submission commit (${artifacts}, ${format})`, async () => {
                const f = fixture(artifacts)
                try {
                    f.metadata.integrations = f.metadata.integrations.filter((x) => x.role !== "forge")
                    fs.writeFileSync(f.file, JSON.stringify(f.metadata))
                    await beginProviderCreation(f.root, f.directory, "forge")
                    f.git(["add", "."])
                    f.git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "Submission"])
                    const committed = fs.readFileSync(f.file, "utf8")
                    const payload = { id: "4700971917", url: pr.html_url }
                    const responses = {
                        payload,
                        mcpText: { content: [{ type: "text", text: JSON.stringify(payload) }] },
                        mcpStructured: { content: [], structuredContent: payload },
                    }
                    const result = await recordProviderCreation(
                        f.root,
                        f.directory,
                        "forge",
                        {
                            tool: "mcp__github__create_pull_request",
                            arguments: {
                                ...repo,
                                head: prScope.head,
                                base: prScope.target,
                                title: "Example",
                                body: "Approved",
                            },
                            response: responses[format],
                        },
                        mcpTools,
                    )
                    assert.deepEqual(Object.keys(result).sort(), ["entityId", "resourceIds", "role"])
                    assert.deepEqual(result.resourceIds[0].value, { number: 7, url: pr.html_url })
                    const recorded = readResourceIdsCache(f.directory)
                    await assert.rejects(
                        recordProviderCreation(
                            f.root,
                            f.directory,
                            "forge",
                            {
                                tool: "mcp__github__create_pull_request",
                                arguments: { ...repo, head: prScope.head, base: prScope.target, title: "Example" },
                                response: { content: [], structuredContent: payload, isError: true },
                            },
                            mcpTools,
                        ),
                        /MCP error/,
                    )
                    assert.deepEqual(readResourceIdsCache(f.directory), recorded)
                    await selectPullRequestResourceIds(f.context(), evidence, new OperationResourceIdsMemo(), mcpTools)
                    assert.equal(fs.readFileSync(f.file, "utf8"), committed)
                    assert.deepEqual(fs.readdirSync(path.join(f.directory, ".local")), ["metadata.json"])
                    assert.equal(f.git(["rev-list", "--count", "HEAD"]), "1")
                    assert.equal(f.git(["status", "--porcelain"]), "")
                    assert.equal(f.git(["ls-files", "--", path.relative(f.root, path.join(f.directory, ".local"))]), "")
                } finally {
                    f.cleanup()
                }
            })
        }
    }
})
