import {
    getMcpToolName,
    isMcpRecord,
    mcpResponsePayload,
    mcpResponseValue,
    type McpToolCatalog,
} from "../../../extensions/__lib/mcp.js"
import { assertPlanCommentUrl, type PlanComment } from "./plan-comment.js"
import { hasPublicationMarker, type PublicationAdapter } from "./plan-publication.js"
import { requirePublicationCall } from "./publication-evidence.js"
import type { IntegrationRecord } from "./records.js"
import type { ProviderEvidence } from "./resource-id-operations.js"

type Tracker = Extract<IntegrationRecord, { role: "tracker"; provider: "github"; state: "bound" }>

export function githubPublication(
    tracker: Tracker,
    server: string,
    tools: McpToolCatalog,
    save: (state: PlanComment) => void,
): PublicationAdapter<number> {
    const address = { ...tracker.repository, issue_number: tracker.external.issueNumber }
    const call = (operation: string, args: Record<string, unknown>) => ({
        tool: getMcpToolName(server, operation, tools),
        arguments: args,
    })
    const requireCall = (evidence: ProviderEvidence, operation: string, args: Record<string, unknown>) =>
        requirePublicationCall(evidence, server, operation, args, tools)
    const identity = (id: unknown, url: unknown) => {
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || typeof url !== "string")
            throw new Error(
                "comment response lacks a positive safe integer ID and issue-scoped browser URL; recover through explicit comment reads",
            )
        assertPlanCommentUrl(tracker.repository, tracker.external.issueNumber, id, url)
        return { id, url }
    }
    return {
        state: tracker.planComment,
        presentation: "github-plan-comment",
        save,
        create: (body) => call("add_issue_comment", { ...address, body }),
        update: (id, body) => call("update_issue_comment", { ...tracker.repository, comment_id: id, body }),
        verification: { kind: "direct" },
        record(evidence, token) {
            requireCall(evidence, "add_issue_comment", address)
            if (!hasPublicationMarker(evidence.arguments.body, token))
                throw new Error("created comment arguments lack the pending publication marker")
            const response = mcpResponsePayload(evidence.response)
            const id = typeof response.id === "string" && /^\d+$/.test(response.id) ? Number(response.id) : response.id
            const url = "html_url" in response ? response.html_url : response.url
            return identity(id, url)
        },
        recoveryLookups: () => [call("issue_read", { method: "get_comments", ...address, page: 1, perPage: 100 })],
        recover(pages, token) {
            const perPage = pages[0].arguments.perPage
            if (typeof perPage !== "number" || !Number.isInteger(perPage) || perPage < 1 || perPage > 100)
                throw new Error("comment recovery requires explicit perPage between 1 and 100")
            const comments: Record<string, unknown>[] = []
            for (const [index, evidence] of pages.entries()) {
                requireCall(evidence, "issue_read", { method: "get_comments", ...address, page: index + 1, perPage })
                const response = mcpResponseValue(evidence.response)
                if (!Array.isArray(response) || response.length > perPage || !response.every(isMcpRecord))
                    throw new Error("comment recovery requires native comment-array pages")
                if (index < pages.length - 1 ? response.length !== perPage : response.length === perPage)
                    throw new Error(
                        "comment recovery pagination is incomplete or inconsistent; include a terminal short or empty page",
                    )
                comments.push(...response)
            }
            return comments
                .filter((item) => hasPublicationMarker(item.body, token))
                .map((item) => ({ ...identity(item.id, item.html_url), body: item.body as string }))
        },
    }
}
