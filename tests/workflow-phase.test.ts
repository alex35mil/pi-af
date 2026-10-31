import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import { Value } from "typebox/value"
import { PhaseSchema, projectedPhase, type LifecycleState } from "../workflows/extensions/__lib/domain.ts"
import { assertReviewPhase } from "../workflows/extensions/review/index.ts"
import { GitHubTrackerSchema, LinearTrackerSchema } from "../workflows/extensions/integrations/config.ts"
import {
    NativePhaseFactsSchema,
    phaseProjectionContract,
    planPhaseMutation,
    resolveLinearPhaseGroup,
    type NativePhaseFacts,
} from "../workflows/extensions/integrations/phase.ts"
import { linearPhases, phaseValues } from "./workflow-phase-fixtures.ts"

const statuses = {
    backlog: "Backlog",
    todo: "Todo",
    inProgress: "In Progress",
    inReview: "In Review",
    done: "Done",
    canceled: "Canceled",
}
const github = Value.Parse(GitHubTrackerSchema, {
    provider: "github",
    mcpServer: "github",
    repository: { owner: "example", repo: "example" },
    project: { owner: "example", ownerType: "user", number: 1 },
    labels: {
        kind: {
            epic: "Epic",
            deliverableKinds: {
                feature: "Feature",
                bugfix: "Bugfix",
                research: "Research",
                refactor: "Refactor",
                audit: "Audit",
                chore: "Chore",
            },
        },
    },
    fields: {
        status: { field: "Status", values: statuses },
        phase: { field: "Phase", values: phaseValues },
        priority: { scope: "project", field: "Priority", values: ["High"] },
    },
})
const linear = Value.Parse(LinearTrackerSchema, {
    provider: "linear",
    mcpServer: "linear",
    team: "Engineering",
    phase: linearPhases(),
    statuses: { projects: statuses, issues: statuses },
})
const githubFacts: Extract<NativePhaseFacts, { provider: "github" }> = {
    provider: "github",
    field: {
        name: "Phase",
        dataType: "SINGLE_SELECT",
        options: Object.values(phaseValues),
    },
    current: null,
}
function linearFacts(): Extract<NativePhaseFacts, { provider: "linear" }> {
    const label = {
        team: null,
        parentId: null,
        isGroup: false,
        groupType: null,
        retiredAt: null,
    }
    return {
        provider: "linear",
        catalog: [
            {
                ...label,
                id: "phase",
                name: "Phase",
                isGroup: true,
                groupType: "singleSelect",
            },
            ...Object.entries(phaseValues).map(([id, name]) => ({
                ...label,
                id,
                name,
                parentId: "phase",
            })),
            {
                ...label,
                id: "other-group",
                name: "Other",
                isGroup: true,
                groupType: "singleSelect",
            },
            {
                ...label,
                id: "other-execution",
                name: "Execution",
                parentId: "other-group",
            },
        ],
        applied: ["customer-label", "other-execution", "planning"],
    }
}
const lifecycles: LifecycleState[] = ["backlog", "todo", "inProgress", "inReview", "done", "canceled"]

