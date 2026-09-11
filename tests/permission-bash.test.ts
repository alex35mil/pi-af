import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { analyzeBash, type BashAnalyzer } from "../extensions/permission/bash.ts"
import { resolveMode, type Mode, type PermissionSettings } from "../extensions/permission/index.ts"

const noOverrides = new Map<string, Mode>()

function resolve(
    settings: PermissionSettings,
    command: string,
    cwd?: string,
    overrides: ReadonlyMap<string, Mode> = noOverrides,
    analyzer: BashAnalyzer = analyzeBash,
): Promise<Mode> {
    return resolveMode(settings, "bash", command, cwd, overrides, analyzer)
}

describe("Bash syntax analysis", () => {
    it("extracts commands across newlines, pipelines, and substitutions", async () => {
        const analysis = await analyzeBash("echo one\necho two | sed 's/two/three/'\nFOO=$(rm file)")

        assert.deepEqual(analysis, {
            commands: ["echo one", "echo two", "sed 's/two/three/'", "rm file"],
            writesFile: false,
        })
    })

    it("aggregates every syntax-visible command with strict precedence", async () => {
        const settings: PermissionSettings = {
            defaultMode: "deny",
            allow: ["bash(echo *)", "bash(cat *)"],
            ask: ["bash(npm *)"],
            deny: ["bash(rm *)"],
        }

        assert.equal(await resolve(settings, "echo one\nnpm test | cat file"), "ask")
        assert.equal(await resolve(settings, "echo one && npm test; rm file"), "deny")
        assert.equal(await resolve(settings, "if true; then echo ok; fi"), "allow")
        assert.equal(await resolve(settings, 'echo "$(rm file)"'), "deny")
    })

    it("keeps quoted operators together and matches multiline units", async () => {
        const settings: PermissionSettings = { defaultMode: "deny", allow: ["bash(echo *)"] }

        assert.equal(await resolve(settings, "echo 'a | b && c'"), "allow")
        assert.equal(await resolve(settings, 'echo "first\nsecond"'), "allow")
    })

    it("emits no outer unit for shell-state-only syntax but checks nested commands", async () => {
        const settings: PermissionSettings = { defaultMode: "deny", deny: ["bash(rm *)"] }

        assert.equal(await resolve(settings, "FOO=bar"), "allow")
        assert.equal(await resolve(settings, "export FOO=bar"), "allow")
        assert.equal(await resolve(settings, "FOO=$(rm file)"), "deny")
        assert.equal(await resolve(settings, "export FOO=$(rm file)"), "deny")
    })

    it("ignores only a same-directory leading cd", async () => {
        const cwd = process.cwd()
        const settings: PermissionSettings = { defaultMode: "deny", allow: ["bash(npm *)"] }

        assert.equal(await resolve(settings, "cd . && npm test", cwd), "allow")
        assert.equal(await resolve(settings, `cd '${cwd}' && npm test || false`, cwd), "allow")
        assert.equal(await resolve(settings, "cd .. && npm test", cwd), "deny")
        assert.equal(await resolve(settings, "true; cd . && npm test", cwd), "deny")
    })

    it("checks runtime indirection only as its outer invocation", async () => {
        const cases = [
            ["eval 'rm file'", "bash(eval *)"],
            ["bash -c 'rm file'", "bash(bash -c *)"],
            ["sh -c 'rm file'", "bash(sh -c *)"],
            ["source dangerous.sh", "bash(source *)"],
            ["dangerous_alias", "bash(dangerous_alias)"],
            ["dangerous_function", "bash(dangerous_function)"],
            ["$COMMAND file", "bash($COMMAND *)"],
        ] as const

        for (const [command, allow] of cases) {
            const settings: PermissionSettings = { defaultMode: "deny", allow: [allow], deny: ["bash(rm *)"] }
            assert.equal(await resolve(settings, command), "allow", command)
        }

        assert.equal(
            await resolve({ defaultMode: "deny", allow: ["bash(eval *)"], deny: ["bash(rm *)"] }, 'eval "$(rm file)"'),
            "deny",
        )
    })
})

