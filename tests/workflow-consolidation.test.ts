import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import { Value } from "typebox/value"

import {
    EntityMetadataSchema,
    EntityStatusSchema,
    resolveEntityDirectory,
    resolveEntityPath,
} from "../workflows/extensions/__lib/entity.ts"
import { IntegrationRecordSchema } from "../workflows/extensions/integrations/records.ts"
import { parseReviewReport } from "../workflows/extensions/review/findings.ts"
import { RecordReviewResponseSchema } from "../workflows/extensions/review/index.ts"

const commonMetadata = {
    id: "GIG-01KDVDNA00",
    rawId: "01KDVDNA00",
    slug: "example",
    title: "Example",
    createdAt: "2026-01-01T00:00:00Z",
    workStage: "planning",
    branch: { state: "ready", name: "example", start: "main", target: "main", source: "generated" },
    integrations: [],
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
    it("preserves every metadata/status authority variant and strict field boundary", () => {
        for (const entity of ["epic", "task", "gig"] as const) {
            for (const authority of [
                { kind: "workflow", priority: "not set" },
                { kind: "tracker", provider: "github" },
                { kind: "tracker", provider: "linear", desired: { lifecycle: "inProgress", priority: "High" } },
            ]) {
                const metadata = {
                    ...commonMetadata,
                    entity,
                    authority,
                    ...(entity === "epic" ? { taskTarget: "epic" } : { kind: "feature" }),
                }
                assert.equal(Value.Check(EntityMetadataSchema, metadata), true)
                assert.equal(Value.Check(EntityMetadataSchema, { ...metadata, state: "planning" }), false)
                assert.equal(Value.Check(EntityMetadataSchema, { ...metadata, extra: true }), false)
                assert.equal(Value.Check(EntityMetadataSchema, { ...metadata, parentEpic: "example" }), false)
                assert.equal(
                    Value.Check(
                        EntityMetadataSchema,
                        entity === "epic" ? { ...metadata, kind: "feature" } : { ...metadata, taskTarget: "epic" },
                    ),
                    false,
                )
                assert.equal(Value.Check(EntityStatusSchema, metadata), authority.kind === "tracker")
                for (const state of ["inProgress", "inReview", "done"]) {
                    assert.equal(Value.Check(EntityStatusSchema, { ...metadata, state }), authority.kind === "workflow")
                }
                assert.equal(Value.Check(EntityStatusSchema, { ...metadata, state: "planning" }), false)
                assert.equal(Value.Check(EntityStatusSchema, { ...metadata, state: "backlog" }), false)
                assert.equal(Value.Check(EntityStatusSchema, { ...metadata, state: "todo" }), false)
                assert.equal(Value.Check(EntityMetadataSchema, { ...metadata, workStage: "paused" }), false)
            }
        }
    })

    it("preserves complete and partial provider checkpoint identities", () => {
        const cases = [
            {
                provider: "github",
                repository: { owner: "example", repo: "project" },
                identity: { issueNumber: 2 },
            },
            {
                provider: "linear",
                resource: "task-issue",
                identity: { issueId: "issue", projectId: "project" },
            },
            {
                provider: "linear",
                resource: "gig-issue",
                identity: { issueId: "issue" },
            },
        ]
        for (const { identity, ...provider } of cases) {
            const common = { role: "tracker", ...provider }
            for (const checkpoint of [
                { state: "awaiting", operation: "create" },
                { state: "pending", operations: ["create"] },
                { state: "issue-bound-pending", external: identity, operations: ["complete binding"] },
                { state: "bound-pending", external: identity, operations: ["confirm"] },
                { state: "bound", external: identity },
            ])
                assert.equal(Value.Check(IntegrationRecordSchema, { ...common, ...checkpoint }), true)
            assert.equal(Value.Check(IntegrationRecordSchema, { ...common, state: "pending", operations: [] }), false)
            assert.equal(
                Value.Check(IntegrationRecordSchema, {
                    ...common,
                    state: "awaiting",
                    operation: "create",
                    extra: true,
                }),
                false,
            )
        }
        const project = {
            role: "tracker",
            provider: "linear",
            resource: "project",
            external: { projectId: "p" },
        }
        assert.equal(Value.Check(IntegrationRecordSchema, { ...project, state: "bound" }), true)
        assert.equal(
            Value.Check(IntegrationRecordSchema, { ...project, state: "bound-pending", operations: ["confirm"] }),
            true,
        )
        assert.equal(
            Value.Check(IntegrationRecordSchema, { ...project, state: "issue-bound-pending", operations: ["confirm"] }),
            false,
        )
    })

    it("keeps report semantics separate from adjudication input validation", () => {
        const report = (overrides = {}) =>
            JSON.stringify({ findings: [{ ...finding, severity: "warning", ...overrides }], signoff: "blocked" })
        assert.doesNotThrow(() => parseReviewReport(report()))
        for (const overrides of [{ id: "F2" }, { title: " " }, { extra: true }, { userDecision: " " }]) {
            assert.throws(() => parseReviewReport(report(overrides)))
        }
        assert.throws(() => parseReviewReport(JSON.stringify({ findings: [], signoff: "blocked" })))
        assert.throws(() =>
            parseReviewReport(JSON.stringify({ findings: [{ ...finding, severity: "warning" }], signoff: "approved" })),
        )
        const response = {
            entityDir: "example",
            phase: "plan",
            round: 1,
            findings: [{ ...finding, title: " " }],
            status: "Corrected",
        }
        assert.equal(Value.Check(RecordReviewResponseSchema, response), true)
        assert.equal(
            Value.Check(RecordReviewResponseSchema, { ...response, findings: [{ ...finding, severity: "warning" }] }),
            false,
        )
    })

    it("preserves caller-relative bases and rejects paths outside workflow roots", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-paths-"))
        try {
            const entity = path.join(root, ".project", "gigs", "example")
            fs.mkdirSync(entity, { recursive: true })
            const cwd = path.join(root, "src")
            assert.equal(resolveEntityPath(root, cwd, ".project/gigs/example"), entity)
            assert.equal(resolveEntityPath(root, cwd, "../.project/gigs/example"), entity)
            assert.equal(resolveEntityPath(root, root, ".project/gigs/example"), entity)
            assert.equal(resolveEntityDirectory(root, cwd, entity), entity)
            for (const raw of [".project/gigs", ".project/gigs/../../outside", ".project/gigs-sibling/example"]) {
                assert.throws(() => resolveEntityPath(root, root, raw), /must be inside/)
            }
            assert.throws(() => resolveEntityDirectory(root, root, ".project/gigs/missing"), /does not exist/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
