import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { createEventBus, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"
import registerPr from "../workflows/extensions/pr/index.ts"
import { INCOMING_CHECKOUT_TOOLS } from "../workflows/extensions/pr/operations.ts"
import type { IncomingCheckoutInput } from "../workflows/extensions/pr/checkout.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { withToolExecution } from "./extension-context-fixture.ts"
import { MCP_TOOL_CATALOG_EVENT } from "../extensions/__lib/mcp.ts"
import { workflowMcpCatalog } from "./mcp-catalog-fixture.ts"

type Kind = "clean" | "conflict" | "multiple" | "merged" | "alreadyApplied" | "customDriver" | "literalPath"
function fixture(kind: Kind = "clean") {
    const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "incoming-rebase-")))
    const root = path.join(temp, "parent")
    const source = path.join(temp, "source")
    const baseRemote = path.join(temp, "base.git")
    const forkRemote = path.join(temp, "fork.git")
    const global = path.join(temp, "global.gitconfig")
    fs.mkdirSync(root)
    fs.mkdirSync(source)
    fs.writeFileSync(global, "")
    const previous = {
        GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
        GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    }
    process.env.GIT_CONFIG_GLOBAL = global
    process.env.GIT_CONFIG_NOSYSTEM = "1"
    const git = (cwd: string, ...args: string[]) =>
        cp
            .execFileSync(
                "git",
                ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", ...args],
                { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
            )
            .trim()
    git(root, "config", "--global", "user.name", "Fixture")
    git(root, "config", "--global", "user.email", "fixture@example.invalid")
    git(root, "init", "-b", "main")
    fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
    fs.writeFileSync(path.join(root, "README.md"), "parent\n")
    git(root, "add", ".")
    git(root, "commit", "-m", "parent")
    fs.mkdirSync(path.join(root, ".project"))
    const forge = { provider: "github", mcpServer: "fixture", repository: { owner: "upstream", repo: "app" } }
    fs.writeFileSync(
        path.join(root, ".project/config.json"),
        JSON.stringify({ branches: { format: "identifier" } }),
    )
    fs.writeFileSync(path.join(root, ".project/integrations.json"), JSON.stringify({ forge }))
    prepareArtifactPersistence(root)
    fs.writeFileSync(path.join(root, "README.md"), "parent staged\n")
    git(root, "add", "README.md")
    fs.appendFileSync(path.join(root, "README.md"), "parent unstaged\n")
    fs.writeFileSync(path.join(root, "untracked.txt"), "parent untracked\n")
    git(source, "init", "-b", "main")
    fs.writeFileSync(path.join(source, "file.txt"), "base\n")
    fs.writeFileSync(path.join(source, "other.txt"), "other base\n")
    fs.writeFileSync(path.join(source, ".gitignore"), "ignored/\n")
    if (kind === "literalPath") fs.writeFileSync(path.join(source, "*"), "literal base\n")
    if (kind === "customDriver")
        fs.writeFileSync(path.join(source, ".gitattributes"), "file.txt merge=blocked filter=blocked diff=blocked\n")
    git(source, "add", ".")
    git(source, "commit", "-m", "common")
    const common = git(source, "rev-parse", "HEAD")
    git(temp, "clone", "--bare", source, baseRemote)
    fs.writeFileSync(path.join(source, "file.txt"), "contributor first\n")
    git(source, "add", "file.txt")
    if (kind === "literalPath") {
        fs.writeFileSync(path.join(source, "*"), "contributor literal\n")
        git(source, "--literal-pathspecs", "add", "--", "*")
    }
    git(source, "commit", "-m", "contributor first")
    const first = git(source, "rev-parse", "HEAD")
    fs.writeFileSync(path.join(source, "other.txt"), "contributor second\n")
    git(source, "add", "other.txt")
    git(source, "commit", "-m", "contributor second")
    if (kind === "merged") {
        git(source, "checkout", "-b", "side", common)
        fs.writeFileSync(path.join(source, "side.txt"), "side contribution\n")
        git(source, "add", "side.txt")
        git(source, "commit", "-m", "side contribution")
        git(source, "checkout", "main")
        git(source, "merge", "--no-ff", "side", "-m", "merge side branch")
    }
    const head = git(source, "rev-parse", "HEAD")
    git(temp, "clone", "--bare", source, forkRemote)
    git(source, "checkout", "-b", "upstream", common)
    if (kind === "alreadyApplied") {
        git(source, "cherry-pick", "-x", first)
        assert.notEqual(
            git(source, "rev-parse", "HEAD"),
            first,
            "Upstream has an equivalent patch, not the exact contributor commit",
        )
    }
    if (["conflict", "multiple", "customDriver"].includes(kind))
        fs.writeFileSync(path.join(source, "file.txt"), "upstream first\n")
    if (kind === "multiple") fs.writeFileSync(path.join(source, "other.txt"), "upstream second\n")
    if (kind === "literalPath") fs.writeFileSync(path.join(source, "*"), "upstream literal\n")
    fs.writeFileSync(path.join(source, "upstream.txt"), "upstream addition\n")
    git(source, "add", ".")
    git(source, "commit", "-m", "target advanced")
    const target = git(source, "rev-parse", "HEAD")
    git(source, "push", baseRemote, "HEAD:refs/heads/main")
    git(root, "config", "--global", "protocol.allow", "never")
    git(root, "config", "--global", "protocol.file.allow", "always")
    git(root, "config", "--global", `url.file://${baseRemote}.insteadOf`, "git@github.com:upstream/app.git")
    git(root, "config", "--global", `url.file://${forkRemote}.insteadOf`, "git@github.com:contributor/app.git")
    const evidence = {
        tool: "mcp__fixture__pull_request_read",
        arguments: { method: "get", owner: "upstream", repo: "app", pullNumber: 12 },
        response: {
            number: 12,
            state: "open",
            draft: false,
            merged: false,
            merged_at: null as string | null,
            html_url: "https://github.com/upstream/app/pull/12",
            base: { ref: "main", sha: common, repo: { full_name: "upstream/app" } },
            head: { ref: "main", sha: head, repo: { full_name: "contributor/app" } },
        },
    }
    const originalEvidence = structuredClone(evidence)
    const tools: Parameters<ExtensionAPI["registerTool"]>[0][] = []
    const events = createEventBus()
    registerPr({
        events,
        on() {},
        registerCommand: () => {},
        registerTool: (tool: (typeof tools)[number]) => tools.push(tool),
    } as never)
    events.emit(MCP_TOOL_CATALOG_EVENT, workflowMcpCatalog("fixture", "board"))
    const call = async (operation: IncomingCheckoutInput["operation"], extra: object = {}) => {
        const tool = tools.find((entry) => entry.name === INCOMING_CHECKOUT_TOOLS[operation])!
        const input = { reference: "#12", evidence, ...extra }
        assert.ok(Value.Check(tool.parameters, input))
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
    const record = () => JSON.parse(fs.readFileSync(path.join(path.dirname(checkout), "checkout.json"), "utf-8"))
    const ready = async () => {
        await call("prepare")
        await call("checkout")
        await call("beginFixes")
    }
    const rebase = async () => {
        const observation = await call("observeTarget")
        return call("rebase", {
            targetSha: observation.observation.targetSha,
            expectedHeadSha: observation.observation.headSha,
        })
    }
    const parent = () => ({
        head: git(root, "rev-parse", "HEAD"),
        branch: git(root, "branch", "--show-current"),
        status: git(root, "status", "--porcelain"),
        index: fs.readFileSync(path.join(root, ".git/index")),
        config: fs.readFileSync(path.join(root, ".git/config")),
        readme: fs.readFileSync(path.join(root, "README.md")),
        untracked: fs.readFileSync(path.join(root, "untracked.txt")),
    })
    const nested = () => ({
        head: git(checkout, "rev-parse", "HEAD"),
        index: fs.readFileSync(path.join(checkout, ".git/index")),
        record: fs.readFileSync(path.join(path.dirname(checkout), "checkout.json")),
    })
    const forkHead = () => git(forkRemote, "rev-parse", "refs/heads/main")
    const contributorUpdate = () => {
        git(source, "checkout", "-b", "contributor-update", head)
        fs.writeFileSync(path.join(source, "contributor-new.txt"), "new remote work\n")
        git(source, "add", "contributor-new.txt")
        git(source, "commit", "-m", "new remote contribution")
        git(source, "push", forkRemote, "HEAD:refs/heads/main")
        return forkHead()
    }
    return {
        temp,
        root,
        source,
        baseRemote,
        forkRemote,
        global,
        checkout,
        common,
        head,
        target,
        evidence,
        originalEvidence,
        git,
        call,
        record,
        ready,
        rebase,
        parent,
        nested,
        forkHead,
        contributorUpdate,
        close() {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key]
                else process.env[key] = value
            }
            fs.rmSync(temp, { recursive: true, force: true })
        },
    }
}

