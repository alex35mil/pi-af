import {
    getMcpToolName,
    isMcpRecord,
    isMcpTool,
    mcpResponsePayload,
    type McpToolCatalog,
} from "../../../extensions/__lib/mcp.js"
import { assertPlanDocumentUrl, type PlanDocument } from "./plan-document.js"
import { hasPublicationMarker, type PublicationAdapter, type PublicationIdentity } from "./plan-publication.js"
import { LINEAR_PLAN_DOCUMENT_TITLE } from "./projection.js"
import { requirePublicationCall } from "./publication-evidence.js"
import type { IntegrationRecord } from "./records.js"
import type { ProviderEvidence } from "./resource-id-operations.js"

type Tracker = Extract<IntegrationRecord, { role: "tracker"; provider: "linear"; state: "bound" }>
const listingFields = ["id", "url", "issue", "project"]
const parentArguments = ["issue", "project", "initiative", "cycle", "team"]

export function linearPublication(
    tracker: Tracker,
    server: string,
    tools: McpToolCatalog,
    save: (state: PlanDocument) => void,
): PublicationAdapter<string> {
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
        requirePublicationCall(evidence, server, operation, args, tools)
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
    const identity = (response: Record<string, unknown>): PublicationIdentity<string> => {
        if (typeof response.id !== "string" || !response.id || typeof response.url !== "string")
            throw new Error("document response lacks a native ID and URL; obtain exact document evidence")
        assertPlanDocumentUrl(response.url)
        return { id: response.id, url: response.url }
    }
    const documentRead = (evidence: ProviderEvidence, id: string, aliases: Set<string>) => {
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
        return { ...observed, body: response.content, archivedAt: response.archivedAt }
    }
    return {
        state: tracker.planDocument,
        presentation: "linear-plan-document",
        save,
        create: (content) =>
            call("save_document", { title: LINEAR_PLAN_DOCUMENT_TITLE, content, [parent.kind]: parent.id }),
        update: (id, content) => call("save_document", { id, content }),
        record(evidence, token) {
            requireCall(evidence, "save_document", { title: LINEAR_PLAN_DOCUMENT_TITLE, [parent.kind]: parent.id })
            if (
                Object.hasOwn(evidence.arguments, "id") ||
                Object.hasOwn(evidence.arguments, "patch") ||
                parentArguments.some((key) => key !== parent.kind && Object.hasOwn(evidence.arguments, key))
            )
                throw new Error(
                    "document creation evidence must have exactly the bound parent and no update/reparent arguments",
                )
            if (!hasPublicationMarker(evidence.arguments.content, token))
                throw new Error("created document arguments lack the pending publication marker")
            return identity(mcpResponsePayload(evidence.response))
        },
        verification: {
            kind: "document-parent",
            lookups: (id) => [call("get_document", { id }), parentRead()],
            verify(document, parentEvidence, saved) {
                const observed = documentRead(document, saved.id, parentAliases(parentEvidence))
                if (observed.url !== saved.url || observed.archivedAt !== null)
                    throw new Error(
                        "saved document is archived or its identity conflicts; preserve state and investigate",
                    )
            },
        },
        recoveryLookups: () => [parentRead(), call("list_documents", listing)],
        recover(evidence, token) {
            const aliases = parentAliases(evidence[0])
            let cursor: string | undefined
            let terminal = false
            let index = 1
            const candidates = new Map<string, Record<string, unknown>>()
            const seenIds = new Set<string>()
            const seenCursors = new Set<string>()
            for (
                ;
                index < evidence.length && isMcpTool(evidence[index].tool, server, "list_documents", tools);
                index++
            ) {
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
                    throw new Error(
                        "document recovery requires native document-list pages and explicit completion facts",
                    )
                for (const document of response.documents) {
                    if (typeof document.id !== "string" || !document.id || seenIds.has(document.id))
                        throw new Error("document listing contains missing or duplicate IDs")
                    seenIds.add(document.id)
                    if (belongs(document, aliases)) candidates.set(document.id, document)
                }
                if (response.hasNextPage) {
                    if (typeof response.cursor !== "string" || !response.cursor || seenCursors.has(response.cursor))
                        throw new Error("document recovery requires an advancing native cursor")
                    cursor = response.cursor
                    seenCursors.add(cursor)
                } else terminal = true
            }
            if (!terminal)
                throw new Error("document recovery requires complete cursor pages ending with hasNextPage false")
            const reads = new Map<string, ReturnType<typeof documentRead>>()
            for (; index < evidence.length; index++) {
                const read = evidence[index]
                const id = read.arguments.id
                if (typeof id !== "string" || !candidates.has(id) || reads.has(id))
                    throw new Error(
                        "recovery document read is missing, duplicated, or outside the listed parent candidates",
                    )
                reads.set(id, documentRead(read, id, aliases))
            }
            const missing = [...candidates.keys()].filter((id) => !reads.has(id))
            if (missing.length)
                return { state: "recovery-read-required", lookups: missing.map((id) => call("get_document", { id })) }
            return [...reads.values()]
                .filter((document) => hasPublicationMarker(document.body, token))
                .map(({ archivedAt, ...document }) => {
                    if (archivedAt !== null)
                        throw new Error("matching plan document is archived; preserve state and investigate")
                    return document
                })
        },
    }
}
