import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { runDeliveryCleanup } from "../workflows/extensions/deliverable/cleanup.ts"
import registerDeliverable from "../workflows/extensions/deliverable/index.ts"
import { readEntityStatus } from "../workflows/extensions/__lib/entity.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { initializeEntity } from "../workflows/extensions/init/entity.ts"

function repository(withOrigin = true) {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-cleanup-"))
    const root = path.join(parent, "work")
    const origin = path.join(parent, "origin.git")
    fs.mkdirSync(root)
    if (withOrigin) git(parent, ["init", "--bare", origin])
    git(root, ["init", "-b", "main"])
    git(root, ["config", "user.email", "test@example.com"])
    git(root, ["config", "user.name", "Test"])
    fs.writeFileSync(path.join(root, "README.md"), "base\n")
    fs.writeFileSync(path.join(root, ".gitignore"), ".project/**/.local/\n")
    git(root, ["add", "README.md", ".gitignore"])
    git(root, ["commit", "-m", "initial"])
    if (withOrigin) {
        git(root, ["remote", "add", "origin", origin])
        git(root, ["push", "-u", "origin", "main"])
    }
    fs.mkdirSync(path.join(root, ".project"), { recursive: true })
    fs.writeFileSync(
        path.join(root, ".project", "config.json"),
        JSON.stringify({ artifacts: "versioned", branches: { format: "identifier" } }),
    )
    prepareArtifactPersistence(root)
    return { parent, root, origin }
}

function createDoneGig(root: string, withPullRequest: boolean) {
    const gig = initializeEntity(
        {
            entity: "gig",
            title: "Cleanup",
            slug: "cleanup",
            request: "Clean the merged branch",
            priority: "not set",
            source: { mode: "new" },
            kind: "chore",
        },
        { cwd: root, now: new Date("2026-01-02T03:04:00.000Z") },
    )
    const status = readEntityStatus(path.join(root, gig.directory))
    if (status.branch.state !== "ready") assert.fail("expected ready branch")
    const metadataPath = path.join(root, gig.directory, "metadata.json")
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as Record<string, unknown>
    metadata.workStage = "execution"
    if (withPullRequest) {
        metadata.integrations = [
            {
                role: "forge",
                provider: "github",
                repository: { owner: "example", repo: "project" },
                head: status.branch.name,
                target: status.branch.target,
                state: "intent",
            },
        ]
        fs.writeFileSync(
            path.join(root, ".project/integrations.json"),
            JSON.stringify({
                forge: { provider: "github", mcpServer: "github", repository: { owner: "example", repo: "project" } },
            }),
        )
        fs.writeFileSync(
            path.join(root, gig.directory, ".local/metadata.json"),
            JSON.stringify({
                entityId: status.id,
                resourceIds: [
                    {
                        scope: {
                            entityId: status.id,
                            kind: "github-pull-request",
                            mcpServer: "github",
                            repository: { owner: "example", repo: "project" },
                            head: status.branch.name,
                            target: status.branch.target,
                        },
                        value: { number: 7, url: "https://github.com/example/project/pull/7" },
                    },
                ],
            }),
        )
    }
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
    fs.writeFileSync(
        path.join(root, gig.directory, ".local", "status.md"),
        '# Status\n\n```json\n{\n  "state": "done"\n}\n```\n',
    )
    return { directory: gig.directory, branch: status.branch.name, target: status.branch.target }
}

function commitBranch(root: string, branch: string, push = true) {
    git(root, ["switch", branch])
    fs.writeFileSync(path.join(root, "result.txt"), "reviewed result\n")
    git(root, ["add", "result.txt"])
    git(root, ["commit", "-m", "reviewed result"])
    if (push) git(root, ["push", "-u", "origin", branch])
}

