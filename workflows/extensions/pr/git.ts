import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { promisify } from "node:util"
import type { Repository } from "../integrations/forge/github/incoming-pr-context.js"

const execFile = promisify(cp.execFile)
const relocation = [
    "GIT_DIR",
    "GIT_COMMON_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
]
const settings = [
    "core.hooksPath=/dev/null",
    "core.fsmonitor=false",
    "core.untrackedCache=false",
    "submodule.recurse=false",
    "push.recurseSubmodules=no",
    "commit.gpgSign=false",
    "tag.gpgSign=false",
    "core.editor=:",
    "rerere.enabled=false",
    "rerere.autoupdate=false",
    "rebase.autoStash=false",
    "rebase.autoSquash=false",
    "rebase.updateRefs=false",
    "rebase.rebaseMerges=false",
    "rebase.instructionFormat=%s",
    "maintenance.auto=false",
    "gc.auto=0",
]

// Callers supply repository identities validated against actual configured PR evidence.
export function githubSshUrl(repository: Repository): string {
    return `git@github.com:${repository.owner}/${repository.repo}.git`
}

export async function headBranchRef(directory: string, ref: string, signal?: AbortSignal): Promise<string> {
    const full = `refs/heads/${ref}`
    await checkoutGit(directory, ["check-ref-format", full], signal)
    return full
}

// Configuration/artifact readers also use Git. Reject relocation before invoking any of them,
// rather than temporarily mutating process.env in a parallel tool runtime.
export function assertGitEnvironment(): void {
    const found = relocation.filter((key) => process.env[key] !== undefined)
    if (found.length)
        throw new Error(
            `Unset inherited Git relocation/configuration settings before continuing: ${found.join(", ")}. No checkout changes made.`,
        )
}

export interface GitResult {
    code: number
    stdout: string
    stderr: string
}

async function executeResult(directory: string, args: string[], signal?: AbortSignal): Promise<GitResult> {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        GIT_EDITOR: ":",
        GIT_SEQUENCE_EDITOR: ":",
    }
    delete env.GIT_EXTERNAL_DIFF
    try {
        const { stdout, stderr } = await execFile("git", args, {
            cwd: directory,
            env,
            encoding: "utf-8",
            maxBuffer: 64 * 1024 * 1024,
            signal,
        })
        return { code: 0, stdout, stderr }
    } catch (error) {
        const failed = error as cp.ExecFileException & { stdout?: string; stderr?: string }
        if (typeof failed.code !== "number") throw error
        return { code: failed.code, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" }
    }
}

function checked(result: GitResult): string {
    if (result.code !== 0)
        throw Object.assign(
            new Error(result.stderr.trim() || result.stdout.trim() || `Git exited ${result.code}`),
            result,
        )
    return result.stdout
}

async function execute(directory: string, args: string[], signal?: AbortSignal): Promise<string> {
    return checked(await executeResult(directory, args, signal))
}

export function assertIndependentRepository(directory: string): void {
    const gitDirectory = path.join(directory, ".git")
    const stat = fs.lstatSync(gitDirectory)
    if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Expected an independent checkout with its own real .git directory")
    for (const name of ["HEAD", "index", "config", "objects", "refs"]) {
        const entry = path.join(gitDirectory, name)
        if (fs.existsSync(entry) || isLink(entry)) {
            if (fs.lstatSync(entry).isSymbolicLink()) throw new Error(`Unsafe checkout Git metadata: ${name}`)
        }
    }
}

function isLink(file: string): boolean {
    try {
        return fs.lstatSync(file).isSymbolicLink()
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
        throw error
    }
}

async function safeSettings(directory: string, prefix: string[], signal?: AbortSignal): Promise<string[]> {
    const args = settings.flatMap((value) => ["-c", value])
    let keys: string
    try {
        keys = await execute(
            directory,
            [
                ...prefix,
                ...args,
                "config",
                "--null",
                "--name-only",
                "--get-regexp",
                "^(filter\\..*\\.(clean|smudge|process|required)|merge\\..*\\.driver)$",
            ],
            signal,
        )
    } catch (error) {
        if ((error as { code?: unknown }).code !== 1) throw error
        keys = ""
    }
    for (const key of keys.split("\0").filter(Boolean)) {
        // A disabled custom merge driver must report a conflict, not silently accept ours.
        const value = key.startsWith("merge.") ? "/usr/bin/false" : key.endsWith(".required") ? "false" : ""
        if (key.startsWith("merge.") && !fs.existsSync(value))
            throw new Error("Trusted failing merge driver /usr/bin/false is unavailable")
        args.push("-c", `${key}=${value}`)
    }
    return args
}

// Parent reads deliberately support the trusted main repository being a linked worktree.
export async function parentGit(directory: string, args: string[], signal?: AbortSignal): Promise<string> {
    assertGitEnvironment()
    return execute(directory, [...(await safeSettings(directory, [], signal)), ...args], signal)
}

export async function checkoutGitResult(directory: string, args: string[], signal?: AbortSignal): Promise<GitResult> {
    assertGitEnvironment()
    assertIndependentRepository(directory)
    const prefix = ["--literal-pathspecs", `--git-dir=${path.join(directory, ".git")}`, `--work-tree=${directory}`]
    return executeResult(directory, [...prefix, ...(await safeSettings(directory, prefix, signal)), ...args], signal)
}

export async function checkoutGit(directory: string, args: string[], signal?: AbortSignal): Promise<string> {
    return checked(await checkoutGitResult(directory, args, signal))
}

export async function initializeCheckout(directory: string, signal?: AbortSignal): Promise<void> {
    assertGitEnvironment()
    await execute(directory, [...(await safeSettings(directory, [], signal)), "init", "--template="], signal)
    assertIndependentRepository(directory)
}
