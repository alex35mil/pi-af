import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import {
    EntityStatusValidator,
    resolveEntityDirectory,
    resolveEntityPath,
} from "../workflows/extensions/__lib/entity.ts"
import { TrackerRecordValidator } from "../workflows/extensions/integrations/records.ts"
import { parseReviewReport } from "../workflows/extensions/review/findings.ts"
import { RecordReviewResponseValidator } from "../workflows/extensions/review/index.ts"

const commonMetadata = {
    slug: "example",
    title: "Example",
    createdAt: "2026-01-01T00:00:00Z",
    phase: "planning",
    branch: {
        state: "ready",
        name: "example",
        start: "main",
        target: "main",
        source: "generated",
    },
    tracker: {
        provider: "github",
        repository: { owner: "example", repo: "project" },
        external: { issueNumber: 2 },
        planComment: { state: "unpublished" },
    },
}

const finding = {
    id: "F1",
    title: "Problem",
    problem: "Problem",
    useCase: "Supported case",
    impact: "Impact",
    resolution: "Correction",
    userDecision: null,
}

describe("workflow consolidation contracts", () => {
    it("keeps a strict metadata boundary with no local lifecycle, ID, or authority", () => {
        for (const entity of ["epic", "task", "gig"] as const) {
            const metadata = {
                ...commonMetadata,
                entity,
                ...(entity === "epic" ? {} : { kind: "feature" }),
            }
            assert.equal(EntityStatusValidator.check(metadata), true)
            for (const extra of [
                { state: "inProgress" },
                { id: "GIG-01KDVDNA00" },
                { authority: { kind: "tracker", provider: "github" } },
                { integrations: [] },
                { parentEpic: "example" },
                { extra: true },
            ])
                assert.equal(EntityStatusValidator.check({ ...metadata, ...extra }), false)
            assert.equal(
                EntityStatusValidator.check({
                    ...metadata,
                    ...(entity === "epic" ? { kind: "feature" } : {}),
                    taskTarget: "epic",
                }),
                false,
            )
            const { tracker: _tracker, ...untracked } = metadata
            assert.equal(EntityStatusValidator.check(untracked), false)
            for (const phase of ["planning", "execution", "selfReview"])
                assert.equal(EntityStatusValidator.check({ ...metadata, phase }), true)
            assert.equal(EntityStatusValidator.check({ ...metadata, phase: "paused" }), false)
            assert.equal(
                EntityStatusValidator.check({
                    ...metadata,
                    branch: { ...metadata.branch, state: "tracker-pending" },
                }),
                false,
            )
        }
    })

    it("records each tracker object by its identity only", () => {
        const cases = [
            {
                provider: "github",
                repository: { owner: "example", repo: "project" },
                planComment: { state: "unpublished" },
                external: { issueNumber: 2 },
            },
            {
                provider: "linear",
                planDocument: { state: "unpublished" },
                resource: "task-issue",
                external: {
                    issueId: "issue",
                    identifier: "ENG-2",
                    projectId: "project",
                },
            },
            {
                provider: "linear",
                planDocument: { state: "unpublished" },
                resource: "gig-issue",
                external: { issueId: "issue", identifier: "ENG-2" },
            },
            {
                provider: "linear",
                planDocument: { state: "unpublished" },
                resource: "project",
                external: { projectId: "p", createdAt: "2026-10-01T09:00:00.000Z" },
            },
        ]
        for (const record of cases) {
            assert.equal(TrackerRecordValidator.check(record), true)
            assert.equal(TrackerRecordValidator.check({ ...record, state: "bound" }), false)
            assert.equal(
                TrackerRecordValidator.check({
                    ...record,
                    operations: ["confirm"],
                }),
                false,
            )
            const { external: _external, ...unidentified } = record
            assert.equal(TrackerRecordValidator.check(unidentified), false)
        }
        assert.equal(
            TrackerRecordValidator.check({
                ...cases[2],
                external: { issueId: "issue", identifier: "eng-2" },
            }),
            false,
        )
    })

    it("keeps report semantics separate from adjudication input validation", () => {
        const report = (overrides = {}) =>
            JSON.stringify({
                findings: [{ ...finding, severity: "warning", ...overrides }],
                signoff: "blocked",
            })
        assert.doesNotThrow(() => parseReviewReport(report()))
        for (const overrides of [{ id: "F2" }, { title: " " }, { extra: true }, { userDecision: " " }]) {
            assert.throws(() => parseReviewReport(report(overrides)))
        }
        assert.throws(() => parseReviewReport(JSON.stringify({ findings: [], signoff: "blocked" })))
        assert.throws(() =>
            parseReviewReport(
                JSON.stringify({
                    findings: [{ ...finding, severity: "warning" }],
                    signoff: "approved",
                }),
            ),
        )
        const { userDecision: _userDecision, ...inputFinding } = finding
        const response = {
            entityDir: "example",
            phase: "plan",
            round: 1,
            findings: [{ ...inputFinding, title: " " }],
            status: "Corrected",
        }
        assert.equal(RecordReviewResponseValidator.check(response), true)
        assert.equal(
            RecordReviewResponseValidator.check({
                ...response,
                findings: [{ ...finding, severity: "warning" }],
            }),
            false,
        )
    })

    it("preserves caller-relative bases and rejects paths outside workflow roots", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-paths-"))
        try {
            const entity = path.join(root, ".project", ".local", "gigs", "example")
            fs.mkdirSync(entity, { recursive: true })
            const cwd = path.join(root, "src")
            assert.equal(resolveEntityPath(root, cwd, ".project/.local/gigs/example"), entity)
            assert.equal(resolveEntityPath(root, cwd, "../.project/.local/gigs/example"), entity)
            assert.equal(resolveEntityPath(root, root, ".project/.local/gigs/example"), entity)
            assert.equal(resolveEntityDirectory(root, cwd, entity), entity)
            for (const raw of [
                ".project/.local/gigs",
                ".project/.local/gigs/../../outside",
                ".project/.local/gigs-sibling/example",
            ]) {
                assert.throws(() => resolveEntityPath(root, root, raw), /must be inside/)
            }
            assert.throws(() => resolveEntityDirectory(root, root, ".project/.local/gigs/missing"), /does not exist/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
