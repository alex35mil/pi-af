import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"
import { compile, parse } from "../../../extensions/__lib/schema.js"
import { workflowTools } from "../__lib/tools.js"

import * as project from "../../../extensions/__lib/project.js"
import { EPIC_ROOT, GIG_ROOT, PROJECT_ROOT, type DeliverableKind } from "../__lib/domain.js"
import {
    entityLabel,
    LOCAL_REVIEWS_DIR,
    readEntityStatus,
    readPendingEntries,
    resolveEntityPath,
} from "../__lib/entity.js"
import * as Git from "../__lib/git.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import {
    CANDIDATE_FILE,
    isFailedOutcome,
    lastValidReviewRound,
    readReviewCycle,
    readReviewOutcome,
    readReviewRounds,
    REVIEW_PHASES,
    reviewRoundName,
    type ReviewPhase,
    writeReviewPass,
} from "../__lib/review-rounds.js"
import { executeReviewRound, recordEntityResponses, renderReviewRoundResult, REVIEW_REPORT_FILE } from "./round.js"
import { reviewerEnvironment } from "./model.js"
import { registerPullRequestReview } from "./pull-request.js"
import { buildEpicReviewPrompt } from "./epic.js"
import { reviewAgentOutputInstructions, ReviewResponseSchema } from "./findings.js"
import {
    chooseReviewPass,
    NO_PASS_PROMPT,
    type PassPrompt,
    reviewPassNotice,
    reviewPassPrompt,
    reviewPassRecord,
    type RoundPass,
} from "./pass.js"
import {
    fence,
    MAX_EMBEDDED_FILE_BYTES,
    readOptional,
    REVIEW_AUTHORITY_INSTRUCTIONS,
    REVIEW_DOCUMENT_INSTRUCTIONS,
    REVIEW_GIT_INSTRUCTIONS,
    truncate,
} from "./context.js"

const MAX_DIFF_BYTES = 180 * 1024

/** Review categories whose rounds copy the reviewed document into `candidate.md`. */
type SnapshotPhase = "plan" | "final"
type ReviewEntity = "epic" | "task" | "gig"

/**
 * A merge conflict between a Deliverable branch and its target, as a `conflict-plan` round saw it.
 * `preMergeBase` is the branch commit the target merges into: the branch head, or, when replanning
 * after a committed but unpushed merge of this target, that merge's first parent.
 */
export interface ConflictRecord {
    branch: string
    target: string
    preMergeBase: string
    targetSha: string
    resolution: string
}

/** What a Deliverable review round reviews, with the inputs only its category carries. */
export type DeliverableReviewRound =
    | { phase: "plan"; planSnapshot: string }
    | { phase: "interim"; subject?: string }
    | { phase: "final"; completionSnapshot: string }
    | { phase: "conflict-plan"; conflict: ConflictRecord; record: string }
    | { phase: "conflict-merge"; conflict: ConflictRecord; merge: string; record: string }

