import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { createEventBus, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"

import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import registerPr from "../workflows/extensions/pr/index.ts"
import { INCOMING_CHECKOUT_TOOLS } from "../workflows/extensions/pr/operations.ts"
import { IncomingCheckoutSchema, type IncomingCheckoutInput } from "../workflows/extensions/pr/checkout.ts"
import { withToolExecution } from "./extension-context-fixture.ts"
import { MCP_TOOL_CATALOG_EVENT } from "../extensions/__lib/mcp.ts"
import { minimalTracker } from "./workflow-phase-fixtures.ts"
import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"

function fixture(diverged = false) {
    const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "incoming-checkout-tool-")))
    const root = path.join(temp, "parent")
    const source = path.join(temp, "source")
    fs.mkdirSync(root)
    fs.mkdirSync(source)
    const globalConfig = path.join(temp, "global.gitconfig")
    fs.writeFileSync(globalConfig, "")
    const previous = {
        GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
        GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    }
    process.env.GIT_CONFIG_GLOBAL = globalConfig
    process.env.GIT_CONFIG_NOSYSTEM = "1"
    const git = (cwd: string, ...args: string[]) =>
        cp
            .execFileSync(
                "git",
                [
                    "-c",
                    "core.hooksPath=/dev/null",
                    "-c",
                    "core.fsmonitor=false",
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    ...args,
                ],
                { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
            )
            .trim()
    git(root, "init", "-b", "main")
    fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
    fs.writeFileSync(path.join(root, "README.md"), "parent\n")
    git(root, "add", ".")
    git(root, "commit", "-m", "parent")
    fs.mkdirSync(path.join(root, ".project"))
    fs.writeFileSync(path.join(root, ".project/config.json"), JSON.stringify({ branches: { format: "number-title" } }))
    const forge = { provider: "github", mcpServer: "fixture", repository: { owner: "upstream", repo: "app" } }
    fs.writeFileSync(
        path.join(root, ".project/integrations.json"),
        JSON.stringify({ tracker: minimalTracker(), forge }),
    )
    prepareArtifactPersistence(root)
    fs.writeFileSync(path.join(root, "README.md"), "parent staged\n")
    git(root, "add", "README.md")
    fs.appendFileSync(path.join(root, "README.md"), "parent unstaged\n")
    fs.writeFileSync(path.join(root, "untracked.txt"), "parent untracked\n")

    git(source, "init", "-b", "contributor")
    fs.mkdirSync(path.join(source, "src"))
    fs.writeFileSync(path.join(source, "src/example.lua"), "base\n")
    fs.writeFileSync(path.join(source, "removed.lua"), "remove me\n")
    fs.writeFileSync(path.join(source, ".gitignore"), "ignored/\n")
    fs.writeFileSync(
        path.join(source, ".gitattributes"),
        "*.lua filter=fixture diff=fixture\nignored/*.lua filter=secondary\n",
    )
    git(source, "add", ".")
    git(source, "commit", "-m", "base")
    const common = git(source, "rev-parse", "HEAD")
    fs.appendFileSync(path.join(source, "src/example.lua"), "contributor first\n")
    fs.rmSync(path.join(source, "removed.lua"))
    git(source, "add", "-A")
    git(source, "commit", "-m", "first contributor commit")
    const first = git(source, "rev-parse", "HEAD")
    fs.appendFileSync(path.join(source, "src/example.lua"), "contributor second\n")
    fs.mkdirSync(path.join(source, "ignored"))
    fs.writeFileSync(path.join(source, "ignored/added.lua"), "tracked ignored addition\n")
    fs.writeFileSync(path.join(source, "pr.txt"), "PR addition\n")
    git(source, "add", "src/example.lua", "pr.txt")
    git(source, "add", "-f", "ignored/added.lua")
    git(source, "commit", "-m", "second contributor commit")
    const head = git(source, "rev-parse", "HEAD")
    let base = common
    if (diverged) {
        git(source, "checkout", "-b", "upstream", common)
        fs.writeFileSync(path.join(source, "upstream.txt"), "upstream only\n")
        git(source, "add", "upstream.txt")
        git(source, "commit", "-m", "upstream advance")
        base = git(source, "rev-parse", "HEAD")
    }
    // Exercise production SSH URLs with real Git; only trusted fixture configuration
    // redirects the exact repositories. All other transport is blocked, never sent to GitHub.
    git(root, "config", "--file", globalConfig, "protocol.allow", "never")
    git(root, "config", "--file", globalConfig, "protocol.file.allow", "always")
    git(root, "config", "--file", globalConfig, `url.file://${source}.insteadOf`, "git@github.com:upstream/app.git")
    git(
        root,
        "config",
        "--file",
        globalConfig,
        "--add",
        `url.file://${source}.insteadOf`,
        "git@github.com:contributor/app.git",
    )
    const evidence = {
        tool: "mcp__fixture__pull_request_read",
        arguments: { method: "get", owner: "upstream", repo: "app", pullNumber: 12 },
        response: {
            number: 12,
            html_url: "https://github.com/upstream/app/pull/12",
            base: { ref: "main", sha: base, repo: { full_name: "upstream/app" } },
            head: { ref: "main", sha: head, repo: { full_name: "contributor/app" } },
        },
    }
    const tools: Parameters<ExtensionAPI["registerTool"]>[0][] = []
    const events = createEventBus()
    registerPr({
        events,
        on() {},
        registerTool: (tool: (typeof tools)[number]) => tools.push(tool),
        registerCommand: () => {},
    } as never)
    events.emit(MCP_TOOL_CATALOG_EVENT, workflowMcpCatalog("fixture"))
    const call = async (operation: IncomingCheckoutInput["operation"], selectedEvidence = evidence) => {
        const tool = tools.find((item) => item.name === INCOMING_CHECKOUT_TOOLS[operation])!
        assert.ok(tool, "The actual PR extension must register the selected operation")
        const input = { reference: "#12", evidence: selectedEvidence }
        assert.ok(Value.Check(tool.parameters, input), "Exercise the real registered schema")
        const result = await tool.execute(
            "fixture",
            input,
            undefined,
            undefined,
            withToolExecution({ cwd: root } as ExtensionContext),
        )
        return JSON.parse((result.content[0] as { text: string }).text)
    }
    const checkout = path.join(root, ".project/.local/pull-requests/12/checkout")
    const local = path.dirname(checkout)
    const parentState = () => ({
        head: git(root, "rev-parse", "HEAD"),
        branch: git(root, "branch", "--show-current"),
        status: git(root, "status", "--porcelain"),
        index: fs.readFileSync(path.join(root, ".git/index")),
        config: fs.readFileSync(path.join(root, ".git/config")),
        exclude: fs.readFileSync(path.join(root, ".git/info/exclude")),
        ignore: fs.readFileSync(path.join(root, ".gitignore")),
        readme: fs.readFileSync(path.join(root, "README.md")),
        untracked: fs.readFileSync(path.join(root, "untracked.txt")),
    })
    const nestedState = () => ({
        head: git(checkout, "rev-parse", "HEAD"),
        index: fs.readFileSync(path.join(checkout, ".git/index")),
        file: fs.readFileSync(path.join(checkout, "src/example.lua")),
        record: fs.readFileSync(path.join(local, "checkout.json")),
    })
    return {
        temp,
        root,
        source,
        checkout,
        local,
        common,
        head,
        base,
        first,
        git,
        evidence,
        call,
        parentState,
        nestedState,
        close() {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key]
                else process.env[key] = value
            }
            fs.rmSync(temp, { recursive: true, force: true })
        },
    }
}

