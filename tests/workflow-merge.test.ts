import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { Value } from "typebox/value"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { buildIntegrationContext, IntegrationContextSchema } from "../workflows/extensions/integrations/index.ts"
import { finishReadDecision } from "../workflows/extensions/integrations/resource-id-operations.ts"
import { planGitHubMerge, type GitHubMergeSubject } from "../workflows/extensions/integrations/forge/github/merge.ts"

import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"

const mcpTools = workflowMcpCatalog("forge")

const repository = { owner: "upstream", repo: "app" }
const sha = "a".repeat(40)
const baseSha = "b".repeat(40)
const scope = {
    kind: "github-pull-request" as const,
    entityId: "GIG-01M57ACGTF",
    mcpServer: "forge",
    repository,
    head: "source",
    target: "main",
}
const subject: GitHubMergeSubject = {
    mcpServer: "forge",
    repository,
    number: 12,
    base: "main",
    head: { repository, ref: "source" },
    expectedHeadSha: sha,
}
function evidence(fork = false) {
    return {
        tool: "mcp__forge__pull_request_read",
        arguments: { method: "get", ...repository, pullNumber: 12 },
        response: {
            number: 12,
            html_url: "https://github.com/upstream/app/pull/12",
            state: "open",
            draft: false,
            merged: false,
            merged_at: null as string | null,
            base: { ref: "main", sha: baseSha, repo: { full_name: "upstream/app" } },
            head: { ref: "source", sha, repo: { full_name: fork ? "contributor/app" : "upstream/app" } },
        },
    }
}
function fixture(artifacts: "versioned" | "unversioned") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shared-merge-")))
    const git = (...args: string[]) =>
        cp.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim()
    git("init", "-q", "-b", "main")
    fs.writeFileSync(path.join(root, ".gitignore"), ".project/**/.local/\n")
    fs.writeFileSync(path.join(root, "README.md"), "Fixture\n")
    git("add", ".")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture")
    fs.mkdirSync(path.join(root, ".project"))
    fs.writeFileSync(
        path.join(root, ".project/config.json"),
        JSON.stringify({ artifacts, branches: { format: "identifier" } }),
    )
    fs.writeFileSync(
        path.join(root, ".project/integrations.json"),
        JSON.stringify({ forge: { provider: "github", mcpServer: "forge", repository } }),
    )
    prepareArtifactPersistence(root)
    const plan = (reviewed = evidence(), current = reviewed) =>
        buildIntegrationContext(
            { cwd: root } as never,
            {
                operation: "incomingPullRequestMerge",
                reference: "#12",
                reviewedEvidence: reviewed,
                evidence: current,
            },
            mcpTools,
        ).merge
    const snapshot = () => ({
        head: git("rev-parse", "HEAD"),
        branch: git("branch", "--show-current"),
        index: fs.readFileSync(path.join(root, ".git/index")),
        status: git("status", "--porcelain"),
    })
    return { root, plan, snapshot, close: () => fs.rmSync(root, { recursive: true, force: true }) }
}

describe("one repository merge operation", () => {
    for (const mode of ["versioned", "unversioned"] as const)
        it(`gives Deliverable and incoming ${mode} callers the same pinned squash operation`, () => {
            const f = fixture(mode)
            try {
                const read = evidence()
                const before = f.snapshot()
                const expected = {
                    state: "merge-needed",
                    arguments: { ...repository, pullNumber: 12, merge_method: "squash", expectedHeadSha: sha },
                }
                assert.deepEqual(planGitHubMerge(subject, read, mcpTools), expected)
                assert.deepEqual(finishReadDecision(scope, read, sha, 12, mcpTools), expected)
                assert.deepEqual(f.plan(read), expected)
                assert.equal(fs.existsSync(path.join(f.root, ".project/gigs")), false)
                assert.deepEqual(f.snapshot(), before)
            } finally {
                f.close()
            }
        })

    it("keeps incoming fork addressing separate from the Deliverable branch association", () => {
        const f = fixture("versioned")
        try {
            const read = evidence(true)
            const incoming = f.plan(read)
            assert.equal(incoming.state, "merge-needed")
            if (incoming.state !== "merge-needed") assert.fail("incoming merge expected")
            assert.deepEqual(incoming.arguments, {
                ...repository,
                pullNumber: 12,
                merge_method: "squash",
                expectedHeadSha: sha,
            })
            assert.equal(finishReadDecision(scope, read, sha, 12, mcpTools).state, "blocked")
        } finally {
            f.close()
        }
    })

    it("reuses complete merged proof through both callers even after the target advances", () => {
        const f = fixture("versioned")
        try {
            const reviewed = evidence()
            const merged = evidence()
            merged.response.state = "closed"
            merged.response.merged = true
            merged.response.merged_at = "2026-10-21T12:00:00Z"
            merged.response.base.sha = "c".repeat(40)
            const decision = planGitHubMerge(subject, merged, mcpTools)
            assert.equal(decision.state, "merged")
            assert.deepEqual(finishReadDecision(scope, merged, sha, 12, mcpTools), decision)
            assert.deepEqual(f.plan(reviewed, merged), decision)
            merged.response.merged_at = null
            assert.equal(f.plan(reviewed, merged).state, "blocked")
        } finally {
            f.close()
        }
    })

    it("blocks changed reviewed heads, base revisions and addressing", () => {
        const f = fixture("versioned")
        try {
            const reviewed = evidence(true)
            for (const change of ["head", "base", "ref", "repository"] as const) {
                const current = evidence(true)
                if (change === "head") current.response.head.sha = "c".repeat(40)
                if (change === "base") current.response.base.sha = "c".repeat(40)
                if (change === "ref") current.response.head.ref = "other"
                if (change === "repository") current.response.head.repo.full_name = "other/app"
                assert.equal(f.plan(reviewed, current).state, "blocked", change)
            }
        } finally {
            f.close()
        }
    })

    it("blocks unverified provider identity, closed/draft state and unknown merge outcomes", () => {
        for (const change of ["server", "number", "url", "head", "draft", "closed", "unknown"] as const) {
            const read = evidence()
            if (change === "server") read.tool = "mcp__other__pull_request_read"
            if (change === "number") read.arguments.pullNumber = 99
            if (change === "url") read.response.html_url = "https://github.com/other/app/pull/12"
            if (change === "head") read.response.head.sha = "c".repeat(40)
            if (change === "draft") read.response.draft = true
            if (change === "closed") read.response.state = "closed"
            if (change === "unknown") delete (read.response as Partial<typeof read.response>).merged
            assert.equal(planGitHubMerge(subject, read, mcpTools).state, "blocked", change)
        }
    })

    it("accepts no incoming method override or invented workflow entity", () => {
        const input = {
            operation: "incomingPullRequestMerge",
            reference: "#12",
            reviewedEvidence: evidence(),
            evidence: evidence(),
        }
        assert.equal(Value.Check(IntegrationContextSchema, input), true)
        for (const extra of [{ merge_method: "merge" }, { method: "rebase" }, { entityDir: "fake" }])
            assert.equal(Value.Check(IntegrationContextSchema, { ...input, ...extra }), false)
    })
})
