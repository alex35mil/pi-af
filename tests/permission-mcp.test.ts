import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

import {
    getMcpToolName,
    MCP_TOOL_CATALOG_EVENT,
    type McpToolCatalog,
    type McpToolMetadata,
} from "../extensions/__lib/mcp.ts"
import { analyzeBash } from "../extensions/permission/bash.ts"
import permissionExtension, {
    resolveMode,
    validatePermissionSettings,
    type Mode,
    type PermissionSettings,
} from "../extensions/permission/index.ts"

const noOverrides = new Map<string, Mode>()

function metadata(serverName: string, serverToolName: string, readOnlyHint?: boolean): McpToolMetadata {
    return {
        serverName,
        serverToolName,
        ...(readOnlyHint === undefined ? {} : { annotations: { readOnlyHint } }),
    }
}

function resolveMcp(
    settings: PermissionSettings,
    tool: McpToolMetadata,
    sessionOverrides: ReadonlyMap<string, Mode> = noOverrides,
): Promise<Mode> {
    const toolName = getMcpToolName(tool.serverName, tool.serverToolName)
    return resolveMode(settings, toolName, "", undefined, sessionOverrides, analyzeBash, tool)
}

function createEventBusHarness() {
    const listeners = new Map<string, Set<(data: unknown) => void>>()
    const bus = {
        emit(channel: string, data: unknown) {
            for (const listener of listeners.get(channel) ?? []) listener(data)
        },
        on(channel: string, listener: (data: unknown) => void) {
            const channelListeners = listeners.get(channel) ?? new Set()
            channelListeners.add(listener)
            listeners.set(channel, channelListeners)
            return () => channelListeners.delete(listener)
        },
    } as ExtensionAPI["events"]

    return { bus, listenerCount: (channel: string) => listeners.get(channel)?.size ?? 0 }
}

type ExtensionHandler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown

function createPermissionHarness(
    eventBus = createEventBusHarness(),
    commands: ReturnType<ExtensionAPI["getCommands"]> = [],
) {
    const handlers = new Map<string, ExtensionHandler[]>()
    const pi = {
        events: eventBus.bus,
        getCommands: () => commands,
        on(event: string, handler: ExtensionHandler) {
            handlers.set(event, [...(handlers.get(event) ?? []), handler])
        },
        registerCommand() {},
        registerShortcut() {},
    } as unknown as ExtensionAPI

    permissionExtension(pi)
    return {
        eventBus,
        handlers,
        handler: (event: string) => {
            const handler = handlers.get(event)?.at(-1)
            assert.ok(handler, `missing ${event} handler`)
            return handler
        },
    }
}

function createContext(cwd: string) {
    const notifications: Array<{ message: string; level: string }> = []
    const widgets = new Map<string, unknown>()
    let aborts = 0
    const ctx = {
        cwd,
        mode: "tui",
        hasUI: true,
        abort() {
            aborts++
        },
        ui: {
            notify(message: string, level: string) {
                notifications.push({ message, level })
            },
            setWidget(key: string, content: unknown) {
                if (content === undefined) widgets.delete(key)
                else widgets.set(key, content)
            },
        },
    } as unknown as ExtensionContext

    return { ctx, notifications, widgets, aborts: () => aborts }
}