describe("shared workflow Phase", () => {
    it("projects exactly the active Phase only while In Progress for every entity and provider", () => {
        for (const entity of ["epic", "task", "gig"] as const) {
            for (const phase of ["planning", "execution", "selfReview"] as const) {
                assert.equal(Value.Check(PhaseSchema, phase), true)
                for (const lifecycle of lifecycles) {
                    const expected = lifecycle === "inProgress" ? phase : null
                    assert.equal(projectedPhase(lifecycle, phase), expected)
                    const field = planPhaseMutation(github, entity, phase, lifecycle, githubFacts)
                    assert.equal(field.provider, "github")
                    if (field.provider !== "github") assert.fail("expected GitHub")
                    assert.equal(field.value, expected === null ? null : phaseValues[expected])
                    const labels = planPhaseMutation(linear, entity, phase, lifecycle, linearFacts())
                    assert.equal(labels.provider, "linear")
                    if (labels.provider !== "linear") assert.fail("expected Linear")
                    assert.deepEqual(labels.labels, [
                        "customer-label",
                        "other-execution",
                        ...(expected === null ? [] : [expected]),
                    ])
                }
            }
        }
        assert.equal(Value.Check(PhaseSchema, "paused"), false)
    })

    it("returns a local lifecycle-dependent contract, not an inferred tracker status", () => {
        for (const tracker of [github, linear]) {
            const contract = phaseProjectionContract("selfReview", tracker, "gig")
            assert.equal(contract.inProgress, "selfReview")
            assert.equal(contract.otherwise, null)
            assert.match(contract.authority, /read fresh native lifecycle/)
        }
    })

    it("recognizes no-op and clearing assignments without losing unrelated labels", () => {
        const facts = linearFacts()
        facts.applied = ["customer-label", "execution", "other-execution"]
        assert.equal(planPhaseMutation(linear, "gig", "execution", "inProgress", facts).changed, false)
        const cleared = planPhaseMutation(linear, "gig", "selfReview", "inReview", facts)
        assert.equal(cleared.provider, "linear")
        if (cleared.provider !== "linear") assert.fail("expected Linear")
        assert.deepEqual(cleared.labels, ["customer-label", "other-execution"])
        assert.equal(cleared.changed, true)
        assert.equal(
            planPhaseMutation(github, "gig", "selfReview", "inProgress", {
                ...githubFacts,
                current: "Self-Review",
            }).changed,
            false,
        )
        assert.equal(planPhaseMutation(github, "gig", "selfReview", "done", githubFacts).changed, false)
    })

    it("requires the exact GitHub field type and all configured options", () => {
        for (const field of [
            { ...githubFacts.field, name: "Other" },
            { ...githubFacts.field, dataType: "TEXT" },
            { ...githubFacts.field, options: ["Planning", "Execution"] },
        ])
            assert.throws(
                () =>
                    planPhaseMutation(github, "gig", "planning", "inProgress", {
                        ...githubFacts,
                        field,
                    }),
                /Phase/,
            )
        assert.throws(() => planPhaseMutation(github, "gig", "planning", "inProgress", linearFacts()), /provider/)
        assert.equal(Value.Check(NativePhaseFactsSchema, githubFacts), true)
        assert.equal(Value.Check(NativePhaseFactsSchema, linearFacts()), true)
    })

    it("validates group scope, membership, active state, and issue single-select", () => {
        const invalid = [
            (f: ReturnType<typeof linearFacts>) => {
                f.catalog[0].team = "Other team"
            },
            (f: ReturnType<typeof linearFacts>) => {
                f.catalog[0].retiredAt = "retired"
            },
            (f: ReturnType<typeof linearFacts>) => {
                f.catalog[0].isGroup = false
            },
            (f: ReturnType<typeof linearFacts>) => {
                f.catalog[0].groupType = "multiSelect"
            },
            (f: ReturnType<typeof linearFacts>) => {
                f.catalog[1].parentId = "other-group"
            },
            (f: ReturnType<typeof linearFacts>) => {
                f.catalog[1].retiredAt = "retired"
            },
            (f: ReturnType<typeof linearFacts>) => {
                f.catalog.push({ ...f.catalog[0], id: "duplicate" })
            },
        ]
        for (const mutate of invalid) {
            const facts = linearFacts()
            mutate(facts)
            assert.throws(() => resolveLinearPhaseGroup(linear, "gig", facts.catalog), /Phase/)
        }
        const project = linearFacts()
        project.catalog[0].groupType = null
        assert.equal(resolveLinearPhaseGroup(linear, "epic", project.catalog).values.selfReview, "selfReview")

        const teamScoped = structuredClone(linear)
        teamScoped.phase.issues.scope = "team"
        const facts = linearFacts()
        for (const label of facts.catalog) label.team = "Engineering"
        assert.equal(resolveLinearPhaseGroup(teamScoped, "task", facts.catalog).values.planning, "planning")
        assert.throws(() => resolveLinearPhaseGroup(linear, "task", facts.catalog), /scope/)
    })

    it("uses distinct Project and issue group configurations", () => {
        const tracker = structuredClone(linear)
        tracker.phase.projects.group = "Project Phase"
        const facts = linearFacts()
        facts.catalog[0].name = "Project Phase"
        assert.doesNotThrow(() => resolveLinearPhaseGroup(tracker, "epic", facts.catalog))
        assert.throws(() => resolveLinearPhaseGroup(tracker, "gig", facts.catalog), /Phase/)
    })

    it("requires the category-specific Phase for every entity on both trackers", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "phase-review-"))
        const branch = {
            state: "ready",
            name: "example",
            start: "main",
            target: "main",
            source: "generated",
        }
        const common = {
            title: "Example",
            slug: "example",
            createdAt: "2026-01-01T00:00:00Z",
            branch,
        }
        try {
            for (const provider of ["github", "linear"] as const) {
                const epicName = provider === "github" ? "1-example" : "20261001-example"
                const epicDir = path.join(root, provider, ".project/.local/epics", epicName)
                const tracker = (entity: "epic" | "task" | "gig") =>
                    provider === "github"
                        ? {
                              provider,
                              repository: { owner: "example", repo: "example" },
                              external: { issueNumber: entity === "epic" ? 1 : 2 },
                              planComment: { state: "unpublished" },
                          }
                        : entity === "epic"
                          ? {
                                provider,
                                resource: "project",
                                external: {
                                    projectId: "project-uuid",
                                    createdAt: "2026-10-01T09:00:00.000Z",
                                },
                                planDocument: { state: "unpublished" },
                            }
                          : {
                                provider,
                                resource: entity === "task" ? "task-issue" : "gig-issue",
                                external: {
                                    issueId: "issue-uuid",
                                    identifier: "ENG-2",
                                    ...(entity === "task" ? { projectId: "project-uuid" } : {}),
                                },
                                planDocument: { state: "unpublished" },
                            }
                const childName = provider === "github" ? "2-example" : "ENG-2-example"
                for (const entity of ["epic", "task", "gig"] as const) {
                    const directory =
                        entity === "epic"
                            ? epicDir
                            : entity === "task"
                              ? path.join(epicDir, "tasks", childName)
                              : path.join(root, provider, ".project/.local/gigs", childName)
                    fs.mkdirSync(directory, { recursive: true })
                    const metadata = {
                        ...common,
                        entity,
                        tracker: tracker(entity),
                        ...(entity === "epic" ? {} : { kind: "feature" }),
                    }
                    if (entity === "epic")
                        fs.writeFileSync(
                            path.join(directory, "epic.md"),
                            `## Tasks\n\n### [${provider === "github" ? "#2" : "ENG-2"}] Example\n\nKind: feature\n\nExample.\n`,
                        )
                    for (const phase of ["planning", "execution", "selfReview"]) {
                        fs.writeFileSync(path.join(directory, "metadata.json"), JSON.stringify({ ...metadata, phase }))
                        for (const category of entity === "epic"
                            ? (["plan"] as const)
                            : (["plan", "interim", "final"] as const)) {
                            const expected = category === "plan" ? "planning" : "selfReview"
                            if (phase === expected) assert.doesNotThrow(() => assertReviewPhase(directory, category))
                            else assert.throws(() => assertReviewPhase(directory, category), /review requires/)
                        }
                    }
                    if (entity === "epic")
                        fs.writeFileSync(
                            path.join(directory, "metadata.json"),
                            JSON.stringify({ ...metadata, phase: "planning" }),
                        )
                    assert.equal(fs.existsSync(path.join(directory, "status.md")), false)
                }
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
