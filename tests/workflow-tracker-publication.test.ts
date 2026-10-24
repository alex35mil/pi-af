import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"
import { initializeEntity } from "../workflows/extensions/init/entity.ts"
import { readEntityStatus } from "../workflows/extensions/__lib/entity.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { buildIntegrationContext } from "../workflows/extensions/integrations/index.ts"
import { PlanCommentSchema } from "../workflows/extensions/integrations/plan-comment.ts"
import { planPublicationMarker } from "../workflows/extensions/integrations/plan-publication.ts"
import { signPublication } from "../workflows/extensions/integrations/publication.ts"
import { verifyMarkdownProjection } from "../workflows/extensions/integrations/projection.ts"
import { trackerPublication } from "../workflows/extensions/integrations/tracker-publication.ts"
import type { ProviderEvidence } from "../workflows/extensions/integrations/resource-id-operations.ts"
import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"

const tools = workflowMcpCatalog("github")
const repository = { owner: "example", repo: "project" }
const request = "Keep the original request."
const source =
    "# Plan\n\n## Overview\n\nKeep the request and show the plan.\n\n### Plan highlights\n\n- One comment.\n\n## Implementation\n\nUpdate the plan.\n"
const token = "ab345678-1234-4567-8901-123456789abc"

function fixture(
    kind: "epic" | "task" | "gig" = "gig",
    mode: "versioned" | "unversioned" = "versioned",
    adopted = false,
) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-publication-"))
    const git = (...args: string[]) => cp.execFileSync("git", args, { cwd: root, stdio: "pipe" })
    git("init", "-b", "main")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    fs.writeFileSync(path.join(root, ".gitignore"), ".project/**/.local/\n")
    git("add", ".gitignore")
    git("commit", "-m", "initial")
    fs.mkdirSync(path.join(root, ".project"))
    fs.writeFileSync(
        path.join(root, ".project/config.json"),
        JSON.stringify({ artifacts: mode, branches: { format: "identifier" } }),
    )
    const kinds = Object.fromEntries(
        ["feature", "bugfix", "research", "refactor", "audit", "chore"].map((k) => [k, `Kind: ${k}`]),
    )
    fs.writeFileSync(
        path.join(root, ".project/integrations.json"),
        JSON.stringify({
            tracker: {
                provider: "github",
                mcpServer: "github",
                repository,
                project: { owner: "example", ownerType: "user", number: 1 },
                labels: { kind: { epic: "Kind: Epic", deliverableKinds: kinds } },
                fields: {
                    status: {
                        field: "Status",
                        values: {
                            backlog: "Backlog",
                            todo: "Todo",
                            inProgress: "In Progress",
                            inReview: "In Review",
                            done: "Done",
                            canceled: "Canceled",
                        },
                    },
                    phase: {
                        field: "Phase",
                        values: { planning: "Planning", execution: "Execution", selfReview: "Self-Review" },
                    },
                    priority: { scope: "project", field: "Priority", values: ["High"] },
                    internalId: { scope: "project", field: "Internal ID" },
                },
            },
        }),
    )
    prepareArtifactPersistence(root)
    const common = {
        title: "Work",
        slug: "work",
        request,
        priority: "High",
        source: adopted
            ? {
                  mode: "external" as const,
                  provider: "github" as const,
                  issueId: 100,
                  issueNumber: 42,
                  issueUrl: "https://github.com/example/project/issues/42",
                  projectItemId: 200,
              }
            : { mode: "new" as const },
    }
    const parent =
        kind === "task"
            ? initializeEntity(
                  { ...common, entity: "epic", title: "Parent", slug: "parent" },
                  { cwd: root, now: new Date("2026-01-01T00:00:00Z") },
              )
            : undefined
    if (parent)
        fs.writeFileSync(
            path.join(root, parent.directory, "epic.md"),
            "# Parent\n\n## Overview\n\nParent.\n\n## Ordered Tasks\n\n1. **Work** — Work.\n",
        )
    const input =
        kind === "epic"
            ? { ...common, entity: kind }
            : kind === "gig"
              ? { ...common, entity: kind, kind: "feature" as const }
              : {
                    ...common,
                    entity: kind,
                    kind: "feature" as const,
                    parentEpicDir: parent!.directory,
                    epicItemTitle: "Work",
                }
    const initialized = initializeEntity(input, { cwd: root, now: new Date("2026-01-01T00:01:00Z") })
    const directory = initialized.directory
    const file = path.join(root, directory, "metadata.json")
    const original = JSON.parse(fs.readFileSync(file, "utf8"))
    assert.deepEqual(original.integrations[0].planComment, { state: "unpublished" })
    const bound = {
        ...original,
        authority: { kind: "tracker", provider: "github" },
        integrations: [
            {
                role: "tracker",
                provider: "github",
                repository,
                state: "bound",
                external: { issueNumber: 42 },
                planComment: { state: "unpublished" },
            },
        ],
    }
    fs.writeFileSync(file, JSON.stringify(bound))
    const read = () => readEntityStatus(path.join(root, directory))
    const saved = () => JSON.parse(fs.readFileSync(file, "utf8"))
    const prepare = (content = source, catalog = tools) =>
        trackerPublication(root, { action: "prepare", entityDir: directory, source: content }, catalog)
    const record = (evidence: ProviderEvidence) =>
        trackerPublication(root, { action: "record", entityDir: directory, evidence }, tools)
    const recover = (pages: ProviderEvidence[]) =>
        trackerPublication(root, { action: "recover", entityDir: directory, pages }, tools)
    const remote = (body: string, id = 123) => ({
        id,
        url: `https://api.github.com/repos/example/project/issues/comments/${id}`,
        html_url: `https://github.com/example/project/issues/42#issuecomment-${id}`,
        body,
    })
    const page = (response: unknown, page = 1, perPage = 100): ProviderEvidence => ({
        tool: "mcp__github__issue_read",
        arguments: { method: "get_comments", ...repository, issue_number: 42, page, perPage },
        response,
    })
    return {
        root,
        directory,
        file,
        original,
        parentDirectory: parent?.directory,
        read,
        saved,
        prepare,
        record,
        recover,
        remote,
        page,
        dispose: () => fs.rmSync(root, { recursive: true, force: true }),
    }
}

