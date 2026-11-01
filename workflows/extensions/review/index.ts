import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

import { StringEnum } from "@earendil-works/pi-ai"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"
import { workflowTools } from "../__lib/tools.js"

import * as project from "../../../extensions/__lib/project.js"
import { EPIC_ROOT, GIG_ROOT, PROJECT_ROOT, type DeliverableKind } from "../__lib/domain.js"
import {
    entityLabel,
    LOCAL_DRAFT_FILE,
    LOCAL_REVIEWS_DIR,
    readEntityStatus,
    readPendingEntries,
    resolveEntityPath,
} from "../__lib/entity.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import type { PublicationState } from "../integrations/plan-publication.js"
import { trackerPlanPublication } from "../integrations/records.js"
import { executeReviewRound, recordRoundResponse, renderReviewRoundResult } from "./round.js"
import { reviewerEnvironment } from "./model.js"
import { registerPullRequestReview } from "./pull-request.js"
import { buildEpicReviewPrompt } from "./epic.js"
import { reviewAgentOutputInstructions, ReviewResponseFindingInputSchema, reviewResponseFindings } from "./findings.js"
import {
    fence,
    MAX_EMBEDDED_FILE_BYTES,
    readOptional,
    REVIEW_AUTHORITY_INSTRUCTIONS,
    REVIEW_DOCUMENT_INSTRUCTIONS,
    truncate,
} from "./context.js"

const MAX_DIFF_BYTES = 180 * 1024
const REVIEW_OUTCOME_FILE = "outcome.json"
const REVIEW_REPORT_FILE = "report.json"
const CANDIDATE_FILE = "candidate.md"

type ReviewPhase = "plan" | "interim" | "final"
/** Review categories whose rounds snapshot a candidate that a presentation tool can hand to the user. */
type SnapshotPhase = "plan" | "final"
type ReviewEntity = "epic" | "task" | "gig"

/** What a Deliverable review round reviews, with the snapshot only the categories that take one carry. */
export type DeliverableReviewRound =
    | { phase: "plan"; planSnapshot: string }
    | { phase: "interim"; subject?: string }
    | { phase: "final"; completionSnapshot: string }

const ReviewOutcomeSchema = Type.Object(
    {
        exitCode: Type.Integer(),
        signoff: Type.Union([Type.Literal("approved"), Type.Literal("blocked"), Type.Null()]),
    },
    { additionalProperties: false },
)
const optionalReviewerProperties = {
    instructions: Type.Optional(Type.String({ description: "Extra review instructions for this run" })),
    model: Type.Optional(Type.String({ description: "Optional pi model pattern for the reviewer" })),
}

export const ReviewRequestSchema = Type.Union([
    Type.Object(
        {
            entity: Type.Literal("epic"),
            entityDir: Type.String({ description: `Epic directory under ${EPIC_ROOT}/` }),
            phase: Type.Enum(["plan"], { type: "string" }),
            ...optionalReviewerProperties,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            entity: Type.Literal("task"),
            entityDir: Type.String({ description: "Task directory under an Epic's tasks/ directory" }),
            phase: StringEnum(["plan", "interim", "final"] as const),
            subject: Type.Optional(Type.String({ description: "Interim review subject/question" })),
            ...optionalReviewerProperties,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            entity: Type.Literal("gig"),
            entityDir: Type.String({ description: `Gig directory under ${GIG_ROOT}/` }),
            phase: StringEnum(["plan", "interim", "final"] as const),
            subject: Type.Optional(Type.String({ description: "Interim review subject/question" })),
            ...optionalReviewerProperties,
        },
        { additionalProperties: false },
    ),
])
type ReviewAgentParams = Static<typeof ReviewRequestSchema>

export const RecordReviewResponseSchema = Type.Object(
    {
        entityDir: Type.String({ description: "Epic, Task, or Gig directory" }),
        phase: StringEnum(["plan", "interim", "final"] as const),
        round: Type.Integer({ minimum: 1 }),
        findings: Type.Array(ReviewResponseFindingInputSchema),
        status: Type.String({ minLength: 1, description: "Plain-language correction and review status" }),
    },
    { additionalProperties: false },
)
type RecordReviewResponseParams = Static<typeof RecordReviewResponseSchema>

const optionalPresentationProperties = {
    snapshot: Type.Optional(
        Type.String({ description: "Optional reviewed plan snapshot path, e.g. reviews/plan-002/candidate.md" }),
    ),
}

export const PreparePlanPresentationSchema = Type.Union([
    Type.Object(
        {
            entity: Type.Literal("epic"),
            entityDir: Type.String({ description: `Epic directory under ${EPIC_ROOT}/` }),
            ...optionalPresentationProperties,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            entity: Type.Literal("task"),
            entityDir: Type.String({ description: "Task directory under an Epic's tasks/ directory" }),
            ...optionalPresentationProperties,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            entity: Type.Literal("gig"),
            entityDir: Type.String({ description: `Gig directory under ${GIG_ROOT}/` }),
            ...optionalPresentationProperties,
        },
        { additionalProperties: false },
    ),
])
type PreparePlanPresentationParams = Static<typeof PreparePlanPresentationSchema>

const completionPresentationProperties = {
    snapshot: Type.Optional(
        Type.String({
            description:
                "Optional reviewed completion snapshot path; must be the newest final round's, e.g. reviews/final-002/candidate.md",
        }),
    ),
}

