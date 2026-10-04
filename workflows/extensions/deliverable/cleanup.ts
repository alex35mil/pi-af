import * as path from "node:path"

import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import { readEntityStatus, resolveEntityDirectory } from "../__lib/entity.js"
import * as Git from "../__lib/git.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { resolveResourceIdsContext } from "../integrations/resource-id-operations.js"
import { isResourceIdsKind, readCachedResourceIds } from "../integrations/resource-ids.js"

const CompletionEvidenceSchema = Type.Union([
    Type.Object({ kind: Type.Literal("workflow") }, { additionalProperties: false }),
    Type.Object(
        {
            kind: Type.Literal("tracker"),
            provider: Type.Union([Type.Literal("github"), Type.Literal("linear")]),
            lifecycle: Type.Literal("done"),
        },
        { additionalProperties: false },
    ),
])

const MergeEvidenceSchema = Type.Union([
    Type.Object({ kind: Type.Literal("git-ancestry") }, { additionalProperties: false }),
    Type.Object(
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
    ),
])

const CleanupRequestProperties = {
    entityDir: Type.String({ minLength: 1 }),
    completion: CompletionEvidenceSchema,
    merge: MergeEvidenceSchema,
}

export const DeliveryCleanupSchema = Type.Object(CleanupRequestProperties, { additionalProperties: false })
export type DeliveryCleanupInput = Static<typeof DeliveryCleanupSchema>

type CleanupContext = {
    entityId: string
    branch: string
    target: string
    mergeEvidence: Static<typeof MergeEvidenceSchema>
}

export function runDeliveryCleanup(rawInput: unknown, options: { cwd: string }) {
    const input = Value.Parse(DeliveryCleanupSchema, rawInput)
    const root = project.resolveRootDir(options.cwd)
    assertArtifactPersistencePrepared(root)
    const cleanup = resolveCleanupContext(root, input)

    Git.run(root, ["fetch", "--no-tags", "origin", `refs/heads/${cleanup.target}`])
    const originTargetCommit = Git.run(root, ["rev-parse", "FETCH_HEAD"])
    Git.run(root, ["switch", cleanup.target])
    Git.run(root, ["merge", "--ff-only", "--no-edit", originTargetCommit])
    const targetCommit = Git.run(root, ["rev-parse", `refs/heads/${cleanup.target}`])
    if (targetCommit !== originTargetCommit) {
        throw new Error(
            `target ${cleanup.target} does not match freshly fetched origin; branch ${cleanup.branch} was preserved`,
        )
    }

    switch (cleanup.mergeEvidence.kind) {
        case "github-pr":
            Git.run(root, ["branch", "-D", cleanup.branch])
            break
        case "git-ancestry":
            if (!Git.succeeds(root, ["merge-base", "--is-ancestor", cleanup.branch, cleanup.target])) {
                throw new Error(
                    `branch ${cleanup.branch} in the current clone is not merged into target ${cleanup.target}; branch was preserved`,
                )
            }
            Git.run(root, ["branch", "-d", cleanup.branch])
            break
        default:
            cleanup.mergeEvidence satisfies never
    }

    if (Git.succeeds(root, ["show-ref", "--verify", `refs/heads/${cleanup.branch}`])) {
        throw new Error(`branch deletion in the current clone did not complete: ${cleanup.branch}`)
    }
    return {
        entityId: cleanup.entityId,
        target: cleanup.target,
        targetCommit,
        deletedBranch: cleanup.branch,
        remoteBranchDeleted: false as const,
    }
}

function resolveCleanupContext(root: string, input: DeliveryCleanupInput): CleanupContext {
    const entityDirectory = resolveEntityDirectory(root, root, input.entityDir)
    const status = readEntityStatus(entityDirectory)
    if (status.entity === "epic") throw new Error("Epic branches are permanent and are not cleanup candidates")
    if (status.branch.state !== "ready") throw new Error(`${status.id} branch is not ready`)
    assertCompletionEvidence(status, input.completion)

    const branch = status.branch.name
    const target = status.branch.target
    if (branch === target) throw new Error(`Deliverable branch and target are identical: ${branch}`)
    requireCloneBranch(root, branch)
    requireCloneBranch(root, target)
    assertWorktreeAvailability(root, branch, target)

    const forge = status.integrations.find((integration) => integration.role === "forge")
    switch (input.merge.kind) {
        case "github-pr": {
            if (!forge) throw new Error("GitHub merge evidence requires stored forge intent")
            const { scope } = resolveResourceIdsContext(root, entityDirectory, "github-pull-request")
            const saved = readCachedResourceIds(entityDirectory, scope)
            if (!saved || !isResourceIdsKind(saved, "github-pull-request"))
                throw new Error("cleanup requires locally recorded PR resource IDs")
            if (
                input.merge.repository.owner.toLowerCase() !== forge.repository.owner.toLowerCase() ||
                input.merge.repository.repo.toLowerCase() !== forge.repository.repo.toLowerCase()
            ) {
                throw new Error("merge evidence repository does not match the stored forge association")
            }
            if (input.merge.pullRequestNumber !== saved.value.number) {
                throw new Error("merge evidence pull request does not match the locally recorded PR")
            }
            if (input.merge.head !== branch || input.merge.base !== target) {
                throw new Error("merge evidence head/base does not match the stored branch contract")
            }
            const branchCommit = Git.run(root, ["rev-parse", branch])
            if (input.merge.headCommitSha.toLowerCase() !== branchCommit.toLowerCase()) {
                throw new Error("merge evidence head commit does not match the Deliverable branch in the current clone")
            }
            Git.run(root, ["remote", "get-url", "origin"])
            break
        }
        case "git-ancestry":
            if (forge) {
                throw new Error("a Deliverable with a forge association requires verified GitHub merge evidence")
            }
            break
        default:
            input.merge satisfies never
    }

    return { entityId: status.id, branch, target, mergeEvidence: input.merge }
}

function assertCompletionEvidence(
    status: ReturnType<typeof readEntityStatus>,
    completion: Static<typeof CompletionEvidenceSchema>,
): void {
    if (status.authority.kind === "workflow") {
        if (completion.kind !== "workflow" || !("state" in status) || status.state !== "done") {
            throw new Error(`${status.id} must have authoritative workflow lifecycle done before cleanup`)
        }
        return
    }
    if (
        completion.kind !== "tracker" ||
        completion.provider !== status.authority.provider ||
        "desired" in status.authority
    ) {
        throw new Error(`${status.id} requires confirmed tracker lifecycle done before cleanup`)
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
