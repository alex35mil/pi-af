import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

import { StringEnum } from "@earendil-works/pi-ai"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"

import * as project from "../../../extensions/__lib/project.js"
import { EPIC_ROOT, PROJECT_ROOT, type DeliverableKind } from "../__lib/domain.js"
import {
    assertEntityBranchReady,
    LOCAL_DRAFT_FILE,
    LOCAL_REVIEWS_DIR,
    LOCAL_STATUS_FILE,
    readEntityStatus,
    readPendingEntries,
    resolveEntityPath,
} from "../__lib/entity.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { renderReviewTranscript, runReviewAgent } from "./agent.js"
import { buildEpicReviewPrompt } from "./epic.js"
import {
    parseReviewReport,
    renderReviewDocument,
    reviewAgentOutputInstructions,
    renderReviewFindings,
    ReviewResponseFindingSchema,
    type ReviewFinding,
    type ReviewReport,
} from "./findings.js"
import { fence, MAX_EMBEDDED_FILE_BYTES, readOptional, REVIEW_AUTHORITY_INSTRUCTIONS, truncate } from "./context.js"

const MAX_DIFF_BYTES = 180 * 1024
const REVIEW_OUTCOME_FILE = "outcome.json"
const REVIEW_REPORT_FILE = "report.json"

type ReviewPhase = "plan" | "interim" | "final"
type ReviewEntity = "epic" | "task" | "gig"

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
            entityDir: Type.String({ description: "Epic directory under .project/epics/" }),
            phase: Type.Literal("plan"),
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
            entityDir: Type.String({ description: "Gig directory under .project/gigs/" }),
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
        findings: Type.Array(ReviewResponseFindingSchema),
        status: Type.String({ minLength: 1, description: "Plain-language correction and review status" }),
    },
    { additionalProperties: false },
)
type RecordReviewResponseParams = Static<typeof RecordReviewResponseSchema>

const optionalPresentationProperties = {
    snapshot: Type.Optional(
        Type.String({ description: "Optional reviewed plan snapshot path, e.g. .local/reviews/plan-002/candidate.md" }),
    ),
}

export const PresentPlanSchema = Type.Union([
    Type.Object(
        {
            entity: Type.Literal("epic"),
            entityDir: Type.String({ description: "Epic directory under .project/epics/" }),
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
            entityDir: Type.String({ description: "Gig directory under .project/gigs/" }),
            ...optionalPresentationProperties,
        },
        { additionalProperties: false },
    ),
])
type PresentPlanParams = Static<typeof PresentPlanSchema>

interface ParentEpicContext {
    relDir: string
    content: string
}

