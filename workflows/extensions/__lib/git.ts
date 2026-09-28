import * as cp from "node:child_process"

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
