import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { Value } from "typebox/value"
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent"

import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { buildReviewerArgs, renderReviewTranscript } from "../workflows/extensions/review/agent.ts"
import {
    parseReviewReport,
    renderReviewDocument,
    renderReviewFindings,
    type ReviewReport,
} from "../workflows/extensions/review/findings.ts"
import registerReviewTools, {
    blockedReviewGate,
    buildDeliverableReviewPrompt,
    createReviewRoundDirectory,
    failedReviewGate,
    formatBlockedReviewPause,
    latestApprovedPlanSnapshot,
    ReviewRequestSchema,
    requireApprovedPlanSnapshot,
    snapshotPlan,
} from "../workflows/extensions/review/index.ts"
import registerEpic from "../workflows/extensions/epic/index.ts"
import { buildEpicReviewPrompt } from "../workflows/extensions/review/epic.ts"
import type { ReviewAgentRunOptions, ReviewAgentRunResult } from "../workflows/extensions/review/agent.ts"
import { executeReviewRound, recordRoundResponse } from "../workflows/extensions/review/round.ts"

function runResult(finalOutput: string, exitCode = 0): ReviewAgentRunResult {
    return { exitCode, finalOutput, stderr: "", events: [] }
}

async function runRound(directory: string, outputs: ReviewAgentRunResult[]) {
    const calls: ReviewAgentRunOptions[] = []
    const sessionDirs: string[] = []
    const run = executeReviewRound(
        {
            environment: { defaultProvider: undefined, defaultModel: undefined, claudeCode: { kind: "unavailable" } },
            cwd: directory,
            directory,
            prompt: "Review.",
            additionalFiles: [],
            agentName: "test",
            progressLabel: "test",
        },
        async (options) => {
            calls.push(options)
            sessionDirs.push(options.session.directory)
            assert.ok(fs.existsSync(options.session.directory))
            const next = outputs.shift()
            assert.ok(next, "unexpected reviewer run")
            return next
        },
    )
    const outcome = await run.then(
        (value) => ({ value, error: undefined }),
        (error: Error) => ({ value: undefined, error }),
    )
    for (const sessionDir of sessionDirs) assert.equal(fs.existsSync(sessionDir), false)
    return { ...outcome, calls }
}

function reviewRoundDir(entity: string, phase: string, round: number): string {
    return path.join(entity, "reviews", `${phase}-${round.toString().padStart(3, "0")}`)
}

function reviewFile(entity: string, phase: string, round: number): string {
    return path.join(reviewRoundDir(entity, phase, round), "review.md")
}

function reviewReport(signoff: "approved" | "blocked"): ReviewReport {
    return {
        findings:
            signoff === "blocked"
                ? [
                      {
                          id: "F1",
                          title: "Payout can start before review",
                          severity: "warning",
                          problem: "A valid recipient list is treated as ready before a person reviews it.",
                          useCase: "An operator imports valid addresses and amounts but has not approved them.",
                          impact: "An unreviewed payout can proceed.",
                          resolution: "Require automated checks and explicit review before ready.",
                          userDecision: null,
                      },
                  ]
                : [],
        signoff,
    }
}

function writeReviewRound(
    entity: string,
    phase: string,
    round: number,
    signoff: "approved" | "blocked" | null,
    options: {
        exitCode?: number
    } = {},
): void {
    const directory = reviewRoundDir(entity, phase, round)
    fs.mkdirSync(directory, { recursive: true })
    if (signoff) {
        const report = reviewReport(signoff)
        fs.writeFileSync(reviewFile(entity, phase, round), renderReviewDocument(report))
        fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report))
    }
    fs.writeFileSync(path.join(directory, "outcome.json"), JSON.stringify({ exitCode: options.exitCode ?? 0, signoff }))
}