export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: "review",
        label: "review",
        description:
            "Run one strict Epic, Task, or Gig planning review, or a Task/Gig interim or final implementation review. Persists one numbered local review round and pauses immediately when the configured blocked-review confirmation threshold is reached.",
        parameters: ReviewRequestSchema,

        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            const input: ReviewAgentParams = Value.Parse(ReviewRequestSchema, params)
            const projectConfig = assertArtifactPersistencePrepared(ctx.cwd)
            const entityDir = resolveEntityDir(ctx.cwd, input.entityDir)
            const phase = input.phase

            if (!fs.existsSync(entityDir)) {
                return textResult(`Entity directory does not exist: ${path.relative(ctx.cwd, entityDir)}`, true)
            }
            assertReviewEntity(entityDir, input.entity)
            assertEntityBranchReady(readEntityStatus(entityDir))

            const round = await nextReviewRound(entityDir, phase)
            const reviewRoundDir = await createReviewRoundDirectory(entityDir, phase, round)
            const reviewedPlanPath = phase === "plan" ? await snapshotPlan(entityDir, round) : undefined
            const reviewPath = path.join(reviewRoundDir, "review.md")
            const reportPath = path.join(reviewRoundDir, REVIEW_REPORT_FILE)
            const requestPath = path.join(reviewRoundDir, "request.md")
            const transcriptPath = path.join(reviewRoundDir, "transcript.md")
            const jsonlPath = path.join(reviewRoundDir, "agent.jsonl")
            const stderrPath = path.join(reviewRoundDir, "stderr.txt")
            const outcomePath = path.join(reviewRoundDir, REVIEW_OUTCOME_FILE)

            const prompt =
                input.entity === "epic"
                    ? await buildEpicReviewPrompt(
                          ctx,
                          entityDir,
                          reviewedPlanPath!,
                          await readPreviousReviewArtifacts(entityDir, phase),
                          input.instructions,
                      )
                    : await buildDeliverableReviewPrompt(
                          ctx,
                          entityDir,
                          phase,
                          input.instructions,
                          input.subject,
                          reviewedPlanPath,
                      )
            await fs.promises.writeFile(requestPath, prompt, "utf-8")

            onUpdate?.(textResult(`Review agent started: ${path.relative(ctx.cwd, requestPath)}`))

            const result = await runReviewAgent({
                cwd: ctx.cwd,
                prompt,
                signal,
                model: input.model,
                agentName: `${input.entity}-review`,
                progressLabel: `${input.entity === "epic" ? "Epic" : "Deliverable"} review agent`,
                jsonlPath,
                onUpdate: (update) => onUpdate?.(textResult(update)),
            })
            let report: ReviewReport | undefined
            let reportError: Error | undefined
            if (result.exitCode === 0) {
                try {
                    report = parseReviewReport(result.finalOutput)
                } catch (error) {
                    reportError = error instanceof Error ? error : new Error(String(error))
                }
            }
            if (report) {
                await fs.promises.writeFile(reviewPath, renderReviewDocument(report), "utf-8")
                await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 4)}\n`, "utf-8")
            }
            await fs.promises.writeFile(transcriptPath, renderReviewTranscript(result.events), "utf-8")
            if (result.stderr.trim()) await fs.promises.writeFile(stderrPath, result.stderr, "utf-8")
            const signoff = report?.signoff
            await fs.promises.writeFile(
                outcomePath,
                `${JSON.stringify({ exitCode: result.exitCode, signoff: signoff ?? null }, null, 4)}\n`,
                "utf-8",
            )
            const files = [
                ...(reviewedPlanPath ? [reviewedPlanPath] : []),
                ...(report ? [reviewPath, reportPath] : []),
                requestPath,
                transcriptPath,
                jsonlPath,
                outcomePath,
            ]
                .concat(result.stderr.trim() ? [stderrPath] : [])
                .map((file) => `- ${path.relative(ctx.cwd, file)}`)
                .join("\n")

            const artifactText = ["Artifacts:", files].join("\n")
            if (result.exitCode !== 0) {
                throw new Error(`Review agent exited with code ${result.exitCode}.\n\n${artifactText}`)
            }
            if (!report || !signoff) {
                throw new Error(
                    `Review agent returned an invalid structured report: ${reportError?.message ?? "missing report"}.\n\n${artifactText}`,
                )
            }

            const baseText = `${renderReviewDocument(report)}\n${artifactText}`
            const blockedGate = await blockedReviewGate(
                entityDir,
                phase,
                round,
                projectConfig.reviews?.userConfirmationAfter,
            )
            const text = blockedGate ? `${baseText}\n\n${formatBlockedReviewPause(blockedGate)}` : baseText
            return textResult(text, false, { signoff, blockedGate })
        },
    })

    pi.registerTool({
        name: "record_review_response",
        label: "record_review_response",
        description:
            "Persist an adjudicated review finding list with the canonical renderer and return the exact same Markdown for chat.",
        parameters: RecordReviewResponseSchema,

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input: RecordReviewResponseParams = Value.Parse(RecordReviewResponseSchema, params)
            assertArtifactPersistencePrepared(ctx.cwd)
            const entityDir = resolveEntityDir(ctx.cwd, input.entityDir)
            assertEntityBranchReady(readEntityStatus(entityDir))

            const roundName = `${input.phase}-${input.round.toString().padStart(3, "0")}`
            const roundDir = path.join(entityDir, LOCAL_REVIEWS_DIR, roundName)
            const reportPath = path.join(roundDir, REVIEW_REPORT_FILE)
            if (!fs.existsSync(reportPath)) throw new Error(`review report does not exist: ${roundName}`)
            const report = parseReviewReport(await fs.promises.readFile(reportPath, "utf-8"))
            if (input.findings.length !== report.findings.length) {
                throw new Error(`response must contain all ${report.findings.length} review findings`)
            }

            const findings: ReviewFinding[] = input.findings.map((finding, index) => {
                const reviewed = report.findings[index]
                if (finding.id !== reviewed.id) {
                    throw new Error(`response finding ${index + 1} must retain review label ${reviewed.id}`)
                }
                return { ...finding, severity: reviewed.severity }
            })
            const content = `${renderReviewFindings(findings)}\n\n## Review status\n\n${input.status.trim()}\n`
            await fs.promises.writeFile(path.join(roundDir, "response.md"), content, "utf-8")
            return textResult(content, false, { round: roundName, findingCount: findings.length })
        },
    })

    pi.registerTool({
        name: "present_plan",
        label: "present_plan",
        description:
            "Prepare an Epic, Task, or Gig's latest approved planning snapshot for user diff review via the write tool.",
        parameters: PresentPlanSchema,

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const input: PresentPlanParams = Value.Parse(PresentPlanSchema, params)
            assertArtifactPersistencePrepared(ctx.cwd)
            const entityDir = resolveEntityDir(ctx.cwd, input.entityDir)

            if (!fs.existsSync(entityDir)) {
                return textResult(`Entity directory does not exist: ${path.relative(ctx.cwd, entityDir)}`, true)
            }
            assertReviewEntity(entityDir, input.entity)
            assertEntityBranchReady(readEntityStatus(entityDir))

            const snapshotPath = input.snapshot
                ? resolvePlanSnapshotPath(ctx.cwd, entityDir, input.snapshot)
                : await latestApprovedPlanSnapshot(entityDir)

            if (snapshotPath && input.snapshot) await requireApprovedPlanSnapshot(entityDir, snapshotPath)
            if (!snapshotPath) {
                return textResult("No approved plan review snapshot found.", true)
            }

            const relSnapshot = path.relative(ctx.cwd, snapshotPath)
            const relPlan = path.relative(
                ctx.cwd,
                path.join(entityDir, input.entity === "epic" ? "epic.md" : "plan.md"),
            )

            return textResult(planPresentationInstructions(relSnapshot, relPlan))
        },
    })
}

