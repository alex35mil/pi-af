import { createHash } from "node:crypto"

import { StringEnum } from "@earendil-works/pi-ai"
import { type Static, Type } from "typebox"

import { unifiedDiff } from "./plan-diff.js"

// Announcing an update to a published plan, for any entity, so the change reaches the people
// watching the issue instead of silently editing the plan in place.
//
// - `plan-update`: the announcement is drafted and the plan update isn't confirmed. `after`
//   fingerprints the updated plan: a published plan matching it proves the update landed;
//   otherwise it didn't, and a new preparation replaces the draft.
// - `announcing`: the plan update landed; the announcement must be posted or recovered before
//   any other plan publication.
const token = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" })
const body = Type.String({ minLength: 1 })
export const PlanAnnouncementSchema = Type.Union([
    Type.Object(
        { state: Type.Literal("plan-update"), token, body, after: Type.String({ pattern: "^[0-9a-f]{64}$" }) },
        { additionalProperties: false },
    ),
    Type.Object({ state: Type.Literal("announcing"), token, body }, { additionalProperties: false }),
])
export type PlanAnnouncement = Static<typeof PlanAnnouncementSchema>

// An Epic update made from one of its Tasks names that Task. Every other update has no origin.
export const AnnouncementOriginSchema = Type.Object(
    {
        kind: StringEnum(["task"] as const),
        entityDir: Type.String({ minLength: 1, description: "The Task's directory under this Epic" }),
    },
    { additionalProperties: false },
)
export const AnnouncementInputSchema = Type.Object(
    {
        origin: Type.Optional(AnnouncementOriginSchema),
        summary: Type.String({
            minLength: 1,
            description:
                "The approved Markdown summary of what changed and why, including when the change is only editorial",
        }),
    },
    { additionalProperties: false },
)
export type AnnouncementInput = Static<typeof AnnouncementInputSchema>
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

// Comment bodies on both trackers stay well under GitHub's 65,536-character limit.
const MAX_BODY = 60_000

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

function fenced(diff: string): string {
    const longest = Math.max(2, ...[...diff.matchAll(/`+/g)].map((match) => match[0].length))
    const fence = "`".repeat(longest + 1)
    return `${fence}diff\n${diff}\n${fence}`
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
    const block = fenced(input.diff)
    // A diff line starting with `+++` would close a Linear fold early, so it stays unfolded.
    const folded = (() => {
        switch (input.plan.presentation) {
            case "github":
                return `<details>\n<summary>Plan diff</summary>\n\n${block}\n\n</details>`
            case "linear":
                return /^\+\+\+/m.test(input.diff) ? block : `+++ Plan diff\n\n${block}\n\n+++`
        }
    })()
    const full = [...head, folded, marker].join("\n\n")
    if (full.length <= MAX_BODY) return full
    return [...head, "The plan diff is too large to include here; see the updated plan.", marker].join("\n\n")
}