const CONFLICT_RECORD_FILE = "conflict.json"
const MERGE_RECORD_FILE = "merge.json"
const Sha = Type.String({ pattern: "^[0-9a-f]{40,64}$" })
const ConflictRecordSchema = Type.Object(
    {
        branch: Type.String({ minLength: 1 }),
        target: Type.String({ minLength: 1 }),
        preMergeBase: Sha,
        targetSha: Sha,
        resolution: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
)
const ConflictRecordValidator = compile(ConflictRecordSchema)

const optionalReviewerProperties = {
    instructions: Type.Optional(Type.String({ description: "Extra review instructions for this run" })),
    model: Type.Optional(Type.String({ description: "Optional pi model pattern for the reviewer" })),
}

const subjectProperty = Type.String({ description: "Interim review subject/question" })
const resolutionProperty = Type.String({
    minLength: 1,
    description:
        "conflict-plan only: the plain-words resolution plan, naming each conflicting file, what each side changed, and how each conflict is kept or combined, plus a Target changes to keep section listing each target commit that touches a conflicting file, with its SHA and PR, the fix or behavior that must survive, and how the resolution keeps it",
})
// Only the categories whose finished cycle doesn't restart freely take it.
const newReviewProperty = Type.String({
    minLength: 1,
    description:
        "plan and final only, after that category's review cycle finished: what changed in behavior, scope, or the Task list that needs another review. Omit otherwise; the tool chooses between a review and a verification pass itself.",
})

// One strict object per Deliverable review category, so each input exists only where it's used.
function deliverableRequests<E extends "task" | "gig">(entity: E, directory: string) {
    const base = { entity: Type.Literal(entity), entityDir: Type.String({ description: directory }) }
    const strict = { additionalProperties: false } as const
    return [
        Type.Object(
            {
                ...base,
                phase: Type.Literal("plan"),
                newReview: Type.Optional(newReviewProperty),
                ...optionalReviewerProperties,
            },
            strict,
        ),
        Type.Object(
            {
                ...base,
                phase: Type.Literal("interim"),
                subject: Type.Optional(subjectProperty),
                ...optionalReviewerProperties,
            },
            strict,
        ),
        Type.Object(
            {
                ...base,
                phase: Type.Literal("final"),
                newReview: Type.Optional(newReviewProperty),
                ...optionalReviewerProperties,
            },
            strict,
        ),
        Type.Object(
            {
                ...base,
                phase: Type.Literal("conflict-plan"),
                resolution: resolutionProperty,
                ...optionalReviewerProperties,
            },
            strict,
        ),
        Type.Object({ ...base, phase: Type.Literal("conflict-merge"), ...optionalReviewerProperties }, strict),
    ] as const
}

const EpicReviewRequestSchema = Type.Object(
    {
        entity: Type.Literal("epic"),
        entityDir: Type.String({ description: `Epic directory under ${EPIC_ROOT}/` }),
        phase: Type.Enum(["plan"], { type: "string" }),
        newReview: Type.Optional(newReviewProperty),
        ...optionalReviewerProperties,
    },
    { additionalProperties: false },
)
const TASK_DIRECTORY = "Task directory under an Epic's tasks/ directory"
const GIG_DIRECTORY = `Gig directory under ${GIG_ROOT}/`

export const ReviewRequestSchema = Type.Union([
    EpicReviewRequestSchema,
    ...deliverableRequests("task", TASK_DIRECTORY),
    ...deliverableRequests("gig", GIG_DIRECTORY),
])
export const ReviewRequestValidator = compile(ReviewRequestSchema)
type ReviewAgentParams = Static<typeof ReviewRequestSchema>

// Tool roots must be plain objects, so each tool declares every input flat; parsing into
// `ReviewRequestSchema` then rejects inputs its category doesn't take.
function deliverableToolParameters(directory: string) {
    return Type.Object(
        {
            entityDir: Type.String({ description: directory }),
            phase: Type.Enum(REVIEW_PHASES, { type: "string" }),
            subject: Type.Optional(subjectProperty),
            resolution: Type.Optional(resolutionProperty),
            newReview: Type.Optional(newReviewProperty),
            ...optionalReviewerProperties,
        },
        { additionalProperties: false },
    )
}

export const RecordReviewResponseSchema = Type.Object(
    {
        entityDir: Type.String({ description: "Epic, Task, or Gig directory" }),
        phase: Type.Enum(REVIEW_PHASES, { type: "string" }),
        round: Type.Integer({ minimum: 1 }),
        responses: Type.Array(ReviewResponseSchema, {
            description:
                "Only the findings you reject or that need the user's decision. Accepted findings need no record.",
        }),
    },
    { additionalProperties: false },
)
export const RecordReviewResponseValidator = compile(RecordReviewResponseSchema)
type RecordReviewResponseParams = Static<typeof RecordReviewResponseSchema>

interface ParentEpicContext {
    relDir: string
    content: string
}

const PASS_MODEL =
    "The tool chooses the pass from the saved rounds: a review, or, after a blocked review, one verification pass limited to the fixes. A finished plan or final cycle needs newReview for another review."

export default function (pi: ExtensionAPI) {
    const tools = workflowTools(pi, "reviews")
    registerPullRequestReview(pi)
    const reviews = [
        ["epic", Type.Omit(EpicReviewRequestSchema, ["entity"])],
        ["task", deliverableToolParameters(TASK_DIRECTORY)],
        ["gig", deliverableToolParameters(GIG_DIRECTORY)],
    ] as const
    for (const [entity, parameters] of reviews) {
        const validator = compile(parameters)
        tools.registerTool({
            name: `review_${entity}`,
            label: `review_${entity}`,
            description:
                entity === "epic"
                    ? `Run one Epic planning review round on epic.md. ${PASS_MODEL} Persists one numbered local review round.`
                    : `Run one Task/Gig review round: plan (plan.md), interim (optional subject), final (result.md or report.md, with the branch diff), conflict-plan (required resolution: the proposed merge-conflict resolution, reviewed against the actual conflicts with the fetched target), or conflict-merge (the committed merge of the target into the branch, reviewed against the approved resolution). ${PASS_MODEL} Persists one numbered local review round.`,
            parameters,

            async execute(_toolCallId, params, signal, onUpdate, ctx) {
                const input: ReviewAgentParams = parse(ReviewRequestValidator, {
                    ...parse(validator, params),
                    entity,
                })
                assertArtifactPersistencePrepared(ctx.cwd)
                const entityDir = resolveEntityDir(ctx.cwd, input.entityDir)
                const phase = input.phase

                if (!fs.existsSync(entityDir)) {
                    return textResult(`Entity directory does not exist: ${path.relative(ctx.cwd, entityDir)}`, true)
                }
                assertReviewEntity(entityDir, input.entity)
                assertReviewPreconditions(entityDir, phase)
                const pass = chooseReviewPass(
                    readReviewCycle(entityDir, phase),
                    phase,
                    "newReview" in input ? input.newReview : undefined,
                )
                const subject =
                    input.entity === "epic"
                        ? ({ entity: "epic" } as const)
                        : ({
                              entity: "deliverable",
                              prepared: await prepareDeliverableRound(ctx.cwd, entityDir, input),
                          } as const)
                // The reference for an Epic review's Task-marker check: the text the last valid round saw.
                const previousEpic = lastValidReviewRound(entityDir, phase)

                const round = nextReviewRound(entityDir, phase)
                const reviewRoundDir = await createReviewRoundDirectory(entityDir, phase, round)
                writeReviewPass(reviewRoundDir, reviewPassRecord(pass))
                const requestPath = path.join(reviewRoundDir, "request.md")

                let snapshotPath: string | undefined
                let prompt: string
                if (subject.entity === "epic") {
                    snapshotPath = await snapshotCandidate(entityDir, "epic.md", "plan", round)
                    prompt = await buildEpicReviewPrompt(ctx, entityDir, snapshotPath, {
                        pass: await reviewPassPrompt(entityDir, phase, pass, snapshotPath),
                        previousCandidate: previousEpic
                            ? await readOptional(path.join(previousEpic.directory, CANDIDATE_FILE))
                            : "",
                        instructions: input.instructions,
                    })
                } else {
                    const reviewRound = await snapshotDeliverableRound(entityDir, subject.prepared, round)
                    snapshotPath = deliverableRoundSnapshot(reviewRound)
                    prompt = await buildDeliverableReviewPrompt(
                        ctx,
                        entityDir,
                        reviewRound,
                        input.instructions,
                        await reviewPassPrompt(entityDir, phase, pass, candidateOf(reviewRound)),
                    )
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
                    toolset: "filesAndGit",
                    onUpdate: (update) => onUpdate?.(textResult(update)),
                }).catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : String(error)
                    const failedGate = failedReviewGate(entityDir, phase, round)
                    throw new Error(failedGate ? `${message}\n\n${formatFailedReviewPause(failedGate)}` : message)
                })

                const notice = [passLine(pass), reviewPassNotice(pass, report.signoff, report.findings.length)]
                    .filter((part) => part !== undefined)
                    .join("\n\n")
                return textResult(renderReviewRoundResult(report, round, notice), false, {
                    signoff: report.signoff,
                    pass: reviewPassRecord(pass),
                })
            },
        })
    }

    tools.registerTool({
        name: "record_review_response",
        label: "record_review_response",
        description:
            "Record the findings of an Epic, Task, or Gig review round that you reject or that need the user's decision, each with a plain explanation. Accepted findings need no record. The verification pass and later reviews read this record. Calling it again replaces the round's record.",
        parameters: RecordReviewResponseSchema,

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input: RecordReviewResponseParams = parse(RecordReviewResponseValidator, params)
            assertArtifactPersistencePrepared(ctx.cwd)
            const entityDir = resolveEntityDir(ctx.cwd, input.entityDir)
            const status = readEntityStatus(entityDir)
            switch (status.entity) {
                case "epic":
                    if (input.phase !== "plan") throw new Error("Epic reviews have only the plan category")
                    break
                case "task":
                case "gig":
                    break
            }

            const roundName = reviewRoundName(input.phase, input.round)
            const roundDir = path.join(entityDir, LOCAL_REVIEWS_DIR, roundName)
            if (!fs.existsSync(path.join(roundDir, REVIEW_REPORT_FILE)))
                throw new Error(`review report does not exist: ${roundName}`)
            await recordEntityResponses(roundDir, input.responses)
            return textResult(`Recorded ${input.responses.length} response(s) for ${roundName}.`, false, {
                round: roundName,
                responseCount: input.responses.length,
            })
        },
    })
}

