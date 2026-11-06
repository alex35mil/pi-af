// Line-based unified diff for plan announcements. Plans are small, so a trimmed
// LCS table is enough; very large middles fall back to a whole-block replacement.
const CONTEXT = 3
const MAX_TABLE_CELLS = 4_000_000

type Op = { kind: "same" | "removed" | "added"; text: string }

// A line as printed, and the key it is compared by.
export type DiffLine = { text: string; key: string }

function lineOps(before: DiffLine[], after: DiffLine[]): Op[] {
    let start = 0
    while (start < before.length && start < after.length && before[start].key === after[start].key) start++
    let end = 0
    while (
        end < before.length - start &&
        end < after.length - start &&
        before[before.length - 1 - end].key === after[after.length - 1 - end].key
    )
        end++
    const a = before.slice(start, before.length - end)
    const b = after.slice(start, after.length - end)
    const middle: Op[] = []
    if (a.length * b.length > MAX_TABLE_CELLS) {
        middle.push(...a.map((line) => ({ kind: "removed" as const, text: line.text })))
        middle.push(...b.map((line) => ({ kind: "added" as const, text: line.text })))
    } else {
        // lengths[i][j]: LCS length of a[i..] and b[j..].
        const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
        for (let i = a.length - 1; i >= 0; i--)
            for (let j = b.length - 1; j >= 0; j--)
                lengths[i][j] =
                    a[i].key === b[j].key ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
        let i = 0
        let j = 0
        while (i < a.length || j < b.length) {
            if (i < a.length && j < b.length && a[i].key === b[j].key) {
                // Matching lines print as the new text.
                middle.push({ kind: "same", text: b[j].text })
                i++
                j++
            } else if (i < a.length && (j === b.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
                // Removals come first, so a replaced line reads old then new.
                middle.push({ kind: "removed", text: a[i++].text })
            } else middle.push({ kind: "added", text: b[j++].text })
        }
    }
    return [
        ...after.slice(0, start).map((line) => ({ kind: "same" as const, text: line.text })),
        ...middle,
        ...after.slice(after.length - end).map((line) => ({ kind: "same" as const, text: line.text })),
    ]
}

// Returns unified-diff hunks without file headers, or an empty string when nothing changed.
export function unifiedDiff(before: string, after: string): string {
    const split = (text: string) =>
        text
            .replace(/\r\n/g, "\n")
            .replace(/\n$/, "")
            .split("\n")
            .map((line) => ({ text: line, key: line }))
    return unifiedLineDiff(split(before), split(after))
}

// Diffs lines by their keys, printing each line's text.
export function unifiedLineDiff(before: DiffLine[], after: DiffLine[]): string {
    const ops = lineOps(before, after)
    const changed = ops.flatMap((op, index) => (op.kind === "same" ? [] : [index]))
    if (changed.length === 0) return ""
    // Group changes whose context windows touch into one hunk.
    const ranges: [number, number][] = []
    for (const index of changed) {
        const from = Math.max(0, index - CONTEXT)
        const to = Math.min(ops.length, index + CONTEXT + 1)
        const last = ranges.at(-1)
        if (last && from <= last[1]) last[1] = to
        else ranges.push([from, to])
    }
    const hunks: string[] = []
    for (const [from, to] of ranges) {
        let oldLine = 1
        let newLine = 1
        for (const op of ops.slice(0, from)) {
            if (op.kind !== "added") oldLine++
            if (op.kind !== "removed") newLine++
        }
        const slice = ops.slice(from, to)
        const oldCount = slice.filter((op) => op.kind !== "added").length
        const newCount = slice.filter((op) => op.kind !== "removed").length
        const header = `@@ -${oldCount ? oldLine : oldLine - 1},${oldCount} +${newCount ? newLine : newLine - 1},${newCount} @@`
        const prefix = { same: " ", removed: "-", added: "+" } as const
        hunks.push([header, ...slice.map((op) => prefix[op.kind] + op.text)].join("\n"))
    }
    return hunks.join("\n")
}