export const PrepareCompletionPresentationSchema = Type.Union([
    Type.Object(
        {
            entity: Type.Literal("task"),
            entityDir: Type.String({ description: "Task directory under an Epic's tasks/ directory" }),
            ...completionPresentationProperties,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            entity: Type.Literal("gig"),
            entityDir: Type.String({ description: `Gig directory under ${GIG_ROOT}/` }),
            ...completionPresentationProperties,
        },
        { additionalProperties: false },
    ),
])
type PrepareCompletionPresentationParams = Static<typeof PrepareCompletionPresentationSchema>

interface ParentEpicContext {
    relDir: string
    content: string
}

export default function (pi: ExtensionAPI) {
    const tools = workflowTools(pi, "reviews")
    registerPullRequestReview(pi)
    const reviews = [
        ["epic", ReviewRequestSchema.anyOf[0]],
        ["task", ReviewRequestSchema.anyOf[1]],
        ["gig", ReviewRequestSchema.anyOf[2]],
    ] as const
    for (const [entity, schema] of reviews) {
        const parameters = Type.Omit(schema, ["entity"])
        tools.registerTool({
            name: `review_${entity}`,
            label: `review_${entity}`,
            description:
                "Run one strict Epic, Task, or Gig planning review, or a Task/Gig interim or final implementation review. Persists one numbered local review round and pauses immediately when the configured blocked-review confirmation threshold is reached.",
            parameters,

            async execute(_toolCallId, params, signal, onUpdate, ctx) {
                const input: ReviewAgentParams = Value.Parse(ReviewRequestSchema, {
                    ...Value.Parse(parameters, params),
                    entity,
                })
                const projectConfig = assertArtifactPersistencePrepared(ctx.cwd)
                const entityDir = resolveEntityDir(ctx.cwd, input.entityDir)
                const phase = input.phase

                if (!fs.existsSync(entityDir)) {
                    return textResult(`Entity directory does not exist: ${path.relative(ctx.cwd, entityDir)}`, true)
                }
                assertReviewEntity(entityDir, input.entity)
                assertReviewPhase(entityDir, phase)
                assertReviewPreconditions(entityDir, phase)

                const round = await nextReviewRound(entityDir, phase)
                const reviewRoundDir = await createReviewRoundDirectory(entityDir, phase, round)
                const requestPath = path.join(reviewRoundDir, "request.md")

                let snapshotPath: string | undefined
                let prompt: string
                if (input.entity === "epic") {
                    snapshotPath = await snapshotCandidate(entityDir, input.phase, round)
                    prompt = await buildEpicReviewPrompt(
                        ctx,
                        entityDir,
                        snapshotPath,
                        await readPreviousReviewArtifacts(entityDir, phase),
                        input.instructions,
                    )
                } else {
                    const reviewRound = await snapshotDeliverableRound(entityDir, input, round)
                    snapshotPath = deliverableRoundSnapshot(reviewRound)
                    prompt = await buildDeliverableReviewPrompt(ctx, entityDir, reviewRound, input.instructions)
                }
                onUpdate?.(textResult(`Review agent started: ${path.relative(ctx.cwd, requestPath)}`))

                const { report } = await executeReviewRound({
                    environment: reviewerEnvironment(pi, ctx.modelRegistry),
                    cwd: ctx.cwd,
                    directory: reviewRoundDir,
                    additionalFiles: snapshotPath ? [snapshotPath] : [],
                    prompt,
                    signal,
                    model: input.model,
                    agentName: `${input.entity}-review`,
                    progressLabel: `${input.entity === "epic" ? "Epic" : "Deliverable"} review agent`,
                    onUpdate: (update) => onUpdate?.(textResult(update)),
                }).catch(async (error: unknown) => {
                    const message = error instanceof Error ? error.message : String(error)
                    const failedGate = await failedReviewGate(entityDir, phase, round)
                    throw new Error(failedGate ? `${message}\n\n${formatFailedReviewPause(failedGate)}` : message)
                })
                const signoff = report.signoff

                const blockedGate = await blockedReviewGate(
                    entityDir,
                    phase,
                    round,
                    projectConfig.reviews?.userConfirmationAfter,
                )
                const text = renderReviewRoundResult(
                    report,
                    round,
                    blockedGate ? formatBlockedReviewPause(blockedGate) : undefined,
                )
                return textResult(text, false, { signoff, blockedGate })
            },
        })
    }

    tools.registerTool({
        name: "record_review_response",
        label: "record_review_response",
        description:
            "Persist an adjudicated review finding list with the canonical renderer and return the exact same Markdown for chat.",
        parameters: RecordReviewResponseSchema,

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input: RecordReviewResponseParams = Value.Parse(RecordReviewResponseSchema, params)
            assertArtifactPersistencePrepared(ctx.cwd)
            const entityDir = resolveEntityDir(ctx.cwd, input.entityDir)
            readEntityStatus(entityDir)

            const roundName = `${input.phase}-${input.round.toString().padStart(3, "0")}`
            const roundDir = path.join(entityDir, LOCAL_REVIEWS_DIR, roundName)
            const reportPath = path.join(roundDir, REVIEW_REPORT_FILE)
            if (!fs.existsSync(reportPath)) throw new Error(`review report does not exist: ${roundName}`)
            const content = await recordRoundResponse(roundDir, reviewResponseFindings(input.findings), input.status)
            return textResult(content, false, { round: roundName, findingCount: input.findings.length })
        },
    })

    const presentations = [
        ["epic", PreparePlanPresentationSchema.anyOf[0]],
        ["task", PreparePlanPresentationSchema.anyOf[1]],
        ["gig", PreparePlanPresentationSchema.anyOf[2]],
    ] as const
    for (const [entity, schema] of presentations) {
        const parameters = Type.Omit(schema, ["entity"])
        tools.registerTool({
            name: `prepare_${entity}_plan_presentation`,
            label: `prepare_${entity}_plan_presentation`,
            description:
                "Validate and select an Epic, Task, or Gig's approved planning snapshot. Return snapshot and target paths for the write tool to present the approval diff. When the plan is already published, or its first publication is pending, the result also asks for the plan-update announcement summary to show with the diff.",
            parameters,

            async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                const input: PreparePlanPresentationParams = Value.Parse(PreparePlanPresentationSchema, {
                    ...Value.Parse(parameters, params),
                    entity,
                })
                assertArtifactPersistencePrepared(ctx.cwd)
                const entityDir = resolveEntityDir(ctx.cwd, input.entityDir)

                if (!fs.existsSync(entityDir)) {
                    return textResult(`Entity directory does not exist: ${path.relative(ctx.cwd, entityDir)}`, true)
                }
                assertReviewEntity(entityDir, input.entity)
                assertReviewPhase(entityDir, "plan")
                const publication = trackerPlanPublication(readEntityStatus(entityDir).tracker)

                const snapshotPath = input.snapshot
                    ? resolveSnapshotPath(ctx.cwd, entityDir, input.snapshot)
                    : await latestApprovedPlanSnapshot(entityDir)

                if (snapshotPath && input.snapshot) await requireApprovedSnapshot(entityDir, snapshotPath, "plan")
                if (!snapshotPath) {
                    return textResult("No approved plan review snapshot found.", true)
                }

                const relSnapshot = path.relative(ctx.cwd, snapshotPath)
                const relPlan = path.relative(
                    ctx.cwd,
                    path.join(entityDir, input.entity === "epic" ? "epic.md" : "plan.md"),
                )

                return textResult(
                    presentationInstructions({ subject: "plan", publication: publication.state }, relSnapshot, relPlan),
                )
            },
        })
    }

    const completionPresentations = [
        ["task", PrepareCompletionPresentationSchema.anyOf[0]],
        ["gig", PrepareCompletionPresentationSchema.anyOf[1]],
    ] as const
    for (const [entity, schema] of completionPresentations) {
        const parameters = Type.Omit(schema, ["entity"])
        tools.registerTool({
            name: `prepare_${entity}_completion_presentation`,
            label: `prepare_${entity}_completion_presentation`,
            description:
                "Validate a Task or Gig's newest final review round and select its approved completion snapshot. Return snapshot and target (result.md or report.md) paths for the write tool to present the user's review diff.",
            parameters,

            async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                const input: PrepareCompletionPresentationParams = Value.Parse(PrepareCompletionPresentationSchema, {
                    ...Value.Parse(parameters, params),
                    entity,
                })
                assertArtifactPersistencePrepared(ctx.cwd)
                const entityDir = resolveEntityDir(ctx.cwd, input.entityDir)

                if (!fs.existsSync(entityDir)) {
                    return textResult(`Entity directory does not exist: ${path.relative(ctx.cwd, entityDir)}`, true)
                }
                assertReviewEntity(entityDir, input.entity)
                assertReviewPhase(entityDir, "final")

                const snapshotPath = await newestApprovedFinalSnapshot(
                    entityDir,
                    input.snapshot ? resolveSnapshotPath(ctx.cwd, entityDir, input.snapshot) : undefined,
                )
                const target = path.join(entityDir, completionFiles(deliverableStatus(entityDir).kind).artifact)
                return textResult(
                    presentationInstructions(
                        { subject: "completion" },
                        path.relative(ctx.cwd, snapshotPath),
                        path.relative(ctx.cwd, target),
                    ),
                )
            },
        })
    }
}

