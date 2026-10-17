import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import {
    assertArtifactPersistencePrepared,
    prepareArtifactPersistence,
} from "../workflows/extensions/__lib/project-config.ts"

function fixture(mode: "versioned" | "unversioned" = "versioned") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workflow-persistence-")))
    const previousTrace = process.env.GIT_TRACE
    const previousIndex = process.env.GIT_INDEX_FILE
    delete process.env.GIT_INDEX_FILE
    const git = (...args: string[]) =>
        cp.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim()
    git("init", "-b", "main")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    fs.writeFileSync(path.join(root, ".gitignore"), ".project/**/.local/\n")
    git("add", ".gitignore")
    git("commit", "-m", "initial")
    fs.mkdirSync(path.join(root, ".project"))
    const config = path.join(root, ".project/config.json")
    fs.writeFileSync(config, JSON.stringify({ artifacts: mode, branches: { format: "identifier" } }))
    const trace = path.join(root, "git.trace")
    process.env.GIT_TRACE = trace
    prepareArtifactPersistence(root)
    return {
        root,
        git,
        config,
        exclude: path.join(root, ".git/info/exclude"),
        scans: () => (fs.readFileSync(trace, "utf8").match(/built-in: git ls-files/g) ?? []).length,
        cleanup: () => {
            if (previousTrace === undefined) delete process.env.GIT_TRACE
            else process.env.GIT_TRACE = previousTrace
            if (previousIndex === undefined) delete process.env.GIT_INDEX_FILE
            else process.env.GIT_INDEX_FILE = previousIndex
            fs.rmSync(root, { recursive: true, force: true })
        },
    }
}

describe("artifact persistence revalidation", () => {
    it("skips membership scans for unchanged inputs and always scans explicit preparation", () => {
        for (const mode of ["versioned", "unversioned"] as const) {
            const f = fixture(mode)
            try {
                const before = f.scans()
                assertArtifactPersistencePrepared(f.root)
                assertArtifactPersistencePrepared(f.root)
                assert.equal(f.scans(), before)
                fs.mkdirSync(path.join(f.root, ".project/gigs/example/.local"), { recursive: true })
                fs.writeFileSync(path.join(f.root, ".project/gigs/example/.local/notes.md"), "notes")
                assertArtifactPersistencePrepared(f.root)
                assert.equal(f.scans(), before)
                prepareArtifactPersistence(f.root)
                assert.ok(f.scans() > before)
            } finally {
                f.cleanup()
            }
        }
    })

    it("invalidates additions, removals and index replacement without changing the index", () => {
        const f = fixture()
        try {
            const index = path.join(f.root, ".git/index")
            const original = fs.readFileSync(index)
            const local = path.join(f.root, ".project/gigs/example/.local")
            fs.mkdirSync(local, { recursive: true })
            fs.writeFileSync(path.join(local, "notes.md"), "private")
            f.git("add", "-f", ".project/gigs/example/.local/notes.md")
            const unsafe = fs.readFileSync(index)
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /entity \.local/)
            assert.deepEqual(fs.readFileSync(index), unsafe)
            f.git("reset", "--", ".project/gigs/example/.local/notes.md")
            assertArtifactPersistencePrepared(f.root)
            fs.writeFileSync(index, unsafe)
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /entity \.local/)
            fs.writeFileSync(index, original)
            assertArtifactPersistencePrepared(f.root)
        } finally {
            f.cleanup()
        }
    })

    it("includes HEAD when an unchanged index now represents a staged deletion", () => {
        const f = fixture("unversioned")
        try {
            const index = path.join(f.root, ".git/index")
            const before = fs.readFileSync(index)
            f.git("add", "-f", ".project/config.json")
            f.git("commit", "-m", "tracked workflow config")
            fs.writeFileSync(index, before)
            assert.deepEqual(fs.readFileSync(index), before)
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /in Git or staged/)
            assert.deepEqual(fs.readFileSync(index), before)
        } finally {
            f.cleanup()
        }
    })

    it("rechecks ignore rules, exclusion content, config and local-setting existence", () => {
        const f = fixture()
        try {
            fs.writeFileSync(path.join(f.root, ".gitignore"), "")
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /versioned artifacts require/)
            fs.writeFileSync(path.join(f.root, ".gitignore"), ".project/**/.local/\n")
            assertArtifactPersistencePrepared(f.root)
            fs.appendFileSync(f.exclude, "\n/.project/\n")
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /remove it manually/)
            fs.writeFileSync(f.exclude, "")
            fs.writeFileSync(
                path.join(f.root, ".project/config.local.json"),
                JSON.stringify({ branches: { username: "alex" } }),
            )
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /not prepared/)
            prepareArtifactPersistence(f.root)
            fs.writeFileSync(f.exclude, "")
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /not prepared/)
            prepareArtifactPersistence(f.root)
            const before = f.scans()
            fs.writeFileSync(
                f.config,
                JSON.stringify({ artifacts: "versioned", branches: { format: "username/identifier" } }),
            )
            assert.equal(assertArtifactPersistencePrepared(f.root).branches.username, "alex")
            assert.ok(f.scans() > before)
            fs.writeFileSync(
                path.join(f.root, ".project/config.local.json"),
                JSON.stringify({ branches: { username: "sam" } }),
            )
            assert.equal(assertArtifactPersistencePrepared(f.root).branches.username, "sam")
            fs.writeFileSync(f.config, "invalid")
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /invalid/)
        } finally {
            f.cleanup()
        }
    })

    it("resolves the active index on every call", () => {
        const f = fixture()
        try {
            process.env.GIT_INDEX_FILE = path.join(f.root, "alternate-index")
            f.git("read-tree", "HEAD")
            fs.writeFileSync(path.join(f.root, ".project/config.local.json"), "local")
            f.git("add", "-f", ".project/config.local.json")
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /config.local.json must remain outside Git/)
            delete process.env.GIT_INDEX_FILE
            prepareArtifactPersistence(f.root)
            assertArtifactPersistencePrepared(f.root)
        } finally {
            f.cleanup()
        }
    })

    it("keeps linked-worktree membership independent from the primary clone", () => {
        const f = fixture()
        const worker = `${f.root}-worker`
        try {
            f.git("add", ".project/config.json")
            f.git("commit", "-m", "workflow configuration")
            f.git("worktree", "add", "-b", "worker", worker)
            prepareArtifactPersistence(worker)
            const local = path.join(worker, ".project/gigs/example/.local")
            fs.mkdirSync(local, { recursive: true })
            fs.writeFileSync(path.join(local, "notes.md"), "private")
            cp.execFileSync("git", ["add", "-f", ".project/gigs/example/.local/notes.md"], {
                cwd: worker,
                stdio: "pipe",
            })
            assert.throws(() => assertArtifactPersistencePrepared(worker), /entity \.local/)
            assertArtifactPersistencePrepared(f.root)
        } finally {
            fs.rmSync(worker, { recursive: true, force: true })
            f.cleanup()
        }
    })
})
