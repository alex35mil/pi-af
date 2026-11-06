import { randomUUID } from "node:crypto"

import {
    getMcpToolName,
    isMcpRecord,
    mcpResponsePayload,
    mcpResponseValue,
    type McpToolCatalog,
} from "../../../extensions/__lib/mcp.js"
import { hasAnnouncementToken } from "./plan-announcement.js"
import {
    assertPlanCommentUrl,
    type PlanComment,
    type PlanCommentPending,
    type PlanCommentPublished,
} from "./plan-comment.js"
import { hasPublicationMarker, planPublicationMarker, type PublicationAdapter } from "./plan-publication.js"
import { publicationMarkerTokens, renderProviderBody, restoreProviderSource } from "./projection.js"
import { requireProviderCall } from "./provider-evidence.js"
import type { GitHubTrackerRecord } from "./records.js"
import type { ProviderEvidence } from "./resource-id-operations.js"

type Tracker = GitHubTrackerRecord

// GitHub hides HTML comments, so a plan comment carries its token in a marker line.
export function githubPublication(
    tracker: Tracker,
    server: string,
    tools: McpToolCatalog,
    save: (state: PlanComment) => void,
): PublicationAdapter<number, PlanCommentPending, PlanCommentPublished> {
    const address = { ...tracker.repository, issue_number: tracker.external.issueNumber }
    const call = (operation: string, args: Record<string, unknown>) => ({
        tool: getMcpToolName(server, operation, tools),
        arguments: args,
    })
    const requireCall = (evidence: ProviderEvidence, operation: string, args: Record<string, unknown>) =>
        requireProviderCall(evidence, { server, operation, expected: args }, tools, "plan publication")
    const render = (source: string, token: string) =>
        `${renderProviderBody(source, { kind: "github-plan-comment" })}\n\n${planPublicationMarker(token)}`
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
    // Without a token (Epic restore), matches any single plan publication marker.
    const marked = (pages: ProviderEvidence[], token?: string) =>
        comments(pages)
            .filter((item) => hasPublicationMarker(item.body, token))
            .map((item) => ({ ...identity(item.id, item.html_url), body: item.body as string }))
    return {
        state: tracker.planComment,
        save,
        create(source, retry) {
            const pending = retry ?? { state: "pending" as const, token: randomUUID() }
            return { mutation: call("add_issue_comment", { ...address, body: render(source, pending.token) }), pending }
        },
        update: (saved, source) =>
            call("update_issue_comment", {
                ...tracker.repository,
                comment_id: saved.id,
                body: render(source, saved.token),
            }),
        recordUpdate(evidence, saved) {
            requireCall(evidence, "update_issue_comment", { ...tracker.repository, comment_id: saved.id })
            if (!hasPublicationMarker(evidence.arguments.body, saved.token))
                throw new Error("updated comment arguments lack the plan publication marker")
            // Unwraps the response, rejecting MCP errors; a minimal success needs no echo.
            mcpResponseValue(evidence.response)
            return evidence.arguments.body
        },
        restore: (body, title) => restoreProviderSource(body, { kind: "github-plan-comment" }, title),
        currentReads: () => commentPages(),
        currentBody(reads, saved) {
            const matches = marked(reads, saved.token)
            if (matches.length !== 1 || matches[0].id !== saved.id || matches[0].url !== saved.url)
                throw new Error(
                    "comment reads don't show exactly the saved plan comment; preserve state and investigate",
                )
            return matches[0].body
        },
        announcementPlan: (saved) => ({ presentation: "github", commentId: saved.id }),
        announcements: () => ({
            create: (body) => call("add_issue_comment", { ...address, body }),
            lookups: commentPages,
            record(evidence, token) {
                requireCall(evidence, "add_issue_comment", address)
                if (!hasAnnouncementToken("github", evidence.arguments.body, token))
                    throw new Error("announcement arguments lack the pending announcement marker")
                const created = createdId(evidence)
                identity(created.id, created.url)
            },
            matching: (pages, token) =>
                comments(pages).flatMap((item) =>
                    hasAnnouncementToken("github", item.body, token) ? [item.body] : [],
                ),
        }),
        record(evidence, pending) {
            requireCall(evidence, "add_issue_comment", address)
            if (!hasPublicationMarker(evidence.arguments.body, pending.token))
                throw new Error("created comment arguments lack the pending publication marker")
            const created = createdId(evidence)
            return { state: "published", token: pending.token, ...identity(created.id, created.url) }
        },
        recoveryLookups: commentPages,
        recover(pages, saved) {
            const matches = marked(pages, saved.token)
            if (matches.length === 0)
                return saved.state === "pending"
                    ? { state: "absent" }
                    : { state: "blocked", reason: "the saved plan comment is missing; investigate with the maintainer" }
            if (matches.length > 1)
                return {
                    state: "blocked",
                    reason: `found ${matches.length} matching plan publications; preserve state and investigate with the maintainer, without creating a replacement`,
                }
            const { body, ...found } = matches[0]
            if (saved.state === "published" && (found.id !== saved.id || found.url !== saved.url))
                return {
                    state: "blocked",
                    reason: "observed publication conflicts with the saved identity; do not replace it",
                }
            return { state: "found", published: { state: "published", token: saved.token, ...found }, body }
        },
        // Any single marker identifies a plan comment; its token becomes the restored state's.
        restoreCandidates: (pages) =>
            marked(pages).map(({ body, ...found }) => {
                const [token] = publicationMarkerTokens(body)
                return { published: { state: "published", token, ...found }, body }
            }),
    }
}