function resolveEntityDir(cwd: string, raw: string): string {
    const root = project.resolveRootDir(cwd)
    return resolveEntityPath(root, cwd, raw)
}

export function assertReviewPhase(directory: string, phase: ReviewPhase): void {
    const status = readEntityStatus(directory)
    const requiredPhase = phase === "plan" ? "planning" : "selfReview"
    if (status.phase !== requiredPhase) {
        throw new Error(
            `${entityLabel(status)} ${phase} review requires Phase ${phase === "plan" ? "Planning" : "Self-Review"}`,
        )
    }
}

/**
 * Every input a review round needs, checked before the round directory exists, so a rejected
 * review leaves `reviews/` unchanged and doesn't consume a round number.
 */
export function assertReviewPreconditions(directory: string, phase: ReviewPhase): void {
    const status = readEntityStatus(directory)
    if (phase === "plan" && !fs.existsSync(path.join(directory, LOCAL_DRAFT_FILE)))
        throw new Error(`Planning draft does not exist: ${LOCAL_DRAFT_FILE}`)
    // A Task's parent Epic needs no check here: reading its metadata already requires it.
    switch (status.entity) {
        case "epic":
            if (!fs.existsSync(path.join(directory, "brief.md")))
                throw new Error(`${entityLabel(status)} review requires brief.md`)
            return
        case "task":
        case "gig":
            break
    }
    if (phase !== "final") return
    const pendingEntries = readPendingEntries(directory)
    if (pendingEntries.length > 0)
        throw new Error(
            `${entityLabel(status)} final review requires zero unchecked pending entries; unresolved entries: ${pendingEntries.map(({ line }) => `line ${line}`).join(", ")}`,
        )
    const { draft } = completionFiles(status.kind)
    const content = fs.existsSync(path.join(directory, draft))
        ? fs.readFileSync(path.join(directory, draft), "utf-8")
        : ""
    if (!content.trim()) throw new Error(`${status.kind} final review requires a non-empty working draft ${draft}`)
}