function resolveEntityDir(cwd: string, raw: string): string {
    const root = project.resolveRootDir(cwd)
    return resolveEntityPath(root, cwd, raw)
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

export async function snapshotPlan(entityDir: string, round: number): Promise<string> {
    const padded = round.toString().padStart(3, "0")
    const reviewRoundDir = path.join(entityDir, LOCAL_REVIEWS_DIR, `plan-${padded}`)
    await fs.promises.mkdir(reviewRoundDir, { recursive: true })
    const snapshotPath = path.join(reviewRoundDir, "candidate.md")
    const draftPath = path.join(entityDir, LOCAL_DRAFT_FILE)
    if (!fs.existsSync(draftPath)) {
        throw new Error(`Planning draft does not exist: ${path.relative(entityDir, draftPath)}`)
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
        if (outcome.exitCode !== 0 || outcome.signoff === null) continue

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

function resolvePlanSnapshotPath(cwd: string, entityDir: string, raw: string): string {
    const resolved = path.resolve(entityDir, raw)
    const reviewsDir = path.resolve(entityDir, LOCAL_REVIEWS_DIR)
    if (!resolved.startsWith(reviewsDir + path.sep)) {
        throw new Error("snapshot must be inside the entity .local/reviews directory")
    }
    if (!fs.existsSync(resolved)) {
        throw new Error(`Plan snapshot does not exist: ${path.relative(cwd, resolved)}`)
    }
    return resolved
}

export async function requireApprovedPlanSnapshot(entityDir: string, snapshotPath: string): Promise<void> {
    const resolved = path.resolve(snapshotPath)
    const roundDir = path.dirname(resolved)
    const reviewsDir = path.resolve(entityDir, LOCAL_REVIEWS_DIR)
    if (path.dirname(roundDir) !== reviewsDir || path.basename(resolved) !== "candidate.md") {
        throw new Error("snapshot must be .local/reviews/plan-NNN/candidate.md")
    }
    const match = /^plan-(\d{3})$/.exec(path.basename(roundDir))
    if (!match) throw new Error("snapshot must belong to a numbered plan review round")
    if (!fs.existsSync(resolved)) throw new Error(`Plan snapshot does not exist: ${path.basename(roundDir)}`)

    const reviewPath = path.join(roundDir, "review.md")
    if (!fs.existsSync(reviewPath)) {
        throw new Error(`Plan snapshot has no matching review document: ${path.basename(roundDir)}`)
    }
    const outcomePath = path.join(roundDir, REVIEW_OUTCOME_FILE)
    if (!fs.existsSync(outcomePath)) {
        throw new Error(`Plan snapshot has no matching review outcome: ${path.basename(roundDir)}`)
    }
    const outcome = await readReviewOutcome(roundDir)
    const signoff = outcome.exitCode === 0 ? outcome.signoff : null
    if (signoff !== "approved") {
        throw new Error(`Plan snapshot review is ${signoff ?? "malformed"}: ${path.basename(roundDir)}`)
    }
}

export async function latestApprovedPlanSnapshot(entityDir: string): Promise<string | undefined> {
    for (const { directory: roundDir } of (await readReviewRounds(entityDir, "plan")).reverse()) {
        const reviewPath = path.join(roundDir, "review.md")
        const outcomePath = path.join(roundDir, REVIEW_OUTCOME_FILE)
        if (!fs.existsSync(reviewPath) || !fs.existsSync(outcomePath)) continue
        const outcome = await readReviewOutcome(roundDir)
        if (outcome.exitCode !== 0 || outcome.signoff !== "approved") continue

        const snapshotPath = path.join(roundDir, "candidate.md")
        if (fs.existsSync(snapshotPath)) return snapshotPath
    }

    return undefined
}

function planPresentationInstructions(relSnapshot: string, relPlan: string): string {
    return [
        "Reviewed plan snapshot is ready for user diff review.",
        "Next: read Snapshot, then write its exact content to Target using the write tool. Do not print the plan in chat.",
        "",
        `Snapshot: ${relSnapshot}`,
        `Target: ${relPlan}`,
    ].join("\n")
}

function deliverableKindRequiresReport(kind: DeliverableKind): boolean {
    switch (kind) {
        case "research":
        case "audit":
            return true
        case "feature":
        case "bugfix":
        case "refactor":
        case "chore":
            return false
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
    phase: ReviewPhase,
    instructions?: string,
    subject?: string,
    reviewedPlanPath?: string,
): Promise<string> {
    const relDeliverableDir = path.relative(ctx.cwd, gigDir)
    const planPath = reviewedPlanPath ?? path.join(gigDir, "plan.md")
    const relPlanPath = path.relative(ctx.cwd, planPath)
    const plan = await readOptional(planPath)
    const brief = await readOptional(path.join(gigDir, "brief.md"))
    const metadata = await readOptional(path.join(gigDir, "metadata.json"))
    const localStatus = await readOptional(path.join(gigDir, LOCAL_STATUS_FILE))
    const entityStatus = readEntityStatus(gigDir)
    if (entityStatus.entity === "epic") throw new Error(`expected Deliverable status in ${gigDir}`)
    const report = await readOptional(path.join(gigDir, "report.md"))
    const result = await readOptional(path.join(gigDir, "result.md"))
    if (phase === "final") {
        const pendingEntries = readPendingEntries(gigDir)
        if (pendingEntries.length > 0) {
            throw new Error(
                `${entityStatus.id} final review requires zero unchecked pending entries; unresolved entries: ${pendingEntries.map(({ line }) => `line ${line}`).join(", ")}`,
            )
        }
        if (deliverableKindRequiresReport(entityStatus.kind)) {
            if (!report.trim()) throw new Error(`${entityStatus.kind} final review requires a non-empty report.md`)
        } else if (!result.trim()) {
            throw new Error(`${entityStatus.kind} final review requires a non-empty result.md`)
        }
    }
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
        parentEpic ? `Parent epic: ${parentEpic.relDir}` : "",
        subject ? `Subject: ${subject}` : "",
        "",
        "You are an independent senior code review agent running in a fresh context.",
        "You are read-only. Do not modify files. Do not ask the user questions directly.",
        "Follow all rules supplied by the rules extension. If reviewing files that may match path-scoped rules, read those files first so the rules extension can load applicable rules. Treat rule violations as review findings.",
        ...REVIEW_AUTHORITY_INSTRUCTIONS,
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
              ? `Final review focus: correctness against the approved plan and current kind strategy, regressions, security, tests/verification, and missed requirements.${result.trim() ? " Verify that the existing result.md remains synchronized with the implementation and actual verification." : ""}`
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
        localStatus
            ? ["# .local/status.md", "", fence(truncate(localStatus, MAX_EMBEDDED_FILE_BYTES), "markdown"), ""].join(
                  "\n",
              )
            : "",
        report ? ["# report.md", "", fence(truncate(report, MAX_EMBEDDED_FILE_BYTES), "markdown"), ""].join("\n") : "",
        result ? ["# result.md", "", fence(truncate(result, MAX_EMBEDDED_FILE_BYTES), "markdown"), ""].join("\n") : "",
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
