import { createHash } from "node:crypto"

import { StringEnum } from "@earendil-works/pi-ai"
import { type Static, Type } from "typebox"

import { foldedDiff, MAX_COMMENT_BODY } from "./comment-diff.js"
import { unifiedDiff } from "./plan-diff.js"

// Announcing an update to a published plan, for any entity, so the change reaches the people
// watching the issue instead of silently editing the plan in place.
//
// - `presented`: the plan presentation saved the approved-with-the-diff summary; the target isn't
//   written yet. `after` fingerprints the presented snapshot.
// - `accepted`: the first write of the target after presentation succeeded. `after` fingerprints
//   the file as written, including user edits made on acceptance; publication uses this summary
//   when the source matches.
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
        kind: StringEnum(["task"] as const),
        entityDir: Type.String({ minLength: 1, description: "The Task's directory under this Epic" }),
    },
    { additionalProperties: false },
)
const summary = Type.String({
    minLength: 1,
    description: "The approved Markdown summary of what changed and why, including when the change is only editorial",
})
export const AnnouncementInputSchema = Type.Object(
    { origin: Type.Optional(AnnouncementOriginSchema), summary },
    { additionalProperties: false },
)
export type AnnouncementInput = Static<typeof AnnouncementInputSchema>

export const PlanAnnouncementSchema = Type.Union([
    Type.Object(
        {
            state: Type.Literal("presented"),
            summary,
            origin: Type.Optional(AnnouncementOriginSchema),
            after: fingerprint,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            state: Type.Literal("accepted"),
            summary,
            origin: Type.Optional(AnnouncementOriginSchema),
            after: fingerprint,
        },
        { additionalProperties: false },
    ),
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

function planLink(plan: AnnouncementPlan): string {
    switch (plan.presentation) {
        case "github":
            return `#issuecomment-${plan.commentId}`
        case "linear":
            return plan.url
    }
}

export function planAnnouncementMarker(token: string): string {
    return `<!-- plan-announcement:${token} -->`
}

export function hasAnnouncementMarker(body: unknown, token: string): body is string {
    return (
        typeof body === "string" &&
        body.split(/\r?\n/).filter((line) => line === planAnnouncementMarker(token)).length === 1
    )
}

// The plan as readers see it, for comparison. Drops the root title, which restore takes from
// the tracker, and normalizations Linear applies on save: `*` bullets and list blank lines.
export function comparablePlan(source: string): string {
    let fence: string | undefined
    return source
        .replace(/\r\n/g, "\n")
        .replace(/^#[ \t]+[^\n]*\n/, "")
        .split("\n")
        .flatMap((line) => {
            const opener = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
            if (fence) {
                if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = undefined
                return [line]
            }
            if (opener) fence = opener
            if (!line.trim()) return []
            return [line.replace(/^(\s*)[*+](\s)/, "$1-$2").trimEnd()]
        })
        .join("\n")
}

export function planFingerprint(source: string): string {
    return createHash("sha256").update(comparablePlan(source)).digest("hex")
}

export function planSourceDiff(published: string, source: string): string {
    return unifiedDiff(comparablePlan(published), comparablePlan(source))
}

export function renderAnnouncement(input: {
    // The marker of the Task an Epic update came from.
    fromTask?: string
    summary: string
    plan: AnnouncementPlan
    diff: string
    token: string
}): string {
    // The comment is always on the entity's own issue, so the heading needs no entity name.
    const head = [
        input.fromTask === undefined ? "**Plan updated**" : `**Plan updated** from Task ${input.fromTask}`,
        input.summary.trim(),
        `[View the updated plan](${planLink(input.plan)})`,
    ]
    const marker = planAnnouncementMarker(input.token)
    const folded = foldedDiff(input.plan.presentation, "Plan diff", input.diff)
    const full = [...head, folded, marker].join("\n\n")
    if (full.length <= MAX_COMMENT_BODY) return full
    return [...head, "The plan diff is too large to include here; see the updated plan.", marker].join("\n\n")
}