function assertReviewEntity(directory: string, expected: ReviewEntity): void {
    const status = readEntityStatus(directory)
    if (status.entity !== expected) {
        throw new Error(`directory contains ${status.entity}, not requested ${expected}: ${directory}`)
    }
}

export async function createReviewRoundDirectory(
    entityDir: string,
    phase: ReviewPhase,
    round: number,
): Promise<string> {
    const reviewsDir = path.join(entityDir, LOCAL_REVIEWS_DIR)
    await fs.promises.mkdir(reviewsDir, { recursive: true })
    const paddedRound = round.toString().padStart(3, "0")
    const reviewRoundDir = path.join(reviewsDir, `${phase}-${paddedRound}`)
    await fs.promises.mkdir(reviewRoundDir, { recursive: false })
    return reviewRoundDir
}

/**
 * Copies the round's working draft into `reviews/<phase>-NNN/candidate.md`: `draft.md` for a plan round,
 * the kind's completion draft for a final round. The reviewer and later presentation use only that copy.
 */
export async function snapshotCandidate(entityDir: string, phase: SnapshotPhase, round: number): Promise<string> {
    const padded = round.toString().padStart(3, "0")
    const reviewRoundDir = path.join(entityDir, LOCAL_REVIEWS_DIR, `${phase}-${padded}`)
    await fs.promises.mkdir(reviewRoundDir, { recursive: true })
    const snapshotPath = path.join(reviewRoundDir, CANDIDATE_FILE)
    let draftPath: string
    switch (phase) {
        case "plan":
            draftPath = path.join(entityDir, LOCAL_DRAFT_FILE)
            if (!fs.existsSync(draftPath)) throw new Error(`Planning draft does not exist: ${LOCAL_DRAFT_FILE}`)
            break
        case "final": {
            const { draft } = completionFiles(deliverableStatus(entityDir).kind)
            draftPath = path.join(entityDir, draft)
            if (!fs.existsSync(draftPath)) throw new Error(`Completion working draft does not exist: ${draft}`)
            break
        }
    }
    const temporaryPath = `${snapshotPath}.${process.pid}.tmp`
    try {
        await fs.promises.copyFile(draftPath, temporaryPath)
        await fs.promises.rename(temporaryPath, snapshotPath)
    } finally {
        await fs.promises.rm(temporaryPath, { force: true })
    }
    return snapshotPath
}

async function readReviewRounds(entityDir: string, phase: ReviewPhase) {
    const reviewsDir = path.join(entityDir, LOCAL_REVIEWS_DIR)
    return (await fs.promises.readdir(reviewsDir).catch(() => []))
        .flatMap((entry) => {
            const match = new RegExp(`^${phase}-(\\d{3})$`).exec(entry)
            return match ? [{ entry, round: Number(match[1]), directory: path.join(reviewsDir, entry) }] : []
        })
        .sort((left, right) => left.round - right.round)
}

async function readReviewOutcome(roundDir: string) {
    return Value.Parse(
        ReviewOutcomeSchema,
        JSON.parse(await fs.promises.readFile(path.join(roundDir, REVIEW_OUTCOME_FILE), "utf-8")),
    )
}

async function nextReviewRound(entityDir: string, phase: ReviewPhase): Promise<number> {
    return ((await readReviewRounds(entityDir, phase)).at(-1)?.round ?? 0) + 1
}

/** Consecutive failed rounds that always pause, independent of the configured blocked-review threshold. */
export const FAILED_REVIEW_PAUSE_AFTER = 2

function isFailedOutcome(outcome: Static<typeof ReviewOutcomeSchema>): boolean {
    return outcome.exitCode !== 0 || outcome.signoff === null
}

/** Returns the current failure streak when the just-completed failed round reaches the fixed pause limit. */
export async function failedReviewGate(
    entityDir: string,
    phase: ReviewPhase,
    completedRound: number,
): Promise<number[] | undefined> {
    let failedRounds: number[] = []
    for (const { round, directory: roundDir } of await readReviewRounds(entityDir, phase)) {
        if (round > completedRound) break
        if (!fs.existsSync(path.join(roundDir, REVIEW_OUTCOME_FILE))) continue
        failedRounds = isFailedOutcome(await readReviewOutcome(roundDir)) ? [...failedRounds, round] : []
    }
    return failedRounds.at(-1) === completedRound && failedRounds.length >= FAILED_REVIEW_PAUSE_AFTER
        ? failedRounds
        : undefined
}

