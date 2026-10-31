import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"

import { getCurrentSystemMessage, getSystemMessageText } from "@earendil-works/pi-ai"
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent"
import registerPermission from "../extensions/permissions/index.ts"
import registerRules from "../extensions/rules/index.ts"
import registerIntegrations from "../workflows/extensions/integrations/index.ts"
import { WORKFLOW_CONTEXT } from "../workflows/extensions/integrations/workflow-context.ts"
import { answer, call, failure, nativeSessionFixture, requestText } from "./native-session-fixture.ts"

const body = "Scoped fixture rule: name the contract before replacing its implementation."
const untouched = "This unrelated scoped rule must stay out of initial context."
function setup(root: string) {
    fs.mkdirSync(path.join(root, ".agents/rules"), { recursive: true })
    fs.writeFileSync(path.join(root, ".agents/permissions.json"), JSON.stringify({ defaultMode: "allow" }))
    fs.writeFileSync(path.join(root, ".agents/rules/always.md"), "Always-on fixture instruction.")
    scope(root, body)
    fs.writeFileSync(path.join(root, ".agents/rules/untouched.md"), `---\npaths: ["unrelated/**"]\n---\n${untouched}\n`)
    for (const file of ["target.txt", "other.txt"]) fs.writeFileSync(path.join(root, file), "before")
}
function scope(root: string, text: string) {
    fs.writeFileSync(path.join(root, ".agents/rules/scoped.md"), `---\npaths: ["*.txt"]\n---\n${text}\n`)
}
const read = () => call({ name: "read", arguments: { path: "target.txt" } })
const write = () => call({ name: "write", arguments: { path: "target.txt", content: "after" } })
const extensions = [registerPermission, registerRules]
function toolResults(events: AgentSessionEvent[], name: string) {
    return events.filter((event) => event.type === "tool_execution_end").filter((event) => event.toolName === name)
}