describe("registered incoming PR standard rebase and immediate leased update", () => {
    it("uses existing SSH authentication for preparation, target fetch, observation and publication", async () => {
        const f = fixture()
        const previousSsh = process.env.GIT_SSH_COMMAND
        const previousVariant = process.env.GIT_SSH_VARIANT
        try {
            for (const remote of [f.baseRemote, f.forkRemote])
                f.git(f.root, "config", "--global", "--unset-all", `url.file://${remote}.insteadOf`)
            f.git(f.root, "config", "--global", "protocol.ssh.allow", "always")
            const realGit = cp.execFileSync("which", ["git"], { encoding: "utf-8" }).trim()
            const ssh = path.join(f.temp, "ssh.cjs")
            const log = path.join(f.temp, "ssh-arguments.jsonl")
            fs.writeFileSync(
                ssh,
                `
const cp = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const command = /^(git-upload-pack|git-receive-pack) '(upstream|contributor)\\/app\\.git'$/.exec(args.at(-1));
if (args.at(-2) !== 'git@github.com' || !command) process.exit(1);
const repository = command[2] === 'upstream' ? ${JSON.stringify(f.baseRemote)} : ${JSON.stringify(f.forkRemote)};
const result = cp.spawnSync(${JSON.stringify(realGit)}, [command[1].slice(4), repository], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
`,
            )
            const authentication = `${JSON.stringify(process.execPath)} ${JSON.stringify(ssh)}`
            process.env.GIT_SSH_COMMAND = authentication
            process.env.GIT_SSH_VARIANT = "ssh"
            const parent = f.parent()
            const global = fs.readFileSync(f.global)
            await f.ready()
            const result = await f.rebase()
            assert.equal(result.rebase.publication.kind, "confirmed")
            assert.equal(f.forkHead(), result.rebase.resultSha)
            const calls: string[][] = fs
                .readFileSync(log, "utf-8")
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line))
            assert.ok(calls.every((args) => args.at(-2) === "git@github.com"))
            for (const command of [
                "git-upload-pack 'upstream/app.git'",
                "git-upload-pack 'contributor/app.git'",
                "git-receive-pack 'contributor/app.git'",
            ])
                assert.ok(
                    calls.some((args) => args.at(-1) === command),
                    command,
                )
            assert.equal(process.env.GIT_SSH_COMMAND, authentication)
            assert.deepEqual(fs.readFileSync(f.global), global)
            assert.deepEqual(f.parent(), parent)
        } finally {
            if (previousSsh === undefined) delete process.env.GIT_SSH_COMMAND
            else process.env.GIT_SSH_COMMAND = previousSsh
            if (previousVariant === undefined) delete process.env.GIT_SSH_VARIANT
            else process.env.GIT_SSH_VARIANT = previousVariant
            f.close()
        }
    })

    it(`recovers a saved HTTPS-failed result using SSH and its original lease`, async () => {
        const f = fixture()
        const previousPath = process.env.PATH
        try {
            const headRef = "feature/visible-agent-status"
            const ref = `refs/heads/${headRef}`
            f.git(f.forkRemote, "update-ref", ref, f.head)
            f.git(f.forkRemote, "update-ref", "-d", "refs/heads/main")
            f.evidence.response.head.ref = headRef
            await f.ready()
            await f.call("observeTarget")
            // Construct the existing completed-but-unpublished fixture, not another
            // recovery route: only publishRebase below exercises the tool under test.
            f.git(f.checkout, "fetch", f.baseRemote, f.target)
            f.git(f.checkout, "rebase", f.target)
            const resultSha = f.git(f.checkout, "rev-parse", "HEAD")
            const saved = f.record()
            delete saved.publishedRebase
            saved.phase = "rebased"
            saved.rebase = {
                sourceSha: f.head,
                targetSha: f.target,
                leaseSha: f.head,
                resultSha,
                publication: { kind: "rejected", observedHead: f.head },
            }
            saved.messages = ["fatal: could not read Username for 'https://github.com': terminal prompts disabled"]
            fs.writeFileSync(path.join(path.dirname(f.checkout), "checkout.json"), JSON.stringify(saved))
            const before = f.nested()
            const config = fs.readFileSync(path.join(f.checkout, ".git/config"))
            const global = fs.readFileSync(f.global)
            const files = ["file.txt", "other.txt", "upstream.txt"].map((file) =>
                fs.readFileSync(path.join(f.checkout, file)),
            )
            const parent = f.parent()
            const realGit = cp.execFileSync("which", ["git"], { encoding: "utf-8" }).trim()
            const bin = path.join(f.temp, "recovery-bin")
            const log = path.join(f.temp, "recovery-arguments.jsonl")
            fs.mkdirSync(bin)
            fs.writeFileSync(
                path.join(bin, "git"),
                `#!${process.execPath}
const cp = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args.some(arg => ['init', 'fetch', 'checkout', 'reset', 'rebase'].includes(arg))) process.exit(1);
const result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
`,
                { mode: 0o700 },
            )
            process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
            const recovered = await f.call("publishRebase")
            assert.equal(recovered.phase, "fixes")
            assert.equal(recovered.phaseValid, true)
            assert.deepEqual(recovered.rebase, {
                ...saved.rebase,
                publication: { kind: "confirmed", headSha: resultSha },
            })
            assert.equal(f.git(f.forkRemote, "rev-parse", ref), resultSha)
            assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), before.head)
            assert.deepEqual(fs.readFileSync(path.join(f.checkout, ".git/index")), before.index)
            assert.deepEqual(fs.readFileSync(path.join(f.checkout, ".git/config")), config)
            assert.deepEqual(
                ["file.txt", "other.txt", "upstream.txt"].map((file) =>
                    fs.readFileSync(path.join(f.checkout, file)),
                ),
                files,
            )
            assert.deepEqual(f.record().evidence, saved.evidence)
            assert.deepEqual(f.record().revision, saved.revision)
            assert.deepEqual(f.record().observation, saved.observation)
            assert.deepEqual(fs.readFileSync(f.global), global)
            assert.deepEqual(f.parent(), parent)
            const calls: string[][] = fs
                .readFileSync(log, "utf-8")
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line))
            assert.ok(
                calls.every(
                    (args) => !args.some((arg) => ["init", "fetch", "checkout", "reset", "rebase"].includes(arg)),
                ),
            )
            const transport = calls.filter((args) => args.includes("ls-remote") || args.includes("push"))
            assert.equal(transport.length, 3)
            assert.ok(transport.every((args) => args.includes("git@github.com:contributor/app.git")))
            const pushes = transport.filter((args) => args.includes("push"))
            assert.equal(pushes.length, 1)
            assert.ok(pushes[0].includes(`--force-with-lease=${ref}:${f.head}`))
            assert.ok(pushes[0].includes(`${resultSha}:${ref}`))
            assert.equal(pushes[0].includes("--force"), false)
        } finally {
            if (previousPath === undefined) delete process.env.PATH
            else process.env.PATH = previousPath
            f.close()
        }
    })

    it(`rebases and immediately updates the fork before fixes`, async () => {
        const f = fixture()
        try {
            const parent = f.parent()
            await f.ready()
            const observed = await f.call("observeTarget")
            assert.equal(observed.revision.base.sha, f.common)
            assert.equal(observed.observation.targetSha, f.target)
            assert.equal(observed.observation.headSha, f.head)
            assert.notEqual(f.common, f.target)
            const result = await f.call("rebase", { targetSha: f.target, expectedHeadSha: f.head })
            assert.equal(result.phase, "fixes")
            assert.equal(result.phaseValid, true)
            assert.equal(result.rebase.publication.kind, "confirmed")
            assert.equal(result.rebase.leaseSha, f.head)
            assert.notEqual(result.baselineSha, f.head)
            assert.equal(f.forkHead(), result.baselineSha)
            assert.equal(f.git(f.baseRemote, "rev-parse", "refs/heads/main"), f.target)
            assert.equal(f.git(f.checkout, "merge-base", "--is-ancestor", f.target, result.baselineSha), "")
            assert.equal(f.git(f.checkout, "rev-list", "--count", `${f.target}..HEAD`), "2")
            assert.equal(
                f.git(f.checkout, "log", "--format=%an <%ae>", `${f.target}..HEAD`),
                "Fixture <fixture@example.invalid>\nFixture <fixture@example.invalid>",
            )
            assert.deepEqual(f.record().evidence, f.originalEvidence)
            assert.equal(result.revision.head.sha, f.head)
            assert.equal(result.providerRevision.head.sha, f.head, "No fabricated provider response after push")
            f.evidence.response.head.sha = f.forkHead()
            f.evidence.response.base.sha = f.target
            const fresh = await f.call("inspect")
            assert.equal(fresh.providerHeadMatchesBaseline, true)
            fs.appendFileSync(path.join(f.checkout, "file.txt"), "our later fix\n")
            const fixed = await f.call("inspect")
            assert.equal(fixed.git.staged, false)
            assert.match(fs.readFileSync(fixed.paths.fixesDiff.absolute, "utf-8"), /\+our later fix/)
            assert.equal(f.forkHead(), result.baselineSha, "Later fixes are not automatically published")
            assert.deepEqual(f.parent(), parent)
        } finally {
            f.close()
        }
    })
    it(`exposes conflicts and publishes immediately after approved resolution`, async () => {
        const f = fixture("conflict")
        try {
            const parent = f.parent()
            await f.ready()
            const conflict = await f.rebase()
            assert.equal(conflict.phase, "rebasing")
            assert.equal(conflict.phaseValid, true)
            assert.equal(conflict.git.native.targetSha, f.target)
            assert.deepEqual(
                [...new Set(conflict.git.unmerged.map((entry: { path: string }) => entry.path))],
                ["file.txt"],
            )
            assert.match(fs.readFileSync(conflict.paths.conflictsDiff.absolute, "utf-8"), /file\.txt/)
            assert.equal(f.forkHead(), f.head)
            assert.equal((await f.call("inspect")).phase, "rebasing")
            fs.writeFileSync(path.join(f.checkout, "file.txt"), "approved combined resolution\n")
            const published = await f.call("continueRebase", { resolutionPaths: ["file.txt"] })
            assert.equal(published.phase, "fixes")
            assert.equal(published.rebase.publication.kind, "confirmed")
            assert.equal(f.forkHead(), published.baselineSha)
            assert.deepEqual(published.git.unmerged, [])
            assert.equal(published.git.staged, false)
            assert.equal(published.git.unstaged, false)
            assert.deepEqual(f.record().evidence, f.originalEvidence)
            assert.deepEqual(f.parent(), parent)
        } finally {
            f.close()
        }
    })

    it("continues multiple conflicts without publishing an intermediate commit", async () => {
        const f = fixture("multiple")
        try {
            await f.ready()
            await f.rebase()
            fs.writeFileSync(path.join(f.checkout, "file.txt"), "resolved first\n")
            const second = await f.call("continueRebase", { resolutionPaths: ["file.txt"] })
            assert.equal(second.phase, "rebasing")
            assert.ok(second.git.unmerged.some((entry: { path: string }) => entry.path === "other.txt"))
            assert.equal(f.forkHead(), f.head)
            fs.writeFileSync(path.join(f.checkout, "other.txt"), "resolved second\n")
            const completed = await f.call("continueRebase", { resolutionPaths: ["other.txt"] })
            assert.equal(completed.rebase.publication.kind, "confirmed")
            assert.equal(f.forkHead(), completed.baselineSha)
        } finally {
            f.close()
        }
    })
    for (const kind of ["merged", "alreadyApplied"] as const)
        it(`uses standard rebase semantics for ${kind} history`, async () => {
            const f = fixture(kind)
            try {
                await f.ready()
                const result = await f.rebase()
                assert.equal(result.rebase.publication.kind, "confirmed")
                assert.equal(f.git(f.checkout, "rev-list", "--merges", `${f.target}..HEAD`), "")
                if (kind === "merged") {
                    assert.equal(f.git(f.checkout, "rev-list", "--count", `${f.target}..HEAD`), "3")
                    assert.equal(fs.readFileSync(path.join(f.checkout, "side.txt"), "utf-8"), "side contribution\n")
                } else {
                    assert.equal(f.git(f.checkout, "rev-list", "--count", `${f.target}..HEAD`), "1")
                    assert.match(result.messages.join("\n"), /skipped previously applied commit|dropping/)
                }
            } finally {
                f.close()
            }
        })
    for (const dirty of ["tracked", "staged", "untracked", "ignored", "native"] as const)
        it(`refuses ${dirty} work before starting rebase`, async () => {
            const f = fixture()
            try {
                await f.ready()
                await f.call("observeTarget")
                if (dirty === "tracked" || dirty === "staged") {
                    fs.appendFileSync(path.join(f.checkout, "file.txt"), "preserve this\n")
                    if (dirty === "staged") f.git(f.checkout, "add", "file.txt")
                } else if (dirty === "native")
                    fs.writeFileSync(path.join(f.checkout, ".git/MERGE_HEAD"), f.target + "\n")
                else {
                    const name = dirty === "ignored" ? "ignored/new.txt" : "new.txt"
                    fs.mkdirSync(path.dirname(path.join(f.checkout, name)), { recursive: true })
                    fs.writeFileSync(path.join(f.checkout, name), "preserve this\n")
                }
                const before = f.nested()
                await assert.rejects(
                    f.call("rebase", { targetSha: f.target, expectedHeadSha: f.head }),
                    /clean|native Git operation/,
                )
                assert.deepEqual(f.nested(), before)
                assert.equal(f.forkHead(), f.head)
            } finally {
                f.close()
            }
        })
    it("reports changed PR addressing through inspection while refusing mutations", async () => {
        for (const change of ["retarget", "missing-head"] as const) {
            const f = fixture()
            try {
                await f.ready()
                await f.call("observeTarget")
                const before = f.nested()
                if (change === "retarget") f.evidence.response.base.ref = "other-target"
                else f.evidence.response.head.repo = null as never
                const inspected = await f.call("inspect")
                assert.equal(inspected.providerAddressMatches, false)
                assert.equal(inspected.revision.base.ref, "main")
                assert.equal(inspected.git.head, f.head)
                await assert.rejects(f.call("observeTarget"), /addressing changed/)
                await assert.rejects(
                    f.call("rebase", { targetSha: f.target, expectedHeadSha: f.head }),
                    /addressing changed/,
                )
                assert.deepEqual(f.nested(), before)
                assert.equal(f.forkHead(), f.head)
            } finally {
                f.close()
            }
        }
    })

    it("refuses contributor updates before rebase without rewriting local history", async () => {
        const f = fixture()
        try {
            await f.ready()
            await f.call("observeTarget")
            const changed = f.contributorUpdate()
            const before = f.nested()
            await assert.rejects(
                f.call("rebase", { targetSha: f.target, expectedHeadSha: f.head }),
                /changed after observation/,
            )
            assert.deepEqual(f.nested(), before)
            assert.equal(f.forkHead(), changed)
        } finally {
            f.close()
        }
    })
    for (const missing of [false, true])
        it(`preserves remote changes when the ${missing ? "deleted" : "advanced"} contributor branch rejects the lease`, async () => {
            const f = fixture("conflict")
            try {
                const parent = f.parent()
                await f.ready()
                await f.rebase()
                const changed = missing ? null : f.contributorUpdate()
                if (missing) f.git(f.forkRemote, "update-ref", "-d", "refs/heads/main")
                fs.writeFileSync(path.join(f.checkout, "file.txt"), "approved resolution\n")
                const rejected = await f.call("continueRebase", { resolutionPaths: ["file.txt"] })
                assert.equal(rejected.phase, "rebased")
                assert.equal(rejected.rebase.publication.kind, "rejected")
                assert.equal(rejected.rebase.publication.observedHead, changed)
                assert.equal(rejected.rebase.leaseSha, f.head)
                assert.equal(rejected.git.head, rejected.rebase.resultSha)
                assert.equal(rejected.git.staged, false)
                assert.equal(rejected.git.unstaged, false)
                const repeated = await f.call("publishRebase")
                assert.equal(repeated.rebase.leaseSha, f.head)
                assert.equal(repeated.rebase.publication.observedHead, changed)
                if (!missing) assert.equal(f.forkHead(), changed)
                else assert.throws(() => f.forkHead())
                assert.deepEqual(f.parent(), parent)
            } finally {
                f.close()
            }
        })
    it("refuses a changed target after approval without rewriting or publishing", async () => {
        const f = fixture()
        try {
            await f.ready()
            await f.call("observeTarget")
            fs.appendFileSync(path.join(f.source, "upstream.txt"), "new target change\n")
            f.git(f.source, "add", "upstream.txt")
            f.git(f.source, "commit", "-m", "target moved again")
            f.git(f.source, "push", f.baseRemote, "HEAD:refs/heads/main")
            const before = f.nested()
            await assert.rejects(
                f.call("rebase", { targetSha: f.target, expectedHeadSha: f.head }),
                /changed after observation/,
            )
            assert.deepEqual(f.nested(), before)
            assert.equal(f.forkHead(), f.head)
        } finally {
            f.close()
        }
    })
    it("supports an approved conflict deletion without staging other paths", async () => {
        const f = fixture("conflict")
        try {
            await f.ready()
            await f.rebase()
            fs.rmSync(path.join(f.checkout, "file.txt"))
            const result = await f.call("continueRebase", { resolutionPaths: ["file.txt"] })
            assert.equal(result.rebase.publication.kind, "confirmed")
            assert.equal(f.git(f.checkout, "ls-files", "file.txt"), "")
            assert.equal(fs.readFileSync(path.join(f.checkout, "other.txt"), "utf-8"), "contributor second\n")
        } finally {
            f.close()
        }
    })
    it("stages literal resolution paths without capturing late unrelated files", async () => {
        const f = fixture("literalPath")
        const previousPath = process.env.PATH
        try {
            await f.ready()
            const parent = f.parent()
            const conflict = await f.rebase()
            assert.ok(conflict.git.unmerged.some((entry: { path: string }) => entry.path === "*"))
            fs.writeFileSync(path.join(f.checkout, "*"), "approved literal resolution\n")
            const realGit = cp.execFileSync("which", ["git"], { encoding: "utf-8" }).trim()
            const bin = path.join(f.temp, "bin")
            const unexpected = path.join(f.checkout, "ignored/unexpected.txt")
            fs.mkdirSync(bin)
            // A parallel write after preflight must not be captured by a wildcard-like filename.
            fs.writeFileSync(
                path.join(bin, "git"),
                `#!${process.execPath}\nconst cp = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path'); const args = process.argv.slice(2);\nif (args.includes('add') && args.at(-1) === '*') { fs.mkdirSync(path.dirname(${JSON.stringify(unexpected)}), { recursive: true }); fs.writeFileSync(${JSON.stringify(unexpected)}, 'must remain local\\n'); }\nconst result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env }); process.exit(result.status ?? 1);\n`,
                { mode: 0o700 },
            )
            process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
            let stopped = false
            try {
                await f.call("continueRebase", { resolutionPaths: ["*"] })
            } catch (error) {
                assert.match(String(error), /clean|Checkout preserved/)
                stopped = true
            }
            assert.equal(
                f.git(f.forkRemote, "ls-tree", "--name-only", "refs/heads/main", "--", "ignored/unexpected.txt"),
                "",
                "Late unrelated files must never be published",
            )
            assert.equal(stopped, true)
            assert.equal(f.git(f.checkout, "--literal-pathspecs", "ls-files", "--", "ignored/unexpected.txt"), "")
            assert.equal(fs.readFileSync(unexpected, "utf-8"), "must remain local\n")
            assert.equal(f.forkHead(), f.head)
            assert.deepEqual(f.parent(), parent)
        } finally {
            if (previousPath === undefined) delete process.env.PATH
            else process.env.PATH = previousPath
            f.close()
        }
    })

    it("rejects escaping resolution paths without changing rebase state", async () => {
        const f = fixture("conflict")
        try {
            await f.ready()
            await f.rebase()
            const before = f.nested()
            for (const file of ["../notes.md", ".git/HEAD", path.join(f.checkout, "file.txt")])
                await assert.rejects(
                    f.call("continueRebase", { resolutionPaths: [file] }),
                    /checkout-relative source paths/,
                )
            assert.deepEqual(f.nested(), before)
        } finally {
            f.close()
        }
    })
    it("pins the lease even when a contributor pushes after the final preflight read", async () => {
        const f = fixture()
        const previousPath = process.env.PATH
        try {
            await f.ready()
            const parent = f.parent()
            f.git(f.source, "checkout", "-b", "racing-contributor", f.head)
            fs.writeFileSync(path.join(f.source, "new-work.txt"), "preserve newer contribution\n")
            f.git(f.source, "add", "new-work.txt")
            f.git(f.source, "commit", "-m", "contributor update during push")
            const newer = f.git(f.source, "rev-parse", "HEAD")
            f.git(f.source, "push", f.forkRemote, "HEAD:refs/heads/racing-contributor")
            const realGit = cp.execFileSync("which", ["git"], { encoding: "utf-8" }).trim()
            const bin = path.join(f.temp, "bin")
            const command = path.join(f.temp, "pushed-arguments")
            fs.mkdirSync(bin)
            fs.writeFileSync(
                path.join(bin, "git"),
                `#!${process.execPath}\nconst cp = require('node:child_process'); const fs = require('node:fs'); const args = process.argv.slice(2);\nif (args.includes('push') && args.some(a => a.startsWith('--force-with-lease='))) { fs.writeFileSync(${JSON.stringify(command)}, JSON.stringify(args)); cp.execFileSync(${JSON.stringify(realGit)}, ['--git-dir=${f.forkRemote}', 'update-ref', 'refs/heads/main', '${newer}', '${f.head}']); }\nconst result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env }); process.exit(result.status ?? 1);\n`,
                { mode: 0o700 },
            )
            process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
            const rejected = await f.rebase()
            assert.equal(rejected.phase, "rebased")
            assert.equal(rejected.rebase.publication.kind, "rejected")
            assert.equal(rejected.rebase.publication.observedHead, newer)
            assert.equal(f.forkHead(), newer)
            const args: string[] = JSON.parse(fs.readFileSync(command, "utf-8"))
            assert.ok(args.includes(`--force-with-lease=refs/heads/main:${f.head}`))
            assert.equal(args.includes("--force"), false)
            assert.ok(args.includes(`${rejected.rebase.resultSha}:refs/heads/main`))
            assert.deepEqual(f.parent(), parent)
        } finally {
            if (previousPath === undefined) delete process.env.PATH
            else process.env.PATH = previousPath
            f.close()
        }
    })

    it("reconciles a lost push response against the actual remote without repeating the push", async () => {
        const f = fixture()
        const previousPath = process.env.PATH
        try {
            await f.ready()
            const parent = f.parent()
            const realGit = cp.execFileSync("which", ["git"], { encoding: "utf-8" }).trim()
            const bin = path.join(f.temp, "bin")
            const pushed = path.join(f.temp, "push-count")
            const failRead = path.join(f.temp, "fail-read-once")
            fs.mkdirSync(bin)
            // A push can reach the server before the client loses its response. Delegate all
            // state changes to real Git, then inject the transport failure at that boundary.
            fs.writeFileSync(
                path.join(bin, "git"),
                `#!${process.execPath}\nconst cp = require('node:child_process');\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nif (args.includes('ls-remote') && fs.existsSync(${JSON.stringify(failRead)})) { fs.unlinkSync(${JSON.stringify(failRead)}); process.stderr.write('simulated unavailable transport'); process.exit(1); }\nconst result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env });\nif (result.status === 0 && args.includes('push') && args.some(a => a.startsWith('--force-with-lease='))) { fs.appendFileSync(${JSON.stringify(pushed)}, 'push\\n'); fs.writeFileSync(${JSON.stringify(failRead)}, '1'); process.stderr.write('simulated lost push response'); process.exit(1); }\nprocess.exit(result.status ?? 1);\n`,
                { mode: 0o700 },
            )
            process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
            const uncertain = await f.rebase()
            assert.equal(uncertain.phase, "rebased")
            assert.equal(uncertain.rebase.publication.kind, "attempted")
            assert.equal(
                f.forkHead(),
                uncertain.rebase.resultSha,
                "Real Git applied the push before the simulated response loss",
            )
            f.evidence.response.head.sha = uncertain.rebase.resultSha
            f.evidence.response.base.sha = f.target
            const recovered = await f.call("publishRebase")
            assert.equal(recovered.phase, "fixes")
            assert.equal(recovered.rebase.publication.kind, "confirmed")
            assert.equal(fs.readFileSync(pushed, "utf-8"), "push\n")
            assert.equal(recovered.rebase.leaseSha, f.head)
            assert.deepEqual(f.parent(), parent)
        } finally {
            if (previousPath === undefined) delete process.env.PATH
            else process.env.PATH = previousPath
            f.close()
        }
    })

    it("preserves an interrupted local rebase without claiming completion or pushing", async () => {
        const f = fixture()
        const previousPath = process.env.PATH
        try {
            await f.ready()
            const parent = f.parent()
            const realGit = cp.execFileSync("which", ["git"], { encoding: "utf-8" }).trim()
            const bin = path.join(f.temp, "bin")
            fs.mkdirSync(bin)
            // Simulate interruption after local Git work but before a completion response.
            fs.writeFileSync(
                path.join(bin, "git"),
                `#!${process.execPath}\nconst cp = require('node:child_process'); const args = process.argv.slice(2);\nconst result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env });\nif (result.status === 0 && args.includes('rebase')) process.kill(process.pid, 'SIGTERM');\nelse process.exit(result.status ?? 1);\n`,
                { mode: 0o700 },
            )
            process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
            await assert.rejects(f.rebase(), /Checkout preserved/)
            assert.equal(f.forkHead(), f.head)
            assert.equal(f.record().phase, "rebasing")
            const observed = await f.call("inspect")
            assert.equal(observed.phaseValid, false)
            assert.equal(observed.git.native.kind, "none")
            assert.notEqual(observed.git.head, f.head)
            assert.equal(
                f.git(f.checkout, "cat-file", "-t", f.head),
                "commit",
                "Original contributor objects survive interruption",
            )
            assert.deepEqual(f.parent(), parent)
        } finally {
            if (previousPath === undefined) delete process.env.PATH
            else process.env.PATH = previousPath
            f.close()
        }
    })

    it("refuses outside-path edits and index changes during resolution", async () => {
        const f = fixture("conflict")
        try {
            await f.ready()
            await f.rebase()
            fs.writeFileSync(path.join(f.checkout, "file.txt"), "approved resolution\n")
            fs.appendFileSync(path.join(f.checkout, "upstream.txt"), "unexpected\n")
            const before = f.nested()
            await assert.rejects(f.call("continueRebase", { resolutionPaths: ["file.txt"] }), /outside approved/)
            assert.deepEqual(f.nested(), before)
            assert.match(fs.readFileSync(path.join(f.checkout, "upstream.txt"), "utf-8"), /unexpected/)
            f.git(f.checkout, "add", "file.txt")
            await assert.rejects(f.call("continueRebase", { resolutionPaths: ["file.txt"] }), /progress\/index changed/)
            assert.equal(f.forkHead(), f.head)
        } finally {
            f.close()
        }
    })
    it("suppresses custom merge drivers, filters, hooks, signing and editor helpers", async () => {
        const f = fixture("customDriver")
        try {
            await f.ready()
            const marker = path.join(f.temp, "marker.sh")
            const executed = path.join(f.temp, "executed")
            fs.writeFileSync(marker, `#!/bin/sh\nprintf ran >> '${executed}'\nexit 1\n`, { mode: 0o700 })
            for (const [key, value] of [
                ["merge.blocked.driver", marker],
                ["filter.blocked.clean", marker],
                ["filter.blocked.smudge", marker],
                ["filter.blocked.process", marker],
                ["filter.blocked.required", "true"],
                ["core.editor", marker],
                ["sequence.editor", marker],
                ["commit.gpgSign", "true"],
                ["gpg.program", marker],
                ["rerere.enabled", "true"],
                ["diff.blocked.command", marker],
                ["diff.blocked.textconv", marker],
            ])
                f.git(f.root, "config", "--global", key, value)
            const hooks = path.join(f.checkout, ".git/hooks")
            fs.mkdirSync(hooks)
            for (const name of ["pre-rebase", "post-rewrite", "pre-push", "post-checkout", "commit-msg"]) {
                fs.copyFileSync(marker, path.join(hooks, name))
                fs.chmodSync(path.join(hooks, name), 0o700)
            }
            const globalBefore = fs.readFileSync(f.global)
            const conflict = await f.rebase()
            assert.equal(conflict.phase, "rebasing")
            fs.writeFileSync(path.join(f.checkout, "file.txt"), "approved safe manual resolution\n")
            const result = await f.call("continueRebase", { resolutionPaths: ["file.txt"] })
            assert.equal(result.rebase.publication.kind, "confirmed")
            assert.equal(fs.existsSync(executed), false)
            assert.deepEqual(fs.readFileSync(f.global), globalBefore)
        } finally {
            f.close()
        }
    })
})

