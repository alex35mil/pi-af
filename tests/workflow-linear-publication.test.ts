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
import { PlanDocumentSchema } from "../workflows/extensions/integrations/plan-document.ts"
import { planPublicationMarker } from "../workflows/extensions/integrations/plan-publication.ts"
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

function fixture(
    kind: "epic" | "task" | "gig" = "gig",
    mode: "versioned" | "unversioned" = "versioned",
    adopted = false,
) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "linear-publication-"))
    const git = (...args: string[]) => cp.execFileSync("git", args, { cwd: root, stdio: "pipe" })
    git("init", "-b", "main")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    fs.writeFileSync(path.join(root, ".gitignore"), ".project/**/.local/\n")
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
        JSON.stringify({ artifacts: mode, branches: { format: "identifier" } }),
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
        }),
    )
    prepareArtifactPersistence(root)
    const common = { title: "Work", slug: "work", request: "Original request.", priority: "High" }
    let parentDirectory: string | undefined
    if (kind === "task") {
        const parent = initializeEntity(
            { ...common, entity: "epic", source: { mode: "new" } },
            { cwd: root, now: new Date("2026-01-01T00:00:00Z") },
        )
        parentDirectory = parent.directory
        const file = path.join(root, parent.directory, "metadata.json")
        const status = JSON.parse(fs.readFileSync(file, "utf8"))
        status.authority = { kind: "tracker", provider: "linear" }
        status.integrations = [
            {
                role: "tracker",
                provider: "linear",
                resource: "project",
                state: "bound",
                external: { projectId: "project-uuid" },
                planDocument: { state: "unpublished" },
            },
        ]
        fs.writeFileSync(file, JSON.stringify(status))
        fs.writeFileSync(
            path.join(root, parent.directory, "epic.md"),
            "# Parent\n\n## Overview\n\nParent.\n\n## Ordered Tasks\n\n1. **Work** — Work.\n",
        )
    }
    const external =
        kind === "epic"
            ? {
                  mode: "external" as const,
                  provider: "linear" as const,
                  resource: "project" as const,
                  projectId: "project-uuid",
                  projectUrl: "https://linear.app/example/project/test",
              }
            : kind === "task"
              ? {
                    mode: "external" as const,
                    provider: "linear" as const,
                    resource: "task-issue" as const,
                    issueId: "issue-uuid",
                    identifier: "ENG-1",
                    issueUrl: "https://linear.app/example/issue/ENG-1/work",
                    projectId: "project-uuid",
                }
              : {
                    mode: "external" as const,
                    provider: "linear" as const,
                    resource: "gig-issue" as const,
                    issueId: "issue-uuid",
                    identifier: "ENG-1",
                    issueUrl: "https://linear.app/example/issue/ENG-1/work",
                }
    const initialization =
        kind === "epic"
            ? {
                  ...common,
                  entity: "epic" as const,
                  source: adopted
                      ? (external as Extract<typeof external, { resource: "project" }>)
                      : { mode: "new" as const },
              }
            : kind === "task"
              ? {
                    ...common,
                    entity: "task" as const,
                    kind: "feature" as const,
                    source: adopted
                        ? (external as Extract<typeof external, { resource: "task-issue" }>)
                        : { mode: "new" as const },
                    parentEpicDir: parentDirectory!,
                    epicItemTitle: "Work",
                }
              : {
                    ...common,
                    entity: "gig" as const,
                    kind: "feature" as const,
                    source: adopted
                        ? (external as Extract<typeof external, { resource: "gig-issue" }>)
                        : { mode: "new" as const },
                }
    const initialized = initializeEntity(initialization, { cwd: root, now: new Date("2026-01-01T00:01:00Z") })
    const directory = initialized.directory
    const file = path.join(root, directory, "metadata.json")
    const status = JSON.parse(fs.readFileSync(file, "utf8"))
    assert.deepEqual(status.integrations[0].planDocument, { state: "unpublished" })
    assert.ok(!JSON.stringify(status.integrations).includes("embed Internal ID"))
    status.authority = { kind: "tracker", provider: "linear" }
    status.integrations = [
        {
            role: "tracker",
            provider: "linear",
            resource: kind === "epic" ? "project" : kind === "task" ? "task-issue" : "gig-issue",
            state: "bound",
            external:
                kind === "epic"
                    ? { projectId: "project-uuid" }
                    : kind === "task"
                      ? { issueId: "issue-uuid", projectId: "project-uuid" }
                      : { issueId: "issue-uuid" },
            planDocument: { state: "unpublished" },
        },
    ]
    fs.writeFileSync(file, JSON.stringify(status))
    const saved = () => JSON.parse(fs.readFileSync(file, "utf8"))
    const prepare = (content = source, catalog = tools) =>
        trackerPublication(root, { entityDir: directory, action: "prepare", source: content }, catalog)
    const record = (evidence: ProviderEvidence) =>
        trackerPublication(root, { entityDir: directory, action: "record", evidence }, tools)
    const recover = (pages: ProviderEvidence[]) =>
        trackerPublication(root, { entityDir: directory, action: "recover", pages }, tools)
    const parent = (): ProviderEvidence => ({
        tool: kind === "epic" ? "mcp__linear__get_project" : "mcp__linear__get_issue",
        arguments: kind === "epic" ? { query: "project-uuid" } : { id: "issue-uuid" },
        response: { id: kind === "epic" ? "P-ENG-1" : "ENG-1", uuid: kind === "epic" ? "project-uuid" : "issue-uuid" },
    })
    const document = (content: string, id = documentId) => ({
        id,
        url: id === documentId ? url : `https://linear.app/example/document/plan-${id}`,
        content,
        archivedAt: null,
        issue: kind === "epic" ? null : { id: "ENG-1" },
        project: kind === "epic" ? { id: "P-ENG-1" } : null,
    })
    const read = (content: string, id = documentId): ProviderEvidence => ({
        tool: "mcp__linear__get_document",
        arguments: { id },
        response: document(content, id),
    })
    const listing = (documents: Record<string, unknown>[], more = false, cursor?: string): ProviderEvidence => ({
        tool: "mcp__linear__list_documents",
        arguments: {
            limit: 50,
            includeArchived: true,
            orderBy: "createdAt",
            fields: ["id", "url", "issue", "project"],
            ...(kind === "epic" ? { projectId: "project-uuid" } : {}),
            ...(cursor ? { cursor } : {}),
        },
        response: { documents, hasNextPage: more, ...(more ? { cursor: "next" } : {}) },
    })
    const update = (document: ProviderEvidence, parentEvidence = parent(), content = source) =>
        trackerPublication(
            root,
            { entityDir: directory, action: "prepareUpdate", source: content, document, parent: parentEvidence },
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
        listing,
        update,
        dispose: () => fs.rmSync(root, { recursive: true, force: true }),
    }
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
        for (const state of [
            { state: "unpublished" },
            { state: "pending", token },
            { state: "published", token, id: documentId, url },
        ])
            assert.equal(Value.Check(PlanDocumentSchema, state), true)
        for (const state of [
            { state: "published", token, id: 42, url },
            { state: "pending" },
            { state: "unpublished", token },
        ])
            assert.equal(Value.Check(PlanDocumentSchema, state), false)
    })
    for (const kind of ["epic", "task", "gig"] as const)
        for (const mode of ["versioned", "unversioned"] as const)
            for (const adopted of [false, true])
                it(`publishes and updates ${kind}/${mode}/${adopted ? "adopted" : "new"}`, async () => {
                    const f = fixture(kind, mode, adopted)
                    try {
                        const brief = fs.readFileSync(path.join(f.root, f.directory, "brief.md"), "utf8")
                        const prepared = await f.prepare()
                        assert.ok(prepared.state === "mutation-needed")
                        const args = prepared.mutation.arguments
                        assert.equal(prepared.mutation.tool, "mcp__linear__save_document")
                        assert.equal(args.title, "Plan")
                        assert.ok(typeof args.content === "string")
                        assert.match(args.content, /^Keep the original request\.\n\n## Highlights/)
                        assert.match(args.content, /\+\+\+ Full plan/)
                        assert.doesNotMatch(args.content, /GIG-|TASK-|EPIC-|\.project\//)
                        assert.equal(
                            args[kind === "epic" ? "project" : "issue"],
                            kind === "epic" ? "project-uuid" : "issue-uuid",
                        )
                        assert.equal("description" in args, false)
                        const pending = f.saved().integrations[0].planDocument
                        assert.equal(pending.state, "pending")
                        assert.ok(args.content.endsWith(planPublicationMarker(pending.token)))
                        await f.record({
                            ...prepared.mutation,
                            response: { id: documentId, url, content: "truncated native create preview" },
                        })
                        assert.equal(f.saved().integrations[0].planDocument.state, "published")
                        const verify = await f.prepare()
                        assert.equal(verify.state, "verification-required")
                        const updated = await f.update(f.read(args.content))
                        assert.ok(updated.state === "mutation-needed")
                        assert.deepEqual(Object.keys(updated.mutation.arguments).sort(), ["content", "id"])
                        assert.equal(updated.mutation.arguments.id, documentId)
                        assert.deepEqual(f.saved().integrations[0].planDocument, {
                            state: "published",
                            token: pending.token,
                            id: documentId,
                            url,
                        })
                        assert.equal(fs.readFileSync(path.join(f.root, f.directory, "brief.md"), "utf8"), brief)
                        const context = buildIntegrationContext(
                            { cwd: f.root } as ExtensionContext,
                            { operation: "artifactProjection", entityDir: f.directory },
                            tools,
                        )
                        assert.equal(context.state, "enabled")
                        if (context.state !== "enabled" || context.projection.mode === "none") assert.fail()
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
            assert.deepEqual(f.saved().integrations[0].planDocument, { state: "unpublished" })
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
                const item = { ...f.document("truncated list preview"), content: undefined }
                const evidence = [f.parent(), f.listing(unrelated, true), f.listing([item], false, "next")]
                for (const page of evidence) page.response = envelope(page.response, kind)
                const needed = await f.recover(evidence)
                assert.equal(needed.state, "recovery-read-required")
                if (needed.state !== "recovery-read-required") assert.fail()
                assert.equal(needed.lookups[0].arguments.id, documentId)
                const full = f.read(body)
                full.response = envelope(full.response, kind)
                const recovered = await f.recover([...evidence, full])
                assert.equal(recovered.state, "identified")
                assert.equal(f.saved().integrations[0].planDocument.id, documentId)
                await assert.rejects(f.update(f.read(body, "other-document")), /conflicting|does not match/)
            } finally {
                f.dispose()
            }
        })

    it("preserves state for absent, duplicate, incomplete, narrowed and failed recovery evidence", async () => {
        const f = fixture()
        try {
            const prepared = await f.prepare()
            assert.ok(prepared.state === "mutation-needed")
            const body = prepared.mutation.arguments.content
            assert.ok(typeof body === "string")
            const before = fs.readFileSync(f.file, "utf8")
            assert.equal((await f.recover([f.parent(), f.listing([])])).state, "blocked")
            const both = [f.document(body), f.document(body, "second")]
            assert.equal(
                (await f.recover([f.parent(), f.listing(both), f.read(body), f.read(body, "second")])).state,
                "blocked",
            )
            const narrowed = f.listing([])
            narrowed.arguments.query = "Plan"
            const wrongParent = f.parent()
            wrongParent.response = { id: "OTHER-1", uuid: "other-uuid" }
            const badCursor = f.listing([], true)
            badCursor.response = { documents: [], hasNextPage: true, cursor: "" }
            const errored = f.listing([])
            errored.response = { isError: true, content: [{ type: "text", text: "denied" }] }
            const wrongServer = f.listing([])
            wrongServer.tool = "mcp__other__list_documents"
            for (const evidence of [
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
            await f.record({ ...prepared.mutation, response: { id: documentId, url } })
            const before = fs.readFileSync(f.file, "utf8")
            const moved = f.read(body)
            moved.response = { ...f.document(body), issue: { id: "OTHER-1" } }
            const archived = f.read(body)
            archived.response = { ...f.document(body), archivedAt: "2026-01-01T00:00:00Z" }
            const missingParent = f.read(body)
            missingParent.response = { ...f.document(body), issue: undefined }
            const error = f.read(body)
            error.response = { isError: true, content: [{ type: "text", text: "not found" }] }
            for (const document of [moved, archived, missingParent, error]) await assert.rejects(f.update(document))
            const otherParent = f.parent()
            otherParent.response = { id: "ENG-1", uuid: "other-uuid" }
            await assert.rejects(f.update(f.read(body), otherParent), /parent/)
            assert.equal(fs.readFileSync(f.file, "utf8"), before)
        } finally {
            f.dispose()
        }
    })

    it("rejects unsafe creation evidence while retaining the pending token", async () => {
        const f = fixture()
        try {
            const prepared = await f.prepare()
            assert.ok(prepared.state === "mutation-needed")
            const before = fs.readFileSync(f.file, "utf8")
            for (const args of [
                { ...prepared.mutation.arguments, issue: "wrong" },
                { ...prepared.mutation.arguments, project: "project-uuid" },
                { ...prepared.mutation.arguments, id: documentId },
                { ...prepared.mutation.arguments, content: "no marker" },
            ])
                await assert.rejects(
                    f.record({ tool: prepared.mutation.tool, arguments: args, response: { id: documentId, url } }),
                )
            await assert.rejects(
                f.record({
                    ...prepared.mutation,
                    response: { id: documentId, url: "https://example.com/document/plan" },
                }),
                /URL/,
            )
            assert.equal(fs.readFileSync(f.file, "utf8"), before)
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

    it("migrates only missing document state without changing identities or descriptions", () => {
        const f = fixture()
        try {
            const original = f.saved()
            const legacy = structuredClone(original)
            delete legacy.integrations[0].planDocument
            fs.writeFileSync(f.file, JSON.stringify(legacy))
            assert.throws(() => readEntityStatus(path.join(f.root, f.directory)))
            legacy.integrations[0].planDocument = { state: "unpublished" }
            fs.writeFileSync(f.file, JSON.stringify(legacy))
            assert.deepEqual(readEntityStatus(path.join(f.root, f.directory)), original)
            assert.match(fs.readFileSync("workflows/MIGRATIONS.md", "utf8"), /Linear managed plan documents/)
        } finally {
            f.dispose()
        }
    })
})