function envelope(value: unknown, mode: "raw" | "text" | "structured") {
    return mode === "raw"
        ? value
        : mode === "text"
          ? { content: [{ type: "text", text: JSON.stringify(value) }] }
          : { content: [], structuredContent: value }
}

describe("managed GitHub plan comments", () => {
    it("defines strict comment publication states", () => {
        for (const state of [
            { state: "unpublished" },
            { state: "pending", token },
            { state: "published", token, id: 1, url: "https://github.com/example/project/issues/42#issuecomment-1" },
        ])
            assert.equal(Value.Check(PlanCommentSchema, state), true)
        for (const state of [
            {},
            { state: "pending" },
            { state: "pending", token: "internal-id" },
            { state: "published", token, id: 1 },
            { state: "unpublished", token },
        ])
            assert.equal(Value.Check(PlanCommentSchema, state), false)
    })

    for (const mode of ["raw", "text", "structured"] as const)
        for (const shape of ["minimal", "full"] as const)
            it(`records ${shape} comment creation and updates the same comment (${mode})`, async () => {
                const f = fixture()
                try {
                    const prepared = await f.prepare()
                    assert.ok(prepared.state === "mutation-needed")
                    assert.ok(typeof prepared.mutation.arguments.body === "string")
                    const full = f.remote(prepared.mutation.arguments.body)
                    const response = shape === "minimal" ? { id: "123", url: full.html_url } : full
                    await f.record({ ...prepared.mutation, response: envelope(response, mode) })
                    assert.deepEqual(f.saved().integrations[0].planComment, {
                        state: "published",
                        token: f.saved().integrations[0].planComment.token,
                        id: 123,
                        url: full.html_url,
                    })
                    f.read()
                    const updated = await f.prepare(source.replace("Update the plan.", "Updated scope."))
                    assert.ok(updated.state === "mutation-needed")
                    assert.equal(updated.mutation.tool, "mcp__github__update_issue_comment")
                    assert.equal(updated.mutation.arguments.comment_id, 123)
                } finally {
                    f.dispose()
                }
            })

    it("preserves pending publication for invalid minimal and full creation evidence", async () => {
        const f = fixture()
        try {
            const prepared = await f.prepare()
            assert.ok(prepared.state === "mutation-needed")
            const before = f.saved()
            const url = "https://github.com/example/project/issues/42#issuecomment-123"
            const minimal = { id: "123", url }
            for (const response of [
                ...[
                    undefined,
                    null,
                    0,
                    -1,
                    1.5,
                    "",
                    " 123",
                    "1e2",
                    "123.5",
                    Number.MAX_SAFE_INTEGER + 1,
                    "9007199254740993",
                ].map((id) => ({ ...minimal, id })),
                { id: "123" },
                { ...minimal, url: "https://github.com/example/project/issues/43#issuecomment-123" },
                { ...minimal, url: "https://github.com/example/project/issues/42#issuecomment-124" },
                { ...minimal, url: "https://github.com/other/project/issues/42#issuecomment-123" },
                { ...minimal, url: "https://api.github.com/repos/example/project/issues/comments/123" },
                { ...minimal, html_url: null },
                { ...minimal, html_url: "https://github.com/example/project/issues/43#issuecomment-123" },
                { isError: true, content: [], structuredContent: minimal },
            ]) {
                await assert.rejects(f.record({ ...prepared.mutation, response }))
                assert.deepEqual(f.saved(), before)
            }
            for (const invalid of [
                { ...prepared.mutation, tool: "mcp__other__add_issue_comment" },
                ...Object.entries({ owner: "other", repo: "other", issue_number: 43, body: "No marker" }).map(
                    ([key, value]) => ({
                        ...prepared.mutation,
                        arguments: { ...prepared.mutation.arguments, [key]: value },
                    }),
                ),
            ]) {
                await assert.rejects(f.record({ ...invalid, response: minimal }))
                assert.deepEqual(f.saved(), before)
            }
            assert.equal((await f.prepare()).state, "recovery-required")
        } finally {
            f.dispose()
        }
    })

    for (const kind of ["epic", "task", "gig"] as const)
        for (const mode of ["versioned", "unversioned"] as const)
            for (const adopted of [false, true])
                it(`uses one comment for ${kind}/${mode}/${adopted ? "adopted" : "new"}`, async () => {
                    const f = fixture(kind, mode, adopted)
                    try {
                        const brief = fs.readFileSync(path.join(f.root, f.directory, "brief.md"), "utf8")
                        const prepared = await f.prepare()
                        assert.ok(prepared.state === "mutation-needed")
                        assert.ok(typeof prepared.mutation.arguments.body === "string")
                        assert.equal(prepared.mutation.tool, "mcp__github__add_issue_comment")
                        assert.ok("issue_number" in prepared.mutation.arguments)
                        assert.equal(prepared.mutation.arguments.issue_number, 42)
                        const pending = f.saved().integrations[0].planComment
                        assert.equal(pending.state, "pending")
                        assert.ok(prepared.mutation.arguments.body.endsWith(planPublicationMarker(pending.token)))
                        assert.doesNotMatch(prepared.mutation.arguments.body, /(?:GIG|TASK|EPIC)-|\.project\//)
                        assert.match(
                            prepared.mutation.arguments.body,
                            /^# Plan\n\nKeep the request and show the plan\.\n\n## Highlights\n\n- One comment\.\n\n<details>\n<summary>Full plan<\/summary>/,
                        )
                        assert.equal("title" in prepared.mutation.arguments, false)
                        await f.record({
                            tool: prepared.mutation.tool,
                            arguments: prepared.mutation.arguments,
                            response: f.remote(prepared.mutation.arguments.body),
                        })
                        const identity = f.saved().integrations[0].planComment
                        assert.equal(identity.state, "published")
                        const updated = await f.prepare(source.replace("Update the plan.", "Updated scope."))
                        assert.ok(updated.state === "mutation-needed")
                        assert.ok(typeof updated.mutation.arguments.body === "string")
                        assert.equal(updated.mutation.tool, "mcp__github__update_issue_comment")
                        assert.ok("comment_id" in updated.mutation.arguments)
                        assert.equal(updated.mutation.arguments.comment_id, 123)
                        assert.match(updated.mutation.arguments.body, /^# Plan\n[\s\S]*\n## Highlights\n/)
                        assert.match(updated.mutation.arguments.body, /Updated scope/)
                        assert.ok(updated.mutation.arguments.body.endsWith(planPublicationMarker(identity.token)))
                        assert.deepEqual(f.saved().integrations[0].planComment, identity)
                        assert.equal(fs.readFileSync(path.join(f.root, f.directory, "brief.md"), "utf8"), brief)
                        const context = buildIntegrationContext(
                            { cwd: f.root } as ExtensionContext,
                            { operation: "artifactProjection", entityDir: f.directory },
                            tools,
                        )
                        assert.equal(context.state, "enabled")
                        if (context.state !== "enabled" || !context.projection || context.projection.mode === "none")
                            assert.fail()
                        assert.match(
                            context.projection.rendering,
                            /prepare_tracker_publication.*Preserve issue title\/description/,
                        )
                        assert.ok("planComment" in context.projection)
                        assert.deepEqual(context.projection.planComment, identity)
                        if (mode === "unversioned")
                            assert.equal(
                                cp
                                    .execFileSync("git", ["check-ignore", f.file], { cwd: f.root, encoding: "utf8" })
                                    .trim(),
                                f.file,
                            )
                        f.read()
                    } finally {
                        f.dispose()
                    }
                })

    it("publishes a synchronized parent Epic using its own comment state", async () => {
        const f = fixture("task")
        try {
            assert.ok(f.parentDirectory)
            const parentFile = path.join(f.root, f.parentDirectory, "metadata.json")
            const parent = JSON.parse(fs.readFileSync(parentFile, "utf8"))
            parent.authority = { kind: "tracker", provider: "github" }
            parent.integrations = [
                {
                    role: "tracker",
                    provider: "github",
                    repository,
                    state: "bound",
                    external: { issueNumber: 41 },
                    planComment: { state: "unpublished" },
                },
            ]
            fs.writeFileSync(parentFile, JSON.stringify(parent))
            const childBefore = f.saved()
            const prepared = await trackerPublication(
                f.root,
                {
                    action: "prepare",
                    entityDir: f.parentDirectory,
                    source,
                },
                tools,
            )
            assert.ok(prepared.state === "mutation-needed")
            assert.ok(typeof prepared.mutation.arguments.body === "string")
            assert.ok("issue_number" in prepared.mutation.arguments)
            assert.equal(prepared.mutation.arguments.issue_number, 41)
            await trackerPublication(
                f.root,
                {
                    action: "record",
                    entityDir: f.parentDirectory,
                    evidence: {
                        tool: prepared.mutation.tool,
                        arguments: prepared.mutation.arguments,
                        response: {
                            id: 555,
                            html_url: "https://github.com/example/project/issues/41#issuecomment-555",
                        },
                    },
                },
                tools,
            )
            const updated = await trackerPublication(
                f.root,
                {
                    action: "prepare",
                    entityDir: f.parentDirectory,
                    source,
                },
                tools,
            )
            assert.ok(updated.state === "mutation-needed")
            assert.ok(typeof updated.mutation.arguments.body === "string")
            assert.ok("comment_id" in updated.mutation.arguments)
            assert.equal(updated.mutation.arguments.comment_id, 555)
            assert.deepEqual(f.saved(), childBefore)
        } finally {
            f.dispose()
        }
    })

    it("resolves availability and validates source before saving a creation attempt", async () => {
        const f = fixture()
        try {
            await assert.rejects(f.prepare(source, new Map()), /unavailable/)
            await assert.rejects(f.prepare("No overview"), /Overview/)
            assert.deepEqual(f.saved().integrations[0].planComment, { state: "unpublished" })
            const results = await Promise.all([f.prepare(), f.prepare()])
            assert.equal(results.filter((r) => r.state === "mutation-needed").length, 1)
            assert.equal(results.filter((r) => r.state === "recovery-required").length, 1)
        } finally {
            f.dispose()
        }
    })

    for (const mode of ["raw", "text", "structured"] as const)
        it(`recovers interrupted creation on later pages (${mode}) and reads uncertain updates`, async () => {
            const f = fixture()
            try {
                const prepared = await f.prepare()
                assert.ok(prepared.state === "mutation-needed")
                assert.ok(typeof prepared.mutation.arguments.body === "string")
                const signed = signPublication(prepared.mutation.arguments.body, "github", {
                    harness: "Pi",
                    provider: "test",
                    modelId: "model",
                })
                assert.equal((await f.prepare()).state, "recovery-required")
                const pages = [
                    f.page(envelope([f.remote("Discussion", 1)], mode), 1, 1),
                    f.page(envelope([f.remote(signed)], mode), 2, 1),
                    f.page(envelope([], mode), 3, 1),
                ]
                assert.equal((await f.recover(pages)).state, "identified")
                const identity = f.saved().integrations[0].planComment
                assert.equal(identity.id, 123)
                const readback = await f.recover(pages)
                assert.ok("body" in readback)
                assert.equal(verifyMarkdownProjection(signed, readback.body as string).verified, true)
                assert.deepEqual(f.saved().integrations[0].planComment, identity)
                const absent = await f.recover([f.page([])])
                assert.equal(absent.state, "blocked")
                const conflict = await f.recover([f.page([f.remote(signed, 456)])])
                assert.equal(conflict.state, "blocked")
                assert.deepEqual(f.saved().integrations[0].planComment, identity)
            } finally {
                f.dispose()
            }
        })

    it("preserves pending state for absent, duplicate, incomplete, errored and wrong-scope evidence", async () => {
        const f = fixture()
        try {
            const prepared = await f.prepare()
            assert.ok(prepared.state === "mutation-needed")
            assert.ok(typeof prepared.mutation.arguments.body === "string")
            const body = prepared.mutation.arguments.body
            const before = f.saved()
            for (const comments of [[], [f.remote(body), f.remote(body, 124)]])
                assert.equal((await f.recover([f.page(comments)])).state, "blocked")
            for (const pages of [
                [f.page([f.remote(body)], 1, 1)],
                [f.page([], 2)],
                [{ ...f.page([]), tool: "mcp__other__issue_read" }],
                [{ ...f.page([]), arguments: { ...f.page([]).arguments, issue_number: 43 } }],
                [{ ...f.page([]), arguments: { ...f.page([]).arguments, repo: "other" } }],
                [f.page({ isError: true, content: [], structuredContent: [f.remote(body)] })],
                [f.page({ content: [{ type: "text", text: "Access denied" }] })],
                [f.page([f.remote(body)], 1), f.page([], 2)],
            ])
                await assert.rejects(f.recover(pages))
            const evidence = {
                tool: prepared.mutation.tool,
                arguments: prepared.mutation.arguments,
                response: f.remote(body),
            }
            for (const invalid of [
                { ...evidence, tool: "mcp__other__add_issue_comment" },
                { ...evidence, arguments: { ...evidence.arguments, body: "Not the pending plan" } },
                { ...evidence, arguments: { ...evidence.arguments, owner: "other" } },
                {
                    ...evidence,
                    response: { id: 123, html_url: "https://github.com/example/project/issues/43#issuecomment-123" },
                },
                {
                    ...evidence,
                    response: { id: 123, html_url: "https://github.com/example/project/issues/42#issuecomment-124" },
                },
            ])
                await assert.rejects(f.record(invalid))
            assert.deepEqual(f.saved(), before)
            assert.equal((await f.prepare()).state, "recovery-required")
        } finally {
            f.dispose()
        }
    })

    it("migrates only missing comment state and preserves the rest of the entity", () => {
        const f = fixture()
        try {
            const before = f.saved()
            const legacy = structuredClone(before)
            delete legacy.integrations[0].planComment
            fs.writeFileSync(f.file, JSON.stringify(legacy))
            assert.throws(f.read, /MIGRATIONS/)
            legacy.integrations[0].planComment = { state: "unpublished" }
            fs.writeFileSync(f.file, JSON.stringify(legacy))
            f.read()
            assert.deepEqual(f.saved(), before)
        } finally {
            f.dispose()
        }
    })
})