function passLine(pass: RoundPass): string {
    switch (pass.kind) {
        case "review":
            return "**Pass:** review"
        case "verification":
            return `**Pass:** verification of ${pass.of.entry}`
    }
}

function resolveEntityDir(cwd: string, raw: string): string {
    const root = project.resolveRootDir(cwd)
    return resolveEntityPath(root, cwd, raw)
}

/**
 * Every input a review round needs, checked before the round directory exists, so a rejected
 * review leaves `reviews/` unchanged and doesn't consume a round number.
 */
export function assertReviewPreconditions(directory: string, phase: ReviewPhase): void {
    const status = readEntityStatus(directory)
    // A Task's parent Epic needs no check here: reading its metadata already requires it.
    switch (status.entity) {
        case "epic":
            if (!fs.existsSync(path.join(directory, "brief.md")))
                throw new Error(`${entityLabel(status)} review requires brief.md`)
            if (!fs.existsSync(path.join(directory, "epic.md")))
                throw new Error(`${entityLabel(status)} review requires epic.md`)
            return
        case "task":
        case "gig":
            break
    }
    switch (phase) {
        case "plan":
            if (!fs.existsSync(path.join(directory, "plan.md")))
                throw new Error(`${entityLabel(status)} plan review requires plan.md`)
            return
        case "interim":
        // Conflict rounds check repository state in `prepareConflictRound`.
        case "conflict-plan":
        case "conflict-merge":
            return
        case "final":
            break
    }
    const pendingEntries = readPendingEntries(directory)
    if (pendingEntries.length > 0)
        throw new Error(
            `${entityLabel(status)} final review requires zero unchecked pending entries; unresolved entries: ${pendingEntries.map(({ line }) => `line ${line}`).join(", ")}`,
        )
    const artifact = completionArtifact(status.kind)
    const content = fs.existsSync(path.join(directory, artifact))
        ? fs.readFileSync(path.join(directory, artifact), "utf-8")
        : ""
    if (!content.trim()) throw new Error(`${status.kind} final review requires a non-empty ${artifact}`)
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
    const reviewRoundDir = path.join(reviewsDir, reviewRoundName(phase, round))
    await fs.promises.mkdir(reviewRoundDir, { recursive: false })
    return reviewRoundDir
}