export function formatFailedReviewPause(failedRounds: readonly number[]): string {
    const rounds = failedRounds.map((round) => round.toString().padStart(3, "0")).join(", ")
    return [
        `Review rounds ${rounds} failed in a row without a valid report. This pause applies even without a configured blocked-review threshold.`,
        "Stop. Do not run another review in this category yet.",
        "Tell the user which rounds failed and why, and show any unvalidated reviewer output as evidence only, never as a review or signoff.",
        "Then ask the user how to proceed, and wait for their answer.",
    ].join("\n")
}

export interface BlockedReviewGate {
    blockedCount: number
    blockedRounds: number[]
}

export async function blockedReviewGate(
    entityDir: string,
    phase: ReviewPhase,
    completedRound: number,
    userConfirmationAfter: number | undefined,
): Promise<BlockedReviewGate | undefined> {
    if (userConfirmationAfter === undefined) return undefined

    let blockedRounds: number[] = []
    let gate: BlockedReviewGate | undefined
    for (const { round, directory: roundDir } of await readReviewRounds(entityDir, phase)) {
        const outcomePath = path.join(roundDir, REVIEW_OUTCOME_FILE)
        if (!fs.existsSync(outcomePath)) continue
        const outcome = await readReviewOutcome(roundDir)
        if (isFailedOutcome(outcome)) continue

        gate = undefined
        if (outcome.signoff === "approved") {
            blockedRounds = []
            continue
        }

        const reviewPath = path.join(roundDir, "review.md")
        if (!fs.existsSync(reviewPath)) {
            throw new Error(`blocked review outcome has no review document: ${path.relative(entityDir, roundDir)}`)
        }
        blockedRounds.push(round)
        if (blockedRounds.length === userConfirmationAfter) {
            gate = { blockedCount: userConfirmationAfter, blockedRounds: [...blockedRounds] }
            blockedRounds = []
        }
    }

    return gate?.blockedRounds.at(-1) === completedRound ? gate : undefined
}

export function formatBlockedReviewPause(gate: BlockedReviewGate): string {
    const rounds = gate.blockedRounds.map((round) => round.toString().padStart(3, "0"))
    const roundList =
        rounds.length === 1
            ? rounds[0]
            : `${rounds.slice(0, -1).join(", ")}${rounds.length > 2 ? "," : ""} and ${rounds.at(-1)}`
    const question =
        rounds.length === 1
            ? `Was blocked review ${roundList} legitimate?`
            : `Were blocked reviews ${roundList} legitimate?`
    return [
        `The configured blocked-review confirmation threshold was reached: ${rounds.join(", ")}.`,
        "Stop before applying findings from the current round or running correction verification.",
        "Present each round's canonical adjudicated response, labeled by round, and state whether it contained at least one valid blocking issue at review time.",
        "A block is legitimate when at least one valid blocking issue required correction or a user decision. Incorrect secondary findings do not invalidate an otherwise legitimate block.",
        `Then ask only: "${question}"`,
        "Wait for the user's judgment. If all were legitimate, apply accepted findings from the current round, verify them, and start a fresh batch. If any were illegitimate, stop and diagnose the reviewer guidance or tooling before proposing a correction. Resolve mixed or unclear judgments before correcting the current round or running another review.",
    ].join("\n")
}

function snapshotLabel(phase: SnapshotPhase): string {
    switch (phase) {
        case "plan":
            return "Plan"
        case "final":
            return "Completion"
    }
}

function resolveSnapshotPath(cwd: string, entityDir: string, raw: string): string {
    const resolved = path.resolve(entityDir, raw)
    const reviewsDir = path.resolve(entityDir, LOCAL_REVIEWS_DIR)
    if (!resolved.startsWith(reviewsDir + path.sep)) {
        throw new Error("snapshot must be inside the entity reviews directory")
    }
    if (!fs.existsSync(resolved)) {
        throw new Error(`Snapshot does not exist: ${path.relative(cwd, resolved)}`)
    }
    return resolved
}

/** Requires `reviews/<phase>-NNN/candidate.md` whose round finished with a valid approved signoff. */
export async function requireApprovedSnapshot(
    entityDir: string,
    snapshotPath: string,
    phase: SnapshotPhase,
): Promise<void> {
    const label = snapshotLabel(phase)
    const resolved = path.resolve(snapshotPath)
    const roundDir = path.dirname(resolved)
    const reviewsDir = path.resolve(entityDir, LOCAL_REVIEWS_DIR)
    if (path.dirname(roundDir) !== reviewsDir || path.basename(resolved) !== CANDIDATE_FILE) {
        throw new Error(`snapshot must be reviews/${phase}-NNN/${CANDIDATE_FILE}`)
    }
    const match = new RegExp(`^${phase}-(\\d{3})$`).exec(path.basename(roundDir))
    if (!match) throw new Error(`snapshot must belong to a numbered ${phase} review round`)
    if (!fs.existsSync(resolved)) throw new Error(`${label} snapshot does not exist: ${path.basename(roundDir)}`)

    const reviewPath = path.join(roundDir, "review.md")
    if (!fs.existsSync(reviewPath)) {
        throw new Error(`${label} snapshot has no matching review document: ${path.basename(roundDir)}`)
    }
    const outcomePath = path.join(roundDir, REVIEW_OUTCOME_FILE)
    if (!fs.existsSync(outcomePath)) {
        throw new Error(`${label} snapshot has no matching review outcome: ${path.basename(roundDir)}`)
    }
    const outcome = await readReviewOutcome(roundDir)
    const signoff = outcome.exitCode === 0 ? outcome.signoff : null
    if (signoff !== "approved") {
        throw new Error(`${label} snapshot review is ${signoff ?? "malformed"}: ${path.basename(roundDir)}`)
    }
}

