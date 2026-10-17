import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"
import {
    type EntityStatus,
    EntityStatusSchema,
    readEntityStatus,
    writeEntityStatus,
} from "../workflows/extensions/__lib/entity.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { GitHubTrackerSchema, LinearTrackerSchema } from "../workflows/extensions/integrations/config.ts"
import {
    confirmTrackerInitialization,
    TrackerInitializationFactsSchema,
    type TrackerInitializationFacts,
} from "../workflows/extensions/integrations/initialization.ts"
import { registerWorkflowOperations } from "../workflows/extensions/integrations/operations.ts"
import {
    setWorkflowPhase,
    SetWorkflowPhaseSchema,
    type NativePhaseFacts,
} from "../workflows/extensions/integrations/phase.ts"
import type { WorkflowEnvironment } from "../workflows/extensions/integrations/policy.ts"
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
    repository: { owner: "example", repo: "repo" },
    project: { owner: "example", ownerType: "user", number: 2 },
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
        internalId: { scope: "project", field: "ID" },
    },
})
const linear = Value.Parse(LinearTrackerSchema, {
    provider: "linear",
    mcpServer: "linear",
    team: "Engineering",
    phase: linearPhases(),
    statuses: { projects: statuses, issues: statuses },
})

function environment(
    provider: "none" | "github" | "linear",
    mode: "versioned" | "unversioned" = "versioned",
): WorkflowEnvironment {
    return {
        artifacts: { kind: mode },
        tracker:
            provider === "none"
                ? { kind: "none" }
                : provider === "github"
                  ? { kind: provider, config: structuredClone(github) }
                  : { kind: provider, config: structuredClone(linear) },
        forge: { kind: "none" },
    }
}
function entity(
    provider: "none" | "github" | "linear",
    kind: "epic" | "task" | "gig" = "gig",
    pending = false,
): EntityStatus {
    return Value.Parse(EntityStatusSchema, {
        id: `${kind.toUpperCase()}-01KDVDNA00`,
        rawId: "01KDVDNA00",
        slug: "example",
        title: "Example",
        createdAt: "2026-01-01T00:00:00Z",
        phase: "planning",
        entity: kind,
        ...(kind === "epic" ? { taskTarget: "epic" } : { kind: "refactor" }),
        branch: { state: "ready", name: "example", start: "main", target: "main", source: "generated" },
        authority:
            provider === "none"
                ? { kind: "workflow", priority: "High" }
                : {
                      kind: "tracker",
                      provider,
                      ...(pending ? { desired: { lifecycle: "inProgress", priority: "High" } } : {}),
                  },
        ...(provider === "none" ? { state: "inProgress" } : {}),
        integrations:
            provider === "none"
                ? []
                : [
                      {
                          role: "tracker",
                          provider,
                          state: pending ? "bound-pending" : "bound",
                          ...(pending ? { operations: ["confirm outcomes"] } : {}),
                          ...(provider === "github"
                              ? { repository: github.repository, external: { issueNumber: kind === "epic" ? 10 : 11 } }
                              : {
                                    resource:
                                        kind === "epic" ? "project" : kind === "task" ? "task-issue" : "gig-issue",
                                    external:
                                        kind === "epic"
                                            ? { projectId: "parent-project" }
                                            : {
                                                  issueId: "issue",
                                                  ...(kind === "task" ? { projectId: "parent-project" } : {}),
                                              },
                                }),
                      },
                  ],
    })
}
function native(provider: "github" | "linear"): NativePhaseFacts {
    if (provider === "github")
        return {
            provider,
            field: { name: "Phase", dataType: "SINGLE_SELECT", options: Object.values(phaseValues) },
            current: "Planning",
        }
    const base = { team: null, parentId: null, isGroup: false, groupType: null, retiredAt: null }
    return {
        provider,
        catalog: [
            { ...base, id: "phase", name: "Phase", isGroup: true, groupType: "singleSelect" },
            ...Object.entries(phaseValues).map(([id, name]) => ({ ...base, id, name, parentId: "phase" })),
        ],
        applied: ["unrelated", "planning"],
    }
}
function facts(
    provider: "github" | "linear",
    kind: "epic" | "task" | "gig",
    mode: "versioned" | "unversioned",
): TrackerInitializationFacts {
    const id = `${kind.toUpperCase()}-01KDVDNA00`
    return Value.Parse(
        TrackerInitializationFactsSchema,
        provider === "github"
            ? {
                  provider,
                  repository: github.repository,
                  issueNumber: kind === "epic" ? 10 : 11,
                  project: github.project,
                  itemId: 42,
                  parentIssueNumber: kind === "task" ? 10 : null,
                  lifecycle: "inProgress",
                  priority: "High",
                  phase: native(provider),
                  systemMetadata:
                      mode === "unversioned"
                          ? { mode }
                          : {
                                mode,
                                labels: [kind === "epic" ? "Epic" : "Refactor", "unrelated"],
                                internalId: { ...github.fields.internalId, value: id },
                            },
              }
            : {
                  provider,
                  resource: kind === "epic" ? "project" : kind === "task" ? "task-issue" : "gig-issue",
                  id: kind === "epic" ? "parent-project" : "issue",
                  team: "Engineering",
                  projectId: kind === "task" ? "parent-project" : null,
                  lifecycle: "inProgress",
                  priority: 2,
                  phase: native(provider),
                  systemMetadata: mode === "unversioned" ? { mode } : { mode, internalId: id },
              },
    )
}

