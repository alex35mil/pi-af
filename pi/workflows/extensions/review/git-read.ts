import * as cp from "node:child_process"
import * as fs from "node:fs"
import { promisify } from "node:util"

import { DEFAULT_MAX_BYTES, formatSize, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"

import { compile, parse } from "../../../extensions/__lib/schema.js"
import { FAILING_PROGRAM, GIT_HELPER_CONFIG_PATTERN, gitHelperOverride, inheritedGitRelocation } from "../__lib/git.js"

// The reviewer subprocess's read-only Git access. Only reviewer launches load this extension
// (`--extension`), so normal sessions never see the tool. It runs Git directly, never a shell, and
// refuses arguments that write files, run programs, or read content outside tracked files and the
// object database, so untracked and ignored files such as `.env` stay unreachable.

export const GIT_READ_TOOL = "git_read"

export const GIT_READ_SUBCOMMANDS = [
    "show",
    "diff",
    "log",
    "status",
    "blame",
    "merge-base",
    "merge-tree",
    "rev-parse",
    "rev-list",
    "ls-files",
    "ls-tree",
    "cat-file",
    "grep",
] as const
export type GitReadSubcommand = (typeof GIT_READ_SUBCOMMANDS)[number]

export const GitReadInputSchema = Type.Object(
    {
        subcommand: Type.Enum(GIT_READ_SUBCOMMANDS, {
            type: "string",
            description: "The read-only Git subcommand to run",
        }),
        args: Type.Array(Type.String(), {
            description:
                'Arguments after the subcommand, one per element, without shell quoting, e.g. ["--remerge-diff", "HEAD"]',
        }),
    },
    { additionalProperties: false },
)
export const GitReadInputValidator = compile(GitReadInputSchema)
export type GitReadInput = Static<typeof GitReadInputSchema>

/** Options refused for one subcommand, by long name (without `--`) and by short letter. */
interface Refusals {
    long: readonly string[]
    short: readonly string[]
}

// Writing files or running programs, and reading untracked or arbitrary files.
const SHARED_REFUSALS: Refusals = {
    long: [
        "output",
        "open-files-in-pager",
        "ext-diff",
        "textconv",
        "no-index",
        "untracked",
        "no-exclude-standard",
        "contents",
        "pathspec-from-file",
    ],
    short: ["O"],
}

function subcommandRefusals(subcommand: GitReadSubcommand): Refusals {
    switch (subcommand) {
        case "grep":
            return { long: ["file"], short: ["f"] }
        case "blame":
            return { long: ["ignore-revs-file"], short: ["S"] }
        case "ls-files":
            return { long: ["exclude-from", "exclude-per-directory"], short: ["X"] }
        case "cat-file":
            return { long: ["filters"], short: [] }
        case "show":
        case "diff":
        case "log":
        case "status":
        case "merge-base":
        case "merge-tree":
        case "rev-parse":
        case "rev-list":
        case "ls-tree":
            return { long: [], short: [] }
    }
}

// Flags that keep diff-producing subcommands from running configured external diff or text-conversion programs.
function forcedArguments(subcommand: GitReadSubcommand): string[] {
    switch (subcommand) {
        case "show":
        case "diff":
        case "log":
            return ["--no-ext-diff", "--no-textconv"]
        case "blame":
            return ["--no-textconv"]
        case "status":
        case "merge-base":
        case "merge-tree":
        case "rev-parse":
        case "rev-list":
        case "ls-files":
        case "ls-tree":
        case "cat-file":
        case "grep":
            return []
    }
}

// Exit code 1 is an ordinary result for these: no match, or a merge with conflicts.
function acceptsExitOne(subcommand: GitReadSubcommand): boolean {
    switch (subcommand) {
        case "grep":
        case "merge-tree":
            return true
        case "show":
        case "diff":
        case "log":
        case "status":
        case "blame":
        case "merge-base":
        case "rev-parse":
        case "rev-list":
        case "ls-files":
        case "ls-tree":
        case "cat-file":
            return false
    }
}

// Real options that are prefixes of a refused one. Git runs with abbreviations disabled, so these mean
// exactly themselves: `--text` treats files as text, `--exclude` takes a pattern, `--filter` an object filter.
const EXACT_OPTIONS = new Set(["text", "exclude", "filter"])

// An absolute path, a home path, or one with a `..` segment reaches outside the repository.
// Git ranges such as `main..feature` and `a...b` have no `..` segment and stay allowed.
function escapesRepository(value: string): boolean {
    return value.startsWith("/") || value.startsWith("~") || value.split("/").some((segment) => segment === "..")
}

/** Throws when an argument is refused; returns normally when every argument is allowed. */
export function assertGitReadArguments(subcommand: GitReadSubcommand, args: readonly string[]): void {
    const own = subcommandRefusals(subcommand)
    const long = [...SHARED_REFUSALS.long, ...own.long]
    const short = new Set([...SHARED_REFUSALS.short, ...own.short])
    let options = true
    for (const arg of args) {
        if (options && arg === "--") {
            options = false
            continue
        }
        if (options && arg.startsWith("--")) {
            const [name, ...value] = arg.slice(2).split("=")
            // Git accepts any unique prefix of a long option, so a prefix of a refused option is refused too.
            const refused = EXACT_OPTIONS.has(name) ? undefined : long.find((option) => option.startsWith(name))
            if (refused) throw new Error(`git_read refuses --${refused} (given ${arg})`)
            if (value.length && escapesRepository(value.join("=")))
                throw new Error(`git_read refuses paths outside the repository: ${arg}`)
            continue
        }
        if (options && arg.startsWith("-") && arg.length > 1) {
            // A short-option cluster such as `-if` or `-Ofile`; refusing any refused letter in it is conservative.
            const letter = [...arg.slice(1)].find((character) => short.has(character))
            if (letter) throw new Error(`git_read refuses -${letter} (given ${arg})`)
            if (escapesRepository(arg.slice(2)))
                throw new Error(`git_read refuses paths outside the repository: ${arg}`)
            continue
        }
        if (escapesRepository(arg)) throw new Error(`git_read refuses paths outside the repository: ${arg}`)
    }
    switch (subcommand) {
        case "merge-tree":
            // Without `--write-tree`, merge-tree runs the deprecated trivial mode; `--write-tree` only adds
            // unreferenced objects and changes no refs, index, or files.
            if (!args.slice(0, options ? undefined : args.indexOf("--")).includes("--write-tree"))
                throw new Error("git_read merge-tree requires --write-tree")
            return
        case "show":
        case "diff":
        case "log":
        case "status":
        case "blame":
        case "merge-base":
        case "rev-parse":
        case "rev-list":
        case "ls-files":
        case "ls-tree":
        case "cat-file":
        case "grep":
            return
    }
}

// Settings that keep repository configuration from running programs or writing during reads.
const FIXED_SETTINGS = [
    "core.fsmonitor=false",
    "core.untrackedCache=false",
    "core.hooksPath=/dev/null",
    "core.pager=cat",
    "color.ui=false",
    "diff.external=",
    "log.showSignature=false",
    `gpg.program=${FAILING_PROGRAM}`,
    `gpg.ssh.program=${FAILING_PROGRAM}`,
    `gpg.x509.program=${FAILING_PROGRAM}`,
]

const execFile = promisify(cp.execFile)

interface GitOutcome {
    code: number
    stdout: string
    stderr: string
}

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<GitOutcome> {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "cat",
        GIT_NO_LAZY_FETCH: "1",
        GIT_TEST_DISALLOW_ABBREVIATED_OPTIONS: "1",
    }
    delete env.GIT_EXTERNAL_DIFF
    try {
        const running = execFile("git", args, {
            cwd,
            env,
            encoding: "utf-8",
            maxBuffer: 64 * 1024 * 1024,
            signal,
        })
        // No input: `--stdin` and `--batch` modes see end of input instead of waiting forever.
        running.child.stdin?.end()
        const { stdout, stderr } = await running
        return { code: 0, stdout, stderr }
    } catch (error) {
        const failed = error as cp.ExecFileException & { stdout?: string; stderr?: string }
        if (typeof failed.code !== "number") throw error
        return { code: failed.code, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" }
    }
}

// Overrides that disable every configured content filter and custom merge driver.
async function helperOverrides(cwd: string, signal?: AbortSignal): Promise<string[]> {
    const found = await git(
        cwd,
        [
            ...FIXED_SETTINGS.flatMap((setting) => ["-c", setting]),
            "config",
            "--null",
            "--name-only",
            "--get-regexp",
            GIT_HELPER_CONFIG_PATTERN,
        ],
        signal,
    )
    if (found.code === 1) return []
    if (found.code !== 0) throw new Error(found.stderr.trim() || `git config exited ${found.code}`)
    const keys = found.stdout.split("\0").filter(Boolean)
    if (keys.some((key) => key.startsWith("merge.")) && !fs.existsSync(FAILING_PROGRAM))
        throw new Error(`Trusted failing program ${FAILING_PROGRAM} is unavailable`)
    return keys.map((key) => gitHelperOverride(key, FAILING_PROGRAM))
}

export async function runGitRead(cwd: string, input: GitReadInput, signal?: AbortSignal): Promise<string> {
    const relocation = inheritedGitRelocation()
    if (relocation.length)
        throw new Error(`git_read refuses inherited Git relocation settings: ${relocation.join(", ")}`)
    assertGitReadArguments(input.subcommand, input.args)
    const settings = [...FIXED_SETTINGS, ...(await helperOverrides(cwd, signal))]
    const outcome = await git(
        cwd,
        [
            "--no-pager",
            ...settings.flatMap((setting) => ["-c", setting]),
            input.subcommand,
            ...forcedArguments(input.subcommand),
            ...input.args,
        ],
        signal,
    )
    const ordinary = outcome.code === 0 || (outcome.code === 1 && acceptsExitOne(input.subcommand))
    if (!ordinary) throw new Error(outcome.stderr.trim() || outcome.stdout.trim() || `git exited ${outcome.code}`)
    const exit =
        outcome.code === 0 ? "" : `\n\n[git exited 1: ${input.subcommand === "grep" ? "no match" : "conflicts"}]`
    if (!outcome.stdout) return `(no output)${exit}`
    const truncated = truncateHead(outcome.stdout)
    if (!truncated.truncated) return `${outcome.stdout}${exit}`
    return `${truncated.content}\n\n[Output truncated: showing ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(DEFAULT_MAX_BYTES)} limit). Narrow the command, for example with -- <path>.]${exit}`
}

export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: GIT_READ_TOOL,
        label: GIT_READ_TOOL,
        description:
            "Run one read-only Git subcommand in the repository: show (including --remerge-diff), diff, log, status, blame, merge-base, merge-tree --write-tree, rev-parse, rev-list, ls-files, ls-tree, cat-file, or grep. Runs Git directly without a shell, so pipes and redirects don't apply. Refuses arguments that write files, run programs, or read untracked, ignored, or out-of-repository files, including abbreviated long options. Output is truncated to 2000 lines or 50 KB.",
        promptSnippet: "Run read-only Git commands (show, diff, log, blame, grep, merge-tree --write-tree, …)",
        parameters: GitReadInputSchema,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            const input = parse(GitReadInputValidator, params)
            const text = await runGitRead(ctx.cwd, input, signal)
            return { content: [{ type: "text" as const, text }], details: undefined }
        },
    })
}
