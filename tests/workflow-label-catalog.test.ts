import "./host-runtime.ts"

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { GitHubLabels, LinearLabels } from "../workflows/extensions/integrations/labels.ts"
import {
    type CatalogAction,
    githubListEntries,
    githubManagedEntries,
    linearListEntries,
    linearManagedEntries,
    planCatalog,
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
) {
    return planCatalog({
        catalog,
        desired: githubManagedEntries(desired),
        previous: previous ? githubManagedEntries(previous) : null,
        keep: githubListEntries(desired.unmanaged?.keep),
        retired: githubListEntries(desired.retired),
        answers,
    })
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
            retired.decisions.map((decision) => [decision.kind, decision.options]),
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
            blocked.decisions.map((decision) => [decision.kind, decision.label?.name, decision.label?.usage]),
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
                decision.label?.name === "bug"
                    ? "remove"
                    : decision.label?.name === "wontfix"
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
            kept.decisions.map((decision) => decision.label?.name),
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
    const linear = (catalog: TrackerLabel[], desired: LinearLabels, previous: LinearLabels | null, answers = {}) =>
        planCatalog({
            catalog,
            desired: linearManagedEntries(desired, phase),
            previous: previous ? linearManagedEntries(previous, phase) : null,
            keep: linearListEntries(desired.unmanaged?.keep),
            retired: linearListEntries(desired.retired),
            answers,
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
            plan.decisions.map((decision) => [decision.label?.name, decision.label?.children]),
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
})
