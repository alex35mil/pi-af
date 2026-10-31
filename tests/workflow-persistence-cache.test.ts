import "./host-runtime.ts"

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

const GIG_NOTES = ".project/.local/gigs/example/notes.md"

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workflow-persistence-")))
    const previousTrace = process.env.GIT_TRACE
    const previousIndex = process.env.GIT_INDEX_FILE
    delete process.env.GIT_INDEX_FILE
    const git = (...args: string[]) =>
        cp.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim()
    git("init", "-b", "main")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
    git("add", ".gitignore")
    git("commit", "-m", "initial")
    fs.mkdirSync(path.join(root, ".project"))
    const config = path.join(root, ".project/config.json")
    fs.writeFileSync(config, JSON.stringify({ branches: { format: "identifier-title" } }))
    const trace = path.join(root, "git.trace")
    process.env.GIT_TRACE = trace
    prepareArtifactPersistence(root)
    return {
        root,
        git,
        config,
        exclude: path.join(root, ".git/info/exclude"),
        scans: () => (fs.readFileSync(trace, "utf8").match(/built-in: git ls-files/g) ?? []).length,
        writeNotes: (base = root) => {
            fs.mkdirSync(path.dirname(path.join(base, GIG_NOTES)), { recursive: true })
            fs.writeFileSync(path.join(base, GIG_NOTES), "private")
        },
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
        const f = fixture()
        try {
            const before = f.scans()
            assertArtifactPersistencePrepared(f.root)
            assertArtifactPersistencePrepared(f.root)
            assert.equal(f.scans(), before)
            f.writeNotes()
            assertArtifactPersistencePrepared(f.root)
            assert.equal(f.scans(), before)
            prepareArtifactPersistence(f.root)
            assert.ok(f.scans() > before)
        } finally {
            f.cleanup()
        }
    })

    it("invalidates additions, removals and index replacement without changing the index", () => {
        const f = fixture()
        try {
            const index = path.join(f.root, ".git/index")
            const original = fs.readFileSync(index)
            f.writeNotes()
            f.git("add", "-f", GIG_NOTES)
            const unsafe = fs.readFileSync(index)
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /must remain outside Git/)
            assert.deepEqual(fs.readFileSync(index), unsafe)
            f.git("reset", "--", GIG_NOTES)
            assertArtifactPersistencePrepared(f.root)
            fs.writeFileSync(index, unsafe)
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /must remain outside Git/)
            fs.writeFileSync(index, original)
            assertArtifactPersistencePrepared(f.root)
        } finally {
            f.cleanup()
        }
    })

    it("includes HEAD when an unchanged index now represents a staged deletion", () => {
        const f = fixture()
        try {
            const index = path.join(f.root, ".git/index")
            const before = fs.readFileSync(index)
            f.writeNotes()
            f.git("add", "-f", GIG_NOTES)
            f.git("commit", "-m", "tracked local artifact")
            fs.writeFileSync(index, before)
            assert.deepEqual(fs.readFileSync(index), before)
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /must remain outside Git/)
            assert.deepEqual(fs.readFileSync(index), before)
        } finally {
            f.cleanup()
        }
    })

    it("rechecks ignore rules, exclusion content, config and local-setting existence", () => {
        const f = fixture()
        try {
            fs.writeFileSync(path.join(f.root, ".gitignore"), "")
            assert.throws(() => assertArtifactPersistencePrepared(f.root), /in \.gitignore/)
            fs.writeFileSync(path.join(f.root, ".gitignore"), "/.project/.local/\n")
            assertArtifactPersistencePrepared(f.root)
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
            fs.writeFileSync(f.config, JSON.stringify({ branches: { format: "username/identifier-title" } }))
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
            f.writeNotes(worker)
            cp.execFileSync("git", ["add", "-f", GIG_NOTES], { cwd: worker, stdio: "pipe" })
            assert.throws(() => assertArtifactPersistencePrepared(worker), /must remain outside Git/)
            assertArtifactPersistencePrepared(f.root)
        } finally {
            fs.rmSync(worker, { recursive: true, force: true })
            f.cleanup()
        }
    })
})
