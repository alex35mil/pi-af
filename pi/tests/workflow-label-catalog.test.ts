import "./host-runtime.ts"

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { GitHubLabels, LinearLabels } from "../workflows/extensions/integrations/labels.ts"
import {
    type CatalogAction,
    type Decision,
    githubListEntries,
    githubManagedEntries,
    linearListEntries,
    linearManagedEntries,
    planCatalog,
    type QuestionDecision,
    type RemapEntry,
    type TrackerLabel,
} from "../workflows/extensions/project-setup/label-catalog.ts"
import { linearPhases } from "./workflow-phase-fixtures.ts"

const def = (name: string, color = "#1D76DB", description = "") => ({ name, color, description })

function gh(name: string, extra: Partial<TrackerLabel> = {}): TrackerLabel {
    return {
        id: `id:${name}`,
        name,
        color: "#1D76DB",
        description: "",
        retired: false,
        catalog: "repository",
        scope: "repository",
        parentId: null,
        isGroup: false,
        groupType: null,
        usage: 0,
        usageTruncated: false,
        ...extra,
    }
}

const area = (values: Record<string, string>, appliesTo: ("epic" | "deliverable")[] = ["deliverable"]) => ({
    appliesTo,
    cardinality: "zeroOrMore" as const,
    values: Object.fromEntries(Object.entries(values).map(([key, name]) => [key, def(name)])),
})

function github(
    catalog: TrackerLabel[],
    desired: GitHubLabels,
    previous: GitHubLabels | null,
    answers: Record<string, string> = {},
    remap: RemapEntry[] = [],
) {
    return planCatalog({
        catalog,
        desired: githubManagedEntries(desired),
        previous: previous ? githubManagedEntries(previous) : null,
        keep: githubListEntries(desired.unmanaged?.keep),
        retired: githubListEntries(desired.retired),
        answers,
        remap,
    })
}

/** A decision the user answers; conflicts carry a resolution instead of options. */
function question(decision: Decision): QuestionDecision {
    assert.notEqual(decision.kind, "conflict", `expected a question, got conflict: ${decision.message}`)
    return decision as QuestionDecision
}

const kinds = (plan: ReturnType<typeof planCatalog>) => plan.actions.map((action) => action.kind)
const describe_ = (plan: ReturnType<typeof planCatalog>) => plan.actions.map((action) => action.description)

