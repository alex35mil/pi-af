import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { checkoutGit } from "./git.js"
import { historicalRebase, type CheckoutState } from "./state.js"

export function checkoutSourcePath(directory: string, raw: string): string {
    const resolved = path.resolve(directory, raw)
    const relative = path.relative(directory, resolved)
    if (
        !relative ||
        path.isAbsolute(raw) ||
        relative === ".." ||
        relative.startsWith(".." + path.sep) ||
        relative.split(path.sep).includes(".git")
    )
        throw new Error("Paths must be exact checkout-relative source paths, not Git metadata")
    let current = directory
    for (const part of relative.split(path.sep).slice(0, -1)) {
        current = path.join(current, part)
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Source paths must not traverse symlinks")
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
    }
    return relative
}

export async function quiet(git: (args: string[]) => Promise<string>, args: string[]): Promise<boolean> {
    try {
        await git(args)
        return true
    } catch (error) {
        if ((error as { code?: unknown }).code === 1) return false
        throw error
    }
}
function exists(file: string): boolean {
    try {
        fs.lstatSync(file)
        return true
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
        throw error
    }
}
function regular(file: string): Buffer {
    if (!fs.lstatSync(file).isFile()) throw new Error(`Unsafe Git progress metadata: ${file}`)
    return fs.readFileSync(file)
}
function treeFingerprint(directory: string): string {
    const hash = createHash("sha256")
    const walk = (current: string) => {
        for (const name of fs.readdirSync(current).sort()) {
            const file = path.join(current, name)
            const stat = fs.lstatSync(file)
            hash.update(path.relative(directory, file) + "\0")
            if (stat.isDirectory()) walk(file)
            else hash.update(regular(file))
        }
    }
    walk(directory)
    return hash.digest("hex")
}
export function nativeOperation(directory: string) {
    const git = path.join(directory, ".git")
    const progress = path.join(git, "rebase-merge")
    if (exists(progress)) {
        if (!fs.lstatSync(progress).isDirectory()) throw new Error("Unsafe native rebase directory")
        const read = (name: string) => regular(path.join(progress, name)).toString("utf-8").trim()
        return {
            kind: "rebase" as const,
            sourceSha: read("orig-head"),
            targetSha: read("onto"),
            fingerprint: treeFingerprint(progress),
        }
    }
    for (const name of ["rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer"])
        if (exists(path.join(git, name))) return { kind: "other" as const, name }
    return { kind: "none" as const }
}

async function commitMetadata(git: (args: string[]) => Promise<string>, head: string) {
    const raw = await git(["cat-file", "commit", head])
    const separator = raw.indexOf("\n\n")
    if (separator < 0) throw new Error("Invalid Git commit metadata")
    const headers = raw.slice(0, separator).split("\n")
    return {
        tree: headers.find((line) => line.startsWith("tree "))?.slice(5),
        parents: headers.filter((line) => line.startsWith("parent ")).map((line) => line.slice(7)),
        message: raw.slice(separator + 2),
    }
}

export async function assertBaselineLineage(
    directory: string,
    state: Extract<CheckoutState, { phase: "fixes" | "committingFixes" | "committedFixes" }>,
    signal?: AbortSignal,
) {
    await checkoutGit(
        directory,
        [
            "merge-base",
            "--is-ancestor",
            historicalRebase(state)?.resultSha ?? state.revision.head.sha,
            state.baselineSha,
        ],
        signal,
    )
}