describe("registered incoming PR additive fix delivery and owned cleanup", () => {
    it(`commits then separately publishes fixes and advances the managed baseline`, async () => {
        const f = fixture()
        try {
            await f.ready()
            const parent = f.parent()
            fs.appendFileSync(path.join(f.checkout, "file.txt"), "approved fix\n")
            const committed = await f.call("commitFixes", {
                paths: ["file.txt"],
                message: "fix: reviewed correction",
            })
            assert.equal(committed.phase, "committedFixes")
            assert.equal(committed.phaseValid, true)
            assert.equal(committed.baselineSha, f.head)
            assert.equal(f.forkHead(), f.head, "Commit approval alone must not push")
            const resultSha = committed.fixCommit.resultSha
            assert.equal(f.git(f.checkout, "rev-parse", "HEAD^"), f.head)
            assert.equal(committed.git.headCommit.message, "fix: reviewed correction\n")
            const published = await f.call("publishFixes")
            assert.equal(published.phase, "fixes")
            assert.equal(published.phaseValid, true)
            assert.equal(published.baselineSha, resultSha)
            assert.equal(f.forkHead(), resultSha)
            f.evidence.response.head.sha = resultSha
            fs.appendFileSync(path.join(f.checkout, "file.txt"), "later draft\n")
            const inspected = await f.call("inspect")
            assert.match(fs.readFileSync(inspected.paths.fixesDiff.absolute, "utf8"), /\+later draft/)
            assert.doesNotMatch(fs.readFileSync(inspected.paths.fixesDiff.absolute, "utf8"), /\+approved fix/)
            assert.match(fs.readFileSync(inspected.paths.publishedFixesDiff.absolute, "utf8"), /\+approved fix/)
            assert.deepEqual(f.record().evidence, f.originalEvidence)
            assert.deepEqual(f.parent(), parent)
        } finally {
            f.close()
        }
    })
    it("retains historical rebase evidence after additive fix publication", async () => {
        const f = fixture()
        try {
            await f.ready()
            const rebased = await f.rebase()
            f.evidence.response.head.sha = f.forkHead()
            f.evidence.response.base.sha = f.target
            const integrationDiff = fs.readFileSync(rebased.paths.rebaseDiff.absolute, "utf8")
            fs.appendFileSync(path.join(f.checkout, "file.txt"), "after-rebase correction\n")
            await f.call("commitFixes", { paths: ["file.txt"], message: "fix: correction after rebase" })
            const published = await f.call("publishFixes")
            assert.notEqual(published.baselineSha, f.record().publishedRebase.resultSha)
            assert.equal(fs.readFileSync(published.paths.rebaseDiff.absolute, "utf8"), integrationDiff)
            assert.match(
                fs.readFileSync(published.paths.publishedFixesDiff.absolute, "utf8"),
                /after-rebase correction/,
            )
            f.evidence.response.head.sha = published.baselineSha
            assert.equal((await f.call("inspect")).phaseValid, true)
        } finally {
            f.close()
        }
    })
    it("preserves changes outside the exact approved fix paths", async () => {
        const f = fixture()
        try {
            await f.ready()
            fs.appendFileSync(path.join(f.checkout, "file.txt"), "approved change\n")
            fs.mkdirSync(path.join(f.checkout, "ignored"))
            fs.writeFileSync(path.join(f.checkout, "ignored/private.txt"), "preserve\n")
            const before = f.nested()
            await assert.rejects(
                f.call("commitFixes", { paths: ["file.txt"], message: "fix: correction" }),
                /complete approved fix set/,
            )
            assert.deepEqual(f.nested(), before)
            assert.equal(fs.readFileSync(path.join(f.checkout, "ignored/private.txt"), "utf8"), "preserve\n")
        } finally {
            f.close()
        }
    })
    it("recognizes an interrupted completed fix commit without creating another", async () => {
        const f = fixture()
        const previousPath = process.env.PATH
        try {
            await f.ready()
            fs.appendFileSync(path.join(f.checkout, "file.txt"), "approved correction\n")
            const realGit = cp.execFileSync("which", ["git"], { encoding: "utf8" }).trim()
            const bin = path.join(f.temp, "commit-bin")
            const count = path.join(f.temp, "commit-count")
            fs.mkdirSync(bin)
            fs.writeFileSync(
                path.join(bin, "git"),
                `#!${process.execPath}
const cp = require('node:child_process'); const fs = require('node:fs'); const args = process.argv.slice(2);
const result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env });
if (result.status === 0 && args.includes('commit') && !args.includes('cat-file')) { fs.appendFileSync(${JSON.stringify(count)}, 'commit\\n'); process.kill(process.pid, 'SIGTERM'); }
else process.exit(result.status ?? 1);
`,
                { mode: 0o700 },
            )
            process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
            const request = { paths: ["file.txt"], message: "fix: interrupted correction" }
            await assert.rejects(f.call("commitFixes", request), /Checkout preserved/)
            assert.equal(f.record().phase, "committingFixes")
            const resultSha = f.git(f.checkout, "rev-parse", "HEAD")
            const recovered = await f.call("commitFixes", request)
            assert.equal(recovered.phase, "committedFixes")
            assert.equal(recovered.fixCommit.resultSha, resultSha)
            assert.equal(fs.readFileSync(count, "utf8"), "commit\n")
            assert.equal(f.forkHead(), f.head)
        } finally {
            if (previousPath === undefined) delete process.env.PATH
            else process.env.PATH = previousPath
            f.close()
        }
    })
    for (const phase of ["prepared", "contributorReview", "fixes"] as const)
        it(`cleans only the owned ${phase} checkout after confirmed merge`, async () => {
            const f = fixture()
            try {
                await f.call("prepare")
                if (phase !== "prepared") await f.call("checkout")
                if (phase === "fixes") await f.call("beginFixes")
                const parent = f.parent()
                const local = path.dirname(f.checkout)
                const evidence = path.join(
                    local,
                    "reviews",
                    `${f.common}-${f.head}`,
                    "review-001",
                    "inputs",
                    "source.txt",
                )
                fs.mkdirSync(path.dirname(evidence), { recursive: true })
                fs.writeFileSync(evidence, "immutable review bytes\n")
                fs.writeFileSync(path.join(local, "notes.md"), "private notes\n")
                f.evidence.response.state = "closed"
                f.evidence.response.merged = true
                f.evidence.response.merged_at = "2026-10-21T12:00:00Z"
                const cleaned = await f.call("cleanup", { completion: { kind: "forgeOnly" } })
                assert.equal(cleaned.phase, "removed")
                assert.equal(fs.existsSync(f.checkout), false)
                assert.equal(fs.readFileSync(evidence, "utf8"), "immutable review bytes\n")
                assert.equal(fs.readFileSync(path.join(local, "notes.md"), "utf8"), "private notes\n")
                assert.equal((await f.call("inspect")).phase, "removed")
                assert.equal((await f.call("cleanup", { completion: { kind: "forgeOnly" } })).phase, "removed")
                assert.equal(f.forkHead(), f.head)
                assert.deepEqual(f.parent(), parent)
            } finally {
                f.close()
            }
        })
    it("refuses cleanup before merge proof or with unpublished local work", async () => {
        const f = fixture()
        try {
            await f.ready()
            const request = { completion: { kind: "forgeOnly" } }
            await assert.rejects(f.call("cleanup", request), /confirmed merge/)
            f.evidence.response.state = "closed"
            f.evidence.response.merged = true
            f.evidence.response.merged_at = "2026-10-21T12:00:00Z"
            fs.appendFileSync(path.join(f.checkout, "file.txt"), "unpublished work\n")
            const before = f.nested()
            await assert.rejects(f.call("cleanup", request), /clean detached/)
            assert.deepEqual(f.nested(), before)
            assert.match(fs.readFileSync(path.join(f.checkout, "file.txt"), "utf8"), /unpublished work/)
        } finally {
            f.close()
        }
    })
    it("preserves extra local refs instead of deleting their metadata", async () => {
        const f = fixture()
        try {
            await f.ready()
            f.git(f.checkout, "branch", "keep-local", f.head)
            f.evidence.response.state = "closed"
            f.evidence.response.merged = true
            f.evidence.response.merged_at = "2026-10-21T12:00:00Z"
            await assert.rejects(f.call("cleanup", { completion: { kind: "forgeOnly" } }), /Additional local refs/)
            assert.equal(f.git(f.checkout, "rev-parse", "refs/heads/keep-local"), f.head)
        } finally {
            f.close()
        }
    })
    it("resumes interrupted owned deletion without deleting new work at the original path", async () => {
        const f = fixture()
        const originalRm = fs.promises.rm
        try {
            await f.ready()
            const parent = f.parent()
            f.evidence.response.state = "closed"
            f.evidence.response.merged = true
            f.evidence.response.merged_at = "2026-10-21T12:00:00Z"
            fs.promises.rm = async (target, options) => {
                if (typeof target === "string" && target.includes("checkout.removing-"))
                    throw new Error("fixture interrupted removal")
                return originalRm(target, options)
            }
            const request = { completion: { kind: "forgeOnly" } }
            await assert.rejects(f.call("cleanup", request), /interrupted removal/)
            assert.equal(f.record().phase, "deleting")
            assert.equal((await f.call("inspect")).phase, "deleting")
            fs.mkdirSync(f.checkout)
            fs.writeFileSync(path.join(f.checkout, "new-work.txt"), "preserve new work\n")
            fs.promises.rm = originalRm
            const cleaned = await f.call("cleanup", request)
            assert.equal(cleaned.phase, "removed")
            assert.equal(cleaned.cleanup.replacementAtOriginalPath, true)
            assert.equal(fs.readFileSync(path.join(f.checkout, "new-work.txt"), "utf8"), "preserve new work\n")
            assert.deepEqual(f.parent(), parent)
        } finally {
            fs.promises.rm = originalRm
            f.close()
        }
    })
    it("uses a normal non-forced fix push and preserves a concurrent contributor update", async () => {
        const f = fixture()
        const previousPath = process.env.PATH
        try {
            await f.ready()
            fs.appendFileSync(path.join(f.checkout, "file.txt"), "approved local fix\n")
            const committed = await f.call("commitFixes", { paths: ["file.txt"], message: "fix: normal publication" })
            f.git(f.source, "checkout", "-b", "racing-fix-contributor", f.head)
            fs.writeFileSync(path.join(f.source, "new-work.txt"), "preserve contributor work\n")
            f.git(f.source, "add", "new-work.txt")
            f.git(f.source, "commit", "-m", "contributor update")
            const newer = f.git(f.source, "rev-parse", "HEAD")
            f.git(f.source, "push", f.forkRemote, "HEAD:refs/heads/racing-fix-contributor")
            const realGit = cp.execFileSync("which", ["git"], { encoding: "utf8" }).trim()
            const bin = path.join(f.temp, "fix-push-bin")
            const argsFile = path.join(f.temp, "fix-push-args")
            fs.mkdirSync(bin)
            fs.writeFileSync(
                path.join(bin, "git"),
                `#!${process.execPath}
const cp = require('node:child_process'); const fs = require('node:fs'); const args = process.argv.slice(2);
if (args.includes('push')) { fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args)); cp.execFileSync(${JSON.stringify(realGit)}, ['--git-dir=${f.forkRemote}', 'update-ref', 'refs/heads/main', '${newer}', '${f.head}']); }
const result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env }); process.exit(result.status ?? 1);
`,
                { mode: 0o700 },
            )
            process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
            const rejected = await f.call("publishFixes")
            assert.equal(rejected.phase, "committedFixes")
            assert.equal(rejected.fixCommit.publication.kind, "rejected")
            assert.equal(f.forkHead(), newer)
            assert.equal(rejected.git.head, committed.fixCommit.resultSha)
            const args: string[] = JSON.parse(fs.readFileSync(argsFile, "utf8"))
            assert.ok(args.includes("git@github.com:contributor/app.git"))
            assert.ok(args.includes(`${committed.fixCommit.resultSha}:refs/heads/main`))
            assert.equal(
                args.some((arg) => arg === "--force" || arg.startsWith("--force-with-lease")),
                false,
            )
        } finally {
            if (previousPath === undefined) delete process.env.PATH
            else process.env.PATH = previousPath
            f.close()
        }
    })
    it("reconciles an uncertain fix push without another commit or push", async () => {
        const f = fixture()
        const previousPath = process.env.PATH
        try {
            await f.ready()
            fs.appendFileSync(path.join(f.checkout, "file.txt"), "approved fix\n")
            const committed = await f.call("commitFixes", { paths: ["file.txt"], message: "fix: transport recovery" })
            const realGit = cp.execFileSync("which", ["git"], { encoding: "utf8" }).trim()
            const bin = path.join(f.temp, "fix-recovery-bin")
            const count = path.join(f.temp, "fix-push-count")
            const failRead = path.join(f.temp, "fix-read-fail")
            fs.mkdirSync(bin)
            fs.writeFileSync(
                path.join(bin, "git"),
                `#!${process.execPath}
const cp = require('node:child_process'); const fs = require('node:fs'); const args = process.argv.slice(2);
if (args.includes('ls-remote') && fs.existsSync(${JSON.stringify(failRead)})) { fs.unlinkSync(${JSON.stringify(failRead)}); process.exit(1); }
const result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit', env: process.env });
if (result.status === 0 && args.includes('push')) { fs.appendFileSync(${JSON.stringify(count)}, 'push\\n'); fs.writeFileSync(${JSON.stringify(failRead)}, '1'); process.exit(1); }
process.exit(result.status ?? 1);
`,
                { mode: 0o700 },
            )
            process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
            const uncertain = await f.call("publishFixes")
            assert.equal(uncertain.phase, "committedFixes")
            assert.equal(uncertain.fixCommit.publication.kind, "attempted")
            assert.equal(f.forkHead(), committed.fixCommit.resultSha)
            f.evidence.response.head.sha = committed.fixCommit.resultSha
            f.evidence.response.base.sha = f.target
            const recovered = await f.call("publishFixes")
            assert.equal(recovered.phase, "fixes")
            assert.equal(recovered.baselineSha, committed.fixCommit.resultSha)
            assert.equal(fs.readFileSync(count, "utf8"), "push\n")
        } finally {
            if (previousPath === undefined) delete process.env.PATH
            else process.env.PATH = previousPath
            f.close()
        }
    })
    it("requires exact configured Project Done proof before removing a merged checkout", async () => {
        const f = fixture()
        try {
            const configFile = path.join(f.root, ".project/integrations.json")
            const config = JSON.parse(fs.readFileSync(configFile, "utf8"))
            const values = {
                backlog: "Backlog",
                todo: "Todo",
                inProgress: "In Progress",
                inReview: "In Review",
                done: "Done",
                canceled: "Canceled",
            }
            config.tracker = {
                provider: "github",
                mcpServer: "board",
                repository: { owner: "upstream", repo: "app" },
                project: { owner: "board-owner", ownerType: "user", number: 2 },
                labels: {
                    kind: {
                        epic: "Epic",
                        deliverableKinds: {
                            feature: "Feature",
                            bugfix: "Bugfix",
                            research: "Research",
                            refactor: "Refactor",
                            audit: "Audit",
                            chore: "Chore",
                        },
                    },
                },
                fields: {
                    status: { field: "Status", values },
                    phase: {
                        field: "Phase",
                        values: { planning: "Planning", execution: "Execution", selfReview: "Self-Review" },
                    },
                    priority: { scope: "project", field: "Priority", values: ["High"] },
                    internalId: { scope: "project", field: "Internal ID" },
                },
            }
            fs.writeFileSync(configFile, JSON.stringify(config))
            await f.ready()
            f.evidence.response.state = "closed"
            f.evidence.response.merged = true
            f.evidence.response.merged_at = "2026-10-21T12:00:00Z"
            await assert.rejects(f.call("cleanup", { completion: { kind: "forgeOnly" } }), /Project Done/)
            const scope = { owner: "board-owner", owner_type: "user", project_number: 2 }
            const fieldEvidence = {
                tool: "mcp__board__projects_get",
                arguments: { method: "get_project_field", ...scope, field_id: 70 },
                response: {
                    id: 70,
                    name: "Status",
                    data_type: "single_select",
                    options: Object.values(values).map((name, index) => ({ id: String(index), name })),
                },
            }
            const itemEvidence = {
                tool: "mcp__board__projects_get",
                arguments: { method: "get_project_item", ...scope, item_id: 99, field_names: ["Status"] },
                response: {
                    id: 99,
                    content_type: "PullRequest",
                    content: { repository: "upstream/app", number: 12 },
                    fields: [{ id: 70, name: "Status", value: { name: "In Review" } }],
                },
            }
            const completion = { kind: "project", fieldEvidence, itemEvidence }
            await assert.rejects(f.call("cleanup", { completion }), /Done is unconfirmed/)
            assert.equal(fs.existsSync(f.checkout), true)
            itemEvidence.response.fields[0].value.name = "Done"
            assert.equal((await f.call("cleanup", { completion })).phase, "removed")
        } finally {
            f.close()
        }
    })
    it("does not create a checkout for remote-only completion or remove an unmanaged path", async () => {
        const f = fixture()
        try {
            f.evidence.response.state = "closed"
            f.evidence.response.merged = true
            f.evidence.response.merged_at = "2026-10-21T12:00:00Z"
            const request = { completion: { kind: "forgeOnly" } }
            assert.equal((await f.call("cleanup", request)).cleanup.state, "notNeeded")
            assert.equal(fs.existsSync(f.checkout), false)
            fs.mkdirSync(f.checkout, { recursive: true })
            fs.writeFileSync(path.join(f.checkout, "keep.txt"), "unmanaged\n")
            await assert.rejects(f.call("cleanup", request), /Unmanaged checkout preserved/)
            assert.equal(fs.readFileSync(path.join(f.checkout, "keep.txt"), "utf8"), "unmanaged\n")
        } finally {
            f.close()
        }
    })
})
