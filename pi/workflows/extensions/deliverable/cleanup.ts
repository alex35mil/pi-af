import * as path from "node:path"

import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import { readEntityStatus, resolveEntityDirectory } from "../__lib/entity.js"
import * as Git from "../__lib/git.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { resolveResourceIdsContext } from "../integrations/resource-id-operations.js"
import { isResourceIdsKind, readCachedResourceIds } from "../integrations/resource-ids.js"

// Merged-state proof extracted from the configured PR-get evidence.
const MergeEvidenceSchema = Type.Object(
    {
        kind: Type.Literal("github-pr"),
        source: Type.Literal("pull_request_read:get"),
        repository: Type.Object(
            { owner: Type.String({ minLength: 1 }), repo: Type.String({ minLength: 1 }) },
            { additionalProperties: false },
        ),
        pullRequestNumber: Type.Integer({ minimum: 1 }),
        merged: Type.Literal(true),
        mergedAt: Type.String({ minLength: 1 }),
        head: Type.String({ minLength: 1 }),
        headCommitSha: Type.String({ pattern: "^[0-9a-fA-F]{40,64}$" }),
        base: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
)
type MergeEvidence = Static<typeof MergeEvidenceSchema>

export const DeliveryCleanupInputSchema = Type.Object(
    {
        entityDir: Type.String({ minLength: 1 }),
        evidence: Type.Object(
            {
                tool: Type.String({ minLength: 1 }),
                arguments: Type.Record(Type.String(), Type.Unknown()),
                response: Type.Unknown({ description: "Actual provider JSON or complete native MCP result." }),
            },
            {
                additionalProperties: false,
                description: "Exact configured pull_request_read get evidence for the recorded PR after merge.",
            },
        ),
    },
    { additionalProperties: false },
)

export function runDeliveryCleanup(input: { entityDir: string; merge: MergeEvidence }, options: { cwd: string }) {
    const merge = Value.Parse(MergeEvidenceSchema, input.merge)
    const root = project.resolveRootDir(options.cwd)
    assertArtifactPersistencePrepared(root)
    const entityDirectory = resolveEntityDirectory(root, root, input.entityDir)
    const status = readEntityStatus(entityDirectory)
    if (status.entity === "epic") throw new Error("Epic branches are permanent and are not cleanup candidates")

    const branch = status.branch.name
    const target = status.branch.target
    if (branch === target) throw new Error(`Deliverable branch and target are identical: ${branch}`)
    requireCloneBranch(root, branch)
    requireCloneBranch(root, target)
    assertWorktreeAvailability(root, branch, target)

    const forge = status.forge
    if (!forge) throw new Error("cleanup requires stored PR intent")
    const { scope } = resolveResourceIdsContext(root, entityDirectory, "github-pull-request")
    const saved = readCachedResourceIds(entityDirectory, scope)
    if (!saved || !isResourceIdsKind(saved, "github-pull-request"))
        throw new Error("cleanup requires locally recorded PR resource IDs")
    if (
        merge.repository.owner.toLowerCase() !== forge.repository.owner.toLowerCase() ||
        merge.repository.repo.toLowerCase() !== forge.repository.repo.toLowerCase()
    )
        throw new Error("merge evidence repository does not match the stored PR intent")
    if (merge.pullRequestNumber !== saved.value.number)
        throw new Error("merge evidence pull request does not match the locally recorded PR")
    if (merge.head !== branch || merge.base !== target)
        throw new Error("merge evidence head/base does not match the stored branch contract")
    if (merge.headCommitSha.toLowerCase() !== Git.run(root, ["rev-parse", branch]).toLowerCase())
        throw new Error("merge evidence head commit does not match the Deliverable branch in the current clone")
    Git.run(root, ["remote", "get-url", "origin"])

    Git.run(root, ["fetch", "--no-tags", "origin", `refs/heads/${target}`])
    const originTargetCommit = Git.run(root, ["rev-parse", "FETCH_HEAD"])
    Git.run(root, ["switch", target])
    Git.run(root, ["merge", "--ff-only", "--no-edit", originTargetCommit])
    const targetCommit = Git.run(root, ["rev-parse", `refs/heads/${target}`])
    if (targetCommit !== originTargetCommit) {
        throw new Error(`target ${target} does not match freshly fetched origin; branch ${branch} was preserved`)
    }
    Git.run(root, ["branch", "-D", branch])
    if (Git.succeeds(root, ["show-ref", "--verify", `refs/heads/${branch}`])) {
        throw new Error(`branch deletion in the current clone did not complete: ${branch}`)
    }
    return {
        entity: path.basename(entityDirectory),
        target,
        targetCommit,
        deletedBranch: branch,
        remoteBranchDeleted: false as const,
    }
}

function requireCloneBranch(root: string, branch: string): void {
    if (!Git.succeeds(root, ["show-ref", "--verify", `refs/heads/${branch}`])) {
        throw new Error(`required branch does not exist in the current clone: ${branch}`)
    }
}

function assertWorktreeAvailability(root: string, branch: string, target: string): void {
    const currentWorktree = path.resolve(Git.run(root, ["rev-parse", "--show-toplevel"]))
    const lines = Git.run(root, ["worktree", "list", "--porcelain"]).split(/\r?\n/)
    let worktree = ""
    for (const line of lines) {
        if (line.startsWith("worktree ")) worktree = path.resolve(line.slice("worktree ".length))
        if (!line.startsWith("branch refs/heads/")) continue
        const checkedOutBranch = line.slice("branch refs/heads/".length)
        if ((checkedOutBranch === branch || checkedOutBranch === target) && worktree !== currentWorktree) {
            throw new Error(`${checkedOutBranch} is checked out in another worktree: ${worktree}`)
        }
    }
}
