import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import registerGitRead, {
    assertGitReadArguments,
    GIT_READ_TOOL,
    runGitRead,
    type GitReadInput,
} from "../workflows/extensions/review/git-read.ts"

function git(cwd: string, args: string[]): string {
    return cp.execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

// A repository with a committed file, a branch, an ignored secret, and an untracked file.
function repository() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-git-read-"))
    git(root, ["init", "-q", "-b", "main"])
    git(root, ["config", "user.email", "test@example.com"])
    git(root, ["config", "user.name", "Test"])
    fs.writeFileSync(path.join(root, "README.md"), "tracked line\n")
    fs.writeFileSync(path.join(root, ".gitignore"), ".env\n")
    git(root, ["add", "README.md", ".gitignore"])
    git(root, ["commit", "-q", "-m", "initial"])
    git(root, ["switch", "-q", "-c", "feature"])
    fs.writeFileSync(path.join(root, "README.md"), "tracked line\nfeature line\n")
    git(root, ["commit", "-q", "-am", "feature"])
    fs.writeFileSync(path.join(root, ".env"), "SECRET_TOKEN=leak\n")
    fs.writeFileSync(path.join(root, "untracked.txt"), "SECRET_TOKEN=untracked\n")
    return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

const read = (root: string, subcommand: GitReadInput["subcommand"], args: string[]) =>
    runGitRead(root, { subcommand, args })

describe("reviewer git_read", () => {
    it("registers only the git_read tool", () => {
        const names: string[] = []
        registerGitRead({ registerTool: (tool: { name: string }) => names.push(tool.name) } as never)
        assert.deepEqual(names, [GIT_READ_TOOL])
    })

    it("runs read-only subcommands, including ranges and real options that prefix refused ones", async () => {
        const h = repository()
        try {
            assert.match(await read(h.root, "log", ["--oneline", "main..feature"]), /feature/)
            assert.match(await read(h.root, "diff", ["main...feature", "--", "README.md"]), /\+feature line/)
            assert.match(await read(h.root, "show", ["--stat", "HEAD"]), /README\.md/)
            assert.match(await read(h.root, "grep", ["-n", "tracked"]), /README\.md:1:tracked line/)
            assert.match(await read(h.root, "grep", ["no-such-text"]), /no match/)
            assert.match(await read(h.root, "merge-tree", ["--write-tree", "main", "feature"]), /^[0-9a-f]{40}/)
            assert.match(await read(h.root, "ls-files", ["--exclude", "*.md"]), /README\.md/)
        } finally {
            h.cleanup()
        }
    })

    it("refuses subcommands and arguments that write, run programs, or read untracked content", async () => {
        const h = repository()
        try {
            const refused: Array<[GitReadInput["subcommand"], string[]]> = [
                ["diff", ["--no-index", "/dev/null", ".env"]],
                ["diff", ["--no-ind", "/dev/null", ".env"]],
                ["diff", ["HEAD", "--", "../outside"]],
                ["diff", ["HEAD", "--", "/etc/passwd"]],
                ["diff", ["--output=out.txt"]],
                ["diff", ["--outp", "out.txt"]],
                ["log", ["--ext-diff"]],
                ["show", ["--textconv", "HEAD"]],
                ["grep", ["--untracked", "SECRET"]],
                ["grep", ["--untr", "SECRET"]],
                ["grep", ["--no-exclude-standard", "--untracked", "SECRET"]],
                ["grep", ["-f", ".env"]],
                ["grep", ["-if.env"]],
                ["grep", ["--file=.env"]],
                ["grep", ["-O", "SECRET"]],
                ["blame", ["--contents", ".env", "README.md"]],
                ["blame", ["--cont=.env", "README.md"]],
                ["blame", ["-S", ".env", "README.md"]],
                ["blame", ["--ignore-revs-file=.env", "README.md"]],
                ["ls-files", ["-X", ".env"]],
                ["ls-files", ["--exclude-from=.env"]],
                ["ls-files", ["--exclude-per-directory=.env"]],
                ["cat-file", ["--filters", "HEAD:README.md"]],
                ["rev-list", ["--pathspec-from-file=.env", "HEAD"]],
                ["show", ["~/.ssh/id_rsa"]],
                ["merge-tree", ["main", "feature"]],
            ]
            for (const [subcommand, args] of refused) {
                assert.throws(() => assertGitReadArguments(subcommand, args), /git_read/, `${subcommand} ${args}`)
                await assert.rejects(read(h.root, subcommand, args), /git_read/)
            }
            assert.equal(fs.existsSync(path.join(h.root, "out.txt")), false)
        } finally {
            h.cleanup()
        }
    })

    it("never exposes ignored or untracked file contents", async () => {
        const h = repository()
        try {
            for (const [subcommand, args] of [
                ["grep", ["SECRET_TOKEN"]],
                ["status", ["--short"]],
                ["ls-files", ["--others"]],
            ] as const) {
                assert.doesNotMatch(await read(h.root, subcommand, [...args]), /SECRET_TOKEN=/)
            }
        } finally {
            h.cleanup()
        }
    })

    it("refuses inherited Git relocation and truncates long output", async () => {
        const h = repository()
        const previous = process.env.GIT_DIR
        try {
            process.env.GIT_DIR = path.join(h.root, ".git")
            await assert.rejects(read(h.root, "log", ["--oneline"]), /relocation settings: GIT_DIR/)
            delete process.env.GIT_DIR
            fs.writeFileSync(path.join(h.root, "long.txt"), `${"line\n".repeat(3000)}`)
            git(h.root, ["add", "long.txt"])
            git(h.root, ["commit", "-q", "-m", "long"])
            assert.match(await read(h.root, "show", ["HEAD:long.txt"]), /Output truncated: showing 2000 of/)
        } finally {
            if (previous === undefined) delete process.env.GIT_DIR
            else process.env.GIT_DIR = previous
            h.cleanup()
        }
    })

    it("disables configured external diff and text-conversion programs", async () => {
        const h = repository()
        try {
            const marker = path.join(h.root, "ran.txt")
            const script = path.join(h.root, "helper.sh")
            fs.writeFileSync(script, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`, { mode: 0o755 })
            git(h.root, ["config", "diff.external", script])
            git(h.root, ["config", "diff.md.textconv", script])
            fs.writeFileSync(path.join(h.root, ".gitattributes"), "*.md diff=md\n")
            await read(h.root, "diff", ["main", "feature"])
            await read(h.root, "show", ["HEAD"])
            await read(h.root, "log", ["-p", "-1"])
            assert.equal(fs.existsSync(marker), false)
        } finally {
            h.cleanup()
        }
    })
})