export type ReviewedDocument = "epic.md" | "plan.md" | "report.md" | "result.md"

/** The document a snapshot category reviews: the plan, or the kind's completion artifact. */
function reviewedDocument(entityDir: string, phase: SnapshotPhase): ReviewedDocument {
    const status = readEntityStatus(entityDir)
    switch (status.entity) {
        case "epic":
            return "epic.md"
        case "task":
        case "gig":
            switch (phase) {
                case "plan":
                    return "plan.md"
                case "final":
                    return completionArtifact(status.kind)
            }
    }
}

/**
 * Copies the reviewed document into `reviews/<phase>-NNN/candidate.md`, so the round keeps the text
 * the reviewer saw while the document itself keeps changing.
 */
export async function snapshotCandidate(
    entityDir: string,
    document: ReviewedDocument,
    phase: SnapshotPhase,
    round: number,
): Promise<string> {
    const reviewRoundDir = path.join(entityDir, LOCAL_REVIEWS_DIR, reviewRoundName(phase, round))
    await fs.promises.mkdir(reviewRoundDir, { recursive: true })
    const snapshotPath = path.join(reviewRoundDir, CANDIDATE_FILE)
    const sourcePath = path.join(entityDir, document)
    if (!fs.existsSync(sourcePath)) throw new Error(`Reviewed document does not exist: ${document}`)
    const temporaryPath = `${snapshotPath}.${process.pid}.tmp`
    try {
        await fs.promises.copyFile(sourcePath, temporaryPath)
        await fs.promises.rename(temporaryPath, snapshotPath)
    } finally {
        await fs.promises.rm(temporaryPath, { force: true })
    }
    return snapshotPath
}

function nextReviewRound(entityDir: string, phase: ReviewPhase): number {
    return (readReviewRounds(entityDir, phase).at(-1)?.round ?? 0) + 1
}

/** Consecutive failed rounds that always pause. A failed round returned no valid report and isn't a pass. */
export const FAILED_REVIEW_PAUSE_AFTER = 2

/** Returns the current failure streak when the just-completed failed round reaches the fixed pause limit. */
export function failedReviewGate(entityDir: string, phase: ReviewPhase, completedRound: number): number[] | undefined {
    let failedRounds: number[] = []
    for (const { round, directory: roundDir } of readReviewRounds(entityDir, phase)) {
        if (round > completedRound) break
        const outcome = readReviewOutcome(roundDir)
        if (!outcome) continue
        failedRounds = isFailedOutcome(outcome) ? [...failedRounds, round] : []
    }
    return failedRounds.at(-1) === completedRound && failedRounds.length >= FAILED_REVIEW_PAUSE_AFTER
        ? failedRounds
        : undefined
}