describe("native rules model delivery", () => {
    it("keeps rules lazy and blocks an edit in the same pre-authored batch", async () => {
        const h = await nativeSessionFixture({ extensions, setup, tools: ["read", "write", "edit"] })
        try {
            h.respond(
                (context) => {
                    assert.match(requestText(context), /Always-on fixture instruction/)
                    assert.ok(!requestText(context).includes(body))
                    assert.ok(!requestText(context).includes(untouched))
                    return call(
                        { name: "read", arguments: { path: "target.txt" } },
                        { name: "write", arguments: { path: "target.txt", content: "premature" } },
                    )
                },
                (context) => {
                    assert.equal(fs.readFileSync(path.join(h.root, "target.txt"), "utf8"), "before")
                    assert.ok(requestText(context).includes(body))
                    return write()
                },
                answer("Done"),
            )
            await h.prompt("Read the target, then apply the change.")
            assert.equal(fs.readFileSync(path.join(h.root, "target.txt"), "utf8"), "after")
            const writes = toolResults(h.events, "write")
            assert.equal(writes.length, 2)
            assert.equal(writes[0].isError, true)
            assert.equal(writes[1].isError, false)
            assert.equal(h.requests.length, 3)
        } finally {
            await h.cleanup()
        }
    })

    for (const configured of [true, false])
        it(`sends rules ${configured ? "and" : "without"} the workflows section in the provider prompt`, async () => {
            const h = await nativeSessionFixture({
                extensions: [...extensions, registerIntegrations],
                setup(root) {
                    setup(root)
                    if (configured) {
                        fs.mkdirSync(path.join(root, ".project"), { recursive: true })
                        fs.writeFileSync(path.join(root, ".project/integrations.json"), "{}")
                    }
                },
                tools: ["read", "codemode"],
            })
            try {
                h.respond((context) => {
                    const system = getCurrentSystemMessage(context.messages)
                    assert.ok(system, "the request has a system message")
                    const text = getSystemMessageText(system)
                    // The rules sit in their own section; pi's built-in `rules` section stays.
                    assert.match(
                        text,
                        /<project_rules>\n[\s\S]*Always-on fixture instruction\.[\s\S]*\n<\/project_rules>/,
                    )
                    assert.match(text, /<rules>\n/)
                    if (configured) assert.ok(text.includes(`<workflows>\n${WORKFLOW_CONTEXT}\n</workflows>`))
                    else assert.doesNotMatch(text, /<workflows>/)
                    return answer("Done")
                })
                await h.prompt("What should I know?")
            } finally {
                await h.cleanup()
            }
        })

    it("returns discarded nested rules to the model and retains them for later requests and known scopes", async () => {
        const h = await nativeSessionFixture({ extensions, setup })
        try {
            h.respond(
                call({
                    name: "codemode",
                    arguments: {
                        code: 'await tools.read({path:"target.txt"}); try { await tools.write({path:"target.txt",content:"premature"}); } catch (_) {} text("discarded read");',
                    },
                }),
                (context) => {
                    assert.equal(fs.readFileSync(path.join(h.root, "target.txt"), "utf8"), "before")
                    assert.ok(
                        requestText(context).includes(body),
                        JSON.stringify(context.messages.filter((message) => message.role === "toolResult")),
                    )
                    return call({
                        name: "codemode",
                        arguments: { code: 'await tools.write({path:"other.txt",content:"after"}); text("done");' },
                    })
                },
                (context) => {
                    assert.ok(
                        requestText(context).includes(body),
                        "Nested rules must persist, not disappear after one request",
                    )
                    return answer("Done")
                },
            )
            await h.prompt("Read in a script and continue only after receiving its rules.")
            assert.equal(fs.readFileSync(path.join(h.root, "target.txt"), "utf8"), "before")
            assert.equal(fs.readFileSync(path.join(h.root, "other.txt"), "utf8"), "after")
            assert.equal(h.requests.length, 3)
            const nestedWrites = toolResults(h.events, "write")
            assert.deepEqual(
                nestedWrites.map((event) => event.isError),
                [true, false],
            )
            assert.equal(
                h.manager
                    .getBranch()
                    .filter((entry) => entry.type === "custom_message" && entry.customType === "rules-delivery").length,
                1,
            )
        } finally {
            await h.cleanup()
        }
    })

    it("does not persist visibility after a failed model response", async () => {
        const h = await nativeSessionFixture({ extensions, setup, tools: ["read", "write", "edit"] })
        try {
            h.respond(read(), (context) => {
                assert.ok(requestText(context).includes(body))
                return failure("Fixture provider request failed")
            })
            await h.prompt("Read the target")
            assert.equal(
                h.manager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === "rules-state")
                    .length,
                0,
            )
            await h.reopen()
            h.respond(write(), answer("Done"))
            await h.prompt("Continue after the failed request")
            assert.equal(fs.readFileSync(path.join(h.root, "target.txt"), "utf8"), "after")
        } finally {
            await h.cleanup()
        }
    })

    it("delivers the complete rule after reading only the first line of its own file", async () => {
        const h = await nativeSessionFixture({ extensions, setup, tools: ["read", "write", "edit"] })
        try {
            h.respond(
                call({ name: "read", arguments: { path: ".agents/rules/scoped.md", limit: 1 } }),
                (context) => {
                    assert.ok(requestText(context).includes(body))
                    return write()
                },
                answer("Done"),
            )
            await h.prompt("Read the rule header, then apply the change")
            assert.equal(fs.readFileSync(path.join(h.root, "target.txt"), "utf8"), "after")
        } finally {
            await h.cleanup()
        }
    })

    it("keeps visibility on its branch across tree navigation and a fresh session runtime", async () => {
        const h = await nativeSessionFixture({ extensions, setup, tools: ["read", "write", "edit"] })
        try {
            const beforeRead = h.manager.getLeafId()
            assert.ok(beforeRead)
            h.respond(read(), answer("Rules received"))
            await h.prompt("Read the target")
            const visibleBranch = h.manager.getLeafId()
            assert.ok(visibleBranch)
            assert.equal((await h.session.navigateTree(beforeRead, { summarize: false })).cancelled, false)
            h.respond(write(), answer("Read rules before editing"))
            await h.prompt("Attempt the edit on the earlier branch")
            assert.equal(fs.readFileSync(path.join(h.root, "target.txt"), "utf8"), "before")
            assert.equal((await h.session.navigateTree(visibleBranch, { summarize: false })).cancelled, false)
            await h.reopen()
            h.respond((context) => {
                assert.ok(requestText(context).includes(body))
                return write()
            }, answer("Done"))
            await h.prompt("Continue the branch that received its rules")
            assert.equal(fs.readFileSync(path.join(h.root, "target.txt"), "utf8"), "after")
            assert.deepEqual(
                toolResults(h.events, "write").map((event) => event.isError),
                [true, false],
            )
            assert.equal(toolResults(h.events, "read").length, 1)
        } finally {
            await h.cleanup()
        }
    })

    it("clears visibility on native compaction even when old rule text is retained", async () => {
        const h = await nativeSessionFixture({
            extensions: [
                ...extensions,
                (pi) => {
                    pi.on("session_before_compact", (event) => {
                        const kept = event.branchEntries.find(
                            (entry) =>
                                entry.type === "message" &&
                                entry.message.role === "assistant" &&
                                entry.message.content.some((part) => part.type === "toolCall"),
                        )
                        assert.ok(kept)
                        return {
                            compaction: {
                                summary: "Fixture compaction summary",
                                firstKeptEntryId: kept.id,
                                tokensBefore: event.preparation.tokensBefore,
                            },
                        }
                    })
                },
            ],
            setup,
            tools: ["read", "write", "edit"],
        })
        try {
            h.respond(read(), answer("Rules received"))
            await h.prompt("Read the target")
            h.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } })
            await h.session.compact()
            h.respond(
                (context) => {
                    assert.ok(requestText(context).includes(body), "The native retained tail includes the old reminder")
                    return write()
                },
                read(),
                write(),
                answer("Done"),
            )
            await h.prompt("Edit only after fresh rule delivery")
            assert.deepEqual(
                toolResults(h.events, "write").map((event) => event.isError),
                [true, false],
            )
            const reads = toolResults(h.events, "read")
            assert.equal(reads.length, 2)
            assert.ok(JSON.stringify(reads[1].result).includes(body))
        } finally {
            await h.cleanup()
        }
    })

    it("requires delivery of changed rule contents before another edit", async () => {
        const h = await nativeSessionFixture({ extensions, setup, tools: ["read", "write", "edit"] })
        try {
            h.respond(read(), answer("Rules received"))
            await h.prompt("Read the target")
            const changed = "Changed fixture contract: use the newly delivered instruction."
            scope(h.root, changed)
            h.respond(
                write(),
                read(),
                (context) => {
                    assert.equal(fs.readFileSync(path.join(h.root, "target.txt"), "utf8"), "before")
                    assert.ok(requestText(context).includes(changed))
                    return write()
                },
                answer("Done"),
            )
            await h.prompt("Apply the change under current rules")
            const writes = toolResults(h.events, "write")
            assert.deepEqual(
                writes.map((event) => event.isError),
                [true, false],
            )
        } finally {
            await h.cleanup()
        }
    })
})

