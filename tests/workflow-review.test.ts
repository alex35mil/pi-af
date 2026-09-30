import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import { Value } from "typebox/value"

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
    formatBlockedReviewPause,
    latestApprovedPlanSnapshot,
    ReviewRequestSchema,
    requireApprovedPlanSnapshot,
    snapshotPlan,
} from "../workflows/extensions/review/index.ts"
import registerEpic from "../workflows/extensions/epic/index.ts"
import { buildEpicReviewPrompt } from "../workflows/extensions/review/epic.ts"

function reviewRoundDir(entity: string, phase: string, round: number): string {
    return path.join(entity, ".local", "reviews", `${phase}-${round.toString().padStart(3, "0")}`)
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
    it("registers one review tool for every entity variant", () => {
        const tools: string[] = []
        const pi = {
            registerTool: (definition: { name: string }) => tools.push(definition.name),
            registerCommand: () => {},
        }
        registerReviewTools(pi as never)
        registerEpic(pi as never)
        assert.deepEqual(tools, ["review", "record_review_response", "present_plan"])
    })

    it("uses one canonical finding renderer for persisted and chat output", () => {
        const report = parseReviewReport(JSON.stringify(reviewReport("blocked")))
        const findings = renderReviewFindings(report.findings)
        assert.equal(
            findings,
            [
                "## Review findings",
                "",
                "### 1. Payout can start before review (F1)",
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

        const technicalExample = ['Compare "- <pre>', "  * literal", '  </pre>".', "Use `first", "    second`."].join(
            "\n",
        )
        const technicalFindings = renderReviewFindings([{ ...report.findings[0], useCase: `\n${technicalExample}\n` }])
        assert.ok(technicalFindings.includes(`**Use case:** ${technicalExample}`))

        assert.throws(
            () => parseReviewReport(JSON.stringify({ ...report, commentary: "extra" })),
            /unexpected or missing fields/,
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

    it("accepts only valid entity/phase review combinations", () => {
        assert.equal(
            Value.Check(ReviewRequestSchema, {
                entity: "epic",
                entityDir: ".project/epics/example",
                phase: "plan",
            }),
            true,
        )
        assert.equal(
            Value.Check(ReviewRequestSchema, {
                entity: "epic",
                entityDir: ".project/epics/example",
                phase: "final",
            }),
            false,
        )
        assert.equal(
            Value.Check(ReviewRequestSchema, {
                entity: "task",
                entityDir: ".project/epics/example/tasks/task",
                phase: "final",
            }),
            true,
        )
        assert.equal(
            Value.Check(ReviewRequestSchema, {
                entity: "task",
                entityDir: ".project/epics/example/tasks/task",
                phase: "final",
                continuation: { approved: true },
            }),
            false,
        )
        assert.equal(
            Value.Check(ReviewRequestSchema, {
                entity: "gig",
                entityDir: ".project/gigs/example",
                phase: "plan",
                epicDir: ".project/epics/example",
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
        const args = buildReviewerArgs("Deliverable Reviewer", "/tmp/prompt.md")
        const extensions = args.flatMap((value, index) => (value === "--extension" ? [args[index + 1]] : []))

        assert.equal(args.includes("--no-extensions"), true)
        assert.deepEqual(
            extensions.map((value) => value.replaceAll(path.sep, "/").split("/").slice(-2).join("/")),
            ["rules/index.ts", "permission/index.ts"],
        )
        for (const extension of extensions) assert.equal(fs.existsSync(extension), true)
    })

    it("creates ignored review directories after a fresh checkout", async () => {
        const entity = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-fresh-checkout-"))
        try {
            const round = await createReviewRoundDirectory(entity, "plan", 1)
            assert.equal(round, path.join(entity, ".local", "reviews", "plan-001"))
            assert.equal(fs.statSync(round).isDirectory(), true)
        } finally {
            fs.rmSync(entity, { recursive: true, force: true })
        }
    })

    it("binds an orphan plan snapshot to the retried review round", async () => {
        const deliverable = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-round-"))
        try {
            const localDir = path.join(deliverable, ".local")
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
            fs.mkdirSync(path.join(epic, ".local", "reviews", "plan-001"), { recursive: true })
            fs.writeFileSync(path.join(epic, ".local", "draft.md"), "current Epic candidate\n")
            fs.writeFileSync(
                path.join(epic, ".local", "reviews", "plan-001", "candidate.md"),
                "orphan Epic candidate\n",
            )

            const snapshot = await snapshotPlan(epic, 1)
            assert.equal(snapshot, path.join(epic, ".local", "reviews", "plan-001", "candidate.md"))
            assert.equal(fs.readFileSync(snapshot, "utf-8"), "current Epic candidate\n")
        } finally {
            fs.rmSync(epic, { recursive: true, force: true })
        }
    })

    it("propagates Project Policies into a fresh review prompt", async () => {
        const repository = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-review-prompt-"))
        try {
            const epicDir = path.join(repository, ".project", "epics", "example")
            fs.mkdirSync(path.join(repository, ".project"), { recursive: true })
            fs.mkdirSync(path.join(epicDir, ".local"), { recursive: true })
            const policies = [
                "# Project Policies",
                "",
                "- During Epic plan review, additionally check that every prospective Task identifies its rollout stage.",
                "- During Deliverable final review, additionally check the completion artifact against the repository's release checklist.",
                "- Override automatic submission after final-artifact acceptance: commit locally, then wait for a separate explicit user request before pushing or creating a PR.",
                "",
            ].join("\n")
            fs.writeFileSync(path.join(repository, ".project", "policies.md"), policies)
            fs.writeFileSync(path.join(epicDir, "brief.md"), "# Brief\n")
            fs.writeFileSync(
                path.join(epicDir, "epic.md"),
                "# Accepted\n\n## Ordered Tasks\n\n1. [TASK-01KDVDNA00] **Existing Task** — keep it.\n",
            )
            const candidate = path.join(epicDir, ".local", "draft.md")
            fs.writeFileSync(candidate, "# Candidate\n")

            const prompt = await buildEpicReviewPrompt(
                { cwd: repository } as never,
                epicDir,
                candidate,
                "## plan-review-001.response.md\n\nF1 rejected by user.",
            )
            assert.ok(prompt.includes(policies))
            assert.match(prompt, /TASK-01KDVDNA00/)
            assert.match(prompt, /F1 rejected by user/)
            assert.doesNotMatch(prompt, /# log\.md/)
            assert.match(prompt, /Return only one JSON object/)
            assert.doesNotMatch(prompt, /## Findings/)

            const gigDir = path.join(repository, ".project", "gigs", "20260101-0000.GIG-01KDVDNA00.example")
            fs.mkdirSync(path.join(gigDir, ".local", "reviews"), { recursive: true })
            fs.writeFileSync(path.join(gigDir, "brief.md"), "# Brief\n")
            fs.writeFileSync(path.join(gigDir, "plan.md"), "# Root cause\n\nUnique bugfix evidence.\n")
            fs.writeFileSync(
                path.join(gigDir, "metadata.json"),
                JSON.stringify({
                    id: "GIG-01KDVDNA00",
                    rawId: "01KDVDNA00",
                    title: "Example",
                    authority: { kind: "workflow", priority: "not set" },
                    createdAt: "2026-01-01T00:00:00.000Z",
                    workStage: "planning",
                    branch: {
                        state: "ready",
                        name: "GIG-01KDVDNA00-example",
                        start: "main",
                        target: "main",
                        source: "generated",
                    },
                    slug: "example",
                    integrations: [],
                    entity: "gig",
                    kind: "bugfix",
                }),
            )
            fs.writeFileSync(
                path.join(gigDir, ".local", "status.md"),
                '# Status\n\n```json\n{\n  "state": "inProgress"\n}\n```\n',
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
                "# Result\n\n## What changed\n\n- Fixed the defect.\n\n## Verification\n\n- `test` — passed\n",
            )
            const pendingPath = path.join(gigDir, ".local", "pending.md")
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
