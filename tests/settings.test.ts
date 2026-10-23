import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"

import { getMcpSettingsPaths, readMcpConfiguration } from "../extensions/__lib/mcp.ts"
import { getExtensionSettingsPaths } from "../extensions/__lib/project.ts"
import { inspectPersistentPermissions } from "../extensions/permissions/index.ts"
import registerWebSearch from "../extensions/web-search/index.ts"
import { getWorkflowSettingsPaths } from "../workflows/extensions/__lib/project-config.ts"
import { inspectProjectMcp, registeredCredentialEnvironment } from "../workflows/extensions/integrations/mcp.ts"
import { nativeMcpFixture } from "./native-mcp-fixture.ts"

function write(file: string, value: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
}

function fixture() {
    const h = nativeMcpFixture()
    execFileSync("git", ["init", "--quiet"], { cwd: h.root })
    const nested = path.join(h.root, "src/nested")
    fs.mkdirSync(nested, { recursive: true })
    return { ...h, nested, repositoryRoot: fs.realpathSync(h.root) }
}

describe("shared settings contract", () => {
    it("uses literal global/project/local filenames from a nested repository directory", async () => {
        const h = fixture()
        try {
            for (const name of ["mcp", "permissions", "web-search"]) {
                assert.deepEqual(getExtensionSettingsPaths(name, h.nested), {
                    global: path.join(h.root, "agent", `${name}.json`),
                    project: path.join(h.repositoryRoot, ".agents", `${name}.json`),
                    local: path.join(h.repositoryRoot, ".agents", `${name}.local.json`),
                })
            }
            assert.deepEqual(getMcpSettingsPaths(h.nested), getExtensionSettingsPaths("mcp", h.nested))
            assert.deepEqual(getWorkflowSettingsPaths(h.nested), {
                global: path.join(h.root, "agent/workflows.json"),
                local: path.join(h.repositoryRoot, ".project/config.local.json"),
            })
        } finally {
            await h.cleanup()
        }
    })

    it("shares exact-name MCP precedence and credential-reference provenance with inspection", async () => {
        const h = fixture()
        try {
            const files = getMcpSettingsPaths(h.nested)
            const url = "https://api.githubcopilot.com/mcp/"
            write(files.global, {
                mcpServers: {
                    shared: { url, headers: { Authorization: "Bearer ${GLOBAL_TOKEN}" }, timeout: 12 },
                    global: { command: "fixture" },
                },
                autoEnableCodemode: false,
            })
            write(files.project, {
                mcpServers: {
                    shared: { url, headers: { Authorization: "Bearer ${PROJECT_TOKEN}" }, timeout: 20 },
                    project: { command: "fixture" },
                },
                autoEnableCodemode: true,
            })
            const local = { url, headers: { Authorization: "Bearer ${LOCAL_TOKEN}", "X-MCP-Toolsets": "issues" } }
            write(files.local, { mcpServers: { shared: local }, autoEnableCodemode: false })
            const loaded = readMcpConfiguration(h.nested, true)
            assert.deepEqual(
                loaded.servers.find(({ name }) => name === "shared"),
                { name: "shared", config: local, tier: "local" },
            )
            assert.equal(loaded.autoEnableCodemode, false)
            assert.deepEqual(loaded.servers.map(({ name }) => name).sort(), ["global", "project", "shared"])
            assert.deepEqual(
                inspectProjectMcp(h.nested, true).effectiveServers.find(({ name }) => name === "shared"),
                {
                    name: "shared",
                    source: "local",
                    provider: "github",
                    credentialEnv: "LOCAL_TOKEN",
                },
            )
            assert.equal(registeredCredentialEnvironment(h.nested, "shared", "github", true), "LOCAL_TOKEN")
            assert.equal(registeredCredentialEnvironment(h.nested, "shared", "github", false), "GLOBAL_TOKEN")
        } finally {
            await h.cleanup()
        }
    })

    it("never reads untrusted project settings and reports malformed trusted settings", async () => {
        const h = fixture()
        try {
            const files = getMcpSettingsPaths(h.nested)
            write(files.global, { mcpServers: { global: { command: "fixture" } } })
            for (const file of [files.project, files.local]) {
                fs.mkdirSync(path.dirname(file), { recursive: true })
                fs.writeFileSync(file, "not JSON")
            }
            assert.deepEqual(
                readMcpConfiguration(h.nested, false).servers.map(({ name }) => name),
                ["global"],
            )
            const untrusted = inspectProjectMcp(h.nested, false)
            assert.deepEqual(
                untrusted.tiers.map(({ state }) => state),
                ["valid", "untrusted", "untrusted"],
            )
            assert.equal(untrusted.error, undefined)
            assert.throws(() => readMcpConfiguration(h.nested, true), /Invalid MCP JSON/)
            assert.match(inspectProjectMcp(h.nested, true).error!, /Invalid MCP JSON/)
        } finally {
            await h.cleanup()
        }
    })

    it("reads the renamed permission files with runtime precedence and policy intact", async () => {
        const h = fixture()
        try {
            const files = getExtensionSettingsPaths("permissions", h.nested)
            write(files.global, { defaultMode: "deny", allow: ["read"] })
            write(files.project, { allow: ["bash(npm test *)"], ask: ["write(plan.md)"] })
            write(files.local, { defaultMode: "ask", deny: ["bash(rm *)"] })
            const inspected = inspectPersistentPermissions(h.nested)
            assert.deepEqual(
                inspected.sources.map(({ path: file }) => file),
                [files.global, files.project, files.local],
            )
            assert.deepEqual(inspected.settings, {
                defaultMode: "ask",
                allow: ["read", "bash(npm test *)"],
                ask: ["write(plan.md)"],
                deny: ["bash(rm *)"],
                keybindings: {},
            })
        } finally {
            await h.cleanup()
        }
    })

    it("uses the renamed web-search tiers through its real registered tool", async () => {
        const h = fixture()
        const cwd = process.cwd()
        const fetch = globalThis.fetch
        const apiKey = process.env.BRAVE_SEARCH_API_KEY
        try {
            const files = getExtensionSettingsPaths("web-search", h.nested)
            write(files.global, { apiKey: "global-fixture" })
            write(files.project, { apiKey: "project-fixture" })
            write(files.local, { apiKey: "local-fixture" })
            delete process.env.BRAVE_SEARCH_API_KEY
            process.chdir(h.nested)
            let calls = 0
            globalThis.fetch = async (_url, options) => {
                calls++
                assert.equal(new Headers(options?.headers).get("X-Subscription-Token"), "local-fixture")
                return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 })
            }
            await registerWebSearch(h.pi)
            const outcome = await h.run("web_search", { query: "fixture query" })
            assert.equal(outcome.isError, false)
            assert.equal(calls, 1)
        } finally {
            process.chdir(cwd)
            globalThis.fetch = fetch
            if (apiKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY
            else process.env.BRAVE_SEARCH_API_KEY = apiKey
            await h.cleanup()
        }
    })
})
