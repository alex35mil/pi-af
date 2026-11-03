import * as cp from "node:child_process"

// Inherited variables that relocate Git's repository, index, or configuration away from the working directory.
export const GIT_RELOCATION_VARIABLES = [
    "GIT_DIR",
    "GIT_COMMON_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
] as const

export function inheritedGitRelocation(env: NodeJS.ProcessEnv = process.env): string[] {
    return GIT_RELOCATION_VARIABLES.filter((key) => env[key] !== undefined)
}

// A trusted program that always fails, substituted for configured helpers that must not run.
export const FAILING_PROGRAM = "/usr/bin/false"

// Repository configuration that runs programs during content conversion or merging.
export const GIT_HELPER_CONFIG_PATTERN = "^(filter\\..*\\.(clean|smudge|process|required)|merge\\..*\\.driver)$"

/**
 * The `-c` override that disables one configured helper key found by `GIT_HELPER_CONFIG_PATTERN`.
 * A disabled custom merge driver must report a conflict rather than silently accept ours, so it
 * becomes `failingDriver`.
 */
export function gitHelperOverride(key: string, failingDriver: string): string {
    const value = key.startsWith("merge.") ? failingDriver : key.endsWith(".required") ? "false" : ""
    return `${key}=${value}`
}

export function run(cwd: string, args: string[]): string {
    const result = cp.spawnSync("git", args, { cwd, encoding: "utf-8" })
    if (result.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`)
    }
    return result.stdout.trim()
}

export function tryRun(cwd: string, args: string[]): string {
    const result = cp.spawnSync("git", args, { cwd, encoding: "utf-8" })
    return result.status === 0 ? result.stdout.trim() : ""
}

export function succeeds(cwd: string, args: string[]): boolean {
    return cp.spawnSync("git", args, { cwd, encoding: "utf-8" }).status === 0
}
