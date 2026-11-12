import { createHash } from "node:crypto"

import { type Static, Type } from "typebox"

import { foldedDiff, MAX_COMMENT_BODY } from "./comment-diff.js"
import { type DiffLine, unifiedLineDiff } from "./plan-diff.js"
import { assertNoLinearFoldLines } from "./projection.js"

// Announcing an update to a published plan, for any entity, so the change reaches the people
// watching the issue instead of silently editing the plan in place.
//
// The summary is passed with each update; only an update in flight is saved.
//
// - `plan-update`: the announcement is drafted and the plan update isn't confirmed. `after`
//   fingerprints the updated plan: a published plan matching it proves the update landed;
//   otherwise it didn't, and a new preparation replaces the draft.
// - `announcing`: the plan update landed; the announcement must be posted or recovered before
//   any other plan publication.
const token = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" })
const body = Type.String({ minLength: 1 })
const fingerprint = Type.String({ pattern: "^[0-9a-f]{64}$" })

// An Epic update made from one of its Tasks names that Task. Every other update has no origin.
export const AnnouncementOriginSchema = Type.Object(
    {
        kind: Type.Enum(["task"], { type: "string" }),
        entityDir: Type.String({ minLength: 1, description: "The Task's directory under this Epic" }),
    },
    { additionalProperties: false },
)
const summary = Type.String({
    minLength: 1,
    description: "Markdown summary of what changed and why, including when the change is only editorial",
})
export const AnnouncementInputSchema = Type.Object(
    { origin: Type.Optional(AnnouncementOriginSchema), summary },
    { additionalProperties: false },
)
export type AnnouncementInput = Static<typeof AnnouncementInputSchema>

export const PlanAnnouncementSchema = Type.Union([
    Type.Object(
        { state: Type.Literal("plan-update"), token, body, after: fingerprint },
        { additionalProperties: false },
    ),
    Type.Object({ state: Type.Literal("announcing"), token, body }, { additionalProperties: false }),
])
export type PlanAnnouncement = Static<typeof PlanAnnouncementSchema>
// Where the announcement's plan link points. GitHub's plan comment is on the same issue, so a
// bare fragment keeps the reader in the same view; Linear's plan is a separate document.
export type AnnouncementPlan = { presentation: "github"; commentId: number } | { presentation: "linear"; url: string }

// The announcement's link to the plan. GitHub hides its token in an HTML-comment marker; Linear
// renders that marker as text, so its token rides on the link as a query parameter.
function planLink(plan: AnnouncementPlan, token: string): string {
    switch (plan.presentation) {
        case "github":
            return `#issuecomment-${plan.commentId}`
        case "linear":
            return `${plan.url}?${LINEAR_TOKEN_PARAMETER}=${token}`
    }
}

const LINEAR_TOKEN_PARAMETER = "publication"

export function planAnnouncementMarker(token: string): string {
    return `<!-- plan-announcement:${token} -->`
}

// Whether a comment body is the announcement carrying this token, exactly once.
export function hasAnnouncementToken(
    presentation: AnnouncementPlan["presentation"],
    body: unknown,
    token: string,
): body is string {
    if (typeof body !== "string") return false
    switch (presentation) {
        case "github":
            return body.split(/\r?\n/).filter((line) => line === planAnnouncementMarker(token)).length === 1
        case "linear": {
            // Linear may wrap a link target in angle brackets.
            const link = new RegExp(`\\]\\(<?[^\\s()<>]*\\?${LINEAR_TOKEN_PARAMETER}=${token}>?\\)`, "g")
            return [...body.matchAll(link)].length === 1
        }
    }
}

// Plan comparison. Restore takes the root title from the tracker, and Linear rewrites Markdown
// on save, so lines are compared by a key that undoes those rewrites. Blank lines outside code
// don't count. Lines print as written; a removed line, read back from the provider, prints with
// Linear's code-safe rewrites undone.
type PlanLine = DiffLine & { display: string }