describe("label catalog planning", () => {
    it("creates missing labels, adopts exact matches, and updates color or description", () => {
        const plan = github(
            [gh("Area: Backend", { color: "#000000" })],
            { groups: { area: area({ frontend: "Area: Frontend", backend: "Area: Backend" }) } },
            null,
        )
        assert.deepEqual(kinds(plan).sort(), ["create", "update"])
        assert.deepEqual(plan.adopted, ["repository:area:backend"])
        const update = plan.actions.find((action) => action.kind === "update") as Extract<
            CatalogAction,
            { kind: "update" }
        >
        assert.deepEqual(update.change, { color: "#1D76DB" })
        assert.deepEqual(plan.decisions, [])
    })

    it("renames in place when a key keeps its value and changes its name", () => {
        const previous = { groups: { area: area({ frontend: "Area: Fronted" }) } }
        const plan = github(
            [gh("Area: Fronted", { usage: 3 })],
            { groups: { area: area({ frontend: "Area: Frontend" }) } },
            previous,
        )
        assert.deepEqual(kinds(plan), ["update"])
        assert.match(describe_(plan)[0], /rename to "Area: Frontend"/)
    })

    it("treats a label renamed by hand, with the configuration changed to match, as in sync", () => {
        const previous = { groups: { area: area({ frontend: "Area: Frontend" }) } }
        const plan = github([gh("Area: FE")], { groups: { area: area({ frontend: "Area: FE" }) } }, previous)
        assert.deepEqual(plan.actions, [])
        assert.deepEqual(plan.decisions, [])
    })

    it("moves a key automatically only when the label name is exactly the same", () => {
        const previous = { groups: { area: area({ fe: "Area: Frontend" }) } }
        const moved = github(
            [gh("Area: Frontend", { usage: 40 })],
            { groups: { area: area({ frontend: "Area: Frontend" }) } },
            previous,
        )
        assert.deepEqual(moved.actions, [])
        assert.deepEqual(moved.keyMoves, [
            { from: "repository:area:fe", to: "repository:area:frontend", name: "Area: Frontend" },
        ])
        assert.deepEqual(moved.adopted, [])

        const caseOnly = github(
            [gh("Area: Frontend")],
            { groups: { area: area({ frontend: "area: frontend" }) } },
            previous,
        )
        assert.ok(
            caseOnly.decisions.some(
                (decision) => decision.kind === "conflict" && /only in case/.test(decision.message),
            ),
        )
    })

    it("deletes an unused removed label and retires a used one, on both trackers' rules", () => {
        const previous = { groups: { area: area({ frontend: "Area: Frontend", backend: "Area: Backend" }) } }
        const plan = github([gh("Area: Frontend"), gh("Area: Backend", { usage: 2 })], { groups: {} }, previous)
        assert.deepEqual(
            plan.actions.map((action) => [
                action.kind,
                action.kind === "update" ? "" : (action as { name: string }).name,
            ]),
            [
                ["delete", "Area: Frontend"],
                ["retire", "Area: Backend"],
            ],
        )
        assert.deepEqual(plan.retired, [{ name: "Area: Backend", catalog: "repository", scope: "repository" }])
    })

    it("restores a single retired label of the same name, and reports several as a conflict", () => {
        const desired = { groups: { area: area({ backend: "Area: Backend" }) } }
        const restore = github(
            [gh("Area: Backend", { retired: true, usage: 2 })],
            { ...desired, retired: [{ name: "Area: Backend" }] },
            null,
        )
        assert.deepEqual(kinds(restore), ["restore"])
        assert.deepEqual(restore.retired, [])

        const two = github(
            [gh("Area: Backend", { id: "a", retired: true }), gh("Area: Backend", { id: "b", retired: true })],
            desired,
            null,
        )
        assert.ok(two.decisions.some((decision) => /2 retired labels/.test(decision.message)))
    })

    it("asks about a managed label retired or deleted outside setup", () => {
        const config = { groups: { area: area({ backend: "Area: Backend" }) } }
        const retired = github([gh("Area: Backend", { retired: true })], config, config)
        assert.deepEqual(
            retired.decisions.map((decision) => [decision.kind, question(decision).options]),
            [["managedRetired", ["restore"]]],
        )
        assert.deepEqual(
            kinds(
                github([gh("Area: Backend", { retired: true })], config, config, {
                    [retired.decisions[0].id]: "restore",
                }),
            ),
            ["restore"],
        )

        const missing = github([], config, config)
        assert.deepEqual(
            missing.decisions.map((decision) => decision.kind),
            ["managedMissing"],
        )
        assert.deepEqual(kinds(github([], config, config, { [missing.decisions[0].id]: "recreate" })), ["create"])

        const bothGone = github([], { groups: { area: area({ backend: "Area: BE" }) } }, config)
        assert.deepEqual(
            bothGone.decisions.map((decision) => decision.kind),
            ["managedMissing"],
        )
    })

    it("lists every unknown label as a decision and applies each answer", () => {
        const catalog = [gh("bug", { usage: 4 }), gh("wontfix"), gh("legacy", { retired: true, usage: 1 })]
        const blocked = github(catalog, { groups: {} }, null)
        assert.deepEqual(
            blocked.decisions.map((decision) => [
                decision.kind,
                question(decision).label?.name,
                question(decision).label?.usage,
            ]),
            [
                ["unknownLabel", "bug", "4"],
                ["unknownLabel", "wontfix", "0"],
                ["unknownRetiredLabel", "legacy", "1"],
            ],
        )
        assert.deepEqual(blocked.actions, [])
        const answers = Object.fromEntries(
            blocked.decisions.map((decision) => [
                decision.id,
                question(decision).label?.name === "bug"
                    ? "remove"
                    : question(decision).label?.name === "wontfix"
                      ? "keep"
                      : "leaveRetired",
            ]),
        )
        const plan = github(catalog, { groups: {} }, null, answers)
        assert.deepEqual(plan.decisions, [])
        assert.deepEqual(
            plan.actions.map((action) => [action.kind, (action as { name: string }).name]),
            [["retire", "bug"]],
        )
        assert.deepEqual(plan.keep, [{ name: "wontfix", catalog: "repository", scope: "repository" }])
        assert.deepEqual(plan.retired.map((entry) => entry.name).sort(), ["bug", "legacy"])

        const kept = github(
            catalog,
            { groups: {}, unmanaged: { keep: [{ name: "wontfix" }] }, retired: [{ name: "legacy" }] },
            null,
        )
        assert.deepEqual(
            kept.decisions.map((decision) => question(decision).label?.name),
            ["bug"],
        )
    })

    it("offers leave, restore and keep, or delete for a label retired outside setup", () => {
        const catalog = [gh("legacy", { retired: true, usage: 1 })]
        const id = github(catalog, { groups: {} }, null).decisions[0].id
        assert.deepEqual(kinds(github(catalog, { groups: {} }, null, { [id]: "restoreKeep" })), ["restore"])
        assert.deepEqual(kinds(github(catalog, { groups: {} }, null, { [id]: "delete" })), ["delete"])
        assert.throws(() => github(catalog, { groups: {} }, null, { [id]: "keep" }), /isn't an option/)
    })

    it("drops a stale retired entry and re-asks about one made active again", () => {
        const stale = github([], { groups: {}, retired: [{ name: "gone" }] }, null)
        assert.deepEqual(stale.retired, [])
        assert.deepEqual(
            stale.droppedEntries.map((entry) => entry.reason),
            ["the label no longer exists"],
        )

        const active = github([gh("back")], { groups: {}, retired: [{ name: "back" }] }, null)
        assert.deepEqual(
            active.decisions.map((decision) => decision.kind),
            ["unknownLabel"],
        )
        assert.deepEqual(
            active.droppedEntries.map((entry) => entry.reason),
            ["the label is active again"],
        )
    })

    it("drops the retired entry of a label the configuration manages again", () => {
        const plan = github(
            [gh("Area: Legacy", { color: "#000000" })],
            { groups: { area: area({ legacy: "Area: Legacy" }) }, retired: [{ name: "Area: Legacy" }] },
            null,
        )
        assert.deepEqual(plan.retired, [])
        assert.deepEqual(
            plan.droppedEntries.map((entry) => [entry.list, entry.entry.name, entry.reason]),
            [["retired", "Area: Legacy", "the configuration now manages it"]],
        )
        assert.deepEqual(kinds(plan), ["update"])
    })

    it("drops the keep entry of a kept label the configuration now manages", () => {
        const plan = github(
            [gh("bug")],
            { groups: { type: area({ bug: "bug" }) }, unmanaged: { keep: [{ name: "bug" }] } },
            null,
        )
        assert.deepEqual(plan.keep, [])
        assert.deepEqual(plan.adopted, ["repository:type:bug"])
    })

    it("plans no catalog change when a GitHub group's appliesTo changes", () => {
        const previous = { groups: { area: area({ frontend: "Area: Frontend" }, ["deliverable"]) } }
        const plan = github(
            [gh("Area: Frontend")],
            { groups: { area: area({ frontend: "Area: Frontend" }, ["epic", "deliverable"]) } },
            previous,
        )
        assert.deepEqual(plan.actions, [])
    })

    it("plans a rerun against the uncommitted previous configuration as a rename, not a duplicate", () => {
        const applied = { groups: { area: area({ frontend: "Area: Fronted" }) } }
        const plan = github([gh("Area: Fronted")], { groups: { area: area({ frontend: "Area: Frontend" }) } }, applied)
        assert.deepEqual(kinds(plan), ["update"])
    })

    it("rejects answers that don't match a current decision", () => {
        assert.throws(
            () => github([], { groups: {} }, null, { "unknown:x": "keep" }),
            /doesn't match any current decision/,
        )
    })
})

describe("Linear label catalog planning", () => {
    const phase = linearPhases()
    const phaseLabels = (catalog: "issue" | "project"): TrackerLabel[] => [
        lin("Phase", catalog, { id: `${catalog}:phase`, isGroup: true, groupType: "singleSelect", color: "#8250DF" }),
        ...["Planning", "Execution", "Self-Review"].map((name) =>
            lin(name, catalog, { id: `${catalog}:${name}`, parentId: `${catalog}:phase`, color: "#8250DF" }),
        ),
    ]
    function lin(name: string, catalog: "issue" | "project", extra: Partial<TrackerLabel> = {}): TrackerLabel {
        return { ...gh(name), id: `${catalog}:${name}`, catalog, scope: "workspace", ...extra }
    }
    const linear = (
        catalog: TrackerLabel[],
        desired: LinearLabels,
        previous: LinearLabels | null,
        answers: Record<string, string> = {},
        remap: RemapEntry[] = [],
    ) =>
        planCatalog({
            catalog,
            desired: linearManagedEntries(desired, phase),
            previous: previous ? linearManagedEntries(previous, phase) : null,
            keep: linearListEntries(desired.unmanaged?.keep),
            retired: linearListEntries(desired.retired),
            answers,
            remap,
        })
    const existingPhase = [...phaseLabels("issue"), ...phaseLabels("project")]

    it("creates missing Phase groups and their children", () => {
        const plan = linear([], { groups: {} }, null)
        assert.equal(plan.actions.filter((action) => action.kind === "create").length, 8)
        const first = plan.actions[0] as Extract<CatalogAction, { kind: "create" }>
        assert.equal(first.parentKey, null)
        assert.equal(first.groupType, "singleSelect")
    })

    it("creates a native multi-select group in both catalogs for a group that applies to both item types", () => {
        const plan = linear(
            existingPhase,
            {
                groups: {
                    area: {
                        ...area({ frontend: "Area: Frontend" }, ["epic", "deliverable"]),
                        scope: "workspace",
                        nativeGroup: def("Area"),
                    },
                },
            },
            null,
        )
        const creates = plan.actions.filter((action) => action.kind === "create") as Extract<
            CatalogAction,
            { kind: "create" }
        >[]
        assert.deepEqual(
            creates.map((action) => [action.catalog, action.definition.name, action.groupType, action.parentKey]),
            [
                ["issue", "Area", "multiSelect", null],
                ["project", "Area", "multiSelect", null],
                ["issue", "Area: Frontend", null, "issue:area"],
                ["project", "Area: Frontend", null, "project:area"],
            ],
        )
    })

    it("deletes unused children first and retires a removed group whose children are in use", () => {
        const group = lin("Area", "issue", { id: "g", isGroup: true, groupType: "multiSelect" })
        const used = lin("Area: Frontend", "issue", { id: "c1", parentId: "g", usage: 1, usageTruncated: true })
        const unused = lin("Area: Backend", "issue", { id: "c2", parentId: "g" })
        const previous = {
            groups: {
                area: {
                    ...area({ frontend: "Area: Frontend", backend: "Area: Backend" }),
                    scope: "workspace" as const,
                    nativeGroup: def("Area"),
                },
            },
        }
        const plan = linear([...existingPhase, group, used, unused], { groups: {} }, previous)
        assert.deepEqual(
            plan.actions.map((action) => [action.kind, (action as { name: string }).name]),
            [
                ["retire", "Area: Frontend"],
                ["delete", "Area: Backend"],
                ["retire", "Area"],
            ],
        )
    })

    it("changes group type in place and asks before narrowing a used group to single-select", () => {
        const group = lin("Area", "issue", { id: "g", isGroup: true, groupType: "multiSelect" })
        const child = lin("Area: Frontend", "issue", { id: "c", parentId: "g", usage: 1 })
        const config = (cardinality: "zeroOrMore" | "zeroOrOne") => ({
            groups: {
                area: {
                    ...area({ frontend: "Area: Frontend" }),
                    cardinality,
                    scope: "workspace" as const,
                    nativeGroup: def("Area"),
                },
            },
        })
        const plan = linear([...existingPhase, group, child], config("zeroOrOne"), config("zeroOrMore"))
        assert.deepEqual(
            plan.decisions.map((decision) => decision.kind),
            ["groupTypeNarrowing"],
        )
        const answered = linear([...existingPhase, group, child], config("zeroOrOne"), config("zeroOrMore"), {
            [plan.decisions[0].id]: "proceed",
        })
        assert.deepEqual(kinds(answered), ["update"])
    })

    it("reports a managed label that collides with a label at the other level", () => {
        const team = lin("Area: Frontend", "issue", { id: "t", scope: "team" })
        const plan = linear(
            [...existingPhase, team],
            { groups: { area: { ...area({ frontend: "Area: Frontend" }), scope: "workspace" } } },
            null,
        )
        assert.ok(plan.decisions.some((decision) => /runtime applies labels by name/.test(decision.message)))
    })

    it("asks once about an unknown native group, covering its children", () => {
        const group = lin("Old", "issue", { id: "g", isGroup: true, groupType: "singleSelect" })
        const child = lin("Old: A", "issue", { id: "c", parentId: "g", usage: 2 })
        const plan = linear([...existingPhase, group, child], { groups: {} }, null)
        assert.deepEqual(
            plan.decisions.map((decision) => [question(decision).label?.name, question(decision).label?.children]),
            [["Old", ["Old: A"]]],
        )
        const removed = linear([...existingPhase, group, child], { groups: {} }, null, {
            [plan.decisions[0].id]: "remove",
        })
        assert.deepEqual(
            removed.actions.map((action) => [action.kind, (action as { name: string }).name]),
            [
                ["retire", "Old: A"],
                ["retire", "Old"],
            ],
        )
    })

    it("marks Linear workspace labels as shared with other teams", () => {
        const plan = linear([...existingPhase, lin("Bug", "issue")], { groups: {} }, null)
        assert.match(plan.decisions[0].message, /other teams may use/)
    })

    const kindGroup = (extra: Partial<LinearLabels["groups"] & object> = {}): LinearLabels => ({
        groups: {
            kind: {
                appliesTo: ["deliverable"],
                cardinality: "exactlyOne",
                scope: "workspace",
                nativeGroup: def("Kind"),
                values: {
                    feature: def("Feature"),
                    bugfix: def("Bug"),
                    research: def("Research"),
                    refactor: def("Refactor"),
                    audit: def("Audit"),
                    chore: def("Chore"),
                },
            },
            ...extra,
        },
    })
    const named = (plan: ReturnType<typeof planCatalog>) =>
        plan.actions.map((action) => [
            action.kind,
            action.kind === "create" ? action.definition.name : (action as { name: string }).name,
        ])
    const position = (plan: ReturnType<typeof planCatalog>, kind: string, name: string) =>
        named(plan).findIndex(([k, n]) => k === kind && n === name)
    const conflicts = (plan: ReturnType<typeof planCatalog>) =>
        plan.decisions.filter((decision) => decision.kind === "conflict")

    describe("first-run label clashes (issue repro)", () => {
        const catalog = () => [
            ...existingPhase,
            lin("Feature", "issue"),
            lin("Bug", "issue", { usage: 3 }),
            lin("Improvement", "issue"),
        ]

        it("asks to adopt or replace a misplaced label instead of a dead-end conflict", () => {
            const plan = linear(catalog(), kindGroup(), null)
            assert.deepEqual(conflicts(plan), [])
            assert.deepEqual(
                plan.decisions.map((decision) => [decision.id, question(decision).options]),
                [
                    ["misplaced:issue:kind:feature", ["adopt", "replace"]],
                    ["misplaced:issue:kind:bugfix", ["adopt"]],
                    ["unknown:issue:workspace:Improvement", ["remove", "keep"]],
                ],
                "neither clashing label is also asked about as unknown; a used one can only be adopted",
            )
        })

        it("adopts by moving the labels into the group, keeping their items", () => {
            const plan = linear(catalog(), kindGroup(), null, {
                "misplaced:issue:kind:feature": "adopt",
                "misplaced:issue:kind:bugfix": "adopt",
                "unknown:issue:workspace:Improvement": "keep",
            })
            assert.deepEqual(plan.decisions, [])
            const moves = plan.actions.filter((action) => action.kind === "update") as Extract<
                CatalogAction,
                { kind: "update" }
            >[]
            assert.deepEqual(
                moves.map((action) => [action.name, action.change.parentKey]),
                [
                    ["Feature", "issue:kind"],
                    ["Bug", "issue:kind"],
                ],
            )
            assert.ok(position(plan, "create", "Kind") < position(plan, "update", "Feature"))
            assert.deepEqual(
                plan.adopted.filter((key) => key.startsWith("issue:kind")),
                ["issue:kind:feature", "issue:kind:bugfix"],
            )
        })

        it("replaces an unused label by deleting it before creating the configured one", () => {
            const plan = linear(catalog(), kindGroup(), null, {
                "misplaced:issue:kind:feature": "replace",
                "misplaced:issue:kind:bugfix": "adopt",
                "unknown:issue:workspace:Improvement": "remove",
            })
            assert.deepEqual(plan.decisions, [])
            assert.ok(position(plan, "delete", "Feature") === 0)
            assert.ok(position(plan, "create", "Feature") > 0)
            assert.ok(position(plan, "delete", "Improvement") > position(plan, "update", "Bug"))
            assert.throws(
                () => linear(catalog(), kindGroup(), null, { "misplaced:issue:kind:bugfix": "replace" }),
                /isn't an option/,
            )
        })

        it("adopts a retired misplaced label by restoring and moving it", () => {
            const retired = [...existingPhase, lin("Feature", "issue", { retired: true })]
            const asked = linear(retired, kindGroup(), null)
            const decision = question(asked.decisions.find((item) => item.id === "misplaced:issue:kind:feature")!)
            assert.equal(decision.label?.retired, true)
            const plan = linear(retired, kindGroup(), null, { "misplaced:issue:kind:feature": "adopt" })
            assert.deepEqual(plan.decisions, [])
            assert.deepEqual(
                named(plan).filter(([, name]) => name === "Feature"),
                [
                    ["restore", "Feature"],
                    ["update", "Feature"],
                ],
            )
        })

        it("asks about a group of the wrong type and offers replace only without children", () => {
            const empty = lin("Kind", "issue", { id: "k", isGroup: true, groupType: "multiSelect" })
            const asked = linear([...existingPhase, empty], kindGroup(), null)
            assert.deepEqual(question(asked.decisions[0]).options, ["adopt", "replace"])
            const replaced = linear([...existingPhase, empty], kindGroup(), null, { "misplaced:issue:kind": "replace" })
            assert.equal(position(replaced, "delete", "Kind"), 0)

            const child = lin("Old", "issue", { parentId: "k" })
            const withChild = linear([...existingPhase, empty, child], kindGroup(), null)
            assert.deepEqual(question(withChild.decisions[0]).options, ["adopt"])
            const adopted = linear([...existingPhase, empty, child], kindGroup(), null, {
                "misplaced:issue:kind": "adopt",
                "unknown:issue:workspace:Old": "keep",
            })
            const update = adopted.actions.find(
                (action) => action.kind === "update" && action.name === "Kind",
            ) as Extract<CatalogAction, { kind: "update" }>
            assert.equal(update.change.groupType, "singleSelect")
        })
    })

    describe("removing a clashing label clears the clash", () => {
        it("clears a label-versus-group clash and deletes the group with its children first", () => {
            const group = lin("Bug", "issue", { id: "g", isGroup: true, groupType: "multiSelect" })
            const child = lin("Bug: UI", "issue", { parentId: "g" })
            const desired = { groups: { area: { ...area({ bug: "Bug" }), scope: "workspace" as const } } }
            const blocked = linear([...existingPhase, group, child], desired, null)
            const conflict = conflicts(blocked)[0]
            assert.match(conflict.id, /kind-mismatch/)
            assert.ok(conflict.kind === "conflict" && /Remove it/.test(conflict.resolution))
            const plan = linear([...existingPhase, group, child], desired, null, {
                "unknown:issue:workspace:Bug": "remove",
            })
            assert.deepEqual(plan.decisions, [])
            assert.deepEqual(named(plan).slice(0, 3), [
                ["delete", "Bug: UI"],
                ["delete", "Bug"],
                ["create", "Bug"],
            ])
        })

        it("clears a clash with a child label of a kept group when it's answered remove", () => {
            const group = lin("Area", "issue", { id: "a", isGroup: true, groupType: "multiSelect" })
            const child = lin("frontend", "issue", { parentId: "a" })
            const desired: LinearLabels = {
                groups: {
                    area: { ...area({ fe: "Frontend" }), scope: "workspace", nativeGroup: def("Area") },
                },
            }
            const blocked = linear([...existingPhase, group, child], desired, null)
            assert.ok(conflicts(blocked).some((decision) => decision.id === "conflict:case:issue:area:fe"))
            const plan = linear([...existingPhase, group, child], desired, null, {
                "unknown:issue:workspace:frontend": "remove",
            })
            assert.deepEqual(plan.decisions, [])
            assert.ok(position(plan, "delete", "frontend") < position(plan, "create", "Frontend"))
        })

        it("clears a case-only clash and a workspace-versus-team collision", () => {
            const desired = { groups: { area: { ...area({ fe: "Area: FE" }), scope: "workspace" as const } } }
            const caseOnly = lin("area: fe", "issue")
            assert.match(conflicts(linear([...existingPhase, caseOnly], desired, null))[0].id, /case:/)
            const caseCleared = linear([...existingPhase, caseOnly], desired, null, {
                "unknown:issue:workspace:area: fe": "remove",
            })
            assert.deepEqual(caseCleared.decisions, [])
            assert.ok(position(caseCleared, "delete", "area: fe") < position(caseCleared, "create", "Area: FE"))

            const team = lin("Area: FE", "issue", { id: "t", scope: "team" })
            assert.match(conflicts(linear([...existingPhase, team], desired, null))[0].id, /level:/)
            const levelCleared = linear([...existingPhase, team], desired, null, {
                "unknown:issue:team:Area: FE": "remove",
            })
            assert.deepEqual(levelCleared.decisions, [])
            assert.ok(position(levelCleared, "delete", "Area: FE") < position(levelCleared, "create", "Area: FE"))
        })

        it("keeps the clash when the label is used, since retiring keeps its name taken", () => {
            const desired = { groups: { area: { ...area({ fe: "Area: FE" }), scope: "workspace" as const } } }
            const team = lin("Area: FE", "issue", { id: "t", scope: "team", usage: 2 })
            const plan = linear([...existingPhase, team], desired, null, { "unknown:issue:team:Area: FE": "remove" })
            const conflict = conflicts(plan)[0]
            assert.ok(conflict.kind === "conflict" && /rename that label/.test(conflict.resolution))
        })

        it("still moves kept children out before deleting a group dropped from the configuration", () => {
            const group = lin("Type", "issue", { id: "g", isGroup: true, groupType: "multiSelect" })
            const bug = lin("Bug", "issue", { parentId: "g" })
            const previous = {
                groups: {
                    type: {
                        ...area({ bug: "Bug" }),
                        scope: "workspace" as const,
                        nativeGroup: def("Type"),
                    },
                },
            }
            const desired = { groups: { area: { ...area({ bug: "Bug" }), scope: "workspace" as const } } }
            const plan = linear([...existingPhase, group, bug], desired, previous, {
                "misplaced:issue:area:bug": "adopt",
            })
            assert.deepEqual(plan.decisions, [])
            assert.ok(position(plan, "update", "Bug") >= 0)
            assert.ok(position(plan, "update", "Bug") < position(plan, "delete", "Type"))
        })
    })

    describe("remapping existing labels", () => {
        const remap = (name: string, key: string, extra: Partial<RemapEntry> = {}): RemapEntry => ({
            name,
            catalog: "issue",
            scope: "workspace",
            key,
            ...extra,
        })

        it("renames and moves a label into a native group, keeping its items", () => {
            const catalog = [...existingPhase, lin("Improvement", "issue", { usage: 7, color: "#000000" })]
            const plan = linear(catalog, kindGroup(), null, {}, [remap("Improvement", "issue:kind:refactor")])
            const update = plan.actions.find(
                (action) => action.kind === "update" && action.name === "Improvement",
            ) as Extract<CatalogAction, { kind: "update" }>
            assert.deepEqual(update.change, { name: "Refactor", parentKey: "issue:kind", color: "#1D76DB" })
            assert.match(update.description, /Remap "Improvement" to issue:kind:refactor \(7\+?/)
            assert.equal(position(plan, "create", "Refactor"), -1)
            assert.ok(!plan.decisions.some((decision) => /Improvement/.test(decision.message)))
        })

        it("remaps a label group onto the configured native group", () => {
            const old = lin("Type", "issue", { id: "g", isGroup: true, groupType: "multiSelect" })
            const plan = linear([...existingPhase, old], kindGroup(), null, {}, [remap("Type", "issue:kind")])
            const update = plan.actions.find((action) => action.kind === "update" && action.name === "Type") as Extract<
                CatalogAction,
                { kind: "update" }
            >
            assert.deepEqual(update.change, { name: "Kind", groupType: "singleSelect" })
            assert.ok(plan.actions.some((action) => action.kind === "create" && action.definition.name === "Feature"))
        })

        it("renames and recolors on GitHub and drops the old name from the keep list", () => {
            const plan = github(
                [gh("enhancement", { color: "#A2EEEF", usage: 4 })],
                {
                    groups: { area: area({ frontend: "Area: Frontend" }) },
                    unmanaged: { keep: [{ name: "enhancement" }] },
                },
                null,
                {},
                [{ name: "enhancement", catalog: "repository", scope: "repository", key: "repository:area:frontend" }],
            )
            assert.deepEqual(plan.decisions, [])
            assert.deepEqual(kinds(plan), ["update"])
            const update = plan.actions[0] as Extract<CatalogAction, { kind: "update" }>
            assert.deepEqual(update.change, { name: "Area: Frontend", color: "#1D76DB" })
            assert.deepEqual(plan.keep, [])
            assert.deepEqual(
                plan.droppedEntries.map((entry) => entry.entry.name),
                ["enhancement"],
            )
        })

        it("rejects invalid remap entries with a message naming the entry", () => {
            const catalog = [
                ...existingPhase,
                lin("Bug", "issue"),
                lin("Defect", "issue"),
                lin("Gone", "issue", { retired: true }),
                lin("Team", "issue", { scope: "team" }),
                lin("Grp", "issue", { isGroup: true, groupType: "multiSelect" }),
            ]
            const run = (entries: RemapEntry[]) => () => linear(catalog, kindGroup(), null, {}, entries)
            assert.throws(run([remap("Bug", "issue:kind:nope")]), /isn't a configured label/)
            assert.throws(run([remap("Missing", "issue:kind:bugfix")]), /0 labels with that name/)
            assert.throws(run([remap("Gone", "issue:kind:bugfix")]), /retired/)
            assert.throws(run([remap("Team", "issue:kind:bugfix", { scope: "team" })]), /configured in workspace/)
            assert.throws(run([remap("Grp", "issue:kind:bugfix")]), /it's a label group/)
            assert.throws(
                run([remap("Bug", "issue:kind:bugfix"), remap("Bug", "issue:kind:feature")]),
                /remapped more than once/,
            )
            assert.throws(
                run([remap("Bug", "issue:kind:bugfix"), remap("Defect", "issue:kind:bugfix")]),
                /doesn't merge labels/,
            )
        })

        it("reports a conflict with a resolution when the configured name is taken", () => {
            const catalog = [...existingPhase, lin("Improvement", "issue"), lin("Refactor", "issue", { usage: 1 })]
            const plan = linear(catalog, kindGroup(), null, {}, [remap("Improvement", "issue:kind:refactor")])
            const conflict = conflicts(plan).find((decision) => decision.id.startsWith("conflict:remap-target"))
            assert.ok(conflict && conflict.kind === "conflict" && /Remap "Refactor"/.test(conflict.resolution))
        })
    })

    describe("moves into a single-select group", () => {
        const adoptBoth = { "misplaced:issue:kind:feature": "adopt", "misplaced:issue:kind:bugfix": "adopt" }
        const twoUsed = () => [
            ...existingPhase,
            lin("Feature", "issue", { usage: 1, usageTruncated: true }),
            lin("Bug", "issue", { usage: 1, usageTruncated: true }),
        ]

        it("asks before moving two used labels in, and plans both moves on proceed", () => {
            const asked = linear(twoUsed(), kindGroup(), null, adoptBoth)
            assert.deepEqual(
                asked.decisions.map((decision) => [decision.id, question(decision).options]),
                [["single-select:issue:kind", ["proceed"]]],
            )
            assert.match(asked.decisions[0].message, /"Feature"[\s\S]*"Bug"[\s\S]*keeps only one/)
            const plan = linear(twoUsed(), kindGroup(), null, { ...adoptBoth, "single-select:issue:kind": "proceed" })
            assert.deepEqual(plan.decisions, [])
            assert.ok(position(plan, "update", "Feature") >= 0 && position(plan, "update", "Bug") >= 0)
        })

        it("counts a retired used label that the plan restores and moves in", () => {
            const catalog = [
                ...existingPhase,
                lin("Feature", "issue", { retired: true, usage: 1 }),
                lin("Bug", "issue", { usage: 1 }),
            ]
            const plan = linear(catalog, kindGroup(), null, adoptBoth)
            assert.deepEqual(
                plan.decisions.map((decision) => decision.kind),
                ["singleSelectMerge"],
            )
        })

        it("counts a used label already in the group", () => {
            const group = lin("Kind", "issue", { id: "k", isGroup: true, groupType: "singleSelect" })
            const inside = lin("Feature", "issue", { parentId: "k", usage: 1 })
            const outside = lin("Improvement", "issue", { usage: 1 })
            const plan = linear([...existingPhase, group, inside, outside], kindGroup(), null, {}, [
                { name: "Improvement", catalog: "issue", scope: "workspace", key: "issue:kind:refactor" },
            ])
            assert.deepEqual(
                plan.decisions.map((decision) => decision.kind),
                ["singleSelectMerge"],
            )
            assert.match(plan.decisions[0].message, /already holds "Feature"/)
        })

        it("asks nothing for one used label or a multi-select group", () => {
            const oneUsed = [...existingPhase, lin("Feature", "issue", { usage: 1 }), lin("Bug", "issue")]
            assert.deepEqual(linear(oneUsed, kindGroup(), null, adoptBoth).decisions, [])
            const multi: LinearLabels = {
                groups: {
                    area: {
                        ...area({ feature: "Feature", bug: "Bug" }),
                        scope: "workspace",
                        nativeGroup: def("Area"),
                    },
                },
            }
            const plan = linear(twoUsed(), multi, null, {
                "misplaced:issue:area:feature": "adopt",
                "misplaced:issue:area:bug": "adopt",
            })
            assert.deepEqual(plan.decisions, [])
        })

        it("doesn't ask about a remapped label while its target group waits for an answer", () => {
            const group = lin("Kind", "issue", { id: "k", isGroup: true, groupType: "multiSelect" })
            const plan = linear([...existingPhase, group, lin("Improvement", "issue")], kindGroup(), null, {}, [
                { name: "Improvement", catalog: "issue", scope: "workspace", key: "issue:kind:refactor" },
            ])
            assert.deepEqual(
                plan.decisions.map((decision) => decision.id),
                ["misplaced:issue:kind"],
            )
        })

        it("keeps narrowing a used group in place as its own question", () => {
            const group = lin("Kind", "issue", { id: "k", isGroup: true, groupType: "multiSelect" })
            const children = [
                lin("Feature", "issue", { parentId: "k", usage: 1 }),
                lin("Bug", "issue", { parentId: "k", usage: 1 }),
            ]
            const plan = linear([...existingPhase, group, ...children], kindGroup(), null, {
                "misplaced:issue:kind": "adopt",
            })
            assert.deepEqual(
                plan.decisions.map((decision) => decision.kind),
                ["groupTypeNarrowing"],
            )
        })
    })

    it("gives every conflict a resolution", () => {
        const team = lin("Area: FE", "issue", { id: "t", scope: "team", usage: 1 })
        const caseOnly = lin("area: be", "issue", { usage: 1 })
        const group = lin("Bug", "issue", { isGroup: true, groupType: "multiSelect" })
        const plan = linear(
            [...existingPhase, team, caseOnly, group],
            {
                groups: {
                    area: { ...area({ fe: "Area: FE", be: "Area: BE", bug: "Bug" }), scope: "workspace" },
                },
            },
            null,
        )
        const found = conflicts(plan)
        assert.equal(found.length, 3)
        for (const conflict of found) assert.ok(conflict.kind === "conflict" && conflict.resolution.length > 0)
    })
})
