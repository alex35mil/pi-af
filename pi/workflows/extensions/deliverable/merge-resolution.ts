import * as cp from "node:child_process"

import { type Static, Type } from "typebox"

import { compile, parse } from "../../../extensions/__lib/schema.js"
import { getMcpToolName, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import * as Git from "../__lib/git.js"
import { foldedDiff, MAX_COMMENT_BODY } from "../integrations/comment-diff.js"
import { resolveResourceIdsContext } from "../integrations/resource-id-operations.js"
import { isResourceIdsKind, readCachedResourceIds } from "../integrations/resource-ids.js"

// Records a pushed merge-conflict resolution on its PR: the push-approved summary plus the
// `git show --remerge-diff` of the merge commit, folded like every other generated diff.

export const MergeResolutionCommentInputSchema = Type.Object(
    {
        entityDir: Type.String({ minLength: 1, description: "Task or Gig directory" }),
        summary: Type.String({
            minLength: 1,
            description:
                "The plain-words resolution summary the user approved with the push: what conflicted and how each side was kept or combined",
        }),
    },
    { additionalProperties: false },
)
export const MergeResolutionCommentInputValidator = compile(MergeResolutionCommentInputSchema)
export type MergeResolutionCommentInput = Static<typeof MergeResolutionCommentInputSchema>

export function mergeResolutionMarker(merge: string): string {
    return `<!-- merge-resolution:${merge} -->`
}

export function renderMergeResolutionComment(input: {
    summary: string
    target: string
    targetSha: string
    merge: string
    remergeDiff: string
}): string {
    const short = (sha: string) => sha.slice(0, 12)
    const head = [
        "**Merge conflict resolved**",
        `Merged \`${input.target}\` at \`${short(input.targetSha)}\` into this branch as \`${short(input.merge)}\`.`,
        input.summary.trim(),
    ]
    const marker = mergeResolutionMarker(input.merge)
    const full = [...head, foldedDiff("github", "Conflict resolution", input.remergeDiff), marker].join("\n\n")
    if (full.length <= MAX_COMMENT_BODY) return full
    return [
        ...head,
        `The resolution diff is too large to include here. Run \`git show --remerge-diff ${input.merge}\` to see it.`,
        marker,
    ].join("\n\n")
}

// Git reads with configured external diff and text-conversion programs disabled.
function remergeDiff(root: string, merge: string): string {
    const result = cp.spawnSync(
        "git",
        [
            "--no-pager",
            "-c",
            "diff.external=",
            "-c",
            "core.fsmonitor=false",
            "show",
            "--remerge-diff",
            "--format=",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            merge,
        ],
        { cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
    )
    if (result.status !== 0) throw new Error(`git show --remerge-diff failed: ${(result.stderr || "").trim()}`)
    return result.stdout.replace(/\n+$/, "")
}

/**
 * Validates the pushed merge against local state and returns the PR comment call. Reads only local
 * Git and workflow state; makes no provider call.
 */
export function prepareMergeResolutionComment(
    cwd: string,
    input: MergeResolutionCommentInput,
    catalog: McpToolCatalog,
) {
    const context = resolveResourceIdsContext(cwd, input.entityDir, "github-pull-request")
    if (context.scope.kind !== "github-pull-request") throw new Error("merge-resolution comment requires PR addressing")
    const saved = readCachedResourceIds(context.directory, context.scope)
    if (!saved || !isResourceIdsKind(saved, "github-pull-request"))
        throw new Error("merge-resolution comment requires the locally recorded PR; investigate and record it first")
    const root = project.resolveRootDir(cwd)
    const { head: branch, target } = context.scope
    const merge = Git.run(root, ["rev-parse", `refs/heads/${branch}^{commit}`])
    const parents = Git.run(root, ["rev-parse", `${merge}^@`])
        .split("\n")
        .filter(Boolean)
    if (parents.length !== 2) throw new Error(`${branch} doesn't end in a merge commit with exactly two parents`)
    const targetRef = `refs/remotes/origin/${target}`
    if (!Git.succeeds(root, ["merge-base", "--is-ancestor", parents[1], targetRef]))
        throw new Error(`the merge's second parent isn't on ${targetRef}; it doesn't merge the stored target`)
    const pushed = Git.tryRun(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`])
    if (pushed !== merge) throw new Error(`origin/${branch} isn't at the merge commit; push it before recording`)
    const diff = remergeDiff(root, merge)
    if (!diff.trim()) throw new Error("the merge resolved no conflicts, so there is no resolution to record")
    const body = renderMergeResolutionComment({
        summary: input.summary,
        target,
        targetSha: parents[1],
        merge,
        remergeDiff: diff,
    })
    return {
        merge,
        marker: mergeResolutionMarker(merge),
        call: {
            tool: getMcpToolName(context.scope.mcpServer, "add_issue_comment", catalog),
            arguments: { ...context.scope.repository, issue_number: saved.value.number, body },
        },
    }
}

export function parseMergeResolutionCommentInput(params: unknown): MergeResolutionCommentInput {
    return parse(MergeResolutionCommentInputValidator, params)
}
