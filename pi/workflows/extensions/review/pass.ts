import * as fs from "node:fs"
import * as path from "node:path"

import {
    CANDIDATE_FILE,
    readReviewRounds,
    type ReviewCycle,
    type ReviewPass,
    type ReviewPhase,
    type ValidReviewRound,
} from "../__lib/review-rounds.js"
import { unifiedDiff } from "../integrations/plan-diff.js"
import { fence, MAX_EMBEDDED_FILE_BYTES, readOptional, truncate } from "./context.js"
import { renderReviewFindings, type ReviewReport, type ReviewResponse, type ReviewSignoff } from "./findings.js"
import { readEntityResponses, readRoundReport, REVIEW_REPORT_FILE } from "./round.js"

/** The pass a review call runs: a full review, or the verification of a blocked review's fixes. */
export type RoundPass = { kind: "review"; newReview?: string } | { kind: "verification"; of: ValidReviewRound }

/** What a pass adds to the reviewer's prompt: instructions, and a trailing section with its evidence. */
export interface PassPrompt {
    instructions: string[]
    sections: string
}

export const NO_PASS_PROMPT: PassPrompt = { instructions: [], sections: "" }

/**
 * Chooses the pass from the category's saved rounds. After a blocked review the next call verifies
 * its fixes. A finished `plan` or `final` cycle needs a reason for another review; the other
 * categories review a new subject on each call and restart freely.
 */
export function chooseReviewPass(cycle: ReviewCycle, phase: ReviewPhase, newReview: string | undefined): RoundPass {
    switch (cycle.state) {
        case "none":
            return { kind: "review" }
        case "awaitingVerification":
            if (newReview !== undefined)
                throw new Error(
                    `${cycle.review.entry} blocked, so this call verifies its fixes; omit newReview. A new review is possible only after the verification pass.`,
                )
            return { kind: "verification", of: cycle.review }
        case "finished":
            switch (phase) {
                case "interim":
                case "conflict-plan":
                case "conflict-merge":
                    return { kind: "review" }
                case "plan":
                case "final":
                    if (newReview === undefined)
                        throw new Error(
                            `The ${phase} review cycle is finished (${cycle.last.entry}, ${cycle.last.signoff}). Don't review again: report anything still open to the user as an open concern. Another review needs newReview, saying what changed in behavior, scope, or the Task list since that round.`,
                        )
                    return { kind: "review", newReview }
            }
    }
}

export function reviewPassRecord(pass: RoundPass): ReviewPass {
    switch (pass.kind) {
        case "review":
            return pass.newReview === undefined ? { kind: "review" } : { kind: "review", newReview: pass.newReview }
        case "verification":
            return { kind: "verification", of: pass.of.round }
    }
}

function renderResponses(report: ReviewReport, responses: readonly ReviewResponse[]): string {
    return responses
        .map((response) => {
            const finding = report.findings.find(({ id }) => id === response.id)
            const title = finding ? ` (${finding.severity}, ${finding.title.trim()})` : ""
            return `- ${response.id}${title}: ${response.outcome}. ${response.explanation.trim()}`
        })
        .join("\n")
}

// Rejections and open decisions from the category's earlier rounds, so a new review doesn't repeat them.
async function earlierResponses(entityDir: string, phase: ReviewPhase): Promise<string> {
    const chunks: string[] = []
    for (const { entry, directory } of readReviewRounds(entityDir, phase)) {
        if (!fs.existsSync(path.join(directory, REVIEW_REPORT_FILE))) continue
        const responses = await readEntityResponses(directory)
        if (responses.length === 0) continue
        chunks.push(`## ${entry}\n\n${renderResponses(await readRoundReport(directory), responses)}`)
    }
    return chunks.join("\n\n")
}

/**
 * The prompt additions for a pass. `candidate` is this round's `candidate.md` when the category
 * snapshots one; a verification then shows how that text changed since the verified round.
 */
export async function reviewPassPrompt(
    entityDir: string,
    phase: ReviewPhase,
    pass: RoundPass,
    candidate: string | undefined,
): Promise<PassPrompt> {
    switch (pass.kind) {
        case "review": {
            const earlier = await earlierResponses(entityDir, phase)
            return {
                instructions: pass.newReview
                    ? [
                          `An earlier ${phase} review cycle finished. This new review was requested because: ${pass.newReview}`,
                      ]
                    : [],
                sections: earlier
                    ? [
                          "# Earlier review responses",
                          "",
                          "Findings from earlier rounds that the main agent rejected or left for the user's decision. Don't raise a rejected finding again without new evidence.",
                          "",
                          earlier,
                      ].join("\n")
                    : "",
            }
        }
        case "verification": {
            const report = await readRoundReport(pass.of.directory)
            const responses = await readEntityResponses(pass.of.directory)
            const previous = candidate ? await readOptional(path.join(pass.of.directory, CANDIDATE_FILE)) : ""
            const diff = candidate && previous ? unifiedDiff(previous, await readOptional(candidate)) : undefined
            return {
                instructions: [
                    `This is a verification pass for ${pass.of.entry}, not a new review.`,
                    "Check only that each accepted blocking finding under Findings under verification is fixed, and that the fixes introduced no defect. A blocking finding without a recorded response was accepted. A rejected finding stays rejected unless its explanation is wrong.",
                    "Report as blocking only a finding that is still not fixed or a defect that a fix introduced. Stay within the fixes: do not review unchanged work again and do not raise new notes.",
                ],
                sections: [
                    `# Findings under verification (${pass.of.entry})`,
                    "",
                    renderReviewFindings(report.findings),
                    "",
                    "## Recorded responses",
                    "",
                    responses.length ? renderResponses(report, responses) : "None. Every finding was accepted.",
                    ...(diff === undefined
                        ? []
                        : [
                              "",
                              `# Text changes since ${pass.of.entry}/${CANDIDATE_FILE}`,
                              "",
                              fence(truncate(diff || "(no changes)", MAX_EMBEDDED_FILE_BYTES), "diff"),
                          ]),
                ].join("\n"),
            }
        }
    }
}

const AFTER_BLOCKED_REVIEW =
    "Next: fix the blocking findings you accept. Record each finding you reject or that needs the user's decision with record_review_response. Then call this review tool again; it runs the verification pass. Apply a note only when it's clearly worth it."
const AFTER_NOTES = "The review cycle is finished. Notes need no response and no further review."

function afterBlockedVerification(reviewed: string): string {
    return `The review cycle is finished (verification of ${reviewed}). Report each finding that is still open to the user as an open concern, one line each. Do not run another review for them.`
}

/** What the main agent does after the round, shown before the report. */
export function reviewPassNotice(pass: RoundPass, signoff: ReviewSignoff, findingCount: number): string | undefined {
    switch (signoff) {
        case "approved":
            return findingCount > 0 ? AFTER_NOTES : undefined
        case "blocked":
            switch (pass.kind) {
                case "review":
                    return AFTER_BLOCKED_REVIEW
                case "verification":
                    return afterBlockedVerification(pass.of.entry)
            }
    }
}
