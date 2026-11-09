import { Type, type Static } from "typebox"
import { mcpResponsePayload, type McpToolCatalog } from "../../../../../extensions/__lib/mcp.js"
import { EvidenceSchema } from "../../resource-id-tool.js"
import { incomingPullRequestContext, incomingRevision, sameIncomingAddress } from "./incoming-pr-context.js"
import { planGitHubMerge, type GitHubMergeDecision } from "./merge.js"

export const IncomingMergeContextSchema = Type.Object(
    {
        operation: Type.Literal("incomingPullRequestMerge"),
        reference: Type.String({ minLength: 1 }),
        reviewedEvidence: EvidenceSchema,
        evidence: EvidenceSchema,
    },
    { additionalProperties: false },
)
export type IncomingMergeContextInput = Static<typeof IncomingMergeContextSchema>

export function incomingMergeContext(cwd: string, input: IncomingMergeContextInput, tools: McpToolCatalog) {
    const context = incomingPullRequestContext(cwd, input.reference, tools)
    const forge = context.roles.forge.config
    let merge: GitHubMergeDecision
    try {
        const reviewed = incomingRevision(forge, context.incomingPullRequest, input.reviewedEvidence, tools)
        const current = incomingRevision(forge, context.incomingPullRequest, input.evidence, tools)
        if (!sameIncomingAddress(reviewed, current) || reviewed.head.sha !== current.head.sha)
            throw new Error("Incoming PR identity/head changed after review; reassess before shipping")
        const response = mcpResponsePayload(input.evidence.response)
        // Merge itself advances the target; an already-merged proof binds refs/head instead.
        if (response.merged !== true && reviewed.base.sha !== current.base.sha)
            throw new Error("Incoming PR base changed after review; reassess before shipping")
        merge = planGitHubMerge(
            {
                mcpServer: forge.mcpServer,
                repository: reviewed.repository,
                number: reviewed.number,
                base: reviewed.base.ref,
                head: { repository: reviewed.head.repository, ref: reviewed.head.ref },
                expectedHeadSha: reviewed.head.sha,
            },
            input.evidence,
            tools,
        )
    } catch (error) {
        merge = { state: "blocked", reason: error instanceof Error ? error.message : String(error) }
    }
    return { ...context, operation: "incomingPullRequestMerge" as const, merge }
}