for (const result of ["Accepted", "AcceptModified", "Rejected"] as const) {
    it(`continues the actual native session after ${result} codemode review notes`, async () => {
        const note = "Explain the complete naming choice before more work.\nDo not omit this second line."
        const quoted = note
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")
        const content = result === "Rejected" ? "before" : result === "AcceptModified" ? "user modified" : "after"
        let prompts = 0
        const h = await nativeSessionFixture({
            extensions: [registerPermission],
            setup(root) {
                fs.mkdirSync(path.join(root, ".agents"))
                fs.writeFileSync(
                    path.join(root, ".agents/permissions.json"),
                    JSON.stringify({ defaultMode: "ask", allow: ["codemode"] }),
                )
                fs.writeFileSync(path.join(root, "target.txt"), "before")
            },
            async review(root) {
                prompts++
                if (result !== "Rejected") fs.writeFileSync(path.join(root, "target.txt"), content)
                return JSON.stringify({
                    result,
                    content,
                    notes: [{ path: "target.txt", side: "proposed", lineStart: 1, lineEnd: 1, lines: ["after"], note }],
                })
            },
        })
        try {
            h.respond(
                call({
                    name: "codemode",
                    arguments: {
                        code: 'await tools.edit({path:"target.txt",edits:[{oldText:"before",newText:"after"}]}); await tools.write({path:"later.txt",content:"must not run"});',
                    },
                }),
                (context) => {
                    assert.ok(requestText(context).includes(note))
                    assert.equal(fs.existsSync(path.join(h.root, "later.txt")), false)
                    return answer(`${quoted}\n\nI will explain the naming choice before further tools.`)
                },
            )
            await h.prompt("Apply the reviewed edit and address every note")
            assert.equal(prompts, 1)
            assert.equal(h.requests.length, 2)
            assert.equal(fs.readFileSync(path.join(h.root, "target.txt"), "utf8"), content)
            assert.equal(fs.existsSync(path.join(h.root, "later.txt")), false)
            assert.ok(h.session.getLastAssistantText()?.includes(quoted))
            assert.equal(toolResults(h.events, "edit")[0].isError, result === "Rejected")
        } finally {
            await h.cleanup()
        }
    })
}
