import { isMcpTool, mcpResponsePayload, type McpToolCatalog } from "../../../../../extensions/__lib/mcp.js"
import type { ProviderEvidence } from "../../resource-id-operations.js"

interface Repository {
    owner: string
    repo: string
}

export interface GitHubMergeSubject {
    mcpServer: string
    repository: Repository
    number: number
    base: string
    head: { repository: Repository | null; ref: string }
    expectedHeadSha: string
}

export interface GitHubMergeProof {
    kind: "github-pr"
    source: "pull_request_read:get"
    repository: Repository
    pullRequestNumber: number
    merged: true
    mergedAt: string
    head: string
    headCommitSha: string
    base: string
}

export type GitHubMergeDecision =
    | { state: "blocked"; reason: string }
    | {
          state: "merge-needed"
          arguments: {
              owner: string
              repo: string
              pullNumber: number
              merge_method: "squash"
              expectedHeadSha: string
          }
      }
    | { state: "merged"; merge: GitHubMergeProof }

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Missing ${label}`)
    return value as Record<string, unknown>
}
function text(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) throw new Error(`Invalid ${label}`)
    return value
}
function repositoryName(repository: Repository): string {
    return `${repository.owner}/${repository.repo}`.toLowerCase()
}

// Both workflow adapters establish readiness/approval and their own durable association.
// This shared boundary alone owns the repository's merge strategy and native arguments.
export function planGitHubMerge(
    subject: GitHubMergeSubject,
    evidence: ProviderEvidence,
    tools: McpToolCatalog,
): GitHubMergeDecision {
    try {
        const args = evidence.arguments
        if (
            !isMcpTool(evidence.tool, subject.mcpServer, "pull_request_read", tools) ||
            args.method !== "get" ||
            typeof args.owner !== "string" ||
            args.owner.toLowerCase() !== subject.repository.owner.toLowerCase() ||
            typeof args.repo !== "string" ||
            args.repo.toLowerCase() !== subject.repository.repo.toLowerCase() ||
            args.pullNumber !== subject.number ||
            !Number.isSafeInteger(subject.number) ||
            subject.number < 1
        )
            throw new Error("Merge requires the exact configured PR-get evidence")
        const response = mcpResponsePayload(evidence.response)
        const base = object(response.base, "PR base")
        const head = object(response.head, "PR head")
        const headRepository = head.repo == null ? null : object(head.repo, "PR head repository")
        if (
            response.number !== subject.number ||
            text(response.html_url, "PR URL").toLowerCase() !==
                `https://github.com/${repositoryName(subject.repository)}/pull/${subject.number}` ||
            base.ref !== subject.base ||
            text(object(base.repo, "PR base repository").full_name, "PR base repository name").toLowerCase() !==
                repositoryName(subject.repository) ||
            head.ref !== subject.head.ref ||
            (subject.head.repository === null
                ? headRepository !== null
                : headRepository === null ||
                  text(headRepository.full_name, "PR head repository name").toLowerCase() !==
                      repositoryName(subject.head.repository))
        )
            throw new Error("Merge PR does not match the exact repository/base/head association")
        const headSha = text(head.sha, "PR head SHA").toLowerCase()
        if (!/^[a-f0-9]{40,64}$/i.test(subject.expectedHeadSha) || headSha !== subject.expectedHeadSha.toLowerCase())
            throw new Error("Merge PR head does not match the verified expected head")
        if (response.merged === true)
            return {
                state: "merged",
                merge: {
                    kind: "github-pr",
                    source: "pull_request_read:get",
                    repository: subject.repository,
                    pullRequestNumber: subject.number,
                    merged: true,
                    mergedAt: text(response.merged_at, "PR merge timestamp"),
                    head: subject.head.ref,
                    headCommitSha: headSha,
                    base: subject.base,
                },
            }
        if (response.merged !== false) throw new Error("Exact PR get does not establish merged state")
        if (response.state !== "open" || response.draft !== false)
            throw new Error("Merge requires a confirmed open, non-draft PR")
        return {
            state: "merge-needed",
            arguments: {
                ...subject.repository,
                pullNumber: subject.number,
                merge_method: "squash",
                expectedHeadSha: subject.expectedHeadSha,
            },
        }
    } catch (error) {
        return { state: "blocked", reason: error instanceof Error ? error.message : String(error) }
    }
}
