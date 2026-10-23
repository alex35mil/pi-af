import assert from "node:assert/strict"
import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

import { MCP_TOOL_CATALOG_EVENT, type McpToolCatalog, type McpToolMetadata } from "../extensions/__lib/mcp.ts"
import { getExtensionSettingsPaths } from "../extensions/__lib/project.ts"
import { inspectPersistentPermissions } from "../extensions/permissions/index.ts"
import registerProjectSetup from "../workflows/extensions/project-setup/index.ts"
import {
    configureProjectPermissions,
    inspectProjectPermissions,
} from "../workflows/extensions/project-setup/permissions.ts"
import { withToolExecution } from "./extension-context-fixture.ts"

import { fixtureToolName } from "./mcp-catalog-fixture.ts"

function git(root: string, ...args: string[]) {
    return cp.execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "setup-permissions-"))
    const previous = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = path.join(root, "agent")
    git(root, "init", "-b", "main")
    git(root, "config", "core.excludesFile", "/dev/null")
    const paths = getExtensionSettingsPaths("permissions", root)
    return {
        root,
        paths,
        write(tier: keyof typeof paths, value: unknown) {
            fs.mkdirSync(path.dirname(paths[tier]), { recursive: true })
            fs.writeFileSync(paths[tier], `${JSON.stringify(value, null, 2)}\n`)
        },
        cleanup() {
            if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
            else process.env.PI_CODING_AGENT_DIR = previous
            fs.rmSync(root, { recursive: true, force: true })
        },
    }
}

const read: McpToolMetadata = {
    serverName: "team-gh",
    serverToolName: "issue_read",
    inputSchema: {},
    annotations: { readOnlyHint: true },
}
const write: McpToolMetadata = {
    serverName: "team-gh",
    serverToolName: "issue_write",
    inputSchema: {},
    annotations: { readOnlyHint: false },
}
const live: McpToolCatalog = new Map(
    [read, write].map((tool) => [fixtureToolName(tool.serverName, tool.serverToolName), tool]),
)
const hint = "mcp(team-gh, hint: readOnly)"
const writeRule = "mcp(team-gh, issue_write)"
const gate = "write(.project/*/plan.md)"