describe("Bash redirections", () => {
    const settings: PermissionSettings = {
        defaultMode: "deny",
        allow: ["bash(echo *)", "bash(tee *)"],
    }

    it("escalates writable file redirects", async () => {
        const commands = [
            "echo hi > output",
            "echo hi >| output",
            "echo hi >> output",
            "echo hi &> output",
            "echo hi &>> output",
            "echo hi 2> output",
            "echo hi >&output",
            "if true; then echo hi > output; fi",
        ]

        for (const command of commands) {
            assert.equal(await resolve(settings, command), "ask", command)
        }
    })

    it("reconstructs commands around interspersed redirects", async () => {
        assert.deepEqual(await analyzeBash("rm < /dev/null -rf victim"), {
            commands: ["rm -rf victim"],
            writesFile: false,
        })
        assert.equal(
            await resolve({ defaultMode: "allow", deny: ["bash(rm -rf *)"] }, "rm < /dev/null -rf victim"),
            "deny",
        )
        assert.deepEqual(await analyzeBash("! rm < /dev/null -rf victim"), {
            commands: ["rm -rf victim"],
            writesFile: false,
        })
        assert.equal(
            await resolve({ defaultMode: "allow", deny: ["bash(rm -rf *)"] }, "! rm < /dev/null -rf victim"),
            "deny",
        )

        assert.deepEqual(await analyzeBash("echo >/dev/null hi"), {
            commands: ["echo hi"],
            writesFile: false,
        })
        assert.equal(await resolve({ defaultMode: "deny", allow: ["bash(echo hi)"] }, "echo >/dev/null hi"), "allow")

        assert.deepEqual(await analyzeBash("echo one 2>err two >out three"), {
            commands: ["echo one two three"],
            writesFile: true,
        })
        assert.deepEqual(await analyzeBash(">output echo hi"), {
            commands: ["echo hi"],
            writesFile: true,
        })
        assert.equal(await resolve({ defaultMode: "deny", allow: ["bash(echo hi)"] }, ">/dev/null echo hi"), "allow")
    })

    it("exempts exact dev-null destinations", async () => {
        const commands = [
            "echo hi > /dev/null",
            "echo hi >| /dev/null",
            "echo hi >> /dev/null",
            "echo hi &> /dev/null",
            "echo hi &>> /dev/null",
            "echo hi >&/dev/null",
            "echo hi 2> '/dev/null'",
            'echo hi > "/dev/null"',
        ]

        for (const command of commands) {
            assert.equal(await resolve(settings, command), "allow", command)
        }
        assert.equal(await resolve(settings, "echo hi > /dev/null.log"), "ask")
        assert.equal(await resolve(settings, "echo hi > /dev/null\r"), "ask")
    })

    it("exempts input redirects and fd duplication or closing", async () => {
        const commands = [
            "echo hi < input",
            "echo hi <<< text",
            "echo hi >&2",
            'echo hi >&"2"',
            'echo hi >&"-"',
            "echo hi 2>&1",
            "echo hi 2>&-",
            "echo hi 2>&word",
            "echo hi 2>&$FD",
            "echo hi <&3",
        ]

        for (const command of commands) {
            assert.equal(await resolve(settings, command), "allow", command)
        }
    })

    it("exempts process-substitution syntax but checks nested commands and redirects", async () => {
        assert.equal(await resolve(settings, "echo hi > >(tee log)"), "allow")
        assert.equal(await resolve({ ...settings, deny: ["bash(tee *)"] }, "echo hi > >(tee log)"), "deny")
        assert.equal(await resolve(settings, "echo hi > >(tee log > output)"), "ask")
        assert.equal(await resolve(settings, "echo '>'"), "allow")
    })
})

describe("Bash parser failures and session overrides", () => {
    it("denies error and missing trees, including unsupported redirect syntax", async () => {
        const settings: PermissionSettings = { defaultMode: "allow", allow: ["bash(*)"] }

        assert.equal(await resolve(settings, "echo '"), "deny")
        assert.equal(await resolve(settings, "echo $(true"), "deny")
        assert.equal(await resolve(settings, "echo hi <> output"), "deny")
        assert.equal(await resolve(settings, "FOO=bar > output"), "deny")
        await assert.rejects(analyzeBash("echo hi <> output"), /Malformed Bash command/)
    })

    it("denies the whole call when parser initialization or analysis fails", async () => {
        const failingAnalyzer: BashAnalyzer = async () => {
            throw new Error("WASM unavailable")
        }

        assert.equal(
            await resolve(
                { defaultMode: "ask", allow: ["bash(echo *)"], deny: ["bash(rm *)"] },
                "echo ok; rm file",
                undefined,
                noOverrides,
                failingAnalyzer,
            ),
            "deny",
        )
    })

    it("applies session overrides without invoking the parser", async () => {
        let calls = 0
        const analyzer: BashAnalyzer = async () => {
            calls++
            throw new Error("must not run")
        }
        const settings: PermissionSettings = { defaultMode: "deny" }

        assert.equal(
            await resolve(settings, "echo hi > output", undefined, new Map([["bash", "allow"]]), analyzer),
            "allow",
        )
        assert.equal(await resolve(settings, "echo hi", undefined, new Map([["bash", "ask"]]), analyzer), "ask")
        assert.equal(await resolve(settings, "echo hi", undefined, new Map([["bash", "deny"]]), analyzer), "deny")
        assert.equal(calls, 0)
    })
})
