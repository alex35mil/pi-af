import {
    getMcpToolName,
    isMcpRecord,
    isMcpTool,
    mcpResponsePayload,
    type McpToolCatalog,
} from "../../../extensions/__lib/mcp.js"
import {
    assertPlanDocumentUrl,
    type PlanDocument,
    type PlanDocumentPending,
    type PlanDocumentPublished,
} from "./plan-document.js"
import { hasAnnouncementToken, planFingerprint } from "./plan-announcement.js"
import type {
    AnnouncementAdapter,
    FoundPublication,
    PublicationAdapter,
    Published,
    RecoveryReads,
} from "./plan-publication.js"
import { LINEAR_PLAN_DOCUMENT_TITLE, renderProviderBody, restoreProviderSource } from "./projection.js"
import { requireProviderCall } from "./provider-evidence.js"
import type { LinearTrackerRecord } from "./records.js"
import type { ProviderEvidence } from "./resource-id-operations.js"

type Tracker = LinearTrackerRecord
const listingFields = ["id", "title", "url", "issue", "project"]
const parentArguments = ["issue", "project", "initiative", "cycle", "team"]

type DocumentRead = { id: string; url: string; body: string; archivedAt: string | null }

// Linear renders every marker as visible text, so a plan document carries none. Its identity is
// the saved document ID; a pending creation is recognized by the fingerprint of the plan it sent.
export function linearPublication(
    tracker: Tracker,
    server: string,
    tools: McpToolCatalog,
    save: (state: PlanDocument) => void,
): PublicationAdapter<string, PlanDocumentPending, PlanDocumentPublished> {
    const parent =
        tracker.resource === "project"
            ? {
                  kind: "project" as const,
                  id: tracker.external.projectId,
                  operation: "get_project",
                  args: { query: tracker.external.projectId },
              }
            : {
                  kind: "issue" as const,
                  id: tracker.external.issueId,
                  operation: "get_issue",
                  args: { id: tracker.external.issueId, fields: ["id", "uuid"] },
              }
    const call = (operation: string, args: Record<string, unknown>) => ({
        tool: getMcpToolName(server, operation, tools),
        arguments: args,
    })
    const requireCall = (evidence: ProviderEvidence, operation: string, args: Record<string, unknown>) =>
        requireProviderCall(evidence, { server, operation, expected: args }, tools, "plan publication")
    const render = (source: string) => renderProviderBody(source, { kind: "linear-plan-document" })
    // The restored root title doesn't take part in comparison, so the document title stands in.
    const restore = (body: string, title: string) =>
        restoreProviderSource(body, { kind: "linear-plan-document" }, title)
    const fingerprintOf = (body: string) => planFingerprint(restore(body, LINEAR_PLAN_DOCUMENT_TITLE))
    const restores = (body: string) => {
        try {
            restore(body, LINEAR_PLAN_DOCUMENT_TITLE)
            return true
        } catch {
            return false
        }
    }
    const parentRead = () => call(parent.operation, parent.args)
    const listing = {
        limit: 50,
        includeArchived: true,
        orderBy: "createdAt",
        fields: listingFields,
        ...(parent.kind === "project" ? { projectId: parent.id } : {}),
    }
    const parentAliases = (evidence: ProviderEvidence) => {
        requireCall(evidence, parent.operation, parent.kind === "project" ? { query: parent.id } : { id: parent.id })
        const response = mcpResponsePayload(evidence.response)
        if (response.uuid !== parent.id || typeof response.id !== "string" || !response.id)
            throw new Error("document parent read does not prove the exact bound UUID and native identifier")
        return new Set([parent.id, response.id])
    }
    const belongs = (document: Record<string, unknown>, aliases: Set<string>) => {
        for (const field of ["issue", "project"]) {
            const value = document[field]
            if (value !== null && (!isMcpRecord(value) || typeof value.id !== "string" || !value.id))
                throw new Error("document evidence lacks explicit issue/Project parent facts")
        }
        const value = document[parent.kind]
        const other = document[parent.kind === "project" ? "issue" : "project"]
        return isMcpRecord(value) && aliases.has(value.id as string) && other === null
    }
    const identity = (response: Record<string, unknown>): Published<PlanDocumentPublished> => {
        if (typeof response.id !== "string" || !response.id || typeof response.url !== "string")
            throw new Error("document response lacks a native ID and URL; obtain exact document evidence")
        assertPlanDocumentUrl(response.url)
        return { state: "published", id: response.id, url: response.url }
    }
    const documentRead = (evidence: ProviderEvidence, id: string, aliases: Set<string>): DocumentRead => {
        requireCall(evidence, "get_document", { id })
        const response = mcpResponsePayload(evidence.response)
        const observed = identity(response)
        if (observed.id !== id || !belongs(response, aliases))
            throw new Error("document read has a conflicting ID or issue/Project parent; do not move or replace it")
        if (
            typeof response.content !== "string" ||
            (response.archivedAt !== null && typeof response.archivedAt !== "string")
        )
            throw new Error("full document read lacks content or archive facts")
        return { id: observed.id, url: observed.url, body: response.content, archivedAt: response.archivedAt }
    }
    // The saved document, still on its parent and not archived, with its full content.
    const currentBody = (reads: ProviderEvidence[], saved: Published<PlanDocumentPublished>) => {
        if (reads.length !== 2) throw new Error("plan reads must be exactly the get_document and parent reads")
        const observed = documentRead(reads[0], saved.id, parentAliases(reads[1]))
        if (observed.url !== saved.url || observed.archivedAt !== null)
            throw new Error("saved document is archived or its identity conflicts; preserve state and investigate")
        return observed.body
    }
    // Every document titled Plan on the bound parent, fully read, from complete listing pages
    // followed by the full reads they require.
    const planDocuments = (evidence: ProviderEvidence[]): DocumentRead[] | RecoveryReads => {
        const aliases = parentAliases(evidence[0])
        let cursor: string | undefined
        let terminal = false
        let index = 1
        const candidates = new Set<string>()
        const seenIds = new Set<string>()
        const seenCursors = new Set<string>()
        for (; index < evidence.length && isMcpTool(evidence[index].tool, server, "list_documents", tools); index++) {
            const page = evidence[index]
            if (terminal) throw new Error("document listing continues after its terminal page")
            requireCall(page, "list_documents", { ...listing, cursor })
            for (const filter of [
                "query",
                "teamId",
                "creatorId",
                "initiativeId",
                "createdAt",
                "updatedAt",
                ...(parent.kind === "issue" ? ["projectId"] : []),
            ])
                if (Object.hasOwn(page.arguments, filter))
                    throw new Error("document recovery listing has an unsupported narrowing filter")
            const response = mcpResponsePayload(page.response)
            if (
                !Array.isArray(response.documents) ||
                !response.documents.every(isMcpRecord) ||
                response.documents.length > listing.limit ||
                typeof response.hasNextPage !== "boolean"
            )
                throw new Error("document recovery requires native document-list pages and explicit completion facts")
            for (const document of response.documents) {
                if (typeof document.id !== "string" || !document.id || seenIds.has(document.id))
                    throw new Error("document listing contains missing or duplicate IDs")
                seenIds.add(document.id)
                if (!belongs(document, aliases)) continue
                if (typeof document.title !== "string")
                    throw new Error("document listing lacks titles; request the prepared listing fields")
                if (document.title === LINEAR_PLAN_DOCUMENT_TITLE) candidates.add(document.id)
            }
            if (response.hasNextPage) {
                if (typeof response.cursor !== "string" || !response.cursor || seenCursors.has(response.cursor))
                    throw new Error("document recovery requires an advancing native cursor")
                cursor = response.cursor
                seenCursors.add(cursor)
            } else terminal = true
        }
        if (!terminal) throw new Error("document recovery requires complete cursor pages ending with hasNextPage false")
        const reads = new Map<string, DocumentRead>()
        for (; index < evidence.length; index++) {
            const read = evidence[index]
            const id = read.arguments.id
            if (typeof id !== "string" || !candidates.has(id) || reads.has(id))
                throw new Error("recovery document read is missing, duplicated, or outside the listed Plan documents")
            reads.set(id, documentRead(read, id, aliases))
        }
        const missing = [...candidates].filter((id) => !reads.has(id))
        if (missing.length)
            return { state: "recovery-read-required", lookups: missing.map((id) => call("get_document", { id })) }
        return [...reads.values()]
    }
    // Announcements are comments on the plan's own parent: the Epic's Project, or the Task or Gig issue.
    const commentParent = parent.kind === "project" ? { projectId: parent.id } : { issueId: parent.id }
    const commentListing = { ...commentParent, limit: 250 }
    const announcements = (): AnnouncementAdapter => {
        return {
            create: (body) => call("save_comment", { ...commentParent, body }),
            lookups: () => [call("list_comments", commentListing)],
            record(evidence, token) {
                requireCall(evidence, "save_comment", commentParent)
                if (Object.hasOwn(evidence.arguments, "id") || Object.hasOwn(evidence.arguments, "parentId"))
                    throw new Error("announcement evidence must create a new comment on the plan's parent")
                if (!hasAnnouncementToken("linear", evidence.arguments.body, token))
                    throw new Error("announcement arguments lack the pending announcement's plan link")
                const response = mcpResponsePayload(evidence.response)
                if (typeof response.id !== "string" || !response.id)
                    throw new Error("comment response lacks a native ID; recover through comment reads")
            },
            matching(pages, token) {
                const bodies: string[] = []
                let cursor: string | undefined
                const seen = new Set<string>()
                for (const [index, page] of pages.entries()) {
                    requireCall(page, "list_comments", { ...commentListing, cursor })
                    const response = mcpResponsePayload(page.response)
                    if (
                        !Array.isArray(response.comments) ||
                        !response.comments.every(isMcpRecord) ||
                        typeof response.hasNextPage !== "boolean"
                    )
                        throw new Error("comment reads require native comment pages and explicit completion facts")
                    for (const comment of response.comments)
                        if (hasAnnouncementToken("linear", comment.body, token)) bodies.push(comment.body)
                    const last = index === pages.length - 1
                    if (response.hasNextPage === last)
                        throw new Error("comment reads must follow cursors until hasNextPage is false, and stop there")
                    if (response.hasNextPage) {
                        if (typeof response.cursor !== "string" || !response.cursor || seen.has(response.cursor))
                            throw new Error("comment reads require an advancing native cursor")
                        cursor = response.cursor
                        seen.add(cursor)
                    }
                }
                return bodies
            },
        }
    }
    return {
        state: tracker.planDocument,
        save,
        // A Linear create is never resent as such: the given source is fingerprinted afresh.
        create: (source) => ({
            mutation: call("save_document", {
                title: LINEAR_PLAN_DOCUMENT_TITLE,
                content: render(source),
                [parent.kind]: parent.id,
            }),
            pending: { state: "pending", fingerprint: planFingerprint(source) },
        }),
        update: (saved, source) => call("save_document", { id: saved.id, content: render(source) }),
        recordUpdate(evidence, saved) {
            requireCall(evidence, "save_document", { id: saved.id })
            if (
                Object.hasOwn(evidence.arguments, "title") ||
                Object.hasOwn(evidence.arguments, "patch") ||
                parentArguments.some((key) => Object.hasOwn(evidence.arguments, key))
            )
                throw new Error("document update evidence must be a content-only update by ID")
            if (typeof evidence.arguments.content !== "string" || !restores(evidence.arguments.content))
                throw new Error("updated document arguments lack a complete rendered plan")
            const observed = identity(mcpResponsePayload(evidence.response))
            if (observed.id !== saved.id) throw new Error("document update response names another document")
            return evidence.arguments.content
        },
        restore,
        currentReads: (saved) => [call("get_document", { id: saved.id }), parentRead()],
        currentBody,
        announcements,
        announcementPlan: (saved) => ({ presentation: "linear", url: saved.url }),
        record(evidence, pending) {
            requireCall(evidence, "save_document", { title: LINEAR_PLAN_DOCUMENT_TITLE, [parent.kind]: parent.id })
            if (
                Object.hasOwn(evidence.arguments, "id") ||
                Object.hasOwn(evidence.arguments, "patch") ||
                parentArguments.some((key) => key !== parent.kind && Object.hasOwn(evidence.arguments, key))
            )
                throw new Error(
                    "document creation evidence must have exactly the bound parent and no update/reparent arguments",
                )
            const content = evidence.arguments.content
            if (typeof content !== "string" || !restores(content) || fingerprintOf(content) !== pending.fingerprint)
                throw new Error("created document arguments aren't the pending plan")
            return identity(mcpResponsePayload(evidence.response))
        },
        recoveryLookups: () => [parentRead(), call("list_documents", listing)],
        recover(evidence, saved) {
            const documents = planDocuments(evidence)
            if (!Array.isArray(documents)) return documents
            if (saved.state === "published") {
                const own = documents.filter((document) => document.id === saved.id)
                if (documents.length !== 1 || own.length !== 1 || own[0].url !== saved.url)
                    return {
                        state: "blocked",
                        reason: "the parent's Plan documents don't show exactly the saved one; preserve state and investigate with the maintainer",
                    }
                if (own[0].archivedAt !== null)
                    return {
                        state: "blocked",
                        reason: "the saved plan document is archived; investigate with the maintainer",
                    }
                return { state: "found", published: saved, body: own[0].body }
            }
            // Before its first publication the parent has no Plan document, so any Plan document
            // may be a landed create: only an exact match is recorded, and none at all allows a create.
            if (documents.length === 0) return { state: "absent" }
            const [document] = documents
            if (
                documents.length === 1 &&
                document.archivedAt === null &&
                restores(document.body) &&
                fingerprintOf(document.body) === saved.fingerprint
            )
                return {
                    state: "found",
                    published: { state: "published", id: document.id, url: document.url },
                    body: document.body,
                }
            return {
                state: "blocked",
                reason: `found ${documents.length} Plan document(s) on the parent that don't match the pending plan exactly; preserve state and investigate with the maintainer, without creating a replacement`,
            }
        },
        restoreCandidates(evidence) {
            const documents = planDocuments(evidence)
            if (!Array.isArray(documents)) return documents
            return documents
                .filter((document) => restores(document.body))
                .map((document): FoundPublication<PlanDocumentPublished> => {
                    if (document.archivedAt !== null)
                        throw new Error("the published plan document is archived; investigate with the maintainer")
                    return {
                        published: { state: "published", id: document.id, url: document.url },
                        body: document.body,
                    }
                })
        },
    }
}
