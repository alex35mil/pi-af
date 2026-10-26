import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"
import { type EntityStatus, EntityStatusSchema, writeEntityStatus } from "../workflows/extensions/__lib/entity.ts"
import { prepareArtifactPersistence } from "../workflows/extensions/__lib/project-config.ts"
import { GitHubTrackerSchema, LinearTrackerSchema } from "../workflows/extensions/integrations/config.ts"
import { registerWorkflowOperations } from "../workflows/extensions/integrations/operations.ts"
import {
    setWorkflowPhase,
    SetWorkflowPhaseSchema,
    type NativePhaseFacts,
} from "../workflows/extensions/integrations/phase.ts"
import type { WorkflowEnvironment } from "../workflows/extensions/integrations/policy.ts"
import { linearPhases, phaseValues } from "./workflow-phase-fixtures.ts"
import { withToolExecution } from "./extension-context-fixture.ts"

const statuses = {
    backlog: "Backlog",
    todo: "Todo",
    inProgress: "In Progress",
    inReview: "In Review",
    done: "Done",
    canceled: "Canceled",
}
const repository = { owner: "example", repo: "repo" }
const github = Value.Parse(GitHubTrackerSchema, {
    provider: "github",
    mcpServer: "github",
    repository,
    project: { owner: "example", ownerType: "user", number: 2 },
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
const forge = { provider: "github" as const, mcpServer: "github", repository }

function environment(provider: "github" | "linear"): WorkflowEnvironment {
    return {
        tracker: structuredClone(provider === "github" ? github : linear),
        forge,
    }
}

function entity(provider: "github" | "linear", kind: "epic" | "task" | "gig" = "gig"): EntityStatus {
    return Value.Parse(EntityStatusSchema, {
        slug: "example",
        title: "Example",
        createdAt: "2026-01-01T00:00:00Z",
        phase: "planning",
        entity: kind,
        ...(kind === "epic" ? { taskTarget: "epic" } : { kind: "refactor" }),
        branch: {
            state: "ready",
            name: "example",
            start: "main",
            target: "main",
            source: "generated",
        },
        tracker:
            provider === "github"
                ? {
                      provider,
                      repository,
                      external: { issueNumber: kind === "epic" ? 10 : 11 },
                      planComment: { state: "unpublished" },
                  }
                : kind === "epic"
                  ? {
                        provider,
                        resource: "project",
                        external: {
                            projectId: "parent-project",
                            createdAt: "2026-10-01T09:00:00.000Z",
                        },
                        planDocument: { state: "unpublished" },
                    }
                  : {
                        provider,
                        resource: kind === "task" ? "task-issue" : "gig-issue",
                        external: {
                            issueId: "issue",
                            identifier: "ENG-11",
                            ...(kind === "task" ? { projectId: "parent-project" } : {}),
                        },
                        planDocument: { state: "unpublished" },
                    },
    })
}

function native(provider: "github" | "linear"): NativePhaseFacts {
    if (provider === "github")
        return {
            provider,
            field: {
                name: "Phase",
                dataType: "SINGLE_SELECT",
                options: Object.values(phaseValues),
            },
            current: "Planning",
        }
    const base = {
        team: null,
        parentId: null,
        isGroup: false,
        groupType: null,
        retiredAt: null,
    }
    return {
        provider,
        catalog: [
            {
                ...base,
                id: "phase",
                name: "Phase",
                isGroup: true,
                groupType: "singleSelect",
            },
            ...Object.entries(phaseValues).map(([id, name]) => ({
                ...base,
                id,
                name,
                parentId: "phase",
            })),
        ],
        applied: ["unrelated", "planning"],
    }
}

describe("workflow operations", () => {
    it("updates only Phase across all entities and trackers", () => {
        for (const provider of ["github", "linear"] as const)
            for (const kind of ["epic", "task", "gig"] as const) {
                const original = entity(provider, kind)
                const saved = structuredClone(original)
                for (const phase of ["planning", "execution", "selfReview"] as const) {
                    const result = setWorkflowPhase(original, environment(provider), {
                        entityDir: "example",
                        phase,
                        lifecycle: "inProgress",
                        native: native(provider),
                    })
                    assert.deepEqual(result.status, { ...saved, phase })
                    assert.equal(result.changed, phase !== "planning")
                    assert.equal(result.phaseMutation.changed, phase !== "planning")
                    if (result.phaseMutation.provider === "linear")
                        assert.deepEqual(result.phaseMutation.labels, ["unrelated", phase])
                }
                assert.deepEqual(original, saved)
            }
    })

    it("rejects inactive lifecycle, invalid native facts and a mismatched tracker", () => {
        for (const lifecycle of ["backlog", "todo", "inReview", "done", "canceled"] as const)
            assert.throws(
                () =>
                    setWorkflowPhase(entity("github"), environment("github"), {
                        entityDir: "example",
                        phase: "execution",
                        lifecycle,
                        native: native("github"),
                    }),
                /In Progress/,
            )
        const invalid = native("github")
        if (invalid.provider !== "github") assert.fail()
        invalid.field.options = []
        assert.throws(
            () =>
                setWorkflowPhase(entity("github"), environment("github"), {
                    entityDir: "example",
                    phase: "execution",
                    lifecycle: "inProgress",
                    native: invalid,
                }),
            /option/,
        )
        assert.throws(
            () =>
                setWorkflowPhase(entity("linear"), environment("github"), {
                    entityDir: "example",
                    phase: "execution",
                    lifecycle: "inProgress",
                    native: native("github"),
                }),
            /not the configured tracker/,
        )
        assert.equal(
            Value.Check(SetWorkflowPhaseSchema, {
                entityDir: "example",
                authority: "workflow",
                phase: "execution",
            }),
            false,
        )
    })

    it("runs the shared Phase operation without loading a Pi runtime", () => {
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
            console.log('portable operations loaded');
        `,
            ],
            { encoding: "utf8" },
        )
        assert.match(output, /portable operations loaded/)
    })

    it("registers only tracker Phase tools, which validate before saving and stay idempotent", async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workflow-operations-")))
        const git = (...args: string[]) => cp.execFileSync("git", args, { cwd: root, stdio: "pipe" })
        type Tool = Parameters<ExtensionAPI["registerTool"]>[0]
        const tools = new Map<string, Tool>()
        registerWorkflowOperations({
            on() {},
            registerTool: (tool: Tool) => tools.set(tool.name, tool),
        } as unknown as ExtensionAPI)
        assert.deepEqual([...tools.keys()], ["set_github_workflow_phase", "set_linear_workflow_phase"])
        const ctx = withToolExecution({ cwd: root } as ExtensionContext)
        try {
            git("init", "-q")
            fs.mkdirSync(path.join(root, ".project"))
            fs.writeFileSync(path.join(root, ".gitignore"), "/.project/.local/\n")
            fs.writeFileSync(
                path.join(root, ".project/config.json"),
                JSON.stringify({ branches: { format: "identifier-title" } }),
            )
            fs.writeFileSync(path.join(root, ".project/integrations.json"), JSON.stringify({ tracker: github, forge }))
            prepareArtifactPersistence(root)
            const directory = path.join(root, ".project/.local/gigs/11-example")
            fs.mkdirSync(directory, { recursive: true })
            writeEntityStatus(directory, entity("github"))
            const file = path.join(directory, "metadata.json")
            const before = fs.readFileSync(file, "utf8")
            const nativeInput = {
                field: {
                    name: "Phase",
                    dataType: "SINGLE_SELECT",
                    options: Object.values(phaseValues),
                },
                current: "Planning",
            }
            const phaseTool = tools.get("set_github_workflow_phase")!
            await assert.rejects(
                phaseTool.execute(
                    "bad",
                    {
                        entityDir: directory,
                        phase: "execution",
                        lifecycle: "done",
                        native: nativeInput,
                    },
                    undefined,
                    undefined,
                    ctx,
                ),
                /In Progress/,
            )
            assert.equal(fs.readFileSync(file, "utf8"), before)
            const result = await phaseTool.execute(
                "phase",
                {
                    entityDir: directory,
                    phase: "execution",
                    lifecycle: "inProgress",
                    native: nativeInput,
                },
                undefined,
                undefined,
                ctx,
            )
            assert.deepEqual(result.details, {
                entity: "11-example",
                phase: "execution",
                changed: true,
                phaseMutation: {
                    provider: "github",
                    field: "Phase",
                    value: "Execution",
                    changed: true,
                },
            })
            const modified = fs.statSync(file, { bigint: true }).mtimeNs
            await phaseTool.execute(
                "retry",
                {
                    entityDir: directory,
                    phase: "execution",
                    lifecycle: "inProgress",
                    native: { ...nativeInput, current: "Execution" },
                },
                undefined,
                undefined,
                ctx,
            )
            assert.equal(fs.statSync(file, { bigint: true }).mtimeNs, modified)
            assert.equal(fs.existsSync(path.join(directory, "status.md")), false)
            assert.equal(fs.existsSync(path.join(directory, "resource-ids.json")), false)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
