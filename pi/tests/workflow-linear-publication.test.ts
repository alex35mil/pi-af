import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"

import { initializeEntity } from "../workflows/extensions/init/entity.ts"
import { readEntityStatus } from "../workflows/extensions/__lib/entity.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { buildIntegrationContext } from "../workflows/extensions/integrations/index.ts"
import { type AnnouncementInput, planFingerprint } from "../workflows/extensions/integrations/plan-announcement.ts"
import { PlanDocumentValidator } from "../workflows/extensions/integrations/plan-document.ts"
import { trackerPublication } from "../workflows/extensions/integrations/tracker-publication.ts"
import type { ProviderEvidence } from "../workflows/extensions/integrations/resource-id-operations.ts"
import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"
import { linearPhases } from "./workflow-phase-fixtures.ts"

const tools = workflowMcpCatalog("linear")
const source =
    "# Work\n\n## Overview\n\nKeep the original request.\n\n### Plan highlights\n\n- One maintained plan.\n\n## Implementation\n\nAll supporting details.\n"
const token = "ab345678-1234-4567-8901-123456789abc"
const documentId = "document-uuid"
const url = "https://linear.app/example/document/plan-slug"

function fixture(kind: "epic" | "task" | "gig" = "gig") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "linear-publication-"))
    const git = (...args: string[]) => cp.execFileSync("git", args, { cwd: root, stdio: "pipe" })
    git("init", "-b", "main")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
    git("add", ".gitignore")
    git("commit", "-m", "initial")
    fs.mkdirSync(path.join(root, ".project"))
    const statuses = {
        backlog: "Backlog",
        todo: "Todo",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        canceled: "Canceled",
    }
    fs.writeFileSync(
        path.join(root, ".project/config.json"),
        JSON.stringify({ branches: { format: "identifier-title" } }),
    )
    fs.writeFileSync(
        path.join(root, ".project/integrations.json"),
        JSON.stringify({
            tracker: {
                provider: "linear",
                mcpServer: "linear",
                team: "Engineering",
                phase: linearPhases(),
                statuses: { issues: statuses, projects: statuses },
            },
            forge: {
                provider: "github",
                mcpServer: "github",
                repository: { owner: "example", repo: "project" },
            },
        }),
    )
    prepareArtifactPersistence(root)
    const common = { title: "Work", slug: "work", request: "Original request." }
    const issue = {
        issueId: "issue-uuid",
        identifier: "ENG-1",
        issueUrl: "https://linear.app/example/issue/ENG-1/work",
    }
    const project = {
        projectId: "project-uuid",
        projectUrl: "https://linear.app/example/project/test",
        createdAt: "2026-10-01T09:00:00.000Z",
    }
    let parentDirectory: string | undefined
    if (kind === "task") {
        const parent = initializeEntity({ ...common, entity: "epic", object: project }, { cwd: root })
        parentDirectory = parent.directory
        fs.writeFileSync(
            path.join(root, parent.directory, "epic.md"),
            `# Parent\n\n## Overview\n\nParent.\n\n## Task delivery strategy\n\nTask target: epic\nEpic branch: ${parent.status.branch.name}\n\n## Tasks\n\n### [${issue.identifier}] Work\n\nKind: feature\n\nWork.\n`,
        )
    }
    const initialization =
        kind === "epic"
            ? { ...common, entity: "epic" as const, object: project }
            : kind === "task"
              ? {
                    ...common,
                    entity: "task" as const,
                    object: { ...issue, projectId: "project-uuid" },
                    parentEpicDir: parentDirectory!,
                }
              : {
                    ...common,
                    entity: "gig" as const,
                    kind: "feature" as const,
                    object: issue,
                }
    const initialized = initializeEntity(initialization, { cwd: root })
    const directory = initialized.directory
    const file = path.join(root, directory, "metadata.json")
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).tracker.planDocument, { state: "unpublished" })
    const saved = () => JSON.parse(fs.readFileSync(file, "utf8"))
    const prepare = (content = source, catalog = tools) =>
        trackerPublication(root, { entityDir: directory, action: "prepare", source: content }, catalog)
    const record = (evidence: ProviderEvidence) =>
        trackerPublication(root, { entityDir: directory, action: "record", evidence }, tools)
    const recover = (pages: ProviderEvidence[], content = source) =>
        trackerPublication(root, { entityDir: directory, action: "recover", source: content, pages }, tools)
    const parent = (): ProviderEvidence => ({
        tool: kind === "epic" ? "mcp__linear__get_project" : "mcp__linear__get_issue",
        arguments: kind === "epic" ? { query: "project-uuid" } : { id: "issue-uuid" },
        response: {
            id: kind === "epic" ? "P-ENG-1" : "ENG-1",
            uuid: kind === "epic" ? "project-uuid" : "issue-uuid",
        },
    })
    const document = (content: string, id = documentId, title = "Plan") => ({
        id,
        title,
        url: id === documentId ? url : `https://linear.app/example/document/plan-${id}`,
        content,
        archivedAt: null,
        issue: kind === "epic" ? null : { id: "ENG-1" },
        project: kind === "epic" ? { id: "P-ENG-1" } : null,
    })
    const read = (content: string, id = documentId, title = "Plan"): ProviderEvidence => ({
        tool: "mcp__linear__get_document",
        arguments: { id },
        response: document(content, id, title),
    })
    // A listed document: listings omit full content.
    const listed = (id = documentId, title = "Plan") => ({ ...document("", id, title), content: undefined })
    const listing = (documents: Record<string, unknown>[], more = false, cursor?: string): ProviderEvidence => ({
        tool: "mcp__linear__list_documents",
        arguments: {
            limit: 50,
            includeArchived: true,
            orderBy: "createdAt",
            fields: ["id", "title", "url", "issue", "project"],
            ...(kind === "epic" ? { projectId: "project-uuid" } : {}),
            ...(cursor ? { cursor } : {}),
        },
        response: {
            documents,
            hasNextPage: more,
            ...(more ? { cursor: "next" } : {}),
        },
    })
    const update = (
        document: ProviderEvidence,
        parentEvidence = parent(),
        content = source,
        announcement?: AnnouncementInput,
    ) =>
        trackerPublication(
            root,
            {
                entityDir: directory,
                action: "prepareUpdate",
                source: content,
                reads: [document, parentEvidence],
                ...(announcement ? { announcement } : {}),
            },
            tools,
        )
    return {
        root,
        directory,
        file,
        parentDirectory,
        saved,
        prepare,
        record,
        recover,
        parent,
        document,
        read,
        listed,
        listing,
        update,
        dispose: () => fs.rmSync(root, { recursive: true, force: true }),
    }
}