/** The newest approved plan candidate; plan presentation may present it after later unapproved rounds. */
export async function latestApprovedPlanSnapshot(entityDir: string): Promise<string | undefined> {
    for (const { directory: roundDir } of (await readReviewRounds(entityDir, "plan")).reverse()) {
        const reviewPath = path.join(roundDir, "review.md")
        const outcomePath = path.join(roundDir, REVIEW_OUTCOME_FILE)
        if (!fs.existsSync(reviewPath) || !fs.existsSync(outcomePath)) continue
        const outcome = await readReviewOutcome(roundDir)
        if (outcome.exitCode !== 0 || outcome.signoff !== "approved") continue

        const snapshotPath = path.join(roundDir, CANDIDATE_FILE)
        if (fs.existsSync(snapshotPath)) return snapshotPath
    }

    return undefined
}

/**
 * The newest final round's candidate, only when that round itself approved: a newer blocked or failed
 * round means the current work hasn't passed review, so an older approval is never presented.
 * An explicit snapshot must be that same candidate.
 */
export async function newestApprovedFinalSnapshot(entityDir: string, explicit?: string): Promise<string> {
    const newest = (await readReviewRounds(entityDir, "final")).at(-1)
    if (!newest)
        throw new Error("No final review round found; run final review before presenting the completion artifact")
    const snapshotPath = path.join(newest.directory, CANDIDATE_FILE)
    if (explicit && path.resolve(explicit) !== snapshotPath)
        throw new Error(`snapshot must be the newest final round's ${CANDIDATE_FILE}: ${newest.entry}`)
    await requireApprovedSnapshot(entityDir, snapshotPath, "final")
    return snapshotPath
}

/** What a presentation hands to the user; only a plan carries publication state for its update announcement. */
type Presentation = { subject: "plan"; publication: PublicationState<unknown>["state"] } | { subject: "completion" }

function presentationInstructions(presentation: Presentation, relSnapshot: string, relTarget: string): string {
    let artifact: string
    let notes: string[]
    switch (presentation.subject) {
        case "plan":
            artifact = "plan"
            notes = planUpdateAnnouncementInstructions(presentation.publication)
            break
        case "completion":
            artifact = "completion artifact"
            notes = [COMPLETION_ACCEPTANCE_INSTRUCTION]
            break
    }
    const lines = [
        `Reviewed ${presentation.subject} snapshot is ready for user diff review.`,
        `Next: read Snapshot, then write its exact content to Target using the write tool. Do not print the ${artifact} in chat.`,
        "",
        `Snapshot: ${relSnapshot}`,
        `Target: ${relTarget}`,
    ]
    return (notes.length ? [...lines, "", ...notes] : lines).join("\n")
}

// Accepting the completion artifact is not delivery approval: the user may still want to review the code.
const COMPLETION_ACCEPTANCE_INSTRUCTION =
    "Accepting this diff authorizes no commit, push, or PR. After acceptance, say the work is ready to submit and wait for an explicit request to submit or ship."

const ANNOUNCEMENT_SUMMARY_INSTRUCTION =
    "Before writing Target, draft a short summary of what changed and why; say so when the change is only editorial. Show it in the same message as the diff: accepting the diff approves the plan update and its announcement together. Pass that summary as the announcement when publishing."

// A published plan's update is announced on its tracker item, so the summary is approved with the diff.
function planUpdateAnnouncementInstructions(publication: PublicationState<unknown>["state"]): string[] {
    switch (publication) {
        case "unpublished":
            return []
        case "published":
            return [
                "Plan update announcement: this plan is already published on its tracker item, so this update will be announced there.",
                ANNOUNCEMENT_SUMMARY_INSTRUCTION,
            ]
        case "pending":
            return [
                "Plan update announcement: the plan's first publication is pending and may already have landed. If recovery confirms it, this update will be announced on the tracker item.",
                ANNOUNCEMENT_SUMMARY_INSTRUCTION,
            ]
    }
}

/**
 * The kind's user-approved completion artifact and the ungated working draft the agent edits and final
 * review snapshots. Only the presentation write after an approved final review touches `artifact`.
 */
export function completionFiles(kind: DeliverableKind): { artifact: string; draft: string } {
    switch (kind) {
        case "research":
        case "audit":
            return { artifact: "report.md", draft: "report-draft.md" }
        case "feature":
        case "bugfix":
        case "refactor":
        case "chore":
            return { artifact: "result.md", draft: "result-draft.md" }
    }
}

function deliverableStatus(entityDir: string) {
    const status = readEntityStatus(entityDir)
    switch (status.entity) {
        case "epic":
            throw new Error(`expected Deliverable status in ${entityDir}`)
        case "task":
        case "gig":
            return status
    }
}

async function snapshotDeliverableRound(
    entityDir: string,
    input: Extract<ReviewAgentParams, { entity: "task" | "gig" }>,
    round: number,
): Promise<DeliverableReviewRound> {
    switch (input.phase) {
        case "plan":
            return { phase: "plan", planSnapshot: await snapshotCandidate(entityDir, "plan", round) }
        case "interim":
            return { phase: "interim", subject: input.subject }
        case "final":
            return { phase: "final", completionSnapshot: await snapshotCandidate(entityDir, "final", round) }
    }
}

