import * as fs from "node:fs"
import * as path from "node:path"

import * as Git from "../__lib/git.js"

export function ensureLocalSettingsExclusion(
    root: string,
    relativePath: string,
    excludePattern: string,
): { excludePath: string; changed: boolean } {
    const inGit = Git.run(root, ["ls-files", "--cached", "--", relativePath])
    const staged = Git.run(root, ["diff", "--cached", "--name-only", "--", relativePath])
    if (inGit || staged) {
        throw new Error(`${relativePath} is in Git or staged; local setup cannot overwrite it`)
    }

    const excludePath = path.resolve(root, Git.run(root, ["rev-parse", "--git-path", "info/exclude"]))
    const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf-8") : ""
    if (existing.split(/\r?\n/).includes(excludePattern)) return { excludePath, changed: false }

    fs.mkdirSync(path.dirname(excludePath), { recursive: true })
    fs.appendFileSync(excludePath, `${existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""}${excludePattern}\n`)
    return { excludePath, changed: true }
}