describe("workflow operations", () => {
    it("updates only Phase across all entities, authorities and persistence modes", () => {
        for (const provider of ["none", "github", "linear"] as const)
            for (const kind of ["epic", "task", "gig"] as const)
                for (const mode of ["versioned", "unversioned"] as const) {
                    const original = entity(provider, kind)
                    const saved = structuredClone(original)
                    for (const phase of ["planning", "execution", "selfReview"] as const) {
                        const input =
                            provider === "none"
                                ? { entityDir: "example", authority: "workflow" as const, phase }
                                : {
                                      entityDir: "example",
                                      authority: "tracker" as const,
                                      phase,
                                      lifecycle: "inProgress" as const,
                                      native: native(provider),
                                  }
                        const result = setWorkflowPhase(original, environment(provider, mode), input)
                        assert.deepEqual(result.status, { ...saved, phase })
                        assert.equal(result.changed, phase !== "planning")
                        if (provider !== "none") {
                            assert.ok(result.phaseMutation)
                            assert.equal(result.phaseMutation.changed, phase !== "planning")
                            if (result.phaseMutation.provider === "linear")
                                assert.deepEqual(result.phaseMutation.labels, ["unrelated", phase])
                        }
                    }
                    assert.deepEqual(original, saved)
                }
    })

    it("rejects inactive lifecycle, invalid metadata and wrong authority before returning a change", () => {
        for (const lifecycle of ["backlog", "todo", "inReview", "done", "canceled"] as const) {
            const input = {
                entityDir: "example",
                authority: "tracker" as const,
                phase: "execution" as const,
                lifecycle,
                native: native("github"),
            }
            assert.throws(() => setWorkflowPhase(entity("github"), environment("github"), input), /In Progress/)
        }
        const local = entity("none")
        if (!("state" in local)) assert.fail()
        for (const state of ["inReview", "done", "canceled"] as const)
            assert.throws(
                () =>
                    setWorkflowPhase({ ...local, state }, environment("none"), {
                        entityDir: "example",
                        authority: "workflow",
                        phase: "execution",
                    }),
                /In Progress/,
            )
        assert.throws(
            () =>
                setWorkflowPhase(entity("github"), environment("github"), {
                    entityDir: "example",
                    authority: "workflow",
                    phase: "execution",
                }),
            /authority/,
        )
        const invalid = native("github")
        if (invalid.provider !== "github") assert.fail()
        invalid.field.options = []
        assert.throws(
            () =>
                setWorkflowPhase(entity("github"), environment("github"), {
                    entityDir: "example",
                    authority: "tracker",
                    phase: "execution",
                    lifecycle: "inProgress",
                    native: invalid,
                }),
            /option/,
        )
        assert.equal(
            Value.Check(SetWorkflowPhaseSchema, {
                entityDir: "example",
                authority: "workflow",
                phase: "execution",
                native: invalid,
            }),
            false,
        )
        assert.throws(
            () =>
                setWorkflowPhase(
                    {
                        ...entity("linear"),
                        branch: { state: "tracker-pending", provider: "linear", start: "main", target: "main" },
                    },
                    environment("linear"),
                    {
                        entityDir: "example",
                        authority: "tracker",
                        phase: "execution",
                        lifecycle: "inProgress",
                        native: native("linear"),
                    },
                ),
            /branch is tracker-pending/,
        )
    })

    it("completes identified binding in both providers/modes without changing anything else", () => {
        for (const provider of ["github", "linear"] as const)
            for (const kind of ["epic", "task", "gig"] as const)
                for (const mode of ["versioned", "unversioned"] as const) {
                    const original = entity(provider, kind, true)
                    const before = structuredClone(original)
                    const parent = kind === "task" ? entity(provider, "epic") : null
                    const result = confirmTrackerInitialization(
                        original,
                        environment(provider, mode),
                        facts(provider, kind, mode),
                        parent,
                    )
                    assert.equal(result.changed, true)
                    assert.deepEqual(result.status, entity(provider, kind))
                    assert.deepEqual(original, before)
                    assert.equal(
                        confirmTrackerInitialization(
                            result.status,
                            environment(provider, mode),
                            facts(provider, kind, mode),
                            parent,
                        ).changed,
                        false,
                    )
                }
    })

    it("preserves Linear branch provisioning and identified creation checkpoints", () => {
        for (const branch of [
            { state: "tracker-pending", provider: "linear", start: "main", target: "main" },
            { state: "tracker-named", provider: "linear", name: "linear-exact", start: "main", target: "main" },
            {
                state: "provisioning",
                provider: "linear",
                name: "linear-exact",
                start: "main",
                target: "main",
                startCommit: "a".repeat(40),
            },
        ]) {
            const original = Value.Parse(EntityStatusSchema, { ...entity("linear", "gig", true), branch })
            const result = confirmTrackerInitialization(
                original,
                environment("linear"),
                facts("linear", "gig", "versioned"),
                null,
            )
            assert.deepEqual(result.status.branch, branch)
        }
        const original = entity("github", "gig", true)
        const checkpoint = Value.Parse(EntityStatusSchema, {
            ...original,
            integrations: original.integrations.map((entry) => ({ ...entry, state: "issue-bound-pending" })),
        })
        assert.equal(
            confirmTrackerInitialization(checkpoint, environment("github"), facts("github", "gig", "versioned"), null)
                .changed,
            true,
        )
    })

    it("rejects missing/conflicting binding outcomes and preserves the pending intent", () => {
        for (const provider of ["github", "linear"] as const) {
            const original = entity(provider, "task", true)
            const before = structuredClone(original)
            const good = facts(provider, "task", "versioned")
            const bad: TrackerInitializationFacts[] = [
                { ...good, lifecycle: "todo" },
                { ...good, systemMetadata: { mode: "unversioned" } },
                { ...good, priority: provider === "github" ? "Low" : 4 } as TrackerInitializationFacts,
                { ...good, phase: native(provider === "github" ? "linear" : "github") },
            ]
            if (good.provider === "github") {
                bad.push(
                    { ...good, issueNumber: 999 },
                    { ...good, project: { ...good.project, number: 99 } },
                    { ...good, parentIssueNumber: null },
                )
                if (good.systemMetadata.mode !== "versioned") assert.fail()
                bad.push(
                    { ...good, systemMetadata: { ...good.systemMetadata, labels: ["Bugfix"] } },
                    {
                        ...good,
                        systemMetadata: {
                            ...good.systemMetadata,
                            internalId: { ...good.systemMetadata.internalId, scope: "issue" },
                        },
                    },
                )
            } else
                bad.push(
                    { ...good, id: "wrong" },
                    { ...good, team: "other" },
                    { ...good, projectId: null },
                    { ...good, systemMetadata: { mode: "versioned", internalId: "wrong" } },
                )
            for (const input of bad)
                assert.throws(() =>
                    confirmTrackerInitialization(original, environment(provider), input, entity(provider, "epic")),
                )
            assert.throws(() => confirmTrackerInitialization(original, environment(provider), good, null), /parent/)
            assert.throws(
                () =>
                    confirmTrackerInitialization(
                        { ...original, authority: { kind: "tracker", provider } },
                        environment(provider),
                        good,
                        entity(provider, "epic"),
                    ),
                /pending intent/,
            )
            const unidentified = Value.Parse(EntityStatusSchema, {
                ...original,
                integrations: [
                    {
                        role: "tracker",
                        provider,
                        ...(provider === "github" ? { repository: github.repository } : { resource: "task-issue" }),
                        state: "pending",
                        operations: ["create"],
                    },
                ],
            })
            assert.throws(
                () => confirmTrackerInitialization(unidentified, environment(provider), good, entity(provider, "epic")),
                /identified/,
            )
            assert.deepEqual(original, before)
        }
        assert.throws(
            () =>
                confirmTrackerInitialization(
                    entity("none"),
                    environment("none"),
                    facts("github", "gig", "versioned"),
                    null,
                ),
            /tracker authority/,
        )
    })

    it("supports unset Priority and both GitHub Internal ID scopes", () => {
        for (const provider of ["github", "linear"] as const) {
            const original = entity(provider, "gig", true)
            if (original.authority.kind !== "tracker" || !("desired" in original.authority)) assert.fail()
            original.authority.desired.priority = "not set"
            const observed = facts(provider, "gig", "versioned")
            if (observed.provider === "github") observed.priority = "not set"
            else observed.priority = 0
            for (const scope of ["project", "issue"] as const) {
                const configured = environment(provider)
                if (
                    configured.tracker.kind === "github" &&
                    observed.provider === "github" &&
                    observed.systemMetadata.mode === "versioned"
                ) {
                    configured.tracker.config.fields.internalId.scope = scope
                    observed.systemMetadata.internalId.scope = scope
                }
                assert.equal(confirmTrackerInitialization(original, configured, observed, null).changed, true)
            }
        }
    })

    it("runs the shared operations without loading a Pi runtime", () => {
        const output = cp.execFileSync(
            process.execPath,
            [
                "--import",
                "tsx",
                "--input-type=module",
                "-e",
                `
            import { registerHooks } from 'node:module';
            registerHooks({ resolve(specifier, context, next) {
                if (specifier.startsWith('@earendil-works/')) throw new Error('Pi runtime dependency: ' + specifier);
                return next(specifier, context);
            }});
            await import('./workflows/extensions/integrations/phase.ts');
            await import('./workflows/extensions/integrations/initialization.ts');
            console.log('portable operations loaded');
        `,
            ],
            { encoding: "utf8" },
        )
        assert.match(output, /portable operations loaded/)
    })

    it("adapters validate before saving, preserve unrelated files and avoid provider execution", async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workflow-operations-")))
        const git = (...args: string[]) => cp.execFileSync("git", args, { cwd: root, stdio: "pipe" })
        type Tool = Parameters<ExtensionAPI["registerTool"]>[0]
        const tools = new Map<string, Tool>()
        registerWorkflowOperations({
            registerTool: (tool: Tool) => tools.set(tool.name, tool),
        } as unknown as ExtensionAPI)
        const ctx = { cwd: root } as ExtensionContext
        try {
            git("init", "-q")
            fs.mkdirSync(path.join(root, ".project"))
            fs.writeFileSync(path.join(root, ".gitignore"), ".project/**/.local/\n")
            fs.writeFileSync(
                path.join(root, ".project/config.json"),
                JSON.stringify({ artifacts: "versioned", branches: { format: "identifier" } }),
            )
            fs.writeFileSync(path.join(root, ".project/integrations.json"), JSON.stringify({ tracker: github }))
            prepareArtifactPersistence(root)
            const directory = path.join(root, ".project/gigs/20260101-0000.GIG-01KDVDNA00.example")
            fs.mkdirSync(path.join(directory, ".local"), { recursive: true })
            writeEntityStatus(directory, entity("github", "gig", true))
            const file = path.join(directory, "metadata.json")
            const before = fs.readFileSync(file, "utf8")
            const phaseTool = tools.get("set_workflow_phase")!
            await assert.rejects(
                phaseTool.execute(
                    "bad",
                    {
                        entityDir: directory,
                        authority: "tracker",
                        phase: "execution",
                        lifecycle: "done",
                        native: native("github"),
                    },
                    undefined,
                    undefined,
                    ctx,
                ),
                /In Progress/,
            )
            assert.equal(fs.readFileSync(file, "utf8"), before)
            const binding = tools.get("confirm_tracker_initialization")!
            await binding.execute(
                "confirm",
                { entityDir: directory, facts: facts("github", "gig", "versioned") },
                undefined,
                undefined,
                ctx,
            )
            assert.deepEqual(readEntityStatus(directory), entity("github"))
            const after = fs.statSync(file, { bigint: true }).mtimeNs
            await binding.execute(
                "retry",
                { entityDir: directory, facts: facts("github", "gig", "versioned") },
                undefined,
                undefined,
                ctx,
            )
            assert.equal(fs.statSync(file, { bigint: true }).mtimeNs, after)
            const result = await phaseTool.execute(
                "phase",
                {
                    entityDir: directory,
                    authority: "tracker",
                    phase: "execution",
                    lifecycle: "inProgress",
                    native: native("github"),
                },
                undefined,
                undefined,
                ctx,
            )
            assert.deepEqual(result.details, {
                entityId: "GIG-01KDVDNA00",
                phase: "execution",
                changed: true,
                phaseMutation: { provider: "github", field: "Phase", value: "Execution", changed: true },
            })
            assert.equal(fs.existsSync(path.join(directory, ".local/status.md")), false)
            assert.equal(fs.existsSync(path.join(directory, ".local/metadata.json")), false)
            fs.rmSync(path.join(root, ".project/integrations.json"))
            writeEntityStatus(directory, entity("none"))
            const lifecycleFile = path.join(directory, ".local/status.md")
            const lifecycleBefore = fs.readFileSync(lifecycleFile, "utf8")
            const lifecycleModified = fs.statSync(lifecycleFile, { bigint: true }).mtimeNs
            await phaseTool.execute(
                "local",
                { entityDir: directory, authority: "workflow", phase: "execution" },
                undefined,
                undefined,
                ctx,
            )
            assert.equal(fs.readFileSync(lifecycleFile, "utf8"), lifecycleBefore)
            assert.equal(fs.statSync(lifecycleFile, { bigint: true }).mtimeNs, lifecycleModified)
            const localMetadataModified = fs.statSync(file, { bigint: true }).mtimeNs
            await phaseTool.execute(
                "local-retry",
                { entityDir: directory, authority: "workflow", phase: "execution" },
                undefined,
                undefined,
                ctx,
            )
            assert.equal(fs.statSync(file, { bigint: true }).mtimeNs, localMetadataModified)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
