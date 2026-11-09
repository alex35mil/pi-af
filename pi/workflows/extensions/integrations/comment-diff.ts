// Generated diffs posted in tracker and PR comments: one fence and fold format for every comment.

import { LINEAR_FOLD_OPEN } from "./projection.js"

// Comment bodies on both trackers stay well under GitHub's 65,536-character limit.
export const MAX_COMMENT_BODY = 60_000

/** Where the comment is rendered; each provider has its own native fold syntax. */
export type CommentPresentation = "github" | "linear"

// A fence longer than any backtick run inside the diff, so the diff can never close it.
export function fencedDiff(diff: string): string {
    const longest = Math.max(2, ...[...diff.matchAll(/`+/g)].map((match) => match[0].length))
    const fence = "`".repeat(longest + 1)
    return `${fence}diff\n${diff}\n${fence}`
}

/** The diff in a fenced block, folded under `title` with the provider's native syntax. */
export function foldedDiff(presentation: CommentPresentation, title: string, diff: string): string {
    const block = fencedDiff(diff)
    switch (presentation) {
        case "github":
            return `<details>\n<summary>${title}</summary>\n\n${block}\n\n</details>`
        case "linear":
            // Linear stores folds as `>>>`. Diff lines start with ` `, `+`, `-` or `@`, so none
            // can end the fold early.
            return `${LINEAR_FOLD_OPEN} ${title}\n\n${block}\n\n${LINEAR_FOLD_OPEN}`
    }
}