describe("project setup permissions", () => {
    it("merges allows and ask gates while preserving unrelated settings and the index", () => {
        const f = fixture()
        try {
            const original = {
                defaultMode: "deny",
                allow: ["read"],
                ask: ["edit(existing.md)"],
                deny: ["bash(rm *)"],
                keybindings: { autoAcceptEdits: "ctrl+shift+a" },
                other: { keep: true },
            }
            f.write("project", original)
            const index = git(f.root, "ls-files", "--stage")
            const configured = configureProjectPermissions(
                f.root,
                { target: "project", allow: [hint, writeRule], ask: [gate] },
                live,
            )
            assert.deepEqual(configured.added, { allow: [hint, writeRule], ask: [gate] })
            assert.equal(configured.changed, true)
            assert.equal(configured.localExclusionChanged, false)
            assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.project, "utf-8")), {
                ...original,
                allow: [...original.allow, hint, writeRule],
                ask: [...original.ask, gate],
            })
            assert.equal(git(f.root, "ls-files", "--stage"), index)
            assert.equal(fs.existsSync(f.paths.local), false)
        } finally {
            f.cleanup()
        }
    })

    it("skips coverage from every tier without touching files or exclusions", () => {
        for (const tier of ["global", "project", "local"] as const) {
            const f = fixture()
            try {
                f.write(tier, { allow: ["mcp(team-gh, *)"] })
                const before = fs.readFileSync(f.paths[tier], "utf-8")
                const exclude = fs.readFileSync(path.join(f.root, ".git/info/exclude"), "utf-8")
                const result = configureProjectPermissions(
                    f.root,
                    { target: "local", allow: [hint, writeRule], ask: [] },
                    live,
                )
                assert.equal(result.changed, false)
                assert.deepEqual(
                    result.skipped.allow.map((entry) => entry.status),
                    ["covered", "covered"],
                )
                assert.equal(fs.readFileSync(f.paths[tier], "utf-8"), before)
                assert.equal(fs.readFileSync(path.join(f.root, ".git/info/exclude"), "utf-8"), exclude)
                if (tier !== "local") assert.equal(fs.existsSync(f.paths.local), false)
            } finally {
                f.cleanup()
            }
        }
    })

    it("skips semantic duplicates within one approved request and on rerun", () => {
        const f = fixture()
        try {
            const result = configureProjectPermissions(
                f.root,
                { target: "local", allow: [writeRule, "mcp(team-gh,issue_write)"], ask: [gate] },
                live,
            )
            assert.deepEqual(result.added, { allow: [writeRule], ask: [gate] })
            assert.equal(result.skipped.allow[0].status, "covered")
            assert.equal(result.localExclusionChanged, true)
            assert.equal(
                git(f.root, "check-ignore", ".agents/permissions.local.json"),
                ".agents/permissions.local.json",
            )
            const before = fs.readFileSync(f.paths.local, "utf-8")
            assert.equal(
                configureProjectPermissions(f.root, { target: "local", allow: [writeRule], ask: [gate] }, live).changed,
                false,
            )
            assert.equal(fs.readFileSync(f.paths.local, "utf-8"), before)
        } finally {
            f.cleanup()
        }
    })

    it("preserves blockers, skips fully blocked writes, and reports partial read access", () => {
        const f = fixture()
        try {
            f.write("global", { ask: [writeRule] })
            f.write("local", { deny: ["mcp(team-gh, issue_read)"] })
            const secondRead = { ...read, serverToolName: "list_issues" }
            const reads = new Map([...live, [fixtureToolName("team-gh", "list_issues"), secondRead] as const])
            const result = configureProjectPermissions(
                f.root,
                { target: "project", allow: [hint, writeRule], ask: [] },
                reads,
            )
            assert.deepEqual(result.added.allow, [hint])
            assert.equal(result.inspection[0].tools.find((tool) => tool.tool === "issue_read")?.mode, "deny")
            assert.equal(result.skipped.allow[0].status, "blocked")
            assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.local, "utf-8")), {
                deny: ["mcp(team-gh, issue_read)"],
            })
            assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.global, "utf-8")), { ask: [writeRule] })
        } finally {
            f.cleanup()
        }
    })

    it("checks new ask rules and rechecks policy changed after inspection", () => {
        const f = fixture()
        try {
            assert.equal(inspectProjectPermissions(f.root, { rules: [writeRule] }, live).rules[0].status, "available")
            f.write("global", { deny: [writeRule] })
            const result = configureProjectPermissions(
                f.root,
                { target: "project", allow: [writeRule], ask: [gate] },
                live,
            )
            assert.deepEqual(result.added, { allow: [], ask: [gate] })
            assert.equal(result.skipped.allow[0].status, "blocked")
            fs.rmSync(f.paths.global)
            const sameRequest = configureProjectPermissions(
                f.root,
                { target: "local", allow: [writeRule], ask: [writeRule] },
                live,
            )
            assert.deepEqual(sameRequest.added, { allow: [], ask: [writeRule] })
        } finally {
            f.cleanup()
        }
    })

    it("reports unavailable tools and never creates an empty permission file", () => {
        const f = fixture()
        try {
            const result = configureProjectPermissions(
                f.root,
                { target: "local", allow: [hint, writeRule], ask: [] },
                new Map(),
            )
            assert.equal(result.changed, false)
            assert.deepEqual(
                result.skipped.allow.map((entry) => entry.status),
                ["unavailable", "unavailable"],
            )
            assert.equal(fs.existsSync(f.paths.local), false)
            assert.equal(result.localExclusionChanged, false)
        } finally {
            f.cleanup()
        }
    })

    it("validates complete requests and all persistent tiers before any mutation", () => {
        const f = fixture()
        try {
            const exclude = fs.readFileSync(path.join(f.root, ".git/info/exclude"), "utf-8")
            for (const input of [
                { target: "local", allow: [], ask: [] },
                { target: "local", allow: [writeRule, "read"], ask: [gate] },
                { target: "local", allow: ["mcp(team-gh, hint: unknown)"], ask: [gate] },
                { target: "local", allow: [writeRule, writeRule], ask: [] },
            ]) {
                assert.throws(() => configureProjectPermissions(f.root, input, live))
                assert.equal(fs.existsSync(f.paths.local), false)
            }
            for (const tier of ["global", "project", "local"] as const) {
                for (const content of [
                    "{broken",
                    "[]",
                    "null",
                    '{"allow":"read"}',
                    '{"allow":["mcp(team-gh, hint: unknown)"]}',
                ]) {
                    fs.mkdirSync(path.dirname(f.paths[tier]), { recursive: true })
                    fs.writeFileSync(f.paths[tier], content)
                    assert.throws(() =>
                        configureProjectPermissions(f.root, { target: "local", allow: [writeRule], ask: [gate] }, live),
                    )
                    assert.equal(fs.readFileSync(f.paths[tier], "utf-8"), content)
                    fs.rmSync(f.paths[tier])
                }
            }
            assert.equal(fs.readFileSync(path.join(f.root, ".git/info/exclude"), "utf-8"), exclude)
        } finally {
            f.cleanup()
        }
    })

    it("refuses local files in Git and leaves their contents and index intact", () => {
        const f = fixture()
        try {
            f.write("local", { allow: ["read"] })
            git(f.root, "add", ".agents/permissions.local.json")
            const before = fs.readFileSync(f.paths.local, "utf-8")
            const index = git(f.root, "ls-files", "--stage")
            assert.throws(
                () => configureProjectPermissions(f.root, { target: "local", allow: [writeRule], ask: [gate] }, live),
                /in Git or staged/,
            )
            assert.equal(fs.readFileSync(f.paths.local, "utf-8"), before)
            assert.equal(git(f.root, "ls-files", "--stage"), index)
        } finally {
            f.cleanup()
        }
    })

    it("loads the same three-tier precedence used by runtime permission checks", () => {
        const f = fixture()
        try {
            f.write("global", { defaultMode: "deny", allow: [hint], ask: [gate] })
            f.write("project", { defaultMode: "ask", allow: [writeRule] })
            f.write("local", { defaultMode: "allow", deny: [writeRule] })
            const snapshot = inspectPersistentPermissions(f.root)
            assert.equal(snapshot.settings.defaultMode, "allow")
            assert.deepEqual(snapshot.settings.allow, [hint, writeRule])
            assert.deepEqual(snapshot.settings.deny, [writeRule])
            assert.deepEqual(
                snapshot.sources.map((source) => source.tier),
                ["global", "project", "local"],
            )
        } finally {
            f.cleanup()
        }
    })

    it("wires inspection and configuration to catalog refresh and disposes its listener", async () => {
        const f = fixture()
        type Tool = Parameters<ExtensionAPI["registerTool"]>[0]
        const tools = new Map<string, Tool>()
        const listeners = new Map<string, (data: unknown) => void>()
        let shutdown: (() => void) | undefined
        const pi = {
            events: {
                on(channel: string, listener: (data: unknown) => void) {
                    listeners.set(channel, listener)
                    return () => listeners.delete(channel)
                },
            },
            on(event: string, handler: () => void) {
                if (event === "session_shutdown") shutdown = handler
            },
            registerTool(tool: Tool) {
                tools.set(tool.name, tool)
            },
            registerCommand() {},
        } as unknown as ExtensionAPI
        const ctx = withToolExecution({ cwd: f.root } as ExtensionContext)
        async function invoke<T>(name: string, input: unknown): Promise<T> {
            const result = await tools.get(name)!.execute("call", input, undefined, undefined, ctx)
            return result.details as T
        }
        type Inspection = ReturnType<typeof inspectProjectPermissions>
        type Configuration = ReturnType<typeof configureProjectPermissions>
        try {
            registerProjectSetup(pi)
            const before = git(f.root, "status", "--porcelain=v1")
            const initial = await invoke<Inspection>("inspect_permissions", { rules: [hint, writeRule] })
            assert.deepEqual(
                initial.rules.map((entry) => entry.status),
                ["unavailable", "unavailable"],
            )
            listeners.get(MCP_TOOL_CATALOG_EVENT)!(live)
            const inspected = await invoke<Inspection>("inspect_permissions", { rules: [hint, writeRule] })
            assert.deepEqual(
                inspected.rules.map((entry) => entry.status),
                ["available", "available"],
            )
            assert.match(inspected.scope, /excludes session overrides/)
            assert.equal(git(f.root, "status", "--porcelain=v1"), before)
            const saved = await invoke<Configuration>("configure_permissions", {
                target: "local",
                allow: [writeRule],
                ask: [gate],
            })
            assert.equal(saved.changed, true)
            listeners.get(MCP_TOOL_CATALOG_EVENT)!(new Map())
            assert.equal(
                (await invoke<Inspection>("inspect_permissions", { rules: [writeRule] })).rules[0].status,
                "unavailable",
            )
            assert.ok(shutdown)
            shutdown()
            assert.equal(listeners.has(MCP_TOOL_CATALOG_EVENT), false)
        } finally {
            f.cleanup()
        }
    })
})
