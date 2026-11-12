import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
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
    assertReviewPreconditions,
    branchDiff,
    buildDeliverableReviewPrompt,
    createReviewRoundDirectory,
    failedReviewGate,
    ReviewRequestValidator,
    snapshotCandidate,
} from "../workflows/extensions/review/index.ts"
import registerEpic from "../workflows/extensions/epic/index.ts"
import { readReviewCycle, type ReviewPass } from "../workflows/extensions/__lib/review-rounds.ts"
import { buildEpicReviewPrompt } from "../workflows/extensions/review/epic.ts"
import { chooseReviewPass, reviewPassNotice, reviewPassPrompt } from "../workflows/extensions/review/pass.ts"
import type { ReviewAgentRunOptions, ReviewAgentRunResult } from "../workflows/extensions/review/agent.ts"
import {
    executeReviewRound,
    recordRoundResponse,
    renderReviewRoundResult,
} from "../workflows/extensions/review/round.ts"

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
            toolset: "filesAndGit",
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
                          severity: "blocking",
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
        pass?: ReviewPass
    } = {},
): void {
    const directory = reviewRoundDir(entity, phase, round)
    fs.mkdirSync(directory, { recursive: true })
    // A round the review tool created already carries its pass.
    const passFile = path.join(directory, "pass.json")
    if (options.pass || !fs.existsSync(passFile))
        fs.writeFileSync(passFile, JSON.stringify(options.pass ?? { kind: "review" }))
    if (signoff) {
        const report = reviewReport(signoff)
        fs.writeFileSync(reviewFile(entity, phase, round), renderReviewDocument(report))
        fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report))
    }
    fs.writeFileSync(path.join(directory, "outcome.json"), JSON.stringify({ exitCode: options.exitCode ?? 0, signoff }))
}