function deliverableRoundSnapshot(round: DeliverableReviewRound): string | undefined {
    switch (round.phase) {
        case "plan":
            return round.planSnapshot
        case "interim":
            return undefined
        case "final":
            return round.completionSnapshot
    }
}

function deliverableKindReviewFocus(kind: DeliverableKind): string {
    switch (kind) {
        case "feature":
            return "Feature focus: intended behavior, interfaces, implementation ownership, integration, regressions, and verification."
        case "bugfix":
            return "Bugfix focus: symptom evidence, demonstrated root cause, whether the proposed change fixes that cause, regressions, and verification."
        case "refactor":
            return "Refactor focus: structural goal, preserved behavior/interfaces, stated invariants, migration boundary, and verification of no unintended behavior change."
        case "research":
            return "Research focus: question and boundaries, evidence quality, support for conclusions, explicit uncertainty, and useful next steps. Product behavior must remain unchanged."
        case "audit":
            return "Audit focus: declared scope and criteria, evidence for each finding, completeness, actionable recommendations, and limitations. Audit work must not remediate findings in product code."
        case "chore":
            return "Chore focus: concrete maintenance outcome, operational constraints, scope discipline, and practical verification."
    }
}

export async function buildDeliverableReviewPrompt(
    ctx: ExtensionContext,
    gigDir: string,
    round: DeliverableReviewRound,
    instructions?: string,
): Promise<string> {
    const phase = round.phase
    const relDeliverableDir = path.relative(ctx.cwd, gigDir)
    let planPath: string
    let completionSnapshot: string | undefined
    let subject: string | undefined
    switch (round.phase) {
        case "plan":
            planPath = round.planSnapshot
            break
        case "interim":
            planPath = path.join(gigDir, "plan.md")
            subject = round.subject
            break
        case "final":
            planPath = path.join(gigDir, "plan.md")
            completionSnapshot = round.completionSnapshot
            break
    }
    const relPlanPath = path.relative(ctx.cwd, planPath)
    const plan = await readOptional(planPath)
    const brief = await readOptional(path.join(gigDir, "brief.md"))
    const metadata = await readOptional(path.join(gigDir, "metadata.json"))
    const entityStatus = deliverableStatus(gigDir)
    // Accepted root artifacts stay visible as context: prior research evidence, or the last accepted result.
    const report = await readOptional(path.join(gigDir, "report.md"))
    const result = await readOptional(path.join(gigDir, "result.md"))
    const completion = completionSnapshot ? await readOptional(completionSnapshot) : ""
    if (completionSnapshot && !completion.trim())
        throw new Error(`${entityStatus.kind} final review requires a non-empty completion snapshot`)
    const relCompletionSnapshot = completionSnapshot ? path.relative(ctx.cwd, completionSnapshot) : ""
    const parentEpic = await readParentEpicContext(ctx.cwd, gigDir)
    const projectPolicies = await readProjectPolicies(ctx.cwd)
    const previousReviews = await readPreviousReviewArtifacts(gigDir, phase)
    const diff = phase === "final" ? await getGitDiff(ctx.cwd) : ""

    return [
        "# Review Agent Request",
        "",
        `Deliverable directory: ${relDeliverableDir}`,
        `Phase: ${phase}`,
        `Reviewed plan: ${relPlanPath}`,
        relCompletionSnapshot ? `Reviewed completion artifact: ${relCompletionSnapshot}` : "",
        parentEpic ? `Parent epic: ${parentEpic.relDir}` : "",
        subject ? `Subject: ${subject}` : "",
        "",
        "You are an independent senior code review agent running in a fresh context.",
        "You are read-only. Do not modify files. Do not ask the user questions directly.",
        "Follow all rules supplied by the rules extension. If reviewing files that may match path-scoped rules, read those files first so the rules extension can load applicable rules. Treat rule violations as review findings.",
        ...REVIEW_AUTHORITY_INSTRUCTIONS,
        REVIEW_DOCUMENT_INSTRUCTIONS,
        "Review the artifacts and repository state. Be specific, terse, and actionable.",
        parentEpic
            ? "The parent Epic is the canonical initiative contract. Verify that the Task aligns with it and that every user-approved contract change is reflected in epic.md. Unresolved drift blocks final signoff."
            : "",
        "It is valid to report no findings. Do not invent a finding to justify the review.",
        "For edge-case, race/concurrency, and failure-mode findings, apply every active evidence and credible-complexity rule. A finding that omits evidence required by those rules is invalid, must be omitted, and must not affect signoff.",
        "",
        "Authority model:",
        "- Main agent owns plan and implementation.",
        "- Review agent owns critique/signoff only.",
        "- User owns product/domain decisions and final approval.",
        "",
        reviewAgentOutputInstructions(),
        "",
        deliverableKindReviewFocus(entityStatus.kind),
        phase === "plan"
            ? "Plan review focus: concise kind-specific sufficiency. Do not require boilerplate sections. Check for hidden assumptions, testability/verification, risky files, and ambiguous product/domain decisions."
            : phase === "final"
              ? `Final review focus: correctness against the approved plan and current kind strategy, regressions, security, tests/verification, and missed requirements. Verify that the reviewed completion artifact (${completionFiles(entityStatus.kind).artifact} candidate) accurately describes the implementation and only verification that actually ran. Root result.md or report.md files, when present, are previously accepted artifacts shown as context, not the artifact under review.`
              : "Interim review focus: adversarially review current work or the requested subject. Inspect only what is needed and call out uncertainty, missing evidence, and concrete next actions.",
        instructions ? `\nExtra instructions:\n${instructions}` : "",
        projectPolicies ? ["", "# Project Policies (.project/policies.md)", "", projectPolicies].join("\n") : "",
        "",
        "---",
        "",
        `# ${relPlanPath}`,
        "",
        fence(truncate(plan || "(missing)", MAX_EMBEDDED_FILE_BYTES), "markdown"),
        "",
        "# brief.md",
        "",
        fence(truncate(brief || "(missing)", MAX_EMBEDDED_FILE_BYTES), "markdown"),
        "",
        "# metadata.json",
        "",
        fence(truncate(metadata || "(missing)", MAX_EMBEDDED_FILE_BYTES), "json"),
        "",
        completion
            ? [
                  `# ${relCompletionSnapshot} (completion artifact under review)`,
                  "",
                  fence(truncate(completion, MAX_EMBEDDED_FILE_BYTES), "markdown"),
                  "",
              ].join("\n")
            : "",
        report
            ? [
                  "# report.md (previously accepted)",
                  "",
                  fence(truncate(report, MAX_EMBEDDED_FILE_BYTES), "markdown"),
                  "",
              ].join("\n")
            : "",
        result
            ? [
                  "# result.md (previously accepted)",
                  "",
                  fence(truncate(result, MAX_EMBEDDED_FILE_BYTES), "markdown"),
                  "",
              ].join("\n")
            : "",
        parentEpic?.content ?? "",
        previousReviews ? ["# Previous review artifacts", "", previousReviews].join("\n") : "",
        diff ? ["# Current git diff", "", diff].join("\n") : "",
    ]
        .filter(Boolean)
        .join("\n")
}