function planLines(source: string): PlanLine[] {
    let fence: { marker: string; length: number } | undefined
    return source
        .replace(/\r\n/g, "\n")
        .replace(/^#[ \t]+[^\n]*\n/, "")
        .split("\n")
        .flatMap((text) => {
            const opener = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(text)
            if (fence) {
                const closes =
                    opener && opener[2][0] === fence.marker && opener[2].length >= fence.length && !opener[3].trim()
                if (closes) fence = undefined
                // Linear turns `~~~` fences into backtick fences.
                const key = closes ? "```" : text.trimEnd()
                return [{ text, key, display: text }]
            }
            if (opener) {
                fence = { marker: opener[2][0], length: opener[2].length }
                return [{ text, key: `${opener[1]}\`\`\`${opener[3].trim()}`, display: text }]
            }
            if (!text.trim()) return []
            return [{ text, key: comparableLine(text), display: displayLine(text) }]
        })
}

// Applies a rewrite to the parts of a line outside inline code spans.
function outsideCode(line: string, rewrite: (text: string) => string): string {
    return line
        .split(/(`+[^`]*?`+)/)
        .map((part, index) => (index % 2 === 1 ? part : rewrite(part)))
        .join("")
}

// Undoes the rewrites Linear applies that can't alter code: list markers, task boxes and
// angle-bracketed link targets.
function displayLine(line: string): string {
    return outsideCode(
        line
            .replace(/^(\s*)[*+](\s)/, "$1-$2")
            .replace(/^(\s*)(\d+)\)(\s)/, "$1$2.$3")
            .replace(/^(\s*-\s+)\[X\]/, "$1[x]"),
        (text) => text.replace(/\]\(<([^<>\s]*)>\)/g, "]($1)"),
    )
}

function comparableLine(line: string): string {
    // Linear rewrites table delimiter rows to `| -- |` cells, dropping alignment.
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|")
    if (line.includes("|") && cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell)))
        return `|${" -- |".repeat(cells.length)}`
    return outsideCode(displayLine(line), (text) =>
        text
            // A bare URL Linear turned into a link back to the URL.
            .replace(/\[(https?:\/\/[^\]\s]+)\]\(\1\)/g, "$1")
            // Underscore emphasis becomes asterisks; underscores inside words stay.
            .replace(/(^|[^\w_])__(?=\S)(.+?)(?<=\S)__(?![\w_])/g, "$1**$2**")
            .replace(/(^|[^\w_*])_(?=\S)([^_]+?)(?<=\S)_(?![\w_])/g, "$1*$2*"),
    ).trimEnd()
}

// The plan as compared: one key per meaningful line.
export function comparablePlan(source: string): string {
    return planLines(source)
        .map((line) => line.key)
        .join("\n")
}

export function planFingerprint(source: string): string {
    return createHash("sha256").update(comparablePlan(source)).digest("hex")
}

// The diff of the published plan against the new source, by comparison keys. Removed lines come
// from the provider's copy and print in their display form; the rest print as the source has them.
export function planSourceDiff(published: string, source: string): string {
    return unifiedLineDiff(
        planLines(published).map((line) => ({ text: line.display, key: line.key })),
        planLines(source).map((line) => ({ text: line.text, key: line.key })),
    )
}

export function renderAnnouncement(input: {
    // The marker of the Task an Epic update came from.
    fromTask?: string
    summary: string
    plan: AnnouncementPlan
    diff: string
    token: string
}): string {
    if (input.plan.presentation === "linear") assertNoLinearFoldLines(input.summary, "announcement summary")
    // The comment is always on the entity's own issue, so the heading needs no entity name.
    const head = [
        input.fromTask === undefined ? "**Plan updated**" : `**Plan updated** from Task ${input.fromTask}`,
        input.summary.trim(),
        `[View the updated plan](${planLink(input.plan, input.token)})`,
    ]
    const marker = input.plan.presentation === "github" ? [planAnnouncementMarker(input.token)] : []
    const folded = foldedDiff(input.plan.presentation, "Plan diff", input.diff)
    const full = [...head, folded, ...marker].join("\n\n")
    if (full.length <= MAX_COMMENT_BODY) return full
    return [...head, "The plan diff is too large to include here; see the updated plan.", ...marker].join("\n\n")
}
