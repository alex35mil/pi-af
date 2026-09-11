import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveMode, type Mode, type PermissionSettings } from "../extensions/permission/index.ts"

const noOverrides = new Map<string, Mode>()

function resolve(
    settings: PermissionSettings,
    command: string,
    sessionOverrides: ReadonlyMap<string, Mode> = noOverrides,
): Promise<Mode> {
    return resolveMode(settings, "bash", command, undefined, sessionOverrides)
}

describe("built-in bash allow rules", () => {
    const rgSettings: PermissionSettings = {
        defaultMode: "ask",
        allow: ["bash(rg *)"],
    }

    it("allows status-only commands after an allowed search", async () => {
        const originalCommand =
            "rg -n '\\.tmp|PARTIAL_ARTIFACT|publish_no_clobber|hard_link|sync_all|tempfile::Builder' clients/cli/src/project integrations/obsidian/src/project specs/tests/cli/project-init.spec.ts specs/tests/obsidian/project-config.spec.ts || true"

        assert.equal(await resolve(rgSettings, originalCommand), "allow")
        assert.equal(await resolve(rgSettings, "rg -n needle src || false"), "allow")
    })

    it("allows only literal true and false with ASCII shell padding", async () => {
        assert.equal(await resolve({ defaultMode: "deny" }, "true"), "allow")
        assert.equal(await resolve({ defaultMode: "deny" }, " \tfalse\t "), "allow")
    })

    it("preserves non-shell whitespace while normalizing cwd prefixes", async () => {
        const settings: PermissionSettings = { defaultMode: "ask" }
        const cwd = process.cwd()

        assert.equal(await resolveMode(settings, "bash", "cd . && true", cwd, noOverrides), "allow")
        assert.equal(await resolveMode(settings, "bash", "cd . && \tfalse\t ", cwd, noOverrides), "allow")
        assert.equal(await resolveMode(settings, "bash", `cd . && true\u00a0`, cwd, noOverrides), "ask")
        assert.equal(await resolveMode(settings, "bash", "cd . && true\r", cwd, noOverrides), "ask")
    })

    it("does not allow non-literal forms", async () => {
        const commands = [
            "true arg",
            "false --help",
            "true $(cmd)",
            "X=value true",
            "command true",
            "builtin true",
            "'true'",
            "tr\\ue",
            `true\u00a0`,
            "true\r",
        ]

        for (const command of commands) {
            assert.equal(await resolve({ defaultMode: "ask" }, command), "ask", command)
        }
    })

    it("finds literal commands inside compound syntax", async () => {
        assert.equal(await resolve({ defaultMode: "deny" }, "(true)"), "allow")
        assert.equal(await resolve({ defaultMode: "deny" }, "{ true; }"), "allow")
    })

    it("preserves policy precedence", async () => {
        assert.equal(await resolve({ defaultMode: "ask", deny: ["bash(true)"] }, "true"), "deny")
        assert.equal(await resolve({ defaultMode: "deny", ask: ["bash(false)"] }, "false"), "ask")
        assert.equal(await resolve({ defaultMode: "deny", allow: ["bash(rg *)"] }, "rg needle"), "allow")
        assert.equal(await resolve({ defaultMode: "deny" }, "true", new Map([["bash", "ask"]])), "ask")
        assert.equal(
            await resolve({ defaultMode: "deny", deny: ["bash(rm *)"] }, "rm file", new Map([["bash", "allow"]])),
            "allow",
        )
    })

    it("uses the strictest command mode", async () => {
        assert.equal(await resolve({ ...rgSettings, ask: ["bash(true)"] }, "rg needle || true"), "ask")
        assert.equal(await resolve({ ...rgSettings, deny: ["bash(false)"] }, "rg needle || false"), "deny")
    })
})