function git(cwd: string, args: string[]): string {
    return cp.execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function cloneBranchExists(root: string, branch: string): boolean {
    return cp.spawnSync("git", ["show-ref", "--verify", `refs/heads/${branch}`], { cwd: root }).status === 0
}

describe("Deliverable branch cleanup", () => {
    it("registers cleanup under the Deliverable extension", () => {
        const tools: string[] = []
        registerDeliverable({
            registerTool: (tool: { name: string }) => tools.push(tool.name),
        } as unknown as ExtensionAPI)
        assert.deepEqual(tools, ["cleanup_delivery_branch"])
    })

    it("cleans a squash-merged branch in the current clone from verified GitHub PR evidence", () => {
        const { parent, root } = repository()
        try {
            const gig = createDoneGig(root, true)
            commitBranch(root, gig.branch)
            const headCommitSha = git(root, ["rev-parse", gig.branch])
            git(root, ["switch", gig.target])
            git(root, ["merge", "--squash", gig.branch])
            git(root, ["commit", "-m", "squash reviewed result"])
            git(root, ["push", "origin", gig.target])
            git(root, ["switch", gig.branch])
            fs.writeFileSync(path.join(root, "outside-git-notes.txt"), "keep me\n")
            fs.appendFileSync(path.join(root, "README.md"), "working-tree note\n")

            const input = {
                entityDir: gig.directory,
                completion: { kind: "workflow" as const },
                merge: {
                    kind: "github-pr" as const,
                    source: "pull_request_read:get" as const,
                    repository: { owner: "example", repo: "project" },
                    pullRequestNumber: 7,
                    merged: true as const,
                    mergedAt: "2026-01-02T04:00:00Z",
                    head: gig.branch,
                    headCommitSha,
                    base: gig.target,
                },
            }
            assert.throws(
                () =>
                    runDeliveryCleanup(
                        { ...input, merge: { ...input.merge, headCommitSha: "0".repeat(40) } },
                        { cwd: root },
                    ),
                /head commit does not match/,
            )
            assert.throws(
                () =>
                    runDeliveryCleanup(
                        { ...input, merge: { ...input.merge, repository: { owner: "other", repo: "project" } } },
                        { cwd: root },
                    ),
                /repository does not match/,
            )
            assert.throws(
                () => runDeliveryCleanup({ ...input, merge: { ...input.merge, base: "other" } }, { cwd: root }),
                /head\/base does not match/,
            )
            assert.throws(
                () => runDeliveryCleanup({ ...input, merge: { ...input.merge, head: "other" } }, { cwd: root }),
                /head\/base does not match/,
            )
            assert.throws(
                () => runDeliveryCleanup({ ...input, merge: { ...input.merge, pullRequestNumber: 8 } }, { cwd: root }),
                /locally recorded PR/,
            )
            assert.equal(cloneBranchExists(root, gig.branch), true)
            const applied = runDeliveryCleanup(input, { cwd: root })

            assert.equal(applied.targetCommit, git(root, ["rev-parse", "FETCH_HEAD"]))
            assert.equal(fs.existsSync(path.join(root, gig.directory, ".local/metadata.json")), true)
            assert.equal(applied.deletedBranch, gig.branch)
            assert.equal(git(root, ["branch", "--show-current"]), gig.target)
            assert.equal(cloneBranchExists(root, gig.branch), false)
            assert.equal(git(root, ["ls-remote", "--heads", "origin", gig.branch]).includes(gig.branch), true)
            assert.equal(fs.readFileSync(path.join(root, "outside-git-notes.txt"), "utf-8"), "keep me\n")
            assert.match(fs.readFileSync(path.join(root, "README.md"), "utf-8"), /working-tree note/)
        } finally {
            fs.rmSync(parent, { recursive: true, force: true })
        }
    })

    it("preserves a merged branch when origin is unavailable", () => {
        const { parent, root } = repository(false)
        try {
            const gig = createDoneGig(root, false)
            commitBranch(root, gig.branch, false)
            git(root, ["switch", gig.target])
            git(root, ["merge", "--ff-only", gig.branch])
            git(root, ["switch", gig.branch])
            assert.equal(git(root, ["remote"]), "")

            const input = {
                entityDir: gig.directory,
                completion: { kind: "workflow" as const },
                merge: { kind: "git-ancestry" as const },
            }
            assert.throws(() => runDeliveryCleanup(input, { cwd: root }), /git fetch.*origin/)
            assert.equal(git(root, ["branch", "--show-current"]), gig.branch)
            assert.equal(cloneBranchExists(root, gig.branch), true)
            assert.equal(git(root, ["remote"]), "")
        } finally {
            fs.rmSync(parent, { recursive: true, force: true })
        }
    })

    it("uses ancestry without a stored PR and preserves a branch that changed after merge", () => {
        const { parent, root } = repository()
        try {
            const gig = createDoneGig(root, false)
            commitBranch(root, gig.branch)
            git(root, ["switch", gig.target])
            git(root, ["merge", "--ff-only", gig.branch])
            git(root, ["push", "origin", gig.target])
            git(root, ["switch", gig.branch])

            const input = {
                entityDir: gig.directory,
                completion: { kind: "workflow" as const },
                merge: { kind: "git-ancestry" as const },
            }
            const branchCommit = git(root, ["rev-parse", gig.branch])
            fs.writeFileSync(path.join(root, "after-merge.txt"), "new commit in current clone\n")
            git(root, ["add", "after-merge.txt"])
            git(root, ["commit", "-m", "move branch after merge"])
            assert.throws(() => runDeliveryCleanup(input, { cwd: root }), /not merged into target/)
            assert.equal(cloneBranchExists(root, gig.branch), true)
            git(root, ["switch", gig.branch])
            git(root, ["reset", "--hard", branchCommit])
            runDeliveryCleanup(input, { cwd: root })
            assert.equal(cloneBranchExists(root, gig.branch), false)

            const epic = initializeEntity(
                {
                    entity: "epic",
                    title: "Permanent branch",
                    slug: "permanent-branch",
                    request: "Keep the Epic branch",
                    priority: "not set",
                    source: { mode: "new" },
                },
                { cwd: root, now: new Date("2026-01-02T04:00:00.000Z") },
            )
            assert.throws(
                () =>
                    runDeliveryCleanup(
                        {
                            entityDir: epic.directory,
                            completion: { kind: "workflow" },
                            merge: { kind: "git-ancestry" },
                        },
                        { cwd: root },
                    ),
                /Epic branches are permanent/,
            )
        } finally {
            fs.rmSync(parent, { recursive: true, force: true })
        }
    })

    it("preserves source and confirmed Done when the local target is ahead or diverged", () => {
        for (const diverged of [false, true]) {
            const { parent, root } = repository()
            try {
                const gig = createDoneGig(root, false)
                commitBranch(root, gig.branch)
                git(root, ["switch", gig.target])
                git(root, ["merge", "--ff-only", gig.branch])
                git(root, ["push", "origin", gig.target])
                fs.writeFileSync(path.join(root, "unpublished.txt"), "local work\n")
                git(root, ["add", "unpublished.txt"])
                git(root, ["commit", "-m", "unpublished target work"])
                const localTarget = git(root, ["rev-parse", gig.target])
                if (diverged) {
                    const other = path.join(parent, "other")
                    git(parent, ["clone", "-b", "main", path.join(parent, "origin.git"), other])
                    git(other, ["config", "user.name", "Other"])
                    git(other, ["config", "user.email", "other@example.com"])
                    git(other, ["commit", "--allow-empty", "-m", "another actor advanced origin"])
                    git(other, ["push", "origin", "main"])
                }
                git(root, ["switch", gig.branch])
                assert.throws(
                    () =>
                        runDeliveryCleanup(
                            {
                                entityDir: gig.directory,
                                completion: { kind: "workflow" },
                                merge: { kind: "git-ancestry" },
                            },
                            { cwd: root },
                        ),
                    diverged ? /git merge.*failed/ : /does not match freshly fetched origin/,
                )
                assert.equal(cloneBranchExists(root, gig.branch), true)
                assert.equal(git(root, ["rev-parse", gig.target]), localTarget)
                const status = readEntityStatus(path.join(root, gig.directory))
                assert.equal("state" in status && status.state, "done")
            } finally {
                fs.rmSync(parent, { recursive: true, force: true })
            }
        }
    })

    it("finishes an Epic-target Task on the synchronized Epic branch and leaves main untouched", () => {
        const { parent, root } = repository()
        try {
            const mainCommit = git(root, ["rev-parse", "main"])
            const epic = initializeEntity(
                {
                    entity: "epic",
                    title: "Umbrella",
                    slug: "umbrella",
                    request: "Deliver Tasks",
                    priority: "not set",
                    source: { mode: "new" },
                },
                { cwd: root, now: new Date("2026-01-02T05:00:00Z") },
            )
            if (epic.status.branch.state !== "ready") assert.fail("ready Epic required")
            const epicBranch = epic.status.branch.name
            fs.writeFileSync(
                path.join(root, epic.directory, "epic.md"),
                "# Epic\n\n## Ordered Tasks\n\n1. **Child** — implement it.\n",
            )
            git(root, ["push", "origin", epicBranch])
            const task = initializeEntity(
                {
                    entity: "task",
                    title: "Child",
                    slug: "child",
                    request: "Deliver the child",
                    priority: "not set",
                    source: { mode: "new" },
                    kind: "feature",
                    parentEpicDir: epic.directory,
                    epicItemTitle: "Child",
                },
                { cwd: root, now: new Date("2026-01-02T05:01:00Z") },
            )
            if (task.status.branch.state !== "ready") assert.fail("ready Task required")
            const taskBranch = task.status.branch.name
            const metadataPath = path.join(root, task.directory, "metadata.json")
            const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
            metadata.workStage = "execution"
            fs.writeFileSync(metadataPath, JSON.stringify(metadata))
            fs.writeFileSync(
                path.join(root, task.directory, ".local/status.md"),
                '# Status\n\n```json\n{"state":"done"}\n```\n',
            )
            commitBranch(root, taskBranch)
            git(root, ["switch", epicBranch])
            git(root, ["merge", "--ff-only", taskBranch])
            git(root, ["push", "origin", epicBranch])
            git(root, ["switch", taskBranch])
            const result = runDeliveryCleanup(
                { entityDir: task.directory, completion: { kind: "workflow" }, merge: { kind: "git-ancestry" } },
                { cwd: root },
            )
            assert.equal(result.target, epicBranch)
            assert.equal(git(root, ["branch", "--show-current"]), epicBranch)
            assert.equal(result.targetCommit, git(root, ["rev-parse", "FETCH_HEAD"]))
            assert.equal(git(root, ["rev-parse", "main"]), mainCommit)
            assert.equal(cloneBranchExists(root, epicBranch), true)
            assert.equal(cloneBranchExists(root, taskBranch), false)
            assert.match(git(root, ["ls-remote", "--heads", "origin", taskBranch]), new RegExp(taskBranch))
        } finally {
            fs.rmSync(parent, { recursive: true, force: true })
        }
    })

    it("accepts rebase delivery evidence without requiring source-commit ancestry", () => {
        const { parent, root } = repository()
        try {
            const gig = createDoneGig(root, true)
            commitBranch(root, gig.branch)
            const headCommitSha = git(root, ["rev-parse", gig.branch])
            git(root, ["switch", gig.target])
            git(root, ["commit", "--allow-empty", "-m", "advance target before rebase"])
            git(root, ["cherry-pick", headCommitSha])
            const rebasedCommitSha = git(root, ["rev-parse", "HEAD"])
            assert.notEqual(rebasedCommitSha, headCommitSha)
            git(root, ["push", "origin", gig.target])
            git(root, ["switch", gig.branch])
            const input = {
                entityDir: gig.directory,
                completion: { kind: "workflow" },
                merge: {
                    kind: "github-pr",
                    source: "pull_request_read:get",
                    repository: { owner: "example", repo: "project" },
                    pullRequestNumber: 7,
                    merged: true,
                    mergedAt: "2026-01-02T06:00:00Z",
                    head: gig.branch,
                    headCommitSha,
                    base: gig.target,
                },
            }
            for (const missingFacts of [
                { merged: false },
                { merged: undefined },
                { mergedAt: "" },
                { mergedAt: undefined },
            ]) {
                assert.throws(() =>
                    runDeliveryCleanup({ ...input, merge: { ...input.merge, ...missingFacts } }, { cwd: root }),
                )
                assert.equal(cloneBranchExists(root, gig.branch), true)
            }
            runDeliveryCleanup(input, { cwd: root })
            assert.equal(cloneBranchExists(root, gig.branch), false)
            assert.equal(git(root, ["branch", "--show-current"]), gig.target)
        } finally {
            fs.rmSync(parent, { recursive: true, force: true })
        }
    })

    it("preserves the branch and outside-Git file when switching would overwrite it", () => {
        const { parent, root } = repository()
        try {
            const gig = createDoneGig(root, false)
            const statusPath = path.join(root, gig.directory, ".local", "status.md")
            fs.writeFileSync(statusPath, '# Status\n\n```json\n{\n  "state": "inProgress"\n}\n```\n')
            assert.throws(
                () =>
                    runDeliveryCleanup(
                        {
                            entityDir: gig.directory,
                            completion: { kind: "workflow" },
                            merge: { kind: "git-ancestry" },
                        },
                        { cwd: root },
                    ),
                /lifecycle done/,
            )
            fs.writeFileSync(statusPath, '# Status\n\n```json\n{\n  "state": "done"\n}\n```\n')
            commitBranch(root, gig.branch)
            git(root, ["switch", gig.target])
            git(root, ["merge", "--ff-only", gig.branch])
            fs.writeFileSync(path.join(root, "target-only.txt"), "remote target\n")
            git(root, ["add", "target-only.txt"])
            git(root, ["commit", "-m", "target update"])
            git(root, ["push", "origin", gig.target])
            git(root, ["switch", gig.branch])
            fs.writeFileSync(path.join(root, "target-only.txt"), "outside Git\n")

            const input = {
                entityDir: gig.directory,
                completion: { kind: "workflow" as const },
                merge: { kind: "git-ancestry" as const },
            }
            assert.throws(() => runDeliveryCleanup(input, { cwd: root }), /git switch main failed/)
            assert.equal(cloneBranchExists(root, gig.branch), true)
            assert.equal(fs.readFileSync(path.join(root, "target-only.txt"), "utf-8"), "outside Git\n")
            const status = readEntityStatus(path.join(root, gig.directory))
            if (!("state" in status)) assert.fail("expected workflow lifecycle")
            assert.equal(status.state, "done")
        } finally {
            fs.rmSync(parent, { recursive: true, force: true })
        }
    })
})
