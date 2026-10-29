import {
    getMcpToolName,
    isMcpRecord,
    mcpResponsePayload,
    mcpResponseValue,
    type McpToolCatalog,
} from "../../../extensions/__lib/mcp.js"
import { hasAnnouncementMarker } from "./plan-announcement.js"
import { assertPlanCommentUrl, type PlanComment } from "./plan-comment.js"
import { hasPublicationMarker, type PublicationAdapter } from "./plan-publication.js"
import { requirePublicationCall } from "./publication-evidence.js"
import type { GitHubTrackerRecord } from "./records.js"
import type { ProviderEvidence } from "./resource-id-operations.js"

type Tracker = GitHubTrackerRecord

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
    const createdId = (evidence: ProviderEvidence) => {
        const response = mcpResponsePayload(evidence.response)
        const id = typeof response.id === "string" && /^\d+$/.test(response.id) ? Number(response.id) : response.id
        return { id, url: "html_url" in response ? response.html_url : response.url }
    }
    const commentPages = () => [call("issue_read", { method: "get_comments", ...address, page: 1, perPage: 100 })]
    // Every comment on the issue, from complete explicit pages.
    const comments = (pages: ProviderEvidence[]) => {
        const perPage = pages[0].arguments.perPage
        if (typeof perPage !== "number" || !Number.isInteger(perPage) || perPage < 1 || perPage > 100)
            throw new Error("comment reads require explicit perPage between 1 and 100")
        const all: Record<string, unknown>[] = []
        for (const [index, evidence] of pages.entries()) {
            requireCall(evidence, "issue_read", { method: "get_comments", ...address, page: index + 1, perPage })
            const response = mcpResponseValue(evidence.response)
            if (!Array.isArray(response) || response.length > perPage || !response.every(isMcpRecord))
                throw new Error("comment reads require native comment-array pages")
            if (index < pages.length - 1 ? response.length !== perPage : response.length === perPage)
                throw new Error(
                    "comment pagination is incomplete or inconsistent; include a terminal short or empty page",
                )
            all.push(...response)
        }
        return all
    }
    const recover = (pages: ProviderEvidence[], token?: string) =>
        comments(pages)
            .filter((item) => hasPublicationMarker(item.body, token))
            .map((item) => ({ ...identity(item.id, item.html_url), body: item.body as string }))
    return {
        state: tracker.planComment,
        presentation: "github-plan-comment",
        save,
        create: (body) => call("add_issue_comment", { ...address, body }),
        update: (id, body) => call("update_issue_comment", { ...tracker.repository, comment_id: id, body }),
        updateCheck: "direct",
        recordUpdate(evidence, saved) {
            requireCall(evidence, "update_issue_comment", { ...tracker.repository, comment_id: saved.id })
            if (!hasPublicationMarker(evidence.arguments.body, saved.token))
                throw new Error("updated comment arguments lack the plan publication marker")
            // Unwraps the response, rejecting MCP errors; a minimal success needs no echo.
            mcpResponseValue(evidence.response)
            return evidence.arguments.body
        },
        currentReads: () => commentPages(),
        currentBody(reads, saved) {
            const matches = recover(reads, saved.token)
            if (matches.length !== 1 || matches[0].id !== saved.id || matches[0].url !== saved.url)
                throw new Error(
                    "comment reads don't show exactly the saved plan comment; preserve state and investigate",
                )
            return matches[0].body
        },
        announcements: () => ({
            create: (body) => call("add_issue_comment", { ...address, body }),
            lookups: commentPages,
            record(evidence, token) {
                requireCall(evidence, "add_issue_comment", address)
                if (!hasAnnouncementMarker(evidence.arguments.body, token))
                    throw new Error("announcement arguments lack the pending announcement marker")
                const created = createdId(evidence)
                identity(created.id, created.url)
            },
            bodies: (pages) => comments(pages).flatMap((item) => (typeof item.body === "string" ? [item.body] : [])),
        }),
        record(evidence, token) {
            requireCall(evidence, "add_issue_comment", address)
            if (!hasPublicationMarker(evidence.arguments.body, token))
                throw new Error("created comment arguments lack the pending publication marker")
            const created = createdId(evidence)
            return identity(created.id, created.url)
        },
        recoveryLookups: commentPages,
        recover,
    }
}