function createProjectSettings(content: string) {
    const cwd = mkdtempSync(join(tmpdir(), "permission-mcp-"))
    mkdirSync(join(cwd, ".agents"))
    writeFileSync(join(cwd, ".agents", "permission.settings.json"), content)
    return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

async function suppressErrors(run: () => Promise<void>) {
    const original = console.error
    console.error = () => undefined
    try {
        await run()
    } finally {
        console.error = original
    }
}

describe("MCP permission rules", () => {
    const githubRead = metadata("github", "get_issue", true)

    it("matches exact and wildcard server/tool selectors", async () => {
        assert.equal(await resolveMcp({ defaultMode: "deny", allow: ["mcp(github, get_issue)"] }, githubRead), "allow")
        assert.equal(
            await resolveMcp(
                { defaultMode: "deny", allow: ["mcp(github, get_issue)"] },
                metadata("github-enterprise", "get_issue", true),
            ),
            "deny",
        )
        assert.equal(
            await resolveMcp(
                { defaultMode: "deny", allow: ["mcp(github, get_issue)"] },
                metadata("github", "list_issues", true),
            ),
            "deny",
        )
        assert.equal(await resolveMcp({ defaultMode: "deny", allow: ["mcp(github, *)"] }, githubRead), "allow")
        assert.equal(await resolveMcp({ defaultMode: "deny", allow: ["mcp(*, get_issue)"] }, githubRead), "allow")
    })

    it("matches only an explicitly true readOnly hint", async () => {
        const settings: PermissionSettings = { defaultMode: "deny", allow: ["mcp(*, hint: readOnly)"] }

        assert.equal(await resolveMcp(settings, githubRead), "allow")
        assert.equal(await resolveMcp(settings, metadata("github", "get_issue", false)), "deny")
        assert.equal(await resolveMcp(settings, metadata("github", "get_issue")), "deny")
        assert.equal(await resolveMcp(settings, metadata("github", "read_only_search")), "deny")
    })

    it("uses hint selectors in every policy list with normal precedence", async () => {
        assert.equal(
            await resolveMcp({ defaultMode: "allow", deny: ["mcp(github, hint: readOnly)"] }, githubRead),
            "deny",
        )
        assert.equal(await resolveMcp({ defaultMode: "deny", ask: ["mcp(github, hint: readOnly)"] }, githubRead), "ask")
        assert.equal(
            await resolveMcp(
                {
                    defaultMode: "deny",
                    allow: ["mcp(github, hint: readOnly)"],
                    ask: ["mcp(github, get_issue)"],
                },
                githubRead,
            ),
            "ask",
        )
        assert.equal(
            await resolveMcp(
                {
                    defaultMode: "allow",
                    allow: ["mcp(github, hint: readOnly)"],
                    deny: ["mcp(github, get_issue)"],
                },
                githubRead,
            ),
            "deny",
        )
    })

    it("keeps session overrides final", async () => {
        const toolName = getMcpToolName("github", "get_issue")

        assert.equal(
            await resolveMcp(
                { defaultMode: "deny", deny: ["mcp(github, hint: readOnly)"] },
                githubRead,
                new Map([[toolName, "allow"]]),
            ),
            "allow",
        )
        assert.equal(
            await resolveMcp(
                { defaultMode: "allow", allow: ["mcp(github, hint: readOnly)"] },
                githubRead,
                new Map([[toolName, "deny"]]),
            ),
            "deny",
        )
    })

    it("preserves universal star but excludes other generic patterns", async () => {
        assert.equal(await resolveMcp({ defaultMode: "deny", allow: ["*"] }, githubRead), "allow")
        assert.equal(await resolveMcp({ defaultMode: "deny", allow: ["mcp*"] }, githubRead), "deny")
        assert.equal(await resolveMcp({ defaultMode: "deny", allow: ["*github*"] }, githubRead), "deny")
    })

    it("rejects malformed, unknown, invalid-name, and legacy rules", () => {
        assert.doesNotThrow(() =>
            validatePermissionSettings({
                allow: ["mcp(github, hint: readOnly)"],
                ask: ["mcp(*, get_issue)"],
                deny: ["mcp(github, *)"],
            }),
        )
        assert.throws(
            () => validatePermissionSettings({ allow: ["mcp(github, hint: destructive)"] }),
            /Invalid permission rule in allow.*unknown MCP hint "destructive"/,
        )
        assert.throws(
            () => validatePermissionSettings({ ask: ["mcp(github)"] }),
            /Invalid permission rule in ask.*expected mcp\(server, selector\)/,
        )
        assert.throws(
            () => validatePermissionSettings({ deny: ["mcp(git hub, *)"] }),
            /Invalid permission rule in deny.*invalid MCP server name/,
        )
        assert.throws(
            () => validatePermissionSettings({ allow: ["mcp__github__*"] }),
            /Invalid permission rule in allow.*legacy mcp__/,
        )

        for (const list of ["allow", "ask", "deny"] as const) {
            for (const rule of [" mcp(github, *)", "mcp(github, *) "]) {
                assert.throws(
                    () => validatePermissionSettings({ [list]: [rule] }),
                    new RegExp(`Invalid permission rule in ${list}.*leading or trailing whitespace`),
                )
            }
            assert.throws(
                () => validatePermissionSettings({ [list]: [" mcp__github__*"] }),
                new RegExp(`Invalid permission rule in ${list}.*legacy mcp__`),
            )
        }
    })
})

describe("MCP permission lifecycle", () => {
    it("replaces annotation metadata and disposes listeners across reload", async () => {
        const project = createProjectSettings(
            JSON.stringify({ defaultMode: "deny", allow: ["mcp(github, hint: readOnly)"] }),
        )
        const eventBus = createEventBusHarness()

        try {
            const first = createPermissionHarness(eventBus)
            assert.equal(eventBus.listenerCount(MCP_TOOL_CATALOG_EVENT), 1)
            const context = createContext(project.cwd)
            const toolName = getMcpToolName("github", "get_issue")
            const call = { toolName, toolCallId: "call-1", input: {} }

            eventBus.bus.emit(MCP_TOOL_CATALOG_EVENT, new Map([[toolName, metadata("github", "get_issue", true)]]))
            assert.equal(await first.handler("tool_call")(call, context.ctx), undefined)

            eventBus.bus.emit(MCP_TOOL_CATALOG_EVENT, new Map())
            const blocked = (await first.handler("tool_call")({ ...call, toolCallId: "call-2" }, context.ctx)) as {
                block: boolean
            }
            assert.equal(blocked.block, true)

            await first.handler("session_shutdown")({}, context.ctx)
            assert.equal(eventBus.listenerCount(MCP_TOOL_CATALOG_EVENT), 0)

            const reloaded = createPermissionHarness(eventBus)
            assert.equal(eventBus.listenerCount(MCP_TOOL_CATALOG_EVENT), 1)
            await reloaded.handler("session_shutdown")({}, context.ctx)
            assert.equal(eventBus.listenerCount(MCP_TOOL_CATALOG_EVENT), 0)
        } finally {
            project.cleanup()
        }
    })

    it("reports invalid configured rules while keeping the gate fail-closed", async () => {
        await suppressErrors(async () => {
            const project = createProjectSettings(JSON.stringify({ allow: ["mcp__github__*"] }))
            try {
                const harness = createPermissionHarness()
                const context = createContext(project.cwd)

                await harness.handler("session_start")({ reason: "reload" }, context.ctx)
                assert.match(context.notifications[0].message, /Invalid permission rule in allow.*legacy mcp__/)
                assert.deepEqual(context.widgets.get("permission:invalid-settings"), [
                    "Permission settings are invalid. Agent prompts and tools are blocked.",
                    context.notifications[0].message,
                    "Fix the settings, then retry your prompt.",
                ])
                assert.deepEqual(await harness.handler("input")({ text: "continue working" }, context.ctx), {
                    action: "handled",
                })

                const blocked = (await harness.handler("tool_call")(
                    { toolName: "read", toolCallId: "call-1", input: { path: "README.md" } },
                    context.ctx,
                )) as { block: boolean; reason: string }
                assert.equal(blocked.block, true)
                assert.match(blocked.reason, /Invalid permission settings/)
                assert.equal(context.aborts(), 1)

                writeFileSync(
                    join(project.cwd, ".agents", "permission.settings.json"),
                    JSON.stringify({ defaultMode: "allow" }),
                )
                assert.deepEqual(await harness.handler("input")({ text: "continue working" }, context.ctx), {
                    action: "continue",
                })
                assert.equal(context.widgets.has("permission:invalid-settings"), false)
            } finally {
                project.cleanup()
            }
        })
    })

    it("validates skill-derived MCP rules through the same fail-closed boundary", async () => {
        await suppressErrors(async () => {
            const project = createProjectSettings(JSON.stringify({ defaultMode: "allow" }))
            const skillPath = join(project.cwd, ".agents", "legacy-skill.md")
            writeFileSync(
                skillPath,
                "---\nname: legacy\ndescription: legacy\nallowed-tools:\n  - mcp__github__get_issue\n---\n",
            )
            const commands = [
                {
                    name: "skill:legacy",
                    source: "skill" as const,
                    sourceInfo: {
                        path: skillPath,
                        source: "skill",
                        scope: "project" as const,
                        origin: "top-level" as const,
                    },
                },
            ]

            try {
                const harness = createPermissionHarness(undefined, commands)
                const context = createContext(project.cwd)

                await harness.handler("session_start")({ reason: "startup" }, context.ctx)
                assert.match(context.notifications[0].message, /Invalid permission rule in allow.*legacy mcp__/)

                const blocked = (await harness.handler("tool_call")(
                    { toolName: "read", toolCallId: "call-1", input: { path: "README.md" } },
                    context.ctx,
                )) as { block: boolean }
                assert.equal(blocked.block, true)
            } finally {
                project.cleanup()
            }
        })
    })

    it("rejects MCP skill rules with leading or trailing whitespace", async () => {
        await suppressErrors(async () => {
            for (const rule of [" mcp(github, *)", "mcp(github, *) "]) {
                const project = createProjectSettings(JSON.stringify({ defaultMode: "allow" }))
                const skillPath = join(project.cwd, ".agents", "whitespace-skill.md")
                writeFileSync(
                    skillPath,
                    `---\nname: whitespace\ndescription: whitespace\nallowed-tools:\n  - ${JSON.stringify(rule)}\n---\n`,
                )
                const commands = [
                    {
                        name: "skill:whitespace",
                        source: "skill" as const,
                        sourceInfo: {
                            path: skillPath,
                            source: "skill",
                            scope: "project" as const,
                            origin: "top-level" as const,
                        },
                    },
                ]

                try {
                    const harness = createPermissionHarness(undefined, commands)
                    const context = createContext(project.cwd)

                    await harness.handler("session_start")({ reason: "startup" }, context.ctx)
                    assert.match(context.notifications[0].message, /leading or trailing whitespace/)
                    assert.deepEqual(await harness.handler("input")({ text: "continue working" }, context.ctx), {
                        action: "handled",
                    })
                } finally {
                    project.cleanup()
                }
            }
        })
    })

    it("reports malformed JSON on reload without dropping the gate", async () => {
        await suppressErrors(async () => {
            const project = createProjectSettings("{")
            try {
                const harness = createPermissionHarness()
                const context = createContext(project.cwd)

                await harness.handler("session_start")({ reason: "reload" }, context.ctx)
                assert.match(context.notifications[0].message, /Invalid JSON/)

                const blocked = (await harness.handler("tool_call")(
                    { toolName: "read", toolCallId: "call-1", input: { path: "README.md" } },
                    context.ctx,
                )) as { block: boolean }
                assert.equal(blocked.block, true)
            } finally {
                project.cleanup()
            }
        })
    })
})
