import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, Type } from "typebox"

import { compile, parse } from "../../../extensions/__lib/schema.js"
import { LOCAL_REVIEWS_DIR } from "./entity.js"

// Saved review rounds of an entity and the cycle they form. A category's cycle is one review and,
// when that review blocked, one verification pass. The review tools choose the next pass from it,
// and PR creation and Epic Task acceptance require a finished cycle.

export const REVIEW_PHASES = ["plan", "interim", "final", "conflict-plan", "conflict-merge"] as const
export type ReviewPhase = (typeof REVIEW_PHASES)[number]

export const REVIEW_OUTCOME_FILE = "outcome.json"
export const REVIEW_PASS_FILE = "pass.json"
export const CANDIDATE_FILE = "candidate.md"

const ReviewOutcomeSchema = Type.Object(
    {
        exitCode: Type.Integer(),
        signoff: Type.Union([Type.Literal("approved"), Type.Literal("blocked"), Type.Null()]),
    },
    { additionalProperties: false },
)
const ReviewOutcomeValidator = compile(ReviewOutcomeSchema)
export type ReviewOutcome = Static<typeof ReviewOutcomeSchema>

// What a round is: a full review, or the verification of an earlier blocked review's fixes.
const ReviewPassSchema = Type.Union([
    Type.Object(
        { kind: Type.Literal("review"), newReview: Type.Optional(Type.String({ minLength: 1 })) },
        { additionalProperties: false },
    ),
    Type.Object(
        { kind: Type.Literal("verification"), of: Type.Integer({ minimum: 1 }) },
        { additionalProperties: false },
    ),
])
const ReviewPassValidator = compile(ReviewPassSchema)
export type ReviewPass = Static<typeof ReviewPassSchema>

export interface ReviewRound {
    entry: string
    round: number
    directory: string
}

/** A round that returned a valid report. A failed round isn't a pass and never appears here. */
export interface ValidReviewRound extends ReviewRound {
    pass: ReviewPass
    signoff: "approved" | "blocked"
}

export type ReviewCycle =
    | { state: "none" }
    | { state: "awaitingVerification"; review: ValidReviewRound }
    | { state: "finished"; last: ValidReviewRound }

export function reviewRoundName(phase: ReviewPhase, round: number): string {
    return `${phase}-${round.toString().padStart(3, "0")}`
}

export function readReviewRounds(entityDir: string, phase: ReviewPhase): ReviewRound[] {
    const reviewsDir = path.join(entityDir, LOCAL_REVIEWS_DIR)
    const entries = fs.existsSync(reviewsDir) ? fs.readdirSync(reviewsDir) : []
    return entries
        .flatMap((entry) => {
            const match = new RegExp(`^${phase}-(\\d{3})$`).exec(entry)
            return match ? [{ entry, round: Number(match[1]), directory: path.join(reviewsDir, entry) }] : []
        })
        .sort((left, right) => left.round - right.round)
}

/** The round's outcome, or undefined while it has none: a round still running or one that crashed. */
export function readReviewOutcome(roundDir: string): ReviewOutcome | undefined {
    const file = path.join(roundDir, REVIEW_OUTCOME_FILE)
    if (!fs.existsSync(file)) return undefined
    return parse(ReviewOutcomeValidator, JSON.parse(fs.readFileSync(file, "utf-8")))
}

export function isFailedOutcome(outcome: ReviewOutcome): boolean {
    return outcome.exitCode !== 0 || outcome.signoff === null
}

export function writeReviewPass(roundDir: string, pass: ReviewPass): void {
    fs.writeFileSync(path.join(roundDir, REVIEW_PASS_FILE), `${JSON.stringify(pass, null, 4)}\n`, {
        encoding: "utf-8",
        flag: "wx",
    })
}

function readReviewPass(round: ReviewRound): ReviewPass {
    const file = path.join(round.directory, REVIEW_PASS_FILE)
    if (!fs.existsSync(file)) throw new Error(`review round ${round.entry} has no ${REVIEW_PASS_FILE}`)
    return parse(ReviewPassValidator, JSON.parse(fs.readFileSync(file, "utf-8")))
}

/** The newest round of the category that returned a valid report. */
export function lastValidReviewRound(entityDir: string, phase: ReviewPhase): ValidReviewRound | undefined {
    for (const round of readReviewRounds(entityDir, phase).reverse()) {
        const outcome = readReviewOutcome(round.directory)
        if (!outcome || outcome.exitCode !== 0 || outcome.signoff === null) continue
        return { ...round, pass: readReviewPass(round), signoff: outcome.signoff }
    }
    return undefined
}

export function readReviewCycle(entityDir: string, phase: ReviewPhase): ReviewCycle {
    const last = lastValidReviewRound(entityDir, phase)
    if (!last) return { state: "none" }
    switch (last.pass.kind) {
        case "verification":
            return { state: "finished", last }
        case "review":
            switch (last.signoff) {
                case "approved":
                    return { state: "finished", last }
                case "blocked":
                    return { state: "awaitingVerification", review: last }
            }
    }
}

/** Why the category's newest cycle isn't finished, in words a refusal can end with. */
export function unfinishedCycleReason(cycle: Exclude<ReviewCycle, { state: "finished" }>, phase: ReviewPhase): string {
    switch (cycle.state) {
        case "none":
            return `no ${phase} review has run`
        case "awaitingVerification":
            return `${cycle.review.entry} blocked and its fixes aren't verified; run the ${phase} review again for the verification pass`
    }
}