describe("workflow reviewer isolation", () => {
    it("registers one review tool per entity and one response recorder", () => {
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
        ])
    })

    for (const layout of ["directory", "linked"] as const)
        it(`chooses each pass from the saved rounds, whatever the Phase (${layout} local root)`, async () => {
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
                fs.writeFileSync(path.join(directory, "plan.md"), plan)
                const completion = "# Result\n\nDelivered work.\n"
                fs.writeFileSync(path.join(directory, "result.md"), completion)
                const tools: Parameters<ExtensionAPI["registerTool"]>[0][] = []
                registerReviewTools({
                    events: createEventBus(),
                    on() {},
                    registerTool: (tool: (typeof tools)[number]) => tools.push(tool),
                } as never)
                const review = tools.find((tool) => tool.name === "review_gig")!
                const respond = tools.find((tool) => tool.name === "record_review_response")!
                const ctx = { cwd: repository } as never
                const stopBeforeRunner = new Error("Reached the reviewer subprocess boundary")
                const run = (params: Record<string, unknown>) =>
                    review.execute(
                        "test",
                        { entityDir, ...params },
                        undefined,
                        () => {
                            throw stopBeforeRunner
                        },
                        ctx,
                    )
                const reachesReviewer = (params: Record<string, unknown>) =>
                    assert.rejects(run(params), (error: unknown) => error === stopBeforeRunner)
                const rounds = () => fs.readdirSync(path.join(directory, "reviews")).sort()
                const pass = (category: string, round: number) =>
                    JSON.parse(
                        fs.readFileSync(path.join(reviewRoundDir(directory, category, round), "pass.json"), "utf-8"),
                    )
                const candidate = (category: string, round: number) =>
                    path.join(reviewRoundDir(directory, category, round), "candidate.md")

                // No review category requires a Phase: a plan review runs while the entity is in Execution.
                const before = JSON.stringify({ ...metadata, phase: "execution" })
                fs.writeFileSync(metadataPath, before)
                await reachesReviewer({ phase: "plan" })
                assert.equal(fs.readFileSync(metadataPath, "utf-8"), before)
                assert.deepEqual(pass("plan", 1), { kind: "review" })
                assert.equal(fs.readFileSync(candidate("plan", 1), "utf-8"), plan)

                // A round without a valid report isn't a pass, so the next call is still the review.
                await reachesReviewer({ phase: "plan" })
                assert.deepEqual(pass("plan", 2), { kind: "review" })

                // After a blocked review the next call verifies its fixes, and takes no newReview.
                writeReviewRound(directory, "plan", 2, "blocked")
                await assert.rejects(run({ phase: "plan", newReview: "Scope grew." }), /omit newReview/)
                assert.deepEqual(rounds(), ["plan-001", "plan-002"])

                // Only rejected findings and ones needing the user's decision are recorded.
                const record = (responses: unknown[]) =>
                    respond.execute(
                        "test",
                        { entityDir, phase: "plan", round: 2, responses },
                        undefined,
                        undefined,
                        ctx,
                    )
                const rejection = { id: "F1", outcome: "rejected", explanation: "Review is a separate step." }
                await assert.rejects(record([{ ...rejection, id: "F2" }]), /no finding F2/)
                await assert.rejects(record([rejection, rejection]), /more than one response/)
                await assert.rejects(record([{ ...rejection, outcome: "accepted" }]))
                await record([rejection])
                assert.deepEqual(
                    JSON.parse(
                        fs.readFileSync(path.join(reviewRoundDir(directory, "plan", 2), "response.json"), "utf-8"),
                    ),
                    { responses: [rejection] },
                )

                fs.writeFileSync(path.join(directory, "plan.md"), `${plan}\nFixed.\n`)
                await reachesReviewer({ phase: "plan" })
                assert.deepEqual(pass("plan", 3), { kind: "verification", of: 2 })
                // The verification prompt carries the findings, the recorded response, and the text diff.
                const verifying = chooseReviewPass(readReviewCycle(directory, "plan"), "plan", undefined)
                const verification = await reviewPassPrompt(directory, "plan", verifying, candidate("plan", 3))
                assert.match(verification.instructions.join("\n"), /verification pass for plan-002/)
                assert.match(verification.sections, /Payout can start before review/)
                assert.match(verification.sections, /F1.*rejected\. Review is a separate step\./)
                assert.match(verification.sections, /^\+Fixed\.$/m)
                const verificationPrompt = await buildDeliverableReviewPrompt(
                    ctx,
                    directory,
                    { phase: "plan", planSnapshot: candidate("plan", 3) },
                    undefined,
                    verification,
                )
                assert.ok(verificationPrompt.includes(verification.sections))
                assert.match(verificationPrompt, /verification pass for plan-002/)

                // A blocked verification finishes the cycle: no third round without a reason.
                writeReviewRound(directory, "plan", 3, "blocked")
                assert.equal(reviewPassNotice({ kind: "review" }, "approved", 0), undefined)
                assert.match(reviewPassNotice({ kind: "review" }, "blocked", 1) ?? "", /verification pass/)
                assert.match(reviewPassNotice(verifying, "blocked", 1) ?? "", /open concern/)
                await assert.rejects(run({ phase: "plan" }), /plan review cycle is finished \(plan-003, blocked\)/)
                assert.deepEqual(rounds(), ["plan-001", "plan-002", "plan-003"])
                await reachesReviewer({ phase: "plan", newReview: "Scope grew." })
                assert.deepEqual(pass("plan", 4), { kind: "review", newReview: "Scope grew." })
                // A new review sees the reason and the earlier rejection, so it doesn't raise it again.
                const again = await reviewPassPrompt(
                    directory,
                    "plan",
                    { kind: "review", newReview: "Scope grew." },
                    candidate("plan", 4),
                )
                assert.match(again.instructions.join("\n"), /Scope grew\./)
                assert.match(again.sections, /plan-002[\s\S]*Review is a separate step\./)

                // Interim reviews take a new subject each time, so a finished cycle restarts freely.
                await reachesReviewer({ phase: "interim" })
                writeReviewRound(directory, "interim", 1, "approved")
                await reachesReviewer({ phase: "interim", subject: "Parser" })
                assert.deepEqual(pass("interim", 2), { kind: "review" })

                // The final round snapshots the completion artifact and leaves it in place.
                await reachesReviewer({ phase: "final" })
                assert.equal(fs.readFileSync(candidate("final", 1), "utf-8"), completion)
                assert.equal(fs.readFileSync(path.join(directory, "result.md"), "utf-8"), completion)
                writeReviewRound(directory, "final", 1, "approved")
                await assert.rejects(run({ phase: "final" }), /final review cycle is finished \(final-001, approved\)/)
                await reachesReviewer({ phase: "final", newReview: "Behavior changed." })
                assert.deepEqual(pass("final", 2), { kind: "review", newReview: "Behavior changed." })

                if (layout === "linked") {
                    // Everything was written through the link into the source checkout's directory.
                    assert.ok(fs.existsSync(path.join(source, "gigs/7-example/reviews/plan-001/candidate.md")))
                    assert.ok(fs.existsSync(path.join(source, "gigs/7-example/reviews/final-001/candidate.md")))
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
                ["review_gig", gig("feature", "planning", {}, "no-plan"), "plan", /plan review requires plan\.md/],
                [
                    "review_gig",
                    gig("feature", "selfReview", { "report.md": "# Report\n\nDone.\n" }, "no-result"),
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
                        { "epic.md": "# Epic\n" },
                    ),
                    "plan",
                    /review requires brief\.md/,
                ],
                [
                    "review_task",
                    entity(
                        ".project/.local/gigs/orphan/tasks/7-example",
                        { entity: "task", kind: "feature", phase: "planning" },
                        { "plan.md": "# Plan\n" },
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
                "### 1. Payout can start before review (F1, blocking)",
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
        for (const [severity, signoff] of [
            ["blocking", "blocked"],
            ["note", "approved"],
        ] as const) {
            const source = parseReviewReport(
                JSON.stringify({ signoff, findings: [{ ...report.findings[0], severity }] }),
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
        // The signoff follows from the severities: a report where they disagree is invalid.
        assert.throws(
            () => parseReviewReport(JSON.stringify({ ...report, signoff: "approved" })),
            /approved review report must not contain a blocking finding/,
        )
        for (const findings of [[], [{ ...report.findings[0], severity: "note" }]])
            assert.throws(
                () => parseReviewReport(JSON.stringify({ findings, signoff: "blocked" })),
                /blocked review report must contain at least one blocking finding/,
            )
        assert.throws(
            () =>
                parseReviewReport(
                    JSON.stringify({ ...report, findings: [{ ...report.findings[0], severity: "warning" }] }),
                ),
            /severity is invalid/,
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

    it("ends a successful round result with the signoff and keeps round paths out", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-result-"))
        try {
            const { value } = await runRound(directory, [runResult(JSON.stringify(reviewReport("blocked")))])
            assert.ok(value)
            assert.ok(fs.existsSync(path.join(directory, "outcome.json")))
            for (const notice of [undefined, "Pause here."]) {
                const text = renderReviewRoundResult(value.report, 7, notice)
                const lines = text.split("\n")
                assert.equal(lines.at(-1), "**Signoff:** blocked")
                assert.equal(lines.indexOf("**Review round:** 7"), notice ? 2 : 0)
                if (notice) assert.equal(lines[0], notice)
                assert.doesNotMatch(text, /outcome\.json|Artifacts:/)
            }
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
            for (const file of ["request.md", "transcript.md", "outcome.json"]) assert.ok(error?.message.includes(file))
            assert.equal(fs.existsSync(path.join(directory, "invalid-report.md")), false)
        } finally {
            fs.rmSync(directory, { recursive: true, force: true })
        }
    })

    it("pauses after consecutive failed rounds, which never count as a pass", () => {
        const entity = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-failures-"))
        try {
            writeReviewRound(entity, "final", 1, null)
            assert.equal(failedReviewGate(entity, "final", 1), undefined)
            writeReviewRound(entity, "final", 2, "blocked", { exitCode: 143 })
            assert.deepEqual(failedReviewGate(entity, "final", 2), [1, 2])
            assert.deepEqual(readReviewCycle(entity, "final"), { state: "none" })
            writeReviewRound(entity, "final", 3, "blocked")
            assert.equal(failedReviewGate(entity, "final", 3), undefined)
            writeReviewRound(entity, "final", 4, null)
            assert.equal(failedReviewGate(entity, "final", 4), undefined)
            writeReviewRound(entity, "final", 5, null)
            assert.deepEqual(failedReviewGate(entity, "final", 5), [4, 5])
            writeReviewRound(entity, "final", 6, null)
            assert.deepEqual(failedReviewGate(entity, "final", 6), [4, 5, 6])
            assert.equal(failedReviewGate(entity, "interim", 1), undefined)
            // The blocked review before the failures still waits for its verification.
            const cycle = readReviewCycle(entity, "final")
            assert.equal(cycle.state, "awaitingVerification")
            assert.equal(chooseReviewPass(cycle, "final", undefined).kind, "verification")
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
            ReviewRequestValidator.check({
                entity: "epic",
                entityDir: ".project/.local/epics/example",
                phase: "plan",
            }),
            true,
        )
        assert.equal(
            ReviewRequestValidator.check({
                entity: "epic",
                entityDir: ".project/.local/epics/example",
                phase: "final",
            }),
            false,
        )
        assert.equal(
            ReviewRequestValidator.check({
                entity: "task",
                entityDir: ".project/.local/epics/example/tasks/task",
                phase: "final",
            }),
            true,
        )
        assert.equal(
            ReviewRequestValidator.check({
                entity: "task",
                entityDir: ".project/.local/epics/example/tasks/task",
                phase: "final",
                continuation: { approved: true },
            }),
            false,
        )
        assert.equal(
            ReviewRequestValidator.check({
                entity: "gig",
                entityDir: ".project/.local/gigs/example",
                phase: "plan",
                epicDir: ".project/.local/epics/example",
            }),
            false,
        )
        // Each input exists only for the category that uses it.
        const gig = { entity: "gig", entityDir: ".project/.local/gigs/example" }
        const checks: Array<[Record<string, unknown>, boolean]> = [
            [{ phase: "conflict-plan", resolution: "Keep both lines." }, true],
            [{ phase: "conflict-plan" }, false],
            [{ phase: "conflict-plan", resolution: "" }, false],
            [{ phase: "conflict-merge" }, true],
            [{ phase: "conflict-merge", resolution: "Keep both lines." }, false],
            [{ phase: "final", resolution: "Keep both lines." }, false],
            [{ phase: "interim", subject: "Parser" }, true],
            [{ phase: "final", subject: "Parser" }, false],
            [{ phase: "conflict-plan", resolution: "Keep both lines.", subject: "Parser" }, false],
            // Only the categories whose finished cycle needs a reason take one.
            [{ phase: "plan", newReview: "Scope grew." }, true],
            [{ phase: "final", newReview: "Behavior changed." }, true],
            [{ phase: "plan", newReview: "" }, false],
            [{ phase: "interim", newReview: "Scope grew." }, false],
            [{ phase: "conflict-merge", newReview: "Scope grew." }, false],
        ]
        for (const [input, valid] of checks)
            assert.equal(ReviewRequestValidator.check({ ...gig, ...input }), valid, JSON.stringify(input))
        assert.equal(
            ReviewRequestValidator.check({
                entity: "epic",
                entityDir: ".project/.local/epics/example",
                phase: "conflict-plan",
                resolution: "Keep both lines.",
            }),
            false,
        )
    })

    it("loads active rules and the same permission extension used by every agent", () => {
        const launched = (toolset: "files" | "filesAndGit") => {
            const args = buildReviewerArgs(
                "Deliverable Reviewer",
                "/tmp/prompt.md",
                { kind: "standard", model: undefined },
                { directory: "/tmp/session", resume: false },
                toolset,
            )
            assert.equal(args.includes("--no-extensions"), true)
            const extensions = args.flatMap((value, index) => (value === "--extension" ? [args[index + 1]] : []))
            for (const extension of extensions) assert.equal(fs.existsSync(extension), true)
            return {
                tools: args[args.indexOf("--tools") + 1],
                extensions: extensions.map((value) => value.replaceAll(path.sep, "/").split("/").slice(-2).join("/")),
            }
        }
        // Entity reviews read the trusted repository with git_read; incoming-PR reviews don't load it.
        assert.deepEqual(launched("filesAndGit"), {
            tools: "read,grep,find,ls,git_read",
            extensions: ["rules/index.ts", "permissions/index.ts", "review/git-read.ts"],
        })
        assert.deepEqual(launched("files"), {
            tools: "read,grep,find,ls",
            extensions: ["rules/index.ts", "permissions/index.ts"],
        })
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

    it("copies the reviewed document into the round, replacing an orphan snapshot", async () => {
        const entity = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-round-"))
        try {
            fs.mkdirSync(path.join(entity, "reviews", "plan-001"), { recursive: true })
            fs.writeFileSync(path.join(entity, "reviews", "plan-001", "candidate.md"), "orphan stale plan\n")
            for (const document of ["plan.md", "epic.md"] as const) {
                fs.writeFileSync(path.join(entity, document), `current ${document}\n`)
                const snapshot = await snapshotCandidate(entity, document, "plan", 1)
                assert.equal(snapshot, path.join(entity, "reviews", "plan-001", "candidate.md"))
                assert.equal(fs.readFileSync(snapshot, "utf-8"), `current ${document}\n`)
            }
            await assert.rejects(snapshotCandidate(entity, "result.md", "final", 1), /does not exist: result\.md/)
        } finally {
            fs.rmSync(entity, { recursive: true, force: true })
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
                "- Override Deliverable submission: on a submit request, commit locally, then wait for a separate explicit user request before pushing or creating a PR.",
                "",
            ].join("\n")
            fs.writeFileSync(path.join(repository, ".project", "policies.md"), policies)
            fs.writeFileSync(path.join(epicDir, "brief.md"), "# Brief\n")
            const candidate = path.join(epicDir, "epic.md")
            fs.writeFileSync(candidate, "# Candidate\n")

            const prompt = await buildEpicReviewPrompt({ cwd: repository } as never, epicDir, candidate, {
                previousCandidate: "# Reviewed\n\n## Tasks\n\n### [#41] Existing Task\n\nKind: feature\n\nKeep it.\n",
                pass: { instructions: [], sections: "F1 rejected by user." },
            })
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
            const deliverablePrompt = await buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, {
                phase: "interim",
            })
            assert.ok(deliverablePrompt.includes(policies))
            for (const reviewPrompt of [prompt, deliverablePrompt]) {
                assert.match(reviewPrompt, /user decisions override Project Policies/)
                assert.match(reviewPrompt, /Project Policies override reusable workflow skills and references/)
                // Every entity reviewer launches with git_read, so every entity prompt names it.
                assert.match(reviewPrompt, /git_read/)
                // Both reviewers use the same two severities.
                assert.match(reviewPrompt, /blocking\|note/)
            }
            assert.match(deliverablePrompt, /Unique bugfix evidence/)
            assert.match(deliverablePrompt, /Bugfix focus: symptom evidence/)
            assert.doesNotMatch(deliverablePrompt, /# log\.md/)
            assert.match(deliverablePrompt, /Return only one JSON object/)
            assert.doesNotMatch(deliverablePrompt, /## Findings/)

            // Final review requires the kind's completion artifact.
            assert.throws(
                () => assertReviewPreconditions(gigDir, "final"),
                /bugfix final review requires a non-empty result\.md/,
            )
            const draftPath = path.join(gigDir, "result.md")
            fs.writeFileSync(
                draftPath,
                "# Result\n\n## Overview\n\n- Fixed the defect.\n\n## Verification\n\n- `test` — passed\n",
            )
            const pendingPath = path.join(gigDir, "pending.md")
            assert.equal(fs.existsSync(pendingPath), false)
            assert.doesNotThrow(() => assertReviewPreconditions(gigDir, "final"))
            // Interim review needs no completion artifact.
            fs.rmSync(draftPath)
            assert.doesNotThrow(() => assertReviewPreconditions(gigDir, "interim"))
            fs.writeFileSync(draftPath, "# Result\n\n## Overview\n\n- Fixed the defect.\n")

            fs.writeFileSync(pendingPath, "# Pending\n\n- [x] Resolved item\n")
            assert.doesNotThrow(() => assertReviewPreconditions(gigDir, "final"))
            for (const entry of ["- [ ] Unresolved item", "1. [ ] Ordered unresolved item"]) {
                fs.writeFileSync(pendingPath, `# Pending\n\n${entry}\n`)
                assert.throws(
                    () => assertReviewPreconditions(gigDir, "final"),
                    /requires zero unchecked pending entries; unresolved entries: line 3/,
                )
            }
            fs.writeFileSync(pendingPath, "# Pending\n")

            // The final round reviews its snapshot of the artifact; the other kind's artifact is context only.
            const finalSnapshot = await snapshotCandidate(gigDir, "result.md", "final", 1)
            assert.equal(finalSnapshot, path.join(reviewRoundDir(gigDir, "final", 1), "candidate.md"))
            assert.equal(fs.readFileSync(finalSnapshot, "utf-8"), fs.readFileSync(draftPath, "utf-8"))
            fs.writeFileSync(draftPath, "# Result\n\nEdited after the snapshot.\n")
            fs.writeFileSync(path.join(gigDir, "report.md"), "# Research report\n\nPrior research conclusion.\n")
            const finalPrompt = await buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, {
                phase: "final",
                completionSnapshot: finalSnapshot,
            })
            assert.match(finalPrompt, /final-001\/candidate\.md \(completion artifact under review\)/)
            assert.match(finalPrompt, /Fixed the defect/)
            assert.doesNotMatch(finalPrompt, /Edited after the snapshot/)
            assert.match(finalPrompt, /# report\.md \(context\)/)
            assert.match(finalPrompt, /Prior research conclusion/)
            fs.rmSync(path.join(gigDir, "report.md"))
            fs.writeFileSync(finalSnapshot, " \n")
            await assert.rejects(
                buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, {
                    phase: "final",
                    completionSnapshot: finalSnapshot,
                }),
                /requires a non-empty completion snapshot/,
            )
            fs.rmSync(draftPath)

            const metadataPath = path.join(gigDir, "metadata.json")
            const reportDraftPath = path.join(gigDir, "report.md")
            for (const kind of ["audit", "research"] as const) {
                const currentMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as Record<string, unknown>
                fs.writeFileSync(metadataPath, JSON.stringify({ ...currentMetadata, kind }))
                fs.rmSync(reportDraftPath, { force: true })
                // A result.md never satisfies a kind that delivers a report.
                fs.writeFileSync(path.join(gigDir, "result.md"), "# Result\n\nWrong artifact.\n")
                assert.throws(
                    () => assertReviewPreconditions(gigDir, "final"),
                    new RegExp(`${kind} final review requires a non-empty report\\.md`),
                )
                fs.rmSync(path.join(gigDir, "result.md"))
                for (const content of ["", " \n\t"]) {
                    fs.writeFileSync(reportDraftPath, content)
                    assert.throws(
                        () => assertReviewPreconditions(gigDir, "final"),
                        new RegExp(`${kind} final review requires a non-empty report\\.md`),
                    )
                }
            }

            fs.writeFileSync(reportDraftPath, "# Research report\n\nSupported conclusion.\n")
            const researchSnapshot = await snapshotCandidate(gigDir, "report.md", "final", 2)
            const researchPrompt = await buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, {
                phase: "final",
                completionSnapshot: researchSnapshot,
            })
            assert.match(researchPrompt, /Research focus: question and boundaries/)
            assert.match(researchPrompt, /Supported conclusion/)
            fs.writeFileSync(
                metadataPath,
                JSON.stringify({ ...JSON.parse(fs.readFileSync(metadataPath, "utf-8")), kind: "audit" }),
            )
            const auditPrompt = await buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, {
                phase: "final",
                completionSnapshot: researchSnapshot,
            })
            assert.match(auditPrompt, /Audit focus: declared scope and criteria/)
            assert.doesNotMatch(auditPrompt, /direct path/)

            // Without a plan the Deliverable took the direct path, and the brief is the requirement.
            fs.rmSync(path.join(gigDir, "plan.md"))
            const directPrompt = await buildDeliverableReviewPrompt({ cwd: repository } as never, gigDir, {
                phase: "final",
                completionSnapshot: researchSnapshot,
            })
            assert.match(directPrompt, /direct path/)
        } finally {
            fs.rmSync(repository, { recursive: true, force: true })
        }
    })

    it("ties conflict-merge rounds to the approved conflict-plan for that exact merge", async () => {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-conflict-"))
        const root = path.join(parent, "work")
        const git = (...args: string[]) => cp.execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim()
        const write = (content: string) => fs.writeFileSync(path.join(root, "notes.md"), content)
        // Merges the target into the branch, resolving the conflict to `content`.
        const mergeTarget = (content: string) => {
            cp.spawnSync("git", ["merge", "-q", "--no-ff", "--no-commit", "origin/main"], { cwd: root })
            write(content)
            git("add", "notes.md")
            git("commit", "-q", "--no-edit")
            return git("rev-parse", "HEAD")
        }
        const changeTarget = (content: string) => {
            git("switch", "-q", "main")
            write(content)
            git("commit", "-q", "-am", "target change")
            git("push", "-q", "origin", "main")
            git("switch", "-q", branch)
            return git("rev-parse", "origin/main")
        }
        const branch = "7-example"
        try {
            cp.execFileSync("git", ["init", "-q", "--bare", path.join(parent, "origin.git")])
            fs.mkdirSync(root)
            git("init", "-q", "-b", "main")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            git("remote", "add", "origin", path.join(parent, "origin.git"))
            fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local\n")
            write("a\nbase\nc\n")
            git("add", ".")
            git("commit", "-q", "-m", "initial")
            git("push", "-q", "origin", "main")
            git("switch", "-q", "-c", branch)
            write("a\nbranch\nc\n")
            git("commit", "-q", "-am", "branch change")
            git("push", "-q", "origin", branch)
            const branchHead = git("rev-parse", "HEAD")
            const targetSha = changeTarget("a\ntarget\nc\n")

            fs.mkdirSync(path.join(root, ".project"))
            fs.writeFileSync(
                path.join(root, ".project/config.json"),
                JSON.stringify({ branches: { format: "identifier-title" } }),
            )
            prepareArtifactPersistence(root)
            const entityDir = ".project/.local/gigs/7-example"
            const directory = path.join(root, entityDir)
            fs.mkdirSync(directory, { recursive: true })
            fs.writeFileSync(path.join(directory, "plan.md"), "# Plan\n\n## Overview\n\nAccepted.\n")
            fs.writeFileSync(
                path.join(directory, "metadata.json"),
                JSON.stringify({
                    title: "Example",
                    slug: "example",
                    createdAt: "2026-01-01T00:00:00Z",
                    phase: "selfReview",
                    entity: "gig",
                    kind: "feature",
                    branch: { state: "ready", name: branch, start: "main", target: "main", source: "generated" },
                    tracker: {
                        provider: "github",
                        repository: { owner: "example", repo: "project" },
                        external: { issueNumber: 7 },
                        planComment: { state: "unpublished" },
                    },
                }),
            )
            const tools: Parameters<ExtensionAPI["registerTool"]>[0][] = []
            registerReviewTools({
                events: createEventBus(),
                on() {},
                registerTool: (tool: (typeof tools)[number]) => tools.push(tool),
            } as never)
            const review = tools.find((tool) => tool.name === "review_gig")!
            const stop = new Error("Reached the reviewer subprocess boundary")
            const ctx = { cwd: root } as never
            const run = (params: Record<string, unknown>) =>
                review.execute(
                    "test",
                    { entityDir, ...params },
                    undefined,
                    () => {
                        throw stop
                    },
                    ctx,
                )
            const reachesReviewer = (params: Record<string, unknown>) =>
                assert.rejects(run(params), (error: unknown) => error === stop)
            const recorded = (phase: string, round: number, file: string) =>
                JSON.parse(fs.readFileSync(path.join(reviewRoundDir(directory, phase, round), file), "utf-8"))

            // The plan round records the conflict between the branch head and the fetched target.
            await reachesReviewer({ phase: "conflict-plan", resolution: "Keep both lines." })
            const firstConflict = recorded("conflict-plan", 1, "conflict.json")
            assert.deepEqual(firstConflict, {
                branch,
                target: "main",
                preMergeBase: branchHead,
                targetSha,
                resolution: "Keep both lines.",
            })
            const planPrompt = await buildDeliverableReviewPrompt(ctx, directory, {
                phase: "conflict-plan",
                conflict: firstConflict,
                record: "conflict.json",
            })
            assert.match(planPrompt, /Keep both lines\./)
            assert.ok(
                planPrompt.includes(`"--write-tree", "--name-only", "--messages", "${branchHead}", "${targetSha}"`),
            )
            // The reviewer lists the target commits behind the conflict and checks each against the plan.
            assert.ok(planPrompt.includes(`"${branchHead}..${targetSha}", "--"`))
            assert.match(planPrompt, /Target changes to keep/)

            // No merge review before the newest plan round approves, or before the merge exists.
            await assert.rejects(run({ phase: "conflict-merge" }), /newest conflict-plan round to be approved/)
            writeReviewRound(directory, "conflict-plan", 1, "approved")
            await assert.rejects(run({ phase: "conflict-merge" }), /end in a merge commit/)

            // Conflict rounds record responses for Deliverables; Epic directories accept only plan.
            const respond = tools.find((tool) => tool.name === "record_review_response")!
            const response = { round: 1, responses: [] }
            await respond.execute("test", { entityDir, phase: "conflict-plan", ...response }, undefined, undefined, ctx)
            assert.ok(fs.existsSync(path.join(reviewRoundDir(directory, "conflict-plan", 1), "response.json")))
            const epicDir = ".project/.local/epics/7-example"
            fs.mkdirSync(path.join(root, epicDir), { recursive: true })
            fs.writeFileSync(
                path.join(root, epicDir, "metadata.json"),
                fs
                    .readFileSync(path.join(directory, "metadata.json"), "utf-8")
                    .replace(/"entity":"gig","kind":"feature"/, '"entity":"epic"'),
            )
            await assert.rejects(
                respond.execute(
                    "test",
                    { entityDir: epicDir, phase: "conflict-merge", ...response },
                    undefined,
                    undefined,
                    ctx,
                ),
                /Epic reviews have only the plan category/,
            )

            const merge = mergeTarget("a\nbranch\ntarget\nc\n")
            await reachesReviewer({ phase: "conflict-merge" })
            assert.deepEqual(recorded("conflict-merge", 1, "merge.json"), { merge, planRound: "conflict-plan-001" })
            const mergePrompt = await buildDeliverableReviewPrompt(ctx, directory, {
                phase: "conflict-merge",
                conflict: firstConflict,
                merge,
                record: "merge.json",
            })
            assert.ok(mergePrompt.includes(`"--remerge-diff", "${merge}"`))
            assert.match(mergePrompt, /Approved resolution plan/)
            assert.match(mergePrompt, /Target changes to keep/)

            // Replanning on the unpushed merge records its first parent, where the reset returns.
            await reachesReviewer({ phase: "conflict-plan", resolution: "Keep only the target line." })
            assert.equal(recorded("conflict-plan", 2, "conflict.json").preMergeBase, branchHead)
            // An older approval never covers a newer, unapproved plan.
            writeReviewRound(directory, "conflict-plan", 2, "blocked")
            await assert.rejects(run({ phase: "conflict-merge" }), /conflict-plan-002/)
            // The corrected resolution is verified against the blocked round, and that approval counts.
            await reachesReviewer({ phase: "conflict-plan", resolution: "Keep only the target line." })
            assert.deepEqual(recorded("conflict-plan", 3, "pass.json"), { kind: "verification", of: 2 })
            writeReviewRound(directory, "conflict-plan", 3, "approved")
            git("reset", "-q", "--keep", `${merge}^1`)
            mergeTarget("a\ntarget\nc\n")
            await reachesReviewer({ phase: "conflict-merge" })
            assert.equal(recorded("conflict-merge", 2, "merge.json").planRound, "conflict-plan-003")

            // A plan recorded for an earlier conflict never covers a later merge.
            git("push", "-q", "origin", branch)
            changeTarget("a\nnewer target\nc\n")
            mergeTarget("a\nnewer target\nc\n")
            await assert.rejects(run({ phase: "conflict-merge" }), /parents don't match conflict-plan-003/)
        } finally {
            fs.rmSync(parent, { recursive: true, force: true })
        }
    })
})

describe("final review diff", () => {
    it("covers the branch from its merge base with the target, committed steps included", async () => {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-branch-diff-"))
        const root = path.join(parent, "work")
        const git = (...args: string[]) => cp.execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim()
        const write = (name: string, content: string) => fs.writeFileSync(path.join(root, name), content)
        try {
            cp.execFileSync("git", ["init", "-q", "--bare", path.join(parent, "origin.git")])
            fs.mkdirSync(root)
            git("init", "-q", "-b", "main")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            git("remote", "add", "origin", path.join(parent, "origin.git"))
            write("base.md", "base\n")
            git("add", ".")
            git("commit", "-q", "-m", "initial")
            git("push", "-q", "origin", "main")
            git("switch", "-q", "-c", "7-example")
            write("committed.md", "committed step\n")
            git("add", ".")
            git("commit", "-q", "-m", "step one")
            write("base.md", "base\nunstaged change\n")
            write("untracked.md", "new file\n")
            // The target moved on after the branch started; its changes aren't the branch's.
            git("switch", "-q", "-c", "other", "main")
            write("target-only.md", "target change\n")
            git("add", "target-only.md")
            git("commit", "-q", "-m", "target change")
            git("push", "-q", "origin", "other:main")
            git("switch", "-q", "7-example")

            const diff = await branchDiff(root, "main")
            assert.match(diff, /refs\/remotes\/origin\/main/)
            assert.match(diff, /^\+committed step$/m)
            assert.match(diff, /^\+unstaged change$/m)
            assert.match(diff, /\?\? untracked\.md/)
            assert.doesNotMatch(diff, /target change/)

            // Without a remote-tracking target the local branch is the base.
            git("update-ref", "-d", "refs/remotes/origin/main")
            const local = await branchDiff(root, "main")
            assert.match(local, /refs\/heads\/main/)
            assert.match(local, /^\+committed step$/m)

            // With no target at all, the reviewer is told the diff shows only uncommitted work.
            const missing = await branchDiff(root, "absent")
            assert.match(missing, /No merge base with target absent/)
            assert.doesNotMatch(missing, /^\+committed step$/m)
            assert.match(missing, /^\+unstaged change$/m)
        } finally {
            fs.rmSync(parent, { recursive: true, force: true })
        }
    })
})