async function readParentEpicContext(cwd: string, deliverableDir: string): Promise<ParentEpicContext | undefined> {
    const status = readEntityStatus(deliverableDir)
    if (status.entity !== "task") return undefined

    const root = project.resolveRootDir(cwd)
    const epicsRoot = path.join(root, EPIC_ROOT)
    const epicDir = path.dirname(path.dirname(path.resolve(deliverableDir)))
    const raw = path.relative(root, epicDir)
    if (!epicDir.startsWith(epicsRoot + path.sep) || !fs.existsSync(epicDir)) {
        throw new Error(`Parent Epic does not exist inside ${EPIC_ROOT}: ${raw}`)
    }

    const epic = await readOptional(path.join(epicDir, "epic.md"))
    const brief = await readOptional(path.join(epicDir, "brief.md"))
    const content = [
        "# Parent Epic context",
        "",
        `Directory: ${raw}`,
        "",
        "## epic.md",
        "",
        fence(truncate(epic || "(missing)", MAX_EMBEDDED_FILE_BYTES), "markdown"),
        "",
        "## brief.md",
        "",
        fence(truncate(brief || "(missing)", MAX_EMBEDDED_FILE_BYTES), "markdown"),
    ].join("\n")

    return { relDir: raw, content }
}

async function readProjectPolicies(cwd: string): Promise<string> {
    const filePath = path.join(project.resolveRootDir(cwd), PROJECT_ROOT, "policies.md")
    return truncate(await readOptional(filePath), MAX_EMBEDDED_FILE_BYTES)
}

async function readPreviousReviewArtifacts(entityDir: string, phase: ReviewPhase): Promise<string> {
    const chunks: string[] = []
    for (const { entry, directory } of await readReviewRounds(entityDir, phase)) {
        const raw = await readOptional(path.join(directory, "response.md"))
        if (raw) chunks.push(`## ${entry}/response.md\n\n${fence(truncate(raw, MAX_EMBEDDED_FILE_BYTES), "markdown")}`)
    }
    return chunks.join("\n\n")
}

async function getGitDiff(cwd: string): Promise<string> {
    const status = await git(cwd, ["status", "--short"])
    const stat = await git(cwd, ["diff", "--stat"])
    const stagedStat = await git(cwd, ["diff", "--cached", "--stat"])
    const diff = await git(cwd, ["diff"])
    const stagedDiff = await git(cwd, ["diff", "--cached"])

    return truncate(
        [
            "## git status --short",
            fence(status || "(clean)", "text"),
            "## git diff --stat",
            fence(stat || "(empty)", "text"),
            "## git diff --cached --stat",
            fence(stagedStat || "(empty)", "text"),
            "## git diff",
            fence(diff || "(empty)", "diff"),
            "## git diff --cached",
            fence(stagedDiff || "(empty)", "diff"),
        ].join("\n\n"),
        MAX_DIFF_BYTES,
    )
}

async function git(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
        cp.execFile("git", args, { cwd, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) resolve((stdout || stderr || String(error)).trim())
            else resolve(stdout.trim())
        })
    })
}

function textResult(text: string, isError = false, details?: unknown) {
    return {
        isError,
        details,
        content: [{ type: "text" as const, text }],
    }
}