export async function observeCheckout(directory: string, state: CheckoutState, signal?: AbortSignal) {
    const git = (args: string[]) => checkoutGit(directory, args, signal)
    let head: string | null
    try {
        head = (await git(["rev-parse", "--verify", "HEAD"])).trim()
    } catch (error) {
        if ((error as { code?: unknown }).code !== 128 || state.phase !== "prepared") throw error
        head = null
    }
    const detached = !(await quiet(git, ["symbolic-ref", "--quiet", "HEAD"]))
    const matches = (sha: string) =>
        quiet(git, ["diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", sha, "--"])
    const worktreeMatchesIndex = await quiet(git, [
        "diff",
        "--quiet",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-submodules=all",
        "--",
    ])
    const untracked = (await git(["ls-files", "--others", "-z"])).split("\0").filter(Boolean)
    const indexEntries = await git(["ls-files", "--stage", "-z"])
    const unmerged = (await git(["ls-files", "--unmerged", "-z"]))
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
            const match = /^(\d+) ([a-f0-9]+) ([123])\t([\s\S]+)$/.exec(entry)
            if (!match) throw new Error("Invalid unmerged index entry")
            return { mode: match[1], sha: match[2], stage: Number(match[3]), path: match[4] }
        })
    return {
        head,
        headCommit: head ? await commitMetadata(git, head) : null,
        detached,
        indexMatchesContributorHead: await matches(state.revision.head.sha),
        indexMatchesBaseline: await matches(state.baselineSha),
        worktreeMatchesIndex,
        indexFingerprint: createHash("sha256").update(indexEntries).digest("hex"),
        untracked,
        unmerged,
        native: nativeOperation(directory),
        staged: !(await quiet(git, ["diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", "--"])),
        unstaged: !worktreeMatchesIndex,
        sourceEntries: fs.readdirSync(directory).filter((entry) => entry !== ".git"),
    }
}
export type ObservedCheckout = Awaited<ReturnType<typeof observeCheckout>>

export function requireClean(observed: ObservedCheckout, head: string): void {
    if (
        observed.head !== head ||
        !observed.detached ||
        observed.staged ||
        observed.unstaged ||
        observed.untracked.length ||
        observed.unmerged.length ||
        observed.native.kind !== "none"
    )
        throw new Error(
            "Require clean detached contributor head, with no staged/unstaged/untracked files or existing Git operation",
        )
}
export function matchesFixCommit(
    observed: ObservedCheckout,
    intent: { sourceSha: string; treeSha: string; message: string },
): boolean {
    const commit = observed.headCommit
    return (
        commit !== null &&
        commit.tree === intent.treeSha &&
        commit.parents.length === 1 &&
        commit.parents[0] === intent.sourceSha &&
        commit.message === intent.message
    )
}

export function validatePhase(state: CheckoutState, observed: ObservedCheckout): void {
    if (state.phase === "removing" || state.phase === "deleting" || state.phase === "removed")
        throw new Error("Checkout source was retired; inspect removal state")
    if (state.phase === "committingFixes") {
        if (
            !observed.detached ||
            observed.native.kind !== "none" ||
            observed.unmerged.length ||
            observed.untracked.length ||
            !observed.worktreeMatchesIndex ||
            observed.indexFingerprint !== state.fixes.indexFingerprint ||
            (observed.head !== state.fixes.sourceSha && !matchesFixCommit(observed, state.fixes))
        )
            throw new Error("Fix commit intent/index/source changed; preserve and investigate")
        return
    }
    if (state.phase === "committedFixes") {
        requireClean(observed, state.fixes.resultSha)
        if (!matchesFixCommit(observed, state.fixes))
            throw new Error("Recorded fix commit does not match its exact intent")
        return
    }
    if (state.phase === "prepared") {
        if (
            observed.head !== null ||
            observed.sourceEntries.length ||
            observed.staged ||
            observed.untracked.length ||
            observed.native.kind !== "none"
        )
            throw new Error("Object-only checkout has unexpected HEAD, index or source files")
        return
    }
    if (state.phase === "rebasing") {
        const native = observed.native
        if (
            native.kind !== "rebase" ||
            native.sourceSha !== state.rebase.sourceSha ||
            native.targetSha !== state.rebase.targetSha ||
            !state.rebase.checkpoint ||
            native.fingerprint !== state.rebase.checkpoint.nativeFingerprint ||
            observed.indexFingerprint !== state.rebase.checkpoint.indexFingerprint
        )
            throw new Error("Native rebase progress/index changed or is incomplete; preserve and investigate")
        return
    }
    if (state.phase === "rebased") {
        requireClean(observed, state.rebase.resultSha)
        return
    }
    const expected = state.phase === "contributorReview" ? state.reviewBaseSha : state.baselineSha
    if (!observed.detached || observed.head !== expected || observed.native.kind !== "none")
        throw new Error(`Expected detached ${state.phase} HEAD ${expected} and no native Git operation`)
    if (
        state.phase === "contributorReview" &&
        (!observed.indexMatchesContributorHead || !observed.worktreeMatchesIndex || observed.untracked.length)
    )
        throw new Error(
            "Checkout changed during contributor review: original PR index/source required, with no untracked files including ignored additions",
        )
}
