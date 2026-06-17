/**
 * Shared project resolution and settings loader for extensions.
 *
 * Loads and merges settings from 3 tiers:
 *   1. Global:  <agent-dir>/<name>.settings.json
 *   2. Project: <repo-root>/.agents/<name>.settings.json
 *   3. Local:   <repo-root>/.agents/<name>.settings.local.json
 *
 * <repo-root> is the git repository root (or cwd if not in a git repo).
 *
 * Later tiers override earlier ones. Custom merge logic is provided by the caller.
 */

import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

import { getAgentDir } from "@earendil-works/pi-coding-agent"

const CONFIG_DIR = ".agents"

let rootDirCache: { cwd: string; root: string } | undefined

export interface ExtensionSettingsPaths {
    global: string
    project: string
    local: string
}

export function resolveRootDir(cwd: string): string {
    const resolved = path.resolve(cwd)
    if (rootDirCache?.cwd === resolved) return rootDirCache.root

    let root: string
    try {
        const output = cp
            .execFileSync("git", ["rev-parse", "--show-toplevel"], {
                cwd,
                encoding: "utf-8",
                stdio: ["ignore", "pipe", "ignore"],
            })
            .trim()
        root = output ? path.resolve(output) : resolved
    } catch {
        root = resolved
    }

    rootDirCache = { cwd: resolved, root }
    return root
}

export function resolveProjectAgentsDir(cwd: string): string {
    return path.join(resolveRootDir(cwd), CONFIG_DIR)
}

export function getExtensionSettingsPaths(name: string, cwd: string): ExtensionSettingsPaths {
    const rootDir = resolveRootDir(cwd)
    return {
        global: path.join(getAgentDir(), `${name}.settings.json`),
        project: path.join(rootDir, CONFIG_DIR, `${name}.settings.json`),
        local: path.join(rootDir, CONFIG_DIR, `${name}.settings.local.json`),
    }
}

export function loadExtensionSettings<T>(
    name: string,
    cwd: string,
    merge: (base: Partial<T>, override: Partial<T>) => Partial<T>,
): Partial<T> {
    const paths = getExtensionSettingsPaths(name, cwd)
    const global = loadJsonSafe<T>(paths.global)
    const project = loadJsonSafe<T>(paths.project)
    const local = loadJsonSafe<T>(paths.local)
    return merge(merge(global, project), local)
}

function loadJsonSafe<T>(filePath: string): Partial<T> {
    if (!fs.existsSync(filePath)) return {}
    const raw = fs.readFileSync(filePath, "utf-8")
    try {
        return JSON.parse(raw)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Invalid JSON in ${filePath}: ${message}`)
    }
}
