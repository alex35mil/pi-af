import "./host-runtime.ts"

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
import {
    trackerPublication,
    type TrackerPublicationInput,
} from "../workflows/extensions/integrations/tracker-publication.ts"
import type { ProviderEvidence } from "../workflows/extensions/integrations/resource-id-operations.ts"
import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"

const tools = workflowMcpCatalog("github")
const repository = { owner: "example", repo: "project" }
const request = "Keep the original request."
const source =
    "# Plan\n\n## Overview\n\nKeep the request and show the plan.\n\n### Plan highlights\n\n- One comment.\n\n## Implementation\n\nUpdate the plan.\n"
const token = "ab345678-1234-4567-8901-123456789abc"

function fixture(kind: "epic" | "task" | "gig" = "gig", adopted = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-publication-"))
    const git = (...args: string[]) => cp.execFileSync("git", args, { cwd: root, stdio: "pipe" })
    git("init", "-b", "main")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
    git("add", ".gitignore")
    git("commit", "-m", "initial")
    fs.mkdirSync(path.join(root, ".project"))
    fs.writeFileSync(
        path.join(root, ".project/config.json"),
        JSON.stringify({ branches: { format: "identifier-title" } }),
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
                },
            },
            forge: { provider: "github", mcpServer: "github", repository },
        }),
    )
    prepareArtifactPersistence(root)
    // A new and an adopted issue initialize the same way; only the selected object differs.
    const object = (issueNumber: number) => ({
        issueId: 100 + issueNumber,
        issueNumber,
        issueUrl: `https://github.com/example/project/issues/${issueNumber}`,
        ...(adopted ? { projectItemId: 200 } : {}),
    })
    const common = { title: "Work", slug: "work", request, object: object(42) }
    const parent =
        kind === "task"
            ? initializeEntity(
                  { ...common, entity: "epic", title: "Parent", slug: "parent", object: object(41) },
                  { cwd: root },
              )
            : undefined
    if (parent)
        fs.writeFileSync(
            path.join(root, parent.directory, "epic.md"),
            `# Parent\n\n## Overview\n\nParent.\n\n## Task delivery strategy\n\nTask target: epic\nEpic branch: ${parent.status.branch.name}\n\n## Tasks\n\n### [#42] Work\n\nKind: feature\n\nWork.\n`,
        )
    const input =
        kind === "epic"
            ? { ...common, entity: kind }
            : kind === "gig"
              ? { ...common, entity: kind, kind: "feature" as const }
              : { ...common, entity: kind, parentEpicDir: parent!.directory }
    const initialized = initializeEntity(input, { cwd: root })
    const directory = initialized.directory
    const file = path.join(root, directory, "metadata.json")
    const original = JSON.parse(fs.readFileSync(file, "utf8"))
    assert.deepEqual(original.tracker.planComment, { state: "unpublished" })
    const read = () => readEntityStatus(path.join(root, directory))
    const saved = () => JSON.parse(fs.readFileSync(file, "utf8"))
    const prepare = (content = source, catalog = tools) =>
        trackerPublication(root, { action: "prepare", entityDir: directory, source: content }, catalog)
    const record = (evidence: ProviderEvidence) =>
        trackerPublication(root, { action: "record", entityDir: directory, evidence }, tools)
    const recover = (pages: ProviderEvidence[]) =>
        trackerPublication(root, { action: "recover", entityDir: directory, source, pages }, tools)
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
                    assert.deepEqual(f.saved().tracker.planComment, {
                        state: "published",
                        token: f.saved().tracker.planComment.token,
                        id: 123,
                        url: full.html_url,
                    })
                    f.read()
                    const revised = source.replace("Update the plan.", "Updated scope.")
                    assert.equal((await f.prepare(revised)).state, "reads-required")
                    const updated = await trackerPublication(
                        f.root,
                        {
                            action: "prepareUpdate",
                            entityDir: f.directory,
                            source: revised,
                            reads: [f.page([full])],
                            announcement: { summary: "Scope changed." },
                        },
                        tools,
                    )
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

    it("re-issues the same create when a complete read finds the pending comment was never posted", async () => {
        const f = fixture()
        try {
            const prepared = await f.prepare()
            assert.ok(prepared.state === "mutation-needed")
            const pending = f.saved().tracker.planComment
            assert.equal(pending.state, "pending")
            assert.equal((await f.prepare()).state, "recovery-required")

            const reissued = await f.recover([f.page([f.remote("Discussion", 1)], 1, 1), f.page([], 2, 1)])
            assert.ok(reissued.state === "mutation-needed")
            assert.deepEqual(reissued.mutation, prepared.mutation)
            assert.deepEqual(f.saved().tracker.planComment, pending)

            const body = reissued.mutation.arguments.body as string
            assert.equal((await f.record({ ...reissued.mutation, response: f.remote(body) })).state, "published")
            assert.deepEqual(f.saved().tracker.planComment, {
                state: "published",
                token: pending.token,
                id: 123,
                url: "https://github.com/example/project/issues/42#issuecomment-123",
            })
        } finally {
            f.dispose()
        }
    })

    for (const kind of ["epic", "task", "gig"] as const)
        for (const adopted of [false, true])
            it(`uses one comment for ${kind}/${adopted ? "adopted" : "new"}`, async () => {
                const f = fixture(kind, adopted)
                try {
                    const brief = fs.readFileSync(path.join(f.root, f.directory, "brief.md"), "utf8")
                    const prepared = await f.prepare()
                    assert.ok(prepared.state === "mutation-needed")
                    assert.ok(typeof prepared.mutation.arguments.body === "string")
                    assert.equal(prepared.mutation.tool, "mcp__github__add_issue_comment")
                    assert.ok("issue_number" in prepared.mutation.arguments)
                    assert.equal(prepared.mutation.arguments.issue_number, 42)
                    const pending = f.saved().tracker.planComment
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
                    const identity = f.saved().tracker.planComment
                    assert.equal(identity.state, "published")
                    const revised = source.replace("Update the plan.", "Updated scope.")
                    // Every published plan reads its current version first, to announce the change.
                    assert.equal((await f.prepare(revised)).state, "reads-required")
                    const updated = await trackerPublication(
                        f.root,
                        {
                            action: "prepareUpdate",
                            entityDir: f.directory,
                            source: revised,
                            reads: [f.page([f.remote(prepared.mutation.arguments.body)])],
                            announcement: { summary: "Scope changed." },
                        },
                        tools,
                    )
                    assert.ok(updated.state === "mutation-needed" && "announcement" in updated)
                    assert.match(updated.announcement as string, /^\*\*Plan updated\*\*\n\nScope changed\./)
                    assert.ok(typeof updated.mutation.arguments.body === "string")
                    assert.equal(updated.mutation.tool, "mcp__github__update_issue_comment")
                    assert.ok("comment_id" in updated.mutation.arguments)
                    assert.equal(updated.mutation.arguments.comment_id, 123)
                    assert.match(updated.mutation.arguments.body, /^# Plan\n[\s\S]*\n## Highlights\n/)
                    assert.match(updated.mutation.arguments.body, /Updated scope/)
                    assert.ok(updated.mutation.arguments.body.endsWith(planPublicationMarker(identity.token)))
                    assert.deepEqual(f.saved().tracker.planComment, identity)
                    assert.equal(fs.readFileSync(path.join(f.root, f.directory, "brief.md"), "utf8"), brief)
                    const context = buildIntegrationContext(
                        { cwd: f.root } as ExtensionContext,
                        { operation: "artifactProjection", entityDir: f.directory },
                        tools,
                    )
                    assert.equal(context.state, "enabled")

                    assert.match(
                        context.projection.rendering,
                        /prepare_tracker_publication.*Preserve issue title\/description/,
                    )
                    assert.ok("planComment" in context.projection)
                    assert.deepEqual(context.projection.planComment, identity)
                    assert.equal(
                        cp.execFileSync("git", ["check-ignore", f.file], { cwd: f.root, encoding: "utf8" }).trim(),
                        f.file,
                    )
                    f.read()
                } finally {
                    f.dispose()
                }
            })

    it("publishes a synchronized parent Epic update and announces it from the Task", async () => {
        const f = fixture("task")
        try {
            assert.ok(f.parentDirectory)
            const epicDir = f.parentDirectory
            const parentFile = path.join(f.root, epicDir, "metadata.json")
            const parentSaved = () => JSON.parse(fs.readFileSync(parentFile, "utf8"))
            assert.equal(parentSaved().tracker.external.issueNumber, 41)
            const childBefore = f.saved()
            const run = (input: Record<string, unknown>) =>
                trackerPublication(f.root, { entityDir: epicDir, ...input } as TrackerPublicationInput, tools)
            const prepared = await run({ action: "prepare", source })
            assert.ok(prepared.state === "mutation-needed")
            assert.ok(typeof prepared.mutation.arguments.body === "string")
            assert.equal(prepared.mutation.arguments.issue_number, 41)
            const planUrl = "https://github.com/example/project/issues/41#issuecomment-555"
            await run({
                action: "record",
                evidence: { ...prepared.mutation, response: { id: 555, html_url: planUrl } },
            })
            const comments = (bodies: Record<string, unknown>[]): ProviderEvidence => ({
                tool: "mcp__github__issue_read",
                arguments: { method: "get_comments", ...repository, issue_number: 41, page: 1, perPage: 100 },
                response: bodies,
            })
            const planComment = { id: 555, html_url: planUrl, body: prepared.mutation.arguments.body }
            const revised = source.replace("Update the plan.", "Update the plan per workspace.")

            const reads = await run({ action: "prepare", source: revised })
            assert.ok(reads.state === "reads-required")
            assert.equal(reads.lookups[0].arguments.issue_number, 41)
            await assert.rejects(
                run({ action: "prepareUpdate", source: revised, reads: [comments([planComment])] }),
                /announcement/,
            )
            const announcement = {
                origin: { kind: "task", entityDir: f.directory },
                summary: "- Limits per workspace.",
            }
            const updated = await run({
                action: "prepareUpdate",
                source: revised,
                reads: [comments([planComment])],
                announcement,
            })
            assert.ok(updated.state === "mutation-needed" && "announcement" in updated)
            assert.equal(updated.mutation.tool, "mcp__github__update_issue_comment")
            assert.equal(updated.mutation.arguments.comment_id, 555)
            const body = updated.announcement as string
            assert.match(body, /from Task #42/)
            assert.match(body, /- Limits per workspace\./)
            assert.ok(body.includes("[View the updated plan](#issuecomment-555)"))
            assert.ok(!body.includes(planUrl))
            assert.match(body, /<details>\n<summary>Plan diff<\/summary>\n\n```diff\n@@ /)
            assert.match(body, /\n-Update the plan\.\n\+Update the plan per workspace\.\n/)
            assert.doesNotMatch(body, /^[-+]# /m)
            assert.equal(parentSaved().tracker.planAnnouncement.state, "plan-update")

            // A Task outside this Epic can't be the origin.
            await assert.rejects(
                run({
                    action: "prepareUpdate",
                    source: revised,
                    reads: [comments([planComment])],
                    announcement: { ...announcement, origin: { kind: "task", entityDir: epicDir } },
                }),
                /Task of this Epic/,
            )

            const announce = await run({
                action: "record",
                evidence: { ...updated.mutation, response: { id: 555, html_url: planUrl } },
            })
            assert.ok(announce.state === "mutation-needed")
            assert.equal(announce.mutation.tool, "mcp__github__add_issue_comment")
            assert.deepEqual(announce.mutation.arguments, { ...repository, issue_number: 41, body })
            assert.equal(parentSaved().tracker.planAnnouncement.state, "announcing")

            // Nothing else publishes until the announcement is confirmed.
            const blocked = await run({ action: "prepare", source: revised })
            assert.equal(blocked.state, "recovery-required")
            const absent = await run({ action: "recover", source: revised, pages: [comments([planComment])] })
            assert.ok(absent.state === "mutation-needed")
            assert.deepEqual(absent.mutation, announce.mutation)
            const posted = { id: 777, html_url: "https://github.com/example/project/issues/41#issuecomment-777", body }
            assert.equal(
                (await run({ action: "recover", source: revised, pages: [comments([planComment, posted])] })).state,
                "announced",
            )
            assert.equal("planAnnouncement" in parentSaved().tracker, false)
            assert.deepEqual(f.saved(), childBefore)
        } finally {
            f.dispose()
        }
    })

    it("rejects a Gig plan update without an announcement or with a Task origin", async () => {
        const f = fixture("gig")
        try {
            const prepared = await f.prepare()
            assert.ok(prepared.state === "mutation-needed" && typeof prepared.mutation.arguments.body === "string")
            await f.record({ ...prepared.mutation, response: f.remote(prepared.mutation.arguments.body) })
            const revised = source.replace("Update the plan.", "Revised.")
            const update = (announcement?: Record<string, unknown>) =>
                trackerPublication(
                    f.root,
                    {
                        action: "prepareUpdate",
                        entityDir: f.directory,
                        source: revised,
                        reads: [f.page([f.remote(prepared.mutation.arguments.body as string)])],
                        ...(announcement ? { announcement } : {}),
                    } as TrackerPublicationInput,
                    tools,
                )
            await assert.rejects(update(), /needs an announcement/)
            await assert.rejects(
                update({ origin: { kind: "task", entityDir: f.directory }, summary: "Revised." }),
                /gig plan update has no Task origin/,
            )
            assert.equal("planAnnouncement" in f.saved().tracker, false)
        } finally {
            f.dispose()
        }
    })

    for (const kind of ["epic", "gig"] as const)
        it(`finishes a ${kind} announcement when the plan update landed without being recorded`, async () => {
            const f = fixture(kind)
            try {
                const run = (input: Record<string, unknown>) =>
                    trackerPublication(f.root, { entityDir: f.directory, ...input } as TrackerPublicationInput, tools)
                const prepared = await f.prepare()
                assert.ok(prepared.state === "mutation-needed" && typeof prepared.mutation.arguments.body === "string")
                await f.record({ ...prepared.mutation, response: f.remote(prepared.mutation.arguments.body) })
                const revised = source.replace("Update the plan.", "Revised.")
                const announcement = { summary: "Revised." }
                const updated = await run({
                    action: "prepareUpdate",
                    source: revised,
                    reads: [f.page([f.remote(prepared.mutation.arguments.body)])],
                    announcement,
                })
                assert.ok(updated.state === "mutation-needed" && typeof updated.mutation.arguments.body === "string")
                assert.match(updated.announcement as string, /^\*\*Plan updated\*\*\n\nRevised\./)
                // The update's outcome was uncertain; the published plan shows it landed.
                const resumed = await run({
                    action: "prepareUpdate",
                    source: revised,
                    reads: [f.page([f.remote(updated.mutation.arguments.body)])],
                })
                assert.ok(resumed.state === "mutation-needed")
                assert.equal(resumed.mutation.tool, "mcp__github__add_issue_comment")
                assert.equal(resumed.mutation.arguments.body, updated.announcement)
                await assert.rejects(
                    f.record({
                        ...resumed.mutation,
                        arguments: { ...resumed.mutation.arguments, body: "other" },
                        response: { id: 900 },
                    }),
                    /marker/,
                )
                const done = await f.record({
                    ...resumed.mutation,
                    response: { id: "900", url: "https://github.com/example/project/issues/42#issuecomment-900" },
                })
                assert.equal(done.state, "announced")
                assert.equal("planAnnouncement" in f.saved().tracker, false)
            } finally {
                f.dispose()
            }
        })

    it("resolves availability and validates source before saving a creation attempt", async () => {
        const f = fixture()
        try {
            await assert.rejects(f.prepare(source, new Map()), /unavailable/)
            await assert.rejects(f.prepare("No overview"), /Overview/)
            assert.deepEqual(f.saved().tracker.planComment, { state: "unpublished" })
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
                const identity = f.saved().tracker.planComment
                assert.equal(identity.id, 123)
                const readback = await f.recover(pages)
                assert.ok("body" in readback)
                assert.equal(verifyMarkdownProjection(signed, readback.body as string).verified, true)
                assert.deepEqual(f.saved().tracker.planComment, identity)
                const absent = await f.recover([f.page([])])
                assert.equal(absent.state, "blocked")
                const conflict = await f.recover([f.page([f.remote(signed, 456)])])
                assert.equal(conflict.state, "blocked")
                assert.deepEqual(f.saved().tracker.planComment, identity)
            } finally {
                f.dispose()
            }
        })

    it("preserves pending state for duplicate, incomplete, errored and wrong-scope evidence", async () => {
        const f = fixture()
        try {
            const prepared = await f.prepare()
            assert.ok(prepared.state === "mutation-needed")
            assert.ok(typeof prepared.mutation.arguments.body === "string")
            const body = prepared.mutation.arguments.body
            const before = f.saved()
            assert.equal((await f.recover([f.page([f.remote(body), f.remote(body, 124)])])).state, "blocked")
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
})