describe("workflow reviewer isolation", () => {
    it("registers separate entity review and plan-presentation tools", () => {
        const tools: string[] = []
        const pi = {
            events: createEventBus(),
            on() {},
            registerTool: (definition: { name: string }) => tools.push(definition.name),
            registerCommand: () => {},
        }
        registerReviewTools(pi as never)
        registerEpic(pi as never)
        assert.deepEqual(tools, [
            "review_pull_request",
            "record_pull_request_review_response",
            "review_epic",
            "review_task",
            "review_gig",
            "record_review_response",
            "prepare_epic_plan_presentation",
            "prepare_task_plan_presentation",
            "prepare_gig_plan_presentation",
        ])
    })

    for (const layout of ["directory", "linked"] as const)
        it(`routes review categories and plan presentation through their required Phase (${layout} local root)`, async () => {
            const repository = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-phase-tools-"))
            // A worker's .project/.local is a symlink to its source checkout's directory.
            const source = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-source-"))
            const entityDir = ".project/.local/gigs/7-example"
            const directory = path.join(repository, entityDir)
            const metadataPath = path.join(directory, "metadata.json")
            try {
                cp.execFileSync("git", ["init", "-q", repository])
                if (layout === "linked") {
                    fs.mkdirSync(path.join(repository, ".project"))
                    fs.symlinkSync(source, path.join(repository, ".project/.local"))
                }
                fs.mkdirSync(directory, { recursive: true })
                fs.writeFileSync(path.join(repository, ".gitignore"), "/.project/.local\n")
                fs.writeFileSync(
                    path.join(repository, ".project/config.json"),
                    JSON.stringify({ branches: { format: "identifier-title" } }),
                )
                prepareArtifactPersistence(repository)
                const metadata = {
                    title: "Example",
                    slug: "example",
                    createdAt: "2026-01-01T00:00:00Z",
                    entity: "gig",
                    kind: "feature",
                    branch: { state: "ready", name: "7-example", start: "main", target: "main", source: "generated" },
                    tracker: {
                        provider: "github",
                        repository: { owner: "example", repo: "project" },
                        external: { issueNumber: 7 },
                        planComment: { state: "unpublished" },
                    },
                }
                const plan = "# Plan\n\n## Overview\n\nA plan.\n\n## Work\n\nDetails.\n"
                fs.writeFileSync(path.join(directory, "draft.md"), plan)
                const acceptedPlan = "# Previously accepted plan\n"
                fs.writeFileSync(path.join(directory, "plan.md"), acceptedPlan)
                fs.writeFileSync(path.join(directory, "result.md"), "# Result\n\nDelivered work.\n")
                const tools: Parameters<ExtensionAPI["registerTool"]>[0][] = []
                registerReviewTools({
                    events: createEventBus(),
                    on() {},
                    registerTool: (tool: (typeof tools)[number]) => tools.push(tool),
                } as never)
                const review = tools.find((tool) => tool.name === "review_gig")!
                const preparePresentation = tools.find((tool) => tool.name === "prepare_gig_plan_presentation")!
                const ctx = { cwd: repository } as never
                const stopBeforeRunner = new Error("Reached the reviewer subprocess boundary")
                for (const category of ["plan", "interim", "final"] as const) {
                    for (const phase of ["planning", "execution", "selfReview"]) {
                        const before = JSON.stringify({ ...metadata, phase })
                        fs.writeFileSync(metadataPath, before)
                        await assert.rejects(
                            review.execute(
                                "test",
                                { entityDir, phase: category },
                                undefined,
                                () => {
                                    throw stopBeforeRunner
                                },
                                ctx,
                            ),
                            phase === (category === "plan" ? "planning" : "selfReview")
                                ? (error: unknown) => error === stopBeforeRunner
                                : new RegExp(
                                      `${category} review requires Phase ${category === "plan" ? "Planning" : "Self-Review"}`,
                                  ),
                        )
                        assert.equal(fs.readFileSync(metadataPath, "utf-8"), before)
                    }
                }
                const snapshot = path.join(reviewRoundDir(directory, "plan", 1), "candidate.md")
                assert.equal(fs.readFileSync(snapshot, "utf-8"), plan)
                writeReviewRound(directory, "plan", 1, "approved")
                for (const phase of ["planning", "execution", "selfReview"]) {
                    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, phase }))
                    const invoke = () => preparePresentation.execute("test", { entityDir }, undefined, undefined, ctx)
                    if (phase === "planning") {
                        const result = await invoke()
                        assert.match(JSON.stringify(result.content), /Reviewed plan snapshot is ready/)
                        assert.match(JSON.stringify(result.content), /plan-001/)
                        assert.match(JSON.stringify(result.content), /Snapshot:.*candidate\.md/)
                        assert.match(JSON.stringify(result.content), /Target:.*plan\.md/)
                    } else await assert.rejects(invoke(), /plan review requires Phase Planning/)
                    assert.equal(fs.readFileSync(snapshot, "utf-8"), plan)
                    assert.equal(fs.readFileSync(path.join(directory, "plan.md"), "utf-8"), acceptedPlan)
                }
                fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, phase: "planning" }))
                writeReviewRound(directory, "plan", 2, "blocked")
                const blockedSnapshot = path.join(reviewRoundDir(directory, "plan", 2), "candidate.md")
                fs.writeFileSync(blockedSnapshot, plan)
                await assert.rejects(
                    preparePresentation.execute(
                        "test",
                        {
                            entityDir,
                            snapshot: "reviews/plan-002/candidate.md",
                        },
                        undefined,
                        undefined,
                        ctx,
                    ),
                    /Plan snapshot review is blocked/,
                )
                if (layout === "linked") {
                    // Everything was written through the link into the source checkout's directory.
                    assert.ok(fs.existsSync(path.join(source, "gigs/7-example/reviews/plan-001/candidate.md")))
                }
            } finally {
                fs.rmSync(repository, { recursive: true, force: true })
                fs.rmSync(source, { recursive: true, force: true })
            }
        })

    it("rejects a failed precondition before creating a review round", async () => {
        const repository = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-preconditions-"))
        try {
            cp.execFileSync("git", ["init", "-q", repository])
            fs.mkdirSync(path.join(repository, ".project"), { recursive: true })
            fs.writeFileSync(path.join(repository, ".gitignore"), "/.project/.local/\n")
            fs.writeFileSync(
                path.join(repository, ".project/config.json"),
                JSON.stringify({ branches: { format: "identifier-title" } }),
            )
            prepareArtifactPersistence(repository)
            const tools: Parameters<ExtensionAPI["registerTool"]>[0][] = []
            registerReviewTools({
                events: createEventBus(),
                on() {},
                registerTool: (tool: (typeof tools)[number]) => tools.push(tool),
            } as never)
            const ctx = { cwd: repository } as never
            const stopBeforeRunner = new Error("Reached the reviewer subprocess boundary")
            const entity = (
                relative: string,
                fields: Record<string, unknown>,
                files: Record<string, string>,
            ): string => {
                const directory = path.join(repository, relative)
                fs.mkdirSync(directory, { recursive: true })
                fs.writeFileSync(
                    path.join(directory, "metadata.json"),
                    JSON.stringify({
                        title: "Example",
                        // The directory is named `7-<slug>`.
                        slug: path.basename(directory).replace(/^7-/, ""),
                        createdAt: "2026-01-01T00:00:00Z",
                        branch: {
                            state: "ready",
                            name: path.basename(directory),
                            start: "main",
                            target: "main",
                            source: "generated",
                        },
                        tracker: {
                            provider: "github",
                            repository: { owner: "example", repo: "project" },
                            external: { issueNumber: 7 },
                            planComment: { state: "unpublished" },
                        },
                        ...fields,
                    }),
                )
                for (const [name, content] of Object.entries(files))
                    fs.writeFileSync(path.join(directory, name), content)
                return directory
            }
            // Runs the registered tool and returns its error, or stops at the reviewer boundary.
            const run = async (tool: string, directory: string, phase: "plan" | "final", expected: RegExp | Error) => {
                const before = fs.existsSync(path.join(directory, "reviews"))
                    ? fs.readdirSync(path.join(directory, "reviews"))
                    : []
                await assert.rejects(
                    tools
                        .find((candidate) => candidate.name === tool)!
                        .execute(
                            "test",
                            { entityDir: path.relative(repository, directory), phase },
                            undefined,
                            () => {
                                throw stopBeforeRunner
                            },
                            ctx,
                        ),
                    expected instanceof Error ? (error: unknown) => error === expected : expected,
                )
                const after = fs.existsSync(path.join(directory, "reviews"))
                    ? fs.readdirSync(path.join(directory, "reviews"))
                    : []
                return after.filter((entry) => !before.includes(entry))
            }
            const gig = (kind: string, phase: string, files: Record<string, string>, slug: string) =>
                entity(`.project/.local/gigs/7-${slug}`, { entity: "gig", kind, phase }, files)
            const result = { "result.md": "# Result\n\nDone.\n" }

            // Each rejected precondition leaves no new round behind.
            for (const [tool, directory, phase, message] of [
                ["review_gig", gig("feature", "planning", {}, "no-draft"), "plan", /Planning draft does not exist/],
                [
                    "review_gig",
                    gig("feature", "selfReview", {}, "no-result"),
                    "final",
                    /requires a non-empty result\.md/,
                ],
                [
                    "review_gig",
                    gig("research", "selfReview", result, "no-report"),
                    "final",
                    /requires a non-empty report\.md/,
                ],
                [
                    "review_gig",
                    gig("feature", "selfReview", { ...result, "pending.md": "# Pending\n\n- [ ] Open\n" }, "pending"),
                    "final",
                    /requires zero unchecked pending entries/,
                ],
                [
                    "review_epic",
                    entity(
                        ".project/.local/epics/7-example",
                        { entity: "epic", phase: "planning" },
                        { "draft.md": "# Draft\n" },
                    ),
                    "plan",
                    /review requires brief\.md/,
                ],
                [
                    "review_task",
                    entity(
                        ".project/.local/gigs/orphan/tasks/7-example",
                        { entity: "task", kind: "feature", phase: "planning" },
                        { "draft.md": "# Draft\n" },
                    ),
                    "plan",
                    // Reading a Task's metadata already requires its containing Epic.
                    /Task is not contained under/,
                ],
            ] as const)
                assert.deepEqual(await run(tool, directory, phase, message), [], `${tool} ${phase}: ${message}`)

            // Once fixed, the first real review takes round 001.
            const fixed = gig("feature", "selfReview", {}, "fixed")
            assert.deepEqual(await run("review_gig", fixed, "final", /requires a non-empty result\.md/), [])
            fs.writeFileSync(path.join(fixed, "result.md"), result["result.md"])
            assert.deepEqual(await run("review_gig", fixed, "final", stopBeforeRunner), ["final-001"])
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })

    it("uses one canonical finding renderer for persisted and chat output", () => {
        const report = parseReviewReport(JSON.stringify(reviewReport("blocked")))
        const findings = renderReviewFindings(report.findings)
        assert.equal(
            findings,
            [
                "## Review findings",
                "",
                "### 1. Payout can start before review (F1, warning)",
                "",
                "**Problem:** A valid recipient list is treated as ready before a person reviews it.",
                "",
                "**Use case:** An operator imports valid addresses and amounts but has not approved them.",
                "",
                "**Impact:** An unreviewed payout can proceed.",
                "",
                "**Resolution:** Require automated checks and explicit review before ready.",
                "",
                "**User decision needed:** No.",
            ].join("\n"),
        )
        assert.equal(renderReviewDocument(report), `${findings}\n\n## Review status\n\n**Signoff:** blocked\n`)
        for (const severity of ["critical", "warning", "suggestion", "question"] as const) {
            const source = parseReviewReport(
                JSON.stringify({ ...report, findings: [{ ...report.findings[0], severity }] }),
            )
            assert.ok(renderReviewFindings(source.findings).includes(`(F1, ${source.findings[0].severity})`))
            assert.ok(renderReviewDocument(source).includes(`(F1, ${source.findings[0].severity})`))
        }

        const technicalExample = ['Compare "- <pre>', "  * literal", '  </pre>".', "Use `first", "    second`."].join(
            "\n",
        )
        const technicalFindings = renderReviewFindings([{ ...report.findings[0], useCase: `\n${technicalExample}\n` }])
        assert.ok(technicalFindings.includes(`**Use case:** ${technicalExample}`))

        assert.throws(
            () => parseReviewReport(JSON.stringify({ ...report, commentary: "extra" })),
            /unexpected commentary/,
        )
        assert.equal(
            parseReviewReport(
                JSON.stringify({
                    findings: [{ ...report.findings[0], severity: "suggestion" }],
                    signoff: "blocked",
                }),
            ).signoff,
            "blocked",
        )

        const transcript = renderReviewTranscript([
            {
                type: "message_end",
                message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(report) }] },
            },
            {
                type: "message_end",
                message: { role: "assistant", content: [{ type: "text", text: "uncanonical prose" }] },
            },
        ])
        assert.match(transcript, /## Review findings/)
        assert.match(transcript, /Invalid structured review output omitted/)
        assert.doesNotMatch(transcript, /uncanonical prose/)
    })

    it("extracts one report from surrounding prose and names invalid fields", () => {
        const report = reviewReport("blocked")
        const json = JSON.stringify(report)
        assert.deepEqual(parseReviewReport(`I checked the files {see notes}.\n\n${json}\n\nDone.`), report)
        assert.deepEqual(parseReviewReport("```json\n" + json + "\n```"), report)
        assert.throws(() => parseReviewReport("No report here."), /must contain one JSON review report/)
        assert.throws(() => parseReviewReport(`${json}\n${json}`), /contains 2 JSON review report objects/)

        const { severity: _severity, ...withoutSeverity } = report.findings[0]
        assert.throws(
            () => parseReviewReport(`Summary.\n${JSON.stringify({ ...report, findings: [withoutSeverity] })}`),
            /review finding 1 is missing severity/,
        )
        assert.throws(
            () => parseReviewReport(JSON.stringify({ ...report, findings: [{ ...report.findings[0], note: "x" }] })),
            /review finding 1 has unexpected note/,
        )
    })

    it("corrects an invalid report once in the same reviewer session", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-correction-"))
        try {
            const report = reviewReport("blocked")
            const { severity: _severity, ...withoutSeverity } = report.findings[0]
            const invalid = JSON.stringify({ ...report, findings: [withoutSeverity] })
            const { value, error, calls } = await runRound(directory, [
                runResult(invalid),
                runResult(JSON.stringify(report)),
            ])
            assert.equal(error, undefined)
            assert.equal(value?.report.signoff, "blocked")
            assert.deepEqual(
                calls.map((call) => call.session.resume),
                [false, true],
            )
            assert.equal(calls[0].session.directory, calls[1].session.directory)
            assert.match(calls[1].prompt, /missing severity/)
            assert.ok(calls[1].prompt.includes(invalid))
            assert.equal(calls[1].jsonlPath, calls[0].jsonlPath)
            assert.ok(fs.existsSync(path.join(directory, "review.md")))
            assert.ok(fs.existsSync(path.join(directory, "report.json")))
            assert.equal(fs.existsSync(path.join(directory, "invalid-report.md")), false)
            assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "outcome.json"), "utf-8")).signoff, "blocked")
        } finally {
            fs.rmSync(directory, { recursive: true, force: true })
        }
    })

    it("saves unvalidated output when the correction also fails", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-invalid-"))
        try {
            const { error, calls } = await runRound(directory, [
                runResult("F1 is a real blocker."),
                runResult("Still prose: F1 is a real blocker."),
            ])
            assert.equal(calls.length, 2)
            assert.match(error?.message ?? "", /after one correction/)
            assert.match(error?.message ?? "", /Unvalidated reviewer output/)
            assert.ok(error?.message.includes("Still prose: F1 is a real blocker."))
            assert.ok(fs.readFileSync(path.join(directory, "invalid-report.md"), "utf-8").includes("Still prose"))
            assert.equal(fs.existsSync(path.join(directory, "report.json")), false)
            assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "outcome.json"), "utf-8")).signoff, null)
        } finally {
            fs.rmSync(directory, { recursive: true, force: true })
        }
    })

    it("does not correct after a failed reviewer process", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-exit-"))
        try {
            const { error, calls } = await runRound(directory, [runResult("", 1)])
            assert.equal(calls.length, 1)
            assert.match(error?.message ?? "", /exited with code 1/)
            assert.equal(fs.existsSync(path.join(directory, "invalid-report.md")), false)
        } finally {
            fs.rmSync(directory, { recursive: true, force: true })
        }
    })

    it("pauses after consecutive failed rounds independently of blocked reviews", async () => {
        const entity = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-failures-"))
        try {
            writeReviewRound(entity, "final", 1, null)
            assert.equal(await failedReviewGate(entity, "final", 1), undefined)
            writeReviewRound(entity, "final", 2, "blocked", { exitCode: 143 })
            assert.deepEqual(await failedReviewGate(entity, "final", 2), [1, 2])
            writeReviewRound(entity, "final", 3, "blocked")
            assert.equal(await failedReviewGate(entity, "final", 3), undefined)
            writeReviewRound(entity, "final", 4, null)
            assert.equal(await failedReviewGate(entity, "final", 4), undefined)
            writeReviewRound(entity, "final", 5, null)
            assert.deepEqual(await failedReviewGate(entity, "final", 5), [4, 5])
            writeReviewRound(entity, "final", 6, null)
            assert.deepEqual(await failedReviewGate(entity, "final", 6), [4, 5, 6])
            assert.equal(await failedReviewGate(entity, "interim", 1), undefined)
            for (const round of [7, 8]) writeReviewRound(entity, "final", round, "blocked")
            assert.deepEqual((await blockedReviewGate(entity, "final", 8, 3))?.blockedRounds, [3, 7, 8])
        } finally {
            fs.rmSync(entity, { recursive: true, force: true })
        }
    })

    it("renders adjudicated severity from the saved report", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-response-severity-"))
        try {
            const report = reviewReport("blocked")
            const reportText = JSON.stringify(report)
            fs.writeFileSync(path.join(directory, "report.json"), reportText)
            const { severity, ...finding } = report.findings[0]
            const response = await recordRoundResponse(directory, [finding], "Accepted correction.")
            assert.ok(response.includes(`(F1, ${severity})`))
            assert.equal(response, fs.readFileSync(path.join(directory, "response.md"), "utf-8"))
            assert.equal(fs.readFileSync(path.join(directory, "report.json"), "utf-8"), reportText)
        } finally {
            fs.rmSync(directory, { recursive: true, force: true })
        }
    })

    it("accepts only valid entity/phase review combinations", () => {
        assert.equal(
            Value.Check(ReviewRequestSchema, {
                entity: "epic",
                entityDir: ".project/.local/epics/example",
                phase: "plan",
            }),
            true,
        )
        assert.equal(
            Value.Check(ReviewRequestSchema, {
                entity: "epic",
                entityDir: ".project/.local/epics/example",
                phase: "final",
            }),
            false,
        )
        assert.equal(
            Value.Check(ReviewRequestSchema, {
                entity: "task",
                entityDir: ".project/.local/epics/example/tasks/task",
                phase: "final",
            }),
            true,
        )
        assert.equal(
            Value.Check(ReviewRequestSchema, {
                entity: "task",
                entityDir: ".project/.local/epics/example/tasks/task",
                phase: "final",
                continuation: { approved: true },
            }),
            false,
        )
        assert.equal(
            Value.Check(ReviewRequestSchema, {
                entity: "gig",
                entityDir: ".project/.local/gigs/example",
                phase: "plan",
                epicDir: ".project/.local/epics/example",
            }),
            false,
        )
    })

    it("requires immediate legitimacy judgment at the configured blocked-review threshold", async () => {
        const entity = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-streak-"))
        try {
            for (const round of [1, 2]) {
                writeReviewRound(entity, "interim", round, "blocked")
                assert.equal(await blockedReviewGate(entity, "interim", round, 3), undefined)
            }
            writeReviewRound(entity, "interim", 3, "blocked")
            assert.equal(await blockedReviewGate(entity, "interim", 3, undefined), undefined)
            const firstGate = await blockedReviewGate(entity, "interim", 3, 3)
            assert.deepEqual(firstGate, { blockedCount: 3, blockedRounds: [1, 2, 3] })
            assert.ok(firstGate)
            const pause = formatBlockedReviewPause(firstGate)
            assert.match(pause, /Were blocked reviews 001, 002, and 003 legitimate\?/)
            assert.match(pause, /Stop before applying findings from the current round/)
            assert.match(pause, /at least one valid blocking issue/)
            assert.match(pause, /If all were legitimate, apply accepted findings from the current round/)
            assert.match(pause, /If any were illegitimate, stop and diagnose/)
            assert.match(pause, /Wait for the user's judgment/)
            assert.doesNotMatch(pause, /Continue with another review\?|continuation\.approved|continuation\.json/)

            for (const round of [4, 5]) {
                writeReviewRound(entity, "interim", round, "blocked")
                assert.equal(await blockedReviewGate(entity, "interim", round, 3), undefined)
            }
            writeReviewRound(entity, "interim", 6, "blocked")
            assert.deepEqual((await blockedReviewGate(entity, "interim", 6, 3))?.blockedRounds, [4, 5, 6])

            writeReviewRound(entity, "interim", 7, "approved")
            for (const round of [8, 9]) {
                writeReviewRound(entity, "interim", round, "blocked")
                assert.equal(await blockedReviewGate(entity, "interim", round, 3), undefined)
            }
            writeReviewRound(entity, "interim", 10, "blocked")
            assert.deepEqual((await blockedReviewGate(entity, "interim", 10, 3))?.blockedRounds, [8, 9, 10])

            for (const round of [1, 2]) writeReviewRound(entity, "final", round, "blocked")
            assert.deepEqual(await blockedReviewGate(entity, "final", 2, 2), {
                blockedCount: 2,
                blockedRounds: [1, 2],
            })

            writeReviewRound(entity, "plan", 1, "blocked", { exitCode: 1 })
            writeReviewRound(entity, "plan", 2, null)
            for (const round of [3, 4]) {
                writeReviewRound(entity, "plan", round, "blocked")
                assert.equal(await blockedReviewGate(entity, "plan", round, 3), undefined)
            }
            writeReviewRound(entity, "plan", 5, "blocked")
            assert.deepEqual((await blockedReviewGate(entity, "plan", 5, 3))?.blockedRounds, [3, 4, 5])
        } finally {
            fs.rmSync(entity, { recursive: true, force: true })
        }
    })

    it("loads active rules and the same permission extension used by every agent", () => {
        const args = buildReviewerArgs(
            "Deliverable Reviewer",
            "/tmp/prompt.md",
            { kind: "standard", model: undefined },
            { directory: "/tmp/session", resume: false },
        )
        const extensions = args.flatMap((value, index) => (value === "--extension" ? [args[index + 1]] : []))

        assert.equal(args.includes("--no-extensions"), true)
        assert.deepEqual(
            extensions.map((value) => value.replaceAll(path.sep, "/").split("/").slice(-2).join("/")),
            ["rules/index.ts", "permissions/index.ts"],
        )
        for (const extension of extensions) assert.equal(fs.existsSync(extension), true)
    })

    it("creates ignored review directories after a fresh checkout", async () => {
        const entity = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-fresh-checkout-"))
        try {
            const round = await createReviewRoundDirectory(entity, "plan", 1)
            assert.equal(round, path.join(entity, "reviews", "plan-001"))
            assert.equal(fs.statSync(round).isDirectory(), true)
        } finally {
            fs.rmSync(entity, { recursive: true, force: true })
        }
    })

    it("binds an orphan plan snapshot to the retried review round", async () => {
        const deliverable = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-round-"))
        try {
            const localDir = deliverable
            const reviewsDir = path.join(localDir, "reviews")
            fs.mkdirSync(path.join(reviewsDir, "plan-001"), { recursive: true })
            fs.writeFileSync(path.join(localDir, "draft.md"), "current reviewed plan\n")
            fs.writeFileSync(path.join(reviewsDir, "plan-001", "candidate.md"), "orphan stale plan\n")

            const snapshot = await snapshotPlan(deliverable, 1)
            assert.equal(snapshot, path.join(reviewsDir, "plan-001", "candidate.md"))
            assert.equal(fs.readFileSync(snapshot, "utf-8"), "current reviewed plan\n")

            writeReviewRound(deliverable, "plan", 1, "approved")
            await requireApprovedPlanSnapshot(deliverable, snapshot)
            assert.equal(await latestApprovedPlanSnapshot(deliverable), snapshot)

            await assert.rejects(requireApprovedPlanSnapshot(deliverable, path.join(localDir, "draft.md")), /plan-NNN/)

            const blockedDir = path.join(reviewsDir, "plan-002")
            fs.mkdirSync(blockedDir)
            const blocked = path.join(blockedDir, "candidate.md")
            fs.writeFileSync(blocked, "blocked plan\n")
            writeReviewRound(deliverable, "plan", 2, "blocked")
            await assert.rejects(requireApprovedPlanSnapshot(deliverable, blocked), /review is blocked/)

            const malformedDir = path.join(reviewsDir, "plan-003")
            fs.mkdirSync(malformedDir)
            const malformed = path.join(malformedDir, "candidate.md")
            fs.writeFileSync(malformed, "malformed plan\n")
            fs.writeFileSync(path.join(malformedDir, "review.md"), renderReviewDocument(reviewReport("approved")))
            fs.writeFileSync(path.join(malformedDir, "outcome.json"), JSON.stringify({ exitCode: 0, signoff: null }))
            await assert.rejects(requireApprovedPlanSnapshot(deliverable, malformed), /review is malformed/)

            const missingReviewDir = path.join(reviewsDir, "plan-004")
            fs.mkdirSync(missingReviewDir)
            const missingReview = path.join(missingReviewDir, "candidate.md")
            fs.writeFileSync(missingReview, "unreviewed plan\n")
            await assert.rejects(requireApprovedPlanSnapshot(deliverable, missingReview), /matching review document/)
            assert.equal(await latestApprovedPlanSnapshot(deliverable), snapshot)
        } finally {
            fs.rmSync(deliverable, { recursive: true, force: true })
        }
    })

    it("snapshots an Epic candidate through the shared planning protocol", async () => {
        const epic = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-epic-review-round-"))
        try {
            fs.mkdirSync(path.join(epic, "reviews", "plan-001"), { recursive: true })
            fs.writeFileSync(path.join(epic, "draft.md"), "current Epic candidate\n")
            fs.writeFileSync(path.join(epic, "reviews", "plan-001", "candidate.md"), "orphan Epic candidate\n")

            const snapshot = await snapshotPlan(epic, 1)
            assert.equal(snapshot, path.join(epic, "reviews", "plan-001", "candidate.md"))
            assert.equal(fs.readFileSync(snapshot, "utf-8"), "current Epic candidate\n")
        } finally {
            fs.rmSync(epic, { recursive: true, force: true })
        }
    })

    it("propagates Project Policies into a fresh review prompt", async () => {
        const repository = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-prompt-"))
        try {
            const epicDir = path.join(repository, ".project", ".local", "epics", "example")
            fs.mkdirSync(epicDir, { recursive: true })
            const policies = [
                "# Project Policies",
                "",
                "- During Epic plan review, additionally check that every planned Task identifies its rollout stage.",
                "- During Deliverable final review, additionally check the completion artifact against the repository's release checklist.",
                "- Override automatic submission after final-artifact acceptance: commit locally, then wait for a separate explicit user request before pushing or creating a PR.",
                "",
            ].join("\n")
            fs.writeFileSync(path.join(repository, ".project", "policies.md"), policies)
            fs.writeFileSync(path.join(epicDir, "brief.md"), "# Brief\n")
            fs.writeFileSync(
                path.join(epicDir, "epic.md"),
                "# Accepted\n\n## Tasks\n\n### [#41] Existing Task\n\nKind: feature\n\nKeep it.\n",
            )
            const candidate = path.join(epicDir, "draft.md")
            fs.writeFileSync(candidate, "# Candidate\n")

            const prompt = await buildEpicReviewPrompt(
                { cwd: repository } as never,
                epicDir,
                candidate,
                "## plan-review-001.response.md\n\nF1 rejected by user.",
            )
            assert.ok(prompt.includes(policies))
            assert.match(prompt, /\[#41\] Existing Task/)
            assert.match(prompt, /F1 rejected by user/)
            assert.doesNotMatch(prompt, /# log\.md/)
            assert.match(prompt, /Return only one JSON object/)
            assert.doesNotMatch(prompt, /## Findings/)

            const gigDir = path.join(repository, ".project", ".local", "gigs", "7-example")
            fs.mkdirSync(path.join(gigDir, "reviews"), { recursive: true })
            fs.writeFileSync(path.join(gigDir, "brief.md"), "# Brief\n")
            fs.writeFileSync(path.join(gigDir, "plan.md"), "# Root cause\n\nUnique bugfix evidence.\n")
            fs.writeFileSync(
                path.join(gigDir, "metadata.json"),
                JSON.stringify({
                    title: "Example",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    phase: "selfReview",
                    branch: { state: "ready", name: "7-example", start: "main", target: "main", source: "generated" },
                    slug: "example",
                    tracker: {
                        provider: "github",
                        repository: { owner: "example", repo: "project" },
                        external: { issueNumber: 7 },
                        planComment: { state: "unpublished" },
                    },
                    entity: "gig",
                    kind: "bugfix",
                }),
            )
            const deliverablePrompt = await buildDeliverableReviewPrompt(
                { cwd: repository } as never,
                gigDir,
                "interim",
            )
            assert.ok(deliverablePrompt.includes(policies))
            for (const reviewPrompt of [prompt, deliverablePrompt]) {
                assert.match(reviewPrompt, /user decisions override Project Policies/)
                assert.match(reviewPrompt, /Project Policies override reusable workflow skills and references/)
                assert.match(reviewPrompt, /## Overview accurately represents the full supporting sections/)
                assert.match(reviewPrompt, /keeps material limitations visible/)
                assert.match(reviewPrompt, /### Plan highlights/)
            }
            assert.match(deliverablePrompt, /Unique bugfix evidence/)
            assert.match(deliverablePrompt, /Bugfix focus: symptom evidence/)
            assert.doesNotMatch(deliverablePrompt, /# log\.md/)
            assert.match(deliverablePrompt, /Return only one JSON object/)
            assert.doesNotMatch(deliverablePrompt, /## Findings/)

            await assert.rejects(
                buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, "final"),
                /bugfix final review requires a non-empty result\.md/,
            )
            fs.writeFileSync(
                path.join(gigDir, "result.md"),
                "# Result\n\n## Overview\n\n- Fixed the defect.\n\n## Verification\n\n- `test` — passed\n",
            )
            const pendingPath = path.join(gigDir, "pending.md")
            assert.equal(fs.existsSync(pendingPath), false)
            const rerunFinalPrompt = await buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, "final")
            assert.match(rerunFinalPrompt, /# result\.md/)
            assert.match(rerunFinalPrompt, /Verify that the existing result\.md remains synchronized/)

            fs.writeFileSync(pendingPath, "# Pending\n\n- [x] Resolved item\n")
            await assert.doesNotReject(buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, "final"))
            for (const entry of ["- [ ] Unresolved item", "1. [ ] Ordered unresolved item"]) {
                fs.writeFileSync(pendingPath, `# Pending\n\n${entry}\n`)
                await assert.rejects(
                    buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, "final"),
                    /requires zero unchecked pending entries; unresolved entries: line 3/,
                )
            }
            fs.writeFileSync(pendingPath, "# Pending\n")
            await assert.doesNotReject(buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, "final"))
            fs.rmSync(path.join(gigDir, "result.md"))

            const metadataPath = path.join(gigDir, "metadata.json")
            fs.writeFileSync(
                metadataPath,
                fs.readFileSync(metadataPath, "utf-8").replace('"kind":"bugfix"', '"kind":"audit"'),
            )
            fs.writeFileSync(path.join(gigDir, "report.md"), "# Audit report\n\nEvidenced finding.\n")
            const auditPrompt = await buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, "final")
            assert.match(auditPrompt, /Audit focus: declared scope and criteria/)
            assert.match(auditPrompt, /Evidenced finding/)

            const reportPath = path.join(gigDir, "report.md")
            for (const kind of ["audit", "research"] as const) {
                const currentMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as Record<string, unknown>
                fs.writeFileSync(metadataPath, JSON.stringify({ ...currentMetadata, kind }))
                fs.rmSync(reportPath, { force: true })
                await assert.rejects(
                    buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, "final"),
                    new RegExp(`${kind} final review requires a non-empty report\\.md`),
                )
                for (const content of ["", " \n\t"]) {
                    fs.writeFileSync(reportPath, content)
                    await assert.rejects(
                        buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, "final"),
                        new RegExp(`${kind} final review requires a non-empty report\\.md`),
                    )
                }
            }

            fs.writeFileSync(reportPath, "# Research report\n\nSupported conclusion.\n")
            const researchPrompt = await buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, "final")
            assert.match(researchPrompt, /Research focus: question and boundaries/)
            assert.match(researchPrompt, /Supported conclusion/)
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })
})