// What Linear returns for content it stored: `*` bullets, a trailing space on the fold's closing
// line, and the footer it was signed with.
function linearStored(content: string): string {
    return `${content.replaceAll("\n- ", "\n* ").replace(/\n>>>$/, "\n>>> ")}\n\n*Sent via Pi. Model: x/y.*`
}

function envelope(value: unknown, kind: "raw" | "text" | "structured") {
    return kind === "raw"
        ? value
        : kind === "text"
          ? { content: [{ type: "text", text: JSON.stringify(value) }] }
          : { content: [], structuredContent: value }
}

describe("managed Linear plan documents", () => {
    it("defines strict document states with native string identities", () => {
        const fingerprint = planFingerprint(source)
        for (const state of [
            { state: "unpublished" },
            { state: "pending", fingerprint },
            { state: "published", id: documentId, url },
        ])
            assert.equal(PlanDocumentValidator.check(state), true)
        for (const state of [
            { state: "published", id: 42, url },
            { state: "pending" },
            // Linear documents carry no marker, so no token.
            { state: "pending", token },
            { state: "published", token, id: documentId, url },
            { state: "unpublished", fingerprint },
        ])
            assert.equal(PlanDocumentValidator.check(state), false)
    })
    for (const kind of ["epic", "task", "gig"] as const)
        it(`publishes and updates ${kind}`, async () => {
            const f = fixture(kind)
            try {
                const brief = fs.readFileSync(path.join(f.root, f.directory, "brief.md"), "utf8")
                const prepared = await f.prepare()
                assert.ok(prepared.state === "mutation-needed")
                const args = prepared.mutation.arguments
                assert.equal(prepared.mutation.tool, "mcp__linear__save_document")
                assert.equal(args.title, "Plan")
                assert.ok(typeof args.content === "string")
                assert.match(args.content, /^Keep the original request\.\n\n## Highlights/)
                assert.match(args.content, /\n>>> Full plan\n[\s\S]*\n>>>$/)
                assert.doesNotMatch(args.content, /GIG-|TASK-|EPIC-|\.project\/|<!--/)
                assert.equal(
                    args[kind === "epic" ? "project" : "issue"],
                    kind === "epic" ? "project-uuid" : "issue-uuid",
                )
                assert.equal("description" in args, false)
                assert.deepEqual(f.saved().tracker.planDocument, {
                    state: "pending",
                    fingerprint: planFingerprint(source),
                })
                await f.record({
                    ...prepared.mutation,
                    response: {
                        id: documentId,
                        url,
                        content: "truncated native create preview",
                    },
                })
                assert.equal(f.saved().tracker.planDocument.state, "published")
                const verify = await f.prepare()
                assert.equal(verify.state, "reads-required")
                // Every update compares with the published plan; the same source is unchanged,
                // including in the form Linear stores it.
                assert.equal((await f.update(f.read(args.content))).state, "unchanged")
                assert.equal((await f.update(f.read(linearStored(args.content)))).state, "unchanged")
                const updated = await f.update(
                    f.read(args.content),
                    f.parent(),
                    source.replace("All supporting", "Revised supporting"),
                    { summary: "Revised details." },
                )
                assert.ok(updated.state === "mutation-needed")
                assert.deepEqual(Object.keys(updated.mutation.arguments).sort(), ["content", "id"])
                assert.equal(updated.mutation.arguments.id, documentId)
                assert.deepEqual(f.saved().tracker.planDocument, { state: "published", id: documentId, url })
                assert.equal(fs.readFileSync(path.join(f.root, f.directory, "brief.md"), "utf8"), brief)
                const context = buildIntegrationContext(
                    { cwd: f.root } as ExtensionContext,
                    { operation: "artifactProjection", entityDir: f.directory },
                    tools,
                )
                assert.equal(context.state, "enabled")
                assert.match(context.projection.rendering, /tracker_publication/)
                readEntityStatus(path.join(f.root, f.directory))
            } finally {
                f.dispose()
            }
        })

    it("validates tools and layout before consuming creation, and serializes concurrent preparation", async () => {
        const f = fixture()
        try {
            await assert.rejects(f.prepare(source, new Map()), /unavailable/)
            await assert.rejects(f.prepare("invalid"), /Overview/)
            assert.deepEqual(f.saved().tracker.planDocument, {
                state: "unpublished",
            })
            const results = await Promise.all([f.prepare(), f.prepare()])
            assert.equal(results.filter((r) => r.state === "mutation-needed").length, 1)
            assert.equal(results.filter((r) => r.state === "recovery-required").length, 1)
            assert.equal(f.saved().phase, "planning")
        } finally {
            f.dispose()
        }
    })

    for (const kind of ["raw", "text", "structured"] as const)
        it(`recovers a later-page document using full native reads (${kind})`, async () => {
            const f = fixture()
            try {
                const prepared = await f.prepare()
                assert.ok(prepared.state === "mutation-needed")
                const body = prepared.mutation.arguments.content
                assert.ok(typeof body === "string")
                const unrelated = Array.from({ length: 50 }, (_, index) => ({
                    id: `other-${index}`,
                    issue: { id: "OTHER-1" },
                    project: null,
                }))
                // Other documents on the parent aren't plan candidates.
                const notes = f.listed("notes", "Notes")
                const evidence = [f.parent(), f.listing(unrelated, true), f.listing([notes, f.listed()], false, "next")]
                for (const page of evidence) page.response = envelope(page.response, kind)
                const needed = await f.recover(evidence)
                assert.equal(needed.state, "recovery-read-required")
                if (needed.state !== "recovery-read-required") assert.fail()
                assert.deepEqual(
                    needed.lookups.map((lookup) => lookup.arguments.id),
                    [documentId],
                )
                // Linear's stored form of the pending plan still matches its fingerprint.
                const full = f.read(linearStored(body))
                full.response = envelope(full.response, kind)
                const recovered = await f.recover([...evidence, full])
                assert.equal(recovered.state, "identified")
                assert.deepEqual(f.saved().tracker.planDocument, { state: "published", id: documentId, url })
                // A published plan is recovered by its saved identity.
                assert.equal((await f.recover([...evidence, full])).state, "identified")
                const replaced = await f.recover([
                    f.parent(),
                    f.listing([f.listed("other-document")]),
                    f.read(body, "other-document"),
                ])
                assert.equal(replaced.state, "blocked")
                await assert.rejects(f.update(f.read(body, "other-document")), /conflicting|does not match/)
            } finally {
                f.dispose()
            }
        })

    it("preserves state for duplicate, incomplete, narrowed and failed recovery evidence", async () => {
        const f = fixture()
        try {
            const prepared = await f.prepare()
            assert.ok(prepared.state === "mutation-needed")
            const body = prepared.mutation.arguments.content
            assert.ok(typeof body === "string")
            const before = fs.readFileSync(f.file, "utf8")
            const both = [f.listed(), f.listed("second")]
            assert.equal(
                (await f.recover([f.parent(), f.listing(both), f.read(body), f.read(body, "second")])).state,
                "blocked",
            )
            // A Plan document that doesn't match, here because Linear decoded `&amp;`, may still be
            // the landed create: recovery stops instead of creating a second one.
            const decoded = body.replace("All supporting", "All &amp; supporting")
            const edited = source.replace("All supporting", "All &amp; supporting")
            assert.equal(
                (await f.recover([f.parent(), f.listing([f.listed()]), f.read(decoded.replace("&amp;", "&"))], edited))
                    .state,
                "blocked",
            )
            const archived = f.read(body)
            archived.response = { ...f.document(body), archivedAt: "2026-01-01T00:00:00Z" }
            assert.equal((await f.recover([f.parent(), f.listing([f.listed()]), archived])).state, "blocked")
            const untitled = f.listing([{ ...f.listed(), title: undefined }])
            const narrowed = f.listing([])
            narrowed.arguments.query = "Plan"
            const wrongParent = f.parent()
            wrongParent.response = { id: "OTHER-1", uuid: "other-uuid" }
            const badCursor = f.listing([], true)
            badCursor.response = { documents: [], hasNextPage: true, cursor: "" }
            const errored = f.listing([])
            errored.response = {
                isError: true,
                content: [{ type: "text", text: "denied" }],
            }
            const wrongServer = f.listing([])
            wrongServer.tool = "mcp__other__list_documents"
            for (const evidence of [
                [f.parent(), untitled],
                [f.parent(), f.listing([], true)],
                [f.parent(), narrowed],
                [wrongParent, f.listing([])],
                [f.parent(), badCursor],
                [f.parent(), errored],
                [f.parent(), wrongServer],
            ])
                await assert.rejects(f.recover(evidence))
            assert.equal(fs.readFileSync(f.file, "utf8"), before)
            assert.equal((await f.prepare()).state, "recovery-required")
        } finally {
            f.dispose()
        }
    })

    it("rejects moved, archived and unverifiable published documents without reparenting or replacement", async () => {
        const f = fixture()
        try {
            const prepared = await f.prepare()
            assert.ok(prepared.state === "mutation-needed")
            const body = prepared.mutation.arguments.content
            assert.ok(typeof body === "string")
            await f.record({
                ...prepared.mutation,
                response: { id: documentId, url },
            })
            const before = fs.readFileSync(f.file, "utf8")
            const moved = f.read(body)
            moved.response = { ...f.document(body), issue: { id: "OTHER-1" } }
            const archived = f.read(body)
            archived.response = {
                ...f.document(body),
                archivedAt: "2026-01-01T00:00:00Z",
            }
            const missingParent = f.read(body)
            missingParent.response = { ...f.document(body), issue: undefined }
            const error = f.read(body)
            error.response = {
                isError: true,
                content: [{ type: "text", text: "not found" }],
            }
            for (const document of [moved, archived, missingParent, error]) await assert.rejects(f.update(document))
            const otherParent = f.parent()
            otherParent.response = { id: "ENG-1", uuid: "other-uuid" }
            await assert.rejects(f.update(f.read(body), otherParent), /parent/)
            assert.equal(fs.readFileSync(f.file, "utf8"), before)
        } finally {
            f.dispose()
        }
    })

    it("rejects unsafe creation evidence while retaining the pending fingerprint", async () => {
        const f = fixture()
        try {
            const prepared = await f.prepare()
            assert.ok(prepared.state === "mutation-needed")
            const before = fs.readFileSync(f.file, "utf8")
            for (const args of [
                { ...prepared.mutation.arguments, issue: "wrong" },
                { ...prepared.mutation.arguments, project: "project-uuid" },
                { ...prepared.mutation.arguments, id: documentId },
                { ...prepared.mutation.arguments, content: "not a rendered plan" },
                {
                    ...prepared.mutation.arguments,
                    content: String(prepared.mutation.arguments.content).replace("All supporting", "Other"),
                },
            ])
                await assert.rejects(
                    f.record({
                        tool: prepared.mutation.tool,
                        arguments: args,
                        response: { id: documentId, url },
                    }),
                )
            await assert.rejects(
                f.record({
                    ...prepared.mutation,
                    response: {
                        id: documentId,
                        url: "https://example.com/document/plan",
                    },
                }),
                /URL/,
            )
            assert.equal(fs.readFileSync(f.file, "utf8"), before)
        } finally {
            f.dispose()
        }
    })

    for (const kind of ["epic", "gig"] as const)
        it(`creates again when a complete listing finds no Plan document on the parent (${kind})`, async () => {
            const f = fixture(kind)
            try {
                const prepared = await f.prepare()
                assert.ok(prepared.state === "mutation-needed")
                const pending = f.saved().tracker.planDocument
                assert.equal(pending.state, "pending")

                // Same-parent documents with other titles aren't read or matched.
                const evidence = [f.parent(), f.listing([f.listed("other", "Notes")])]
                const reissued = await f.recover(evidence)
                assert.ok(reissued.state === "mutation-needed")
                assert.deepEqual(reissued.mutation, prepared.mutation)
                assert.deepEqual(f.saved().tracker.planDocument, pending)

                // A plan revised after a create that never landed publishes the revision.
                const revised = source.replace("All supporting", "Revised supporting")
                const recreated = await f.recover(evidence, revised)
                assert.ok(recreated.state === "mutation-needed")
                assert.match(String(recreated.mutation.arguments.content), /Revised supporting/)
                assert.deepEqual(f.saved().tracker.planDocument, {
                    state: "pending",
                    fingerprint: planFingerprint(revised),
                })

                assert.equal(
                    (await f.record({ ...recreated.mutation, response: { id: documentId, url } })).state,
                    "published",
                )
                assert.deepEqual(f.saved().tracker.planDocument, { state: "published", id: documentId, url })
            } finally {
                f.dispose()
            }
        })

    it("uses the parent Epic's own document state during synchronization", async () => {
        const f = fixture("task")
        try {
            assert.ok(f.parentDirectory)
            const child = fs.readFileSync(f.file, "utf8")
            const prepared = await trackerPublication(
                f.root,
                { entityDir: f.parentDirectory, action: "prepare", source },
                tools,
            )
            assert.ok(prepared.state === "mutation-needed")
            assert.equal(prepared.mutation.arguments.project, "project-uuid")
            assert.equal("issue" in prepared.mutation.arguments, false)
            assert.equal(fs.readFileSync(f.file, "utf8"), child)
        } finally {
            f.dispose()
        }
    })

    for (const kind of ["epic", "task", "gig"] as const)
        it(`announces a ${kind} plan update as a comment on its own parent with a folded diff`, async () => {
            const f = fixture(kind)
            const parentArgument = kind === "epic" ? { projectId: "project-uuid" } : { issueId: "issue-uuid" }
            try {
                const prepared = await f.prepare()
                assert.ok(
                    prepared.state === "mutation-needed" && typeof prepared.mutation.arguments.content === "string",
                )
                await f.record({ ...prepared.mutation, response: { id: documentId, url } })
                // Linear normalizes bullets on save; that alone isn't a change.
                const stored = linearStored(prepared.mutation.arguments.content)
                const revised = source.replace("All supporting details.", "All supporting details, revised.")
                // The summary accepted at presentation is used without passing it again.
                const metadata = f.saved()
                fs.writeFileSync(
                    f.file,
                    JSON.stringify({
                        ...metadata,
                        tracker: {
                            ...metadata.tracker,
                            planAnnouncement: {
                                state: "accepted",
                                summary: "Details revised.",
                                after: planFingerprint(revised),
                            },
                        },
                    }),
                )
                const updated = await f.update(f.read(stored), f.parent(), revised)
                assert.ok(updated.state === "mutation-needed" && "announcement" in updated)
                const body = updated.announcement as string
                assert.match(body, /^\*\*Plan updated\*\*\n\nDetails revised\./)
                assert.match(body, /\n>>> Plan diff\n\n```diff\n/)
                assert.match(body, /\n-All supporting details\.\n\+All supporting details, revised\.\n/)
                assert.doesNotMatch(body, /^[-+]. One maintained plan/m)
                // The token rides on the plan link; no HTML marker shows in Linear.
                assert.match(body, new RegExp(`\\]\\(${url}\\?publication=[0-9a-f-]{36}\\)`))
                assert.doesNotMatch(body, /<!--/)
                const announce = await f.record({ ...updated.mutation, response: { id: documentId, url } })
                assert.ok(announce.state === "mutation-needed")
                assert.equal(announce.mutation.tool, "mcp__linear__save_comment")
                assert.deepEqual(announce.mutation.arguments, { ...parentArgument, body })
                const comments = (items: Record<string, unknown>[]): ProviderEvidence => ({
                    tool: "mcp__linear__list_comments",
                    arguments: { ...parentArgument, limit: 250 },
                    response: { comments: items, hasNextPage: false },
                })
                const recovered = await f.recover([comments([])])
                assert.ok(recovered.state === "mutation-needed")
                assert.deepEqual(recovered.mutation, announce.mutation)
                // An earlier announcement on the item isn't this one; Linear may bracket link targets.
                const earlier = body.replace(/publication=[0-9a-f-]+/, `publication=${token}`)
                assert.equal((await f.recover([comments([{ body: earlier }])])).state, "mutation-needed")
                const landed = body.replace(/\]\(([^)]+)\)/, "](<$1>)")
                assert.equal((await f.recover([comments([{ body: earlier }, { body: landed }])])).state, "announced")
                const metadataWithAnnouncement = f.saved()
                fs.writeFileSync(
                    f.file,
                    JSON.stringify({
                        ...metadataWithAnnouncement,
                        tracker: {
                            ...metadataWithAnnouncement.tracker,
                            planAnnouncement: {
                                state: "announcing",
                                token: /publication=([0-9a-f-]+)/.exec(body)![1],
                                body,
                            },
                        },
                    }),
                )
                assert.equal((await f.recover([comments([{ body: landed }, { body: landed }])])).state, "blocked")
                await assert.rejects(
                    f.record({
                        ...announce.mutation,
                        arguments: { ...announce.mutation.arguments, id: "c" },
                        response: {},
                    }),
                    /new comment on the plan's parent/,
                )
                assert.equal(
                    (await f.record({ ...announce.mutation, response: { id: "comment-1" } })).state,
                    "announced",
                )
                assert.equal("planAnnouncement" in f.saved().tracker, false)
            } finally {
                f.dispose()
            }
        })

    it("lets a Task record carry an announcement only once its plan is published", async () => {
        const f = fixture("task")
        try {
            const pending = { state: "announcing", token, body: "**Plan updated**" }
            const write = (planDocument: Record<string, unknown>) => {
                const metadata = f.saved()
                fs.writeFileSync(
                    f.file,
                    JSON.stringify({
                        ...metadata,
                        tracker: { ...metadata.tracker, planDocument, planAnnouncement: pending },
                    }),
                )
            }
            write({ state: "unpublished" })
            assert.throws(() => readEntityStatus(path.join(f.root, f.directory)), /requires a published plan/)
            const fingerprint = planFingerprint(source)
            write({ state: "pending", fingerprint })
            assert.throws(() => readEntityStatus(path.join(f.root, f.directory)), /requires a published plan/)
            write({ state: "published", id: documentId, url })
            assert.deepEqual(readEntityStatus(path.join(f.root, f.directory)).tracker.planAnnouncement, pending)
            // A presented summary may wait on a first publication that may have landed, but not on none.
            const presented = { state: "presented", summary: "Revised.", after: planFingerprint(source) }
            const present = (planDocument: Record<string, unknown>) => {
                const metadata = f.saved()
                fs.writeFileSync(
                    f.file,
                    JSON.stringify({
                        ...metadata,
                        tracker: { ...metadata.tracker, planDocument, planAnnouncement: presented },
                    }),
                )
            }
            present({ state: "unpublished" })
            assert.throws(() => readEntityStatus(path.join(f.root, f.directory)), /requires a published plan/)
            present({ state: "pending", fingerprint })
            assert.deepEqual(readEntityStatus(path.join(f.root, f.directory)).tracker.planAnnouncement, presented)
        } finally {
            f.dispose()
        }
    })
})