describe("registered incoming PR checkout tool", () => {
    for (const diverged of [false, true])
        it(`owns the ${diverged ? "diverged" : "linear"} checkout and clean transition`, async () => {
            const f = fixture(diverged)
            try {
                const before = f.parentState()
                const prepared = await f.call("prepare")
                assert.equal(prepared.phase, "prepared")
                assert.equal(prepared.git.head, null)
                assert.equal(prepared.reviewBaseSha, f.common)
                assert.equal(prepared.revision.base.sha, f.base)
                assert.equal(prepared.paths.checkout.absolute, f.checkout)
                assert.equal(prepared.paths.checkout.relative, ".project/.local/pull-requests/12/checkout")
                assert.equal(fs.existsSync(path.join(f.checkout, "src")), false)
                assert.ok(fs.statSync(path.join(f.checkout, ".git")).isDirectory())
                assert.equal((await f.call("prepare")).phase, "prepared")
                const review = await f.call("checkout")
                assert.equal(review.phase, "contributorReview")
                assert.equal(review.git.head, f.common)
                assert.equal(review.git.detached, true)
                assert.equal(review.git.staged, true)
                assert.equal(review.git.unstaged, false)
                assert.equal(review.git.indexMatchesContributorHead, true)
                assert.deepEqual(review.git.untracked, [])
                const contribution = fs.readFileSync(review.paths.contributionDiff.absolute, "utf-8")
                assert.match(contribution, /contributor second/)
                assert.match(contribution, /deleted file/)
                assert.match(contribution, /tracked ignored addition/)
                assert.doesNotMatch(contribution, /upstream\.txt/)
                assert.equal(fs.readFileSync(review.paths.fixesDiff.absolute, "utf-8"), "")
                assert.equal((await f.call("checkout")).phase, "contributorReview")
                assert.equal((await f.call("inspect")).git.head, f.common)
                const fixes = await f.call("beginFixes")
                assert.equal(fixes.phase, "fixes")
                assert.equal(fixes.git.head, f.head)
                assert.equal(fixes.git.staged, false)
                assert.equal(fixes.git.unstaged, false)
                assert.equal(f.git(f.checkout, "rev-parse", "HEAD^"), f.first)
                fs.appendFileSync(path.join(f.checkout, "src/example.lua"), "our fix\n")
                fs.writeFileSync(path.join(f.checkout, "new.lua"), "new fix file\n")
                const draft = await f.call("inspect")
                assert.equal(draft.phase, "fixes")
                assert.equal(draft.git.head, f.head)
                assert.equal(draft.git.staged, false)
                assert.equal(draft.git.unstaged, true)
                assert.deepEqual(draft.git.untracked, ["new.lua"])
                assert.match(fs.readFileSync(draft.paths.fixesDiff.absolute, "utf-8"), /\+our fix/)
                assert.equal(fs.readFileSync(draft.paths.contributionDiff.absolute, "utf-8"), contribution)
                const draftBefore = f.nestedState()
                await f.call("beginFixes")
                await f.call("prepare")
                await assert.rejects(f.call("checkout"), /Cannot return to contributor review/)
                assert.deepEqual(f.nestedState(), draftBefore)
                assert.equal(draft.parent.verifiedUnchanged, true)
                assert.equal(
                    f.git(f.root, "check-ignore", path.relative(f.root, path.join(f.checkout, "src/example.lua"))),
                    path.relative(f.root, path.join(f.checkout, "src/example.lua")),
                )
                assert.deepEqual(f.parentState(), before)
            } finally {
                f.close()
            }
        })

    for (const change of ["tracked", "staged", "untracked", "ignored", "head", "revision"] as const)
        it(`preserves ${change} changes on refused transition`, async () => {
            const f = fixture(true)
            try {
                const parent = f.parentState()
                await f.call("prepare")
                await assert.rejects(f.call("beginFixes"), /Contributor review must finish/)
                await f.call("checkout")
                const selected = structuredClone(f.evidence)
                if (change === "tracked" || change === "staged") {
                    fs.appendFileSync(path.join(f.checkout, "src/example.lua"), "unexpected\n")
                    if (change === "staged") f.git(f.checkout, "add", "src/example.lua")
                }
                const extra = path.join(f.checkout, change === "ignored" ? "ignored/unexpected.txt" : "unexpected.txt")
                if (change === "untracked" || change === "ignored") fs.writeFileSync(extra, "preserve me\n")
                if (change === "head") f.git(f.checkout, "reset", "--soft", f.head)
                if (change === "revision") selected.response.base.sha = f.common
                const before = f.nestedState()
                await assert.rejects(f.call("beginFixes", selected), /changed|Expected detached/)
                assert.deepEqual(f.nestedState(), before)
                if (change === "untracked" || change === "ignored")
                    assert.equal(fs.readFileSync(extra, "utf-8"), "preserve me\n")
                assert.deepEqual(f.parentState(), parent)
            } finally {
                f.close()
            }
        })

    it("suppresses automatic Git helpers throughout actual tool operations", async () => {
        const f = fixture(true)
        try {
            const marker = path.join(f.temp, "marker.sh")
            const executed = path.join(f.temp, "executed")
            fs.writeFileSync(marker, `#!/bin/sh\nprintf ran >> '${executed}'\nexit 1\n`, { mode: 0o700 })
            const command = `sh '${marker}'`
            // Global filters apply even during the tool's first preparation operations.
            for (const [key, value] of [
                ["filter.fixture.process", command],
                ["filter.fixture.clean", command],
                ["filter.fixture.smudge", command],
                ["filter.fixture.required", "true"],
                ["filter.secondary.clean", command],
                ["filter.secondary.smudge", command],
                ["filter.secondary.required", "true"],
            ])
                f.git(f.root, "config", "--global", key, value)
            await f.call("prepare")
            for (const [key, value] of [
                ["core.fsmonitor", command],
                ["diff.external", command],
                ["diff.fixture.command", command],
                ["diff.fixture.textconv", command],
            ])
                f.git(f.checkout, "config", key, value)
            fs.mkdirSync(path.join(f.checkout, ".git/hooks"))
            fs.copyFileSync(marker, path.join(f.checkout, ".git/hooks/post-checkout"))
            fs.chmodSync(path.join(f.checkout, ".git/hooks/post-checkout"), 0o700)
            await f.call("checkout")
            await f.call("inspect")
            await f.call("beginFixes")
            fs.appendFileSync(path.join(f.checkout, "src/example.lua"), "fix\n")
            await f.call("inspect")
            assert.equal(fs.existsSync(executed), false)
        } finally {
            f.close()
        }
    })

    for (const kind of ["existing", "symlink", "dangling", "git-link", "environment", "failed-fetch"] as const)
        it(`refuses unsafe ${kind} setup and preserves parent/work`, async () => {
            const f = fixture()
            try {
                const before = f.parentState()
                if (kind === "environment") {
                    const original = process.env.GIT_INDEX_FILE
                    process.env.GIT_INDEX_FILE = path.join(f.root, ".git/index")
                    try {
                        await assert.rejects(f.call("prepare"), /inherited Git relocation/)
                    } finally {
                        if (original === undefined) delete process.env.GIT_INDEX_FILE
                        else process.env.GIT_INDEX_FILE = original
                    }
                } else if (kind === "failed-fetch") {
                    f.evidence.response.head.sha = "f".repeat(40)
                    await assert.rejects(f.call("prepare"), /preserved; parent repository verified unchanged/)
                    assert.equal(fs.existsSync(path.join(f.local, "checkout.json")), false)
                    assert.equal(fs.existsSync(path.join(f.checkout, "src")), false)
                    await assert.rejects(f.call("prepare"), /unmanaged checkout/)
                } else if (kind === "git-link") {
                    await f.call("prepare")
                    fs.renameSync(path.join(f.checkout, ".git"), path.join(f.temp, "saved-git"))
                    fs.writeFileSync(path.join(f.checkout, ".git"), `gitdir: ${path.join(f.root, ".git")}\n`)
                    await assert.rejects(f.call("checkout"), /own real .git/)
                } else {
                    fs.mkdirSync(f.local, { recursive: true })
                    if (kind === "existing") {
                        fs.mkdirSync(f.checkout)
                        fs.writeFileSync(path.join(f.checkout, "keep.txt"), "keep\n")
                    } else fs.symlinkSync(kind === "symlink" ? f.root : path.join(f.temp, "nonexistent"), f.checkout)
                    await assert.rejects(f.call("prepare"), /unmanaged checkout|symlinks/)
                    if (kind === "existing")
                        assert.equal(fs.readFileSync(path.join(f.checkout, "keep.txt"), "utf-8"), "keep\n")
                }
                assert.deepEqual(f.parentState(), before)
            } finally {
                f.close()
            }
        })

    it("serializes parallel preparation through the registered handler", async () => {
        const f = fixture(true)
        try {
            const before = f.parentState()
            const results = await Promise.all([f.call("prepare"), f.call("prepare")])
            for (const result of results) {
                assert.equal(result.phase, "prepared")
                assert.equal(result.phaseValid, true)
                assert.equal(result.reviewBaseSha, f.common)
                assert.equal(fs.readFileSync(result.paths.fixesDiff.absolute, "utf-8"), "")
            }
            assert.equal(fs.existsSync(path.join(f.checkout, "src")), false)
            assert.deepEqual(f.parentState(), before)
        } finally {
            f.close()
        }
    })

    it("validates actual configured provider identity before creating a checkout", async () => {
        const f = fixture()
        try {
            const before = f.parentState()
            for (const kind of ["server", "repository", "number", "missing-head"] as const) {
                const selected = structuredClone(f.evidence)
                if (kind === "server") selected.tool = "mcp__other__pull_request_read"
                if (kind === "repository") selected.arguments.owner = "other"
                if (kind === "number") selected.response.number = 13
                if (kind === "missing-head") selected.response.head.repo = null as never
                await assert.rejects(f.call("prepare", selected), /evidence|Missing head repository/)
                assert.equal(fs.existsSync(f.checkout), false)
            }
            assert.deepEqual(f.parentState(), before)
        } finally {
            f.close()
        }
    })

    it("rejects arbitrary commands, paths and caller-selected revisions in the registered schema", () => {
        const input = {
            operation: "prepare",
            reference: "#12",
            evidence: { tool: "read", arguments: {}, response: {} },
        }
        for (const extra of [
            { directory: "/tmp/other" },
            { command: "reset --hard" },
            { headSha: "a".repeat(40) },
            { approved: true },
        ])
            assert.equal(Value.Check(IncomingCheckoutSchema, { ...input, ...extra }), false)
    })
})