export function formatFailedReviewPause(failedRounds: readonly number[]): string {
    const rounds = failedRounds.map((round) => round.toString().padStart(3, "0")).join(", ")
    return [
        `Review rounds ${rounds} failed in a row without a valid report.`,
        "Stop. Do not run another review in this category yet.",
        "Tell the user which rounds failed and why, and show any unvalidated reviewer output as evidence only, never as a review or signoff.",
        "Then ask the user how to proceed, and wait for their answer.",
    ].join("\n")
}

/** The kind's completion artifact, written directly and copied into each final round's `candidate.md`. */
export function completionArtifact(kind: DeliverableKind): "report.md" | "result.md" {
    switch (kind) {
        case "research":
        case "audit":
            return "report.md"
        case "feature":
        case "bugfix":
        case "refactor":
        case "chore":
            return "result.md"
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

/** A Deliverable round's checked inputs, resolved before its directory exists so a refusal consumes no round. */
export type PreparedDeliverableRound =
    | { phase: "plan" }
    | { phase: "interim"; subject?: string }
    | { phase: "final" }
    | { phase: "conflict-plan"; conflict: ConflictRecord }
    | { phase: "conflict-merge"; conflict: ConflictRecord; merge: string; planRound: string }

function commitParents(root: string, commit: string): string[] {
    return Git.run(root, ["rev-parse", `${commit}^@`])
        .split("\n")
        .filter(Boolean)
}

/**
 * The conflict between the stored branch and the fetched `origin/<target>`, for a `conflict-plan` round.
 * When the branch head is an unpushed merge of that same target (replanning after a committed merge),
 * the conflict is the one between its first parent and the target: where `git reset --keep` returns.
 */
export function conflictForPlan(root: string, entityDir: string, resolution: string): ConflictRecord {
    const { branch } = deliverableStatus(entityDir)
    const targetRef = `refs/remotes/origin/${branch.target}`
    if (!Git.succeeds(root, ["rev-parse", "--verify", "--quiet", `${targetRef}^{commit}`]))
        throw new Error(`conflict-plan review requires the fetched target ${targetRef}; fetch origin first`)
    const targetSha = Git.run(root, ["rev-parse", `${targetRef}^{commit}`])
    const head = Git.run(root, ["rev-parse", `refs/heads/${branch.name}^{commit}`])
    const parents = commitParents(root, head)
    const pushed = Git.succeeds(root, ["merge-base", "--is-ancestor", head, `refs/remotes/origin/${branch.name}`])
    const preMergeBase = parents.length === 2 && parents[1] === targetSha && !pushed ? parents[0] : head
    if (Git.succeeds(root, ["merge-base", "--is-ancestor", targetSha, preMergeBase]))
        throw new Error(`${branch.name} already contains ${targetRef}; there is no conflict to plan`)
    return { branch: branch.name, target: branch.target, preMergeBase, targetSha, resolution }
}

/**
 * The merge under a `conflict-merge` round and the plan it must follow. Only the newest `conflict-plan`
 * round counts, it must have approved, and the merge's parents must be exactly the pre-merge base and
 * target SHA that round recorded, so a plan for an earlier conflict never covers a later merge.
 */
export async function conflictForMerge(root: string, entityDir: string) {
    const newest = readReviewRounds(entityDir, "conflict-plan").at(-1)
    if (!newest) throw new Error("conflict-merge review requires an approved conflict-plan round")
    const outcome = readReviewOutcome(newest.directory)
    if (outcome?.exitCode !== 0 || outcome.signoff !== "approved")
        throw new Error(`conflict-merge review requires the newest conflict-plan round to be approved: ${newest.entry}`)
    const conflict: ConflictRecord = parse(
        ConflictRecordValidator,
        JSON.parse(await fs.promises.readFile(path.join(newest.directory, CONFLICT_RECORD_FILE), "utf-8")),
    )
    const { branch } = deliverableStatus(entityDir)
    if (conflict.branch !== branch.name || conflict.target !== branch.target)
        throw new Error(`${newest.entry} recorded a different branch or target than the stored branch contract`)
    const merge = Git.run(root, ["rev-parse", `refs/heads/${branch.name}^{commit}`])
    const parents = commitParents(root, merge)
    if (parents.length !== 2) throw new Error(`conflict-merge review requires ${branch.name} to end in a merge commit`)
    if (parents[0] !== conflict.preMergeBase || parents[1] !== conflict.targetSha)
        throw new Error(
            `the merge's parents don't match ${newest.entry} (pre-merge base ${conflict.preMergeBase}, target ${conflict.targetSha}); review a resolution plan for this merge first`,
        )
    return { conflict, merge, planRound: newest.entry }
}

export async function prepareDeliverableRound(
    cwd: string,
    entityDir: string,
    input: Extract<ReviewAgentParams, { entity: "task" | "gig" }>,
): Promise<PreparedDeliverableRound> {
    switch (input.phase) {
        case "plan":
        case "final":
            return { phase: input.phase }
        case "interim":
            return { phase: "interim", subject: input.subject }
        case "conflict-plan":
            return {
                phase: "conflict-plan",
                conflict: conflictForPlan(project.resolveRootDir(cwd), entityDir, input.resolution),
            }
        case "conflict-merge":
            return { phase: "conflict-merge", ...(await conflictForMerge(project.resolveRootDir(cwd), entityDir)) }
    }
}

async function writeRoundRecord(entityDir: string, phase: ReviewPhase, round: number, name: string, value: unknown) {
    const file = path.join(entityDir, LOCAL_REVIEWS_DIR, reviewRoundName(phase, round), name)
    await fs.promises.writeFile(file, `${JSON.stringify(value, null, 4)}\n`, { encoding: "utf-8", flag: "wx" })
    return file
}

export async function snapshotDeliverableRound(
    entityDir: string,
    prepared: PreparedDeliverableRound,
    round: number,
): Promise<DeliverableReviewRound> {
    switch (prepared.phase) {
        case "plan":
            return {
                phase: "plan",
                planSnapshot: await snapshotCandidate(entityDir, reviewedDocument(entityDir, "plan"), "plan", round),
            }
        case "interim":
            return { phase: "interim", subject: prepared.subject }
        case "final":
            return {
                phase: "final",
                completionSnapshot: await snapshotCandidate(
                    entityDir,
                    reviewedDocument(entityDir, "final"),
                    "final",
                    round,
                ),
            }
        case "conflict-plan": {
            const record = await writeRoundRecord(
                entityDir,
                prepared.phase,
                round,
                CONFLICT_RECORD_FILE,
                prepared.conflict,
            )
            return { phase: "conflict-plan", conflict: prepared.conflict, record }
        }
        case "conflict-merge": {
            const record = await writeRoundRecord(entityDir, prepared.phase, round, MERGE_RECORD_FILE, {
                merge: prepared.merge,
                planRound: prepared.planRound,
            })
            return { phase: "conflict-merge", conflict: prepared.conflict, merge: prepared.merge, record }
        }
    }
}

/** The round's `candidate.md`, for the categories that snapshot one. */
function candidateOf(round: DeliverableReviewRound): string | undefined {
    switch (round.phase) {
        case "plan":
            return round.planSnapshot
        case "final":
            return round.completionSnapshot
        case "interim":
        case "conflict-plan":
        case "conflict-merge":
            return undefined
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
        case "conflict-plan":
        case "conflict-merge":
            return round.record
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

function deliverableRoundFocus(round: DeliverableReviewRound, artifact: string, planned: boolean): string {
    switch (round.phase) {
        case "plan":
            return "Plan review focus: would work that follows this plan ship a defect or break a stated requirement? Check hidden assumptions, risky files, missing verification of the behavior at stake, and product or domain decisions the plan makes without the user. Do not require boilerplate sections or more detail than the work needs."
        case "interim":
            return "Interim review focus: adversarially review current work or the requested subject. Inspect only what is needed and call out uncertainty, missing evidence, and concrete next actions."
        case "final":
            return [
                planned
                    ? "Final review focus: correctness against the plan and current kind strategy, regressions, security, tests/verification, and missed requirements."
                    : "Final review focus: this Deliverable took the direct path and has no plan, so brief.md is the requirement. Check correctness against it and current kind strategy, regressions, security, tests/verification, and missed requirements.",
                `Verify that the completion artifact under review (${artifact}, copied into this round's ${CANDIDATE_FILE}) describes the implementation and only verification that actually ran.`,
            ].join(" ")
        case "conflict-plan":
            return [
                "Conflict resolution plan focus: the Deliverable's PR conflicts with its target, and the plan below says how a merge of the target into the branch will resolve it. Nothing is merged yet.",
                `Inspect the actual conflicts yourself: git_read merge-tree with ["--write-tree", "--name-only", "--messages", "${round.conflict.preMergeBase}", "${round.conflict.targetSha}"] lists them, and git_read diff, show, and log on both sides show what each side changed since their merge base.`,
                "Check that the plan covers every conflicting file and hunk, keeps the intent of both sides, describes each side's change accurately, and stays within the plan's behavior. A resolution that changes planned behavior needs the user's decision, not a resolution plan.",
                `Check the plan's Target changes to keep section: git_read log with ["--oneline", "${round.conflict.preMergeBase}..${round.conflict.targetSha}", "--", <conflicting files>] lists the target commits that touch the conflicting files, and each must match an entry. A missing commit, or a resolution that drops or weakens a listed change, is a blocking finding.`,
            ].join("\n")
        case "conflict-merge":
            return [
                `Conflict merge focus: ${round.merge} merges the target into the branch and resolves the conflicts. Review it against the approved resolution plan below.`,
                `Inspect the exact resolution: git_read show with ["--remerge-diff", "${round.merge}"] shows how the committed result differs from Git's automatic merge, including conflict markers. Use git_read diff and show on either parent for context.`,
                "Check that the resolution follows the plan, loses no change from either side, adds no unrelated change, and leaves no conflict markers. Call out missing verification of the merged result.",
                "Check the merged result against the plan's Target changes to keep section. A listed change that the merge drops or weakens is a blocking finding.",
            ].join("\n")
    }
}

function conflictContext(round: Extract<DeliverableReviewRound, { phase: "conflict-plan" | "conflict-merge" }>) {
    const { conflict } = round
    const merge = round.phase === "conflict-merge" ? [`- Merge commit: ${round.merge}`] : []
    return [
        "# Merge conflict",
        "",
        `- Branch: ${conflict.branch}, merging from ${conflict.preMergeBase}`,
        `- Target: ${conflict.target} at ${conflict.targetSha}`,
        ...merge,
        "",
        round.phase === "conflict-plan" ? "# Resolution plan under review" : "# Approved resolution plan",
        "",
        fence(truncate(conflict.resolution, MAX_EMBEDDED_FILE_BYTES), "markdown"),
        "",
    ]
}

export async function buildDeliverableReviewPrompt(
    ctx: ExtensionContext,
    gigDir: string,
    round: DeliverableReviewRound,
    instructions?: string,
    pass: PassPrompt = NO_PASS_PROMPT,
): Promise<string> {
    const phase = round.phase
    const relDeliverableDir = path.relative(ctx.cwd, gigDir)
    let planPath: string
    let completionSnapshot: string | undefined
    let subject: string | undefined
    let conflict: string[] = []
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
        case "conflict-plan":
        case "conflict-merge":
            planPath = path.join(gigDir, "plan.md")
            conflict = conflictContext(round)
            break
    }
    const relPlanPath = path.relative(ctx.cwd, planPath)
    const plan = await readOptional(planPath)
    const brief = await readOptional(path.join(gigDir, "brief.md"))
    const metadata = await readOptional(path.join(gigDir, "metadata.json"))
    const entityStatus = deliverableStatus(gigDir)
    const artifact = completionArtifact(entityStatus.kind)
    const completion = completionSnapshot ? await readOptional(completionSnapshot) : ""
    if (completionSnapshot && !completion.trim())
        throw new Error(`${entityStatus.kind} final review requires a non-empty completion snapshot`)
    const relCompletionSnapshot = completionSnapshot ? path.relative(ctx.cwd, completionSnapshot) : ""
    // Root completion artifacts other than the one under review stay visible as context, e.g. earlier research.
    const context: string[] = []
    for (const name of ["report.md", "result.md"]) {
        if (completionSnapshot && name === artifact) continue
        const content = await readOptional(path.join(gigDir, name))
        if (content)
            context.push(
                [`# ${name} (context)`, "", fence(truncate(content, MAX_EMBEDDED_FILE_BYTES), "markdown"), ""].join(
                    "\n",
                ),
            )
    }
    const parentEpic = await readParentEpicContext(ctx.cwd, gigDir)
    const projectPolicies = await readProjectPolicies(ctx.cwd)
    const { branch } = entityStatus
    const diff = phase === "final" ? await branchDiff(ctx.cwd, branch.target) : ""

    return [
        "# Review Agent Request",
        "",
        `Deliverable directory: ${relDeliverableDir}`,
        `Phase: ${phase}`,
        plan ? `Reviewed plan: ${relPlanPath}` : "Reviewed plan: none (direct path); brief.md is the requirement",
        relCompletionSnapshot ? `Reviewed completion artifact: ${relCompletionSnapshot}` : "",
        parentEpic ? `Parent epic: ${parentEpic.relDir}` : "",
        subject ? `Subject: ${subject}` : "",
        "",
        "You are an independent senior code review agent running in a fresh context.",
        "You are read-only. Do not modify files. Do not ask the user questions directly.",
        "Follow all rules supplied by the rules extension. If reviewing files that may match path-scoped rules, read those files first so the rules extension can load applicable rules. A violated rule is a broken requirement.",
        ...REVIEW_AUTHORITY_INSTRUCTIONS,
        REVIEW_DOCUMENT_INSTRUCTIONS,
        "Review the artifacts and repository state. Be specific, terse, and actionable.",
        REVIEW_GIT_INSTRUCTIONS,
        `The Deliverable branch is ${branch.name}; its target is ${branch.target}. For example, git_read log with ["--oneline", "${branch.target}..${branch.name}"] lists the branch's commits.`,
        parentEpic
            ? "The parent Epic is context: the initiative's goal and this Task's outcome. Tasks update epic.md in place, so a difference between the Task and the Epic text is not a finding by itself. Report one only when the Task breaks the Epic's goal or a user decision."
            : "",
        "It is valid to report no findings. Do not invent a finding to justify the review.",
        "For edge-case, race/concurrency, and failure-mode findings, apply every active evidence and credible-complexity rule. A finding that omits evidence required by those rules is invalid, must be omitted, and must not affect signoff.",
        ...pass.instructions,
        "",
        "Authority model:",
        "- Main agent owns plan and implementation.",
        "- Review agent owns critique/signoff only.",
        "- User owns product/domain decisions and final approval.",
        "",
        reviewAgentOutputInstructions(),
        "",
        deliverableKindReviewFocus(entityStatus.kind),
        deliverableRoundFocus(round, artifact, Boolean(plan)),
        instructions ? `\nExtra instructions:\n${instructions}` : "",
        projectPolicies ? ["", "# Project Policies (.project/policies.md)", "", projectPolicies].join("\n") : "",
        "",
        "---",
        "",
        plan ? [`# ${relPlanPath}`, "", fence(truncate(plan, MAX_EMBEDDED_FILE_BYTES), "markdown"), ""].join("\n") : "",
        "# brief.md",
        "",
        fence(truncate(brief || "(missing)", MAX_EMBEDDED_FILE_BYTES), "markdown"),
        "",
        "# metadata.json",
        "",
        fence(truncate(metadata || "(missing)", MAX_EMBEDDED_FILE_BYTES), "json"),
        "",
        ...conflict,
        completion
            ? [
                  `# ${relCompletionSnapshot} (completion artifact under review)`,
                  "",
                  fence(truncate(completion, MAX_EMBEDDED_FILE_BYTES), "markdown"),
                  "",
              ].join("\n")
            : "",
        ...context,
        parentEpic?.content ?? "",
        pass.sections,
        diff ? ["# Branch changes", "", diff].join("\n") : "",
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

/** Where the branch's own changes start: the merge base with the target, remote-tracking when it exists. */
type BranchBase = { state: "found"; ref: string; commit: string } | { state: "missing"; target: string }

function branchBase(cwd: string, target: string): BranchBase {
    for (const ref of [`refs/remotes/origin/${target}`, `refs/heads/${target}`]) {
        if (!Git.succeeds(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) continue
        const commit = Git.tryRun(cwd, ["merge-base", ref, "HEAD"])
        if (commit) return { state: "found", ref, commit }
    }
    return { state: "missing", target }
}

/**
 * Everything the branch changes: the diff from the merge base with the target to the working tree,
 * so locally committed steps are reviewed with uncommitted work. `git status` names untracked files.
 */
export async function branchDiff(cwd: string, target: string): Promise<string> {
    const base = branchBase(cwd, target)
    const status = await git(cwd, ["status", "--short"])
    let from: string
    let heading: string
    switch (base.state) {
        case "found":
            from = base.commit
            heading = `Changes from the merge base with ${base.ref} (${base.commit}) to the working tree: committed, staged, and unstaged.`
            break
        case "missing":
            from = "HEAD"
            heading = `No merge base with target ${base.target} was found, so this shows only uncommitted changes against HEAD. Use git_read to inspect the branch's commits.`
            break
    }
    const stat = await git(cwd, ["diff", "--stat", from])
    const diff = await git(cwd, ["diff", from])

    return truncate(
        [
            heading,
            "## git status --short",
            fence(status || "(clean)", "text"),
            `## git diff --stat ${from}`,
            fence(stat || "(empty)", "text"),
            `## git diff ${from}`,
            fence(diff || "(empty)", "diff"),
        ].join("\n\n"),
        MAX_DIFF_BYTES,
    )
}

async function git(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
        cp.execFile("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
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
