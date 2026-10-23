import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { it } from "node:test"

import registerPermission from "../extensions/permissions/index.ts"
import { isFileReviewDetails } from "../extensions/permissions/review.ts"
import { answer, call, nativeSessionFixture, requestText } from "./native-session-fixture.ts"

it("keeps a completed parallel edit when a different in-flight review returns notes", async () => {
    const note = "Explain both reviewed changes before more work."
    let completeSecond!: () => void
    const secondFinished = new Promise<void>((resolve) => {
        completeSecond = resolve
    })
    let prompts = 0
    const h = await nativeSessionFixture({
        extensions: [registerPermission],
        setup(root) {
            fs.mkdirSync(path.join(root, ".agents"))
            fs.writeFileSync(
                path.join(root, ".agents/permissions.json"),
                JSON.stringify({ defaultMode: "ask", allow: ["codemode"] }),
            )
            for (const file of ["first.txt", "second.txt"]) fs.writeFileSync(path.join(root, file), "before")
        },
        async review(root, title) {
            prompts++
            const file = path.basename(JSON.parse(title).toolInput.path)
            assert.ok(file === "first.txt" || file === "second.txt")
            if (file === "first.txt") await secondFinished
            fs.writeFileSync(path.join(root, file), file === "first.txt" ? "after-first" : "after-second")
            return JSON.stringify({
                result: "Accepted",
                notes:
                    file === "first.txt"
                        ? [
                              {
                                  path: file,
                                  side: "proposed",
                                  lineStart: 1,
                                  lineEnd: 1,
                                  lines: ["after-first"],
                                  note,
                              },
                          ]
                        : [],
            })
        },
    })
    const unsubscribe = h.session.subscribe((event) => {
        if (
            event.type !== "tool_execution_end" ||
            event.toolName !== "edit" ||
            !isFileReviewDetails(event.result.details)
        )
            return
        if (path.basename(event.result.details.review.path) === "second.txt") completeSecond()
    })
    try {
        h.respond(
            call({
                name: "codemode",
                arguments: {
                    code: 'await Promise.allSettled([tools.edit({path:"first.txt",edits:[{oldText:"before",newText:"after-first"}]}), tools.edit({path:"second.txt",edits:[{oldText:"before",newText:"after-second"}]})]); await tools.write({path:"later.txt",content:"must not run"});',
                },
            }),
            (context) => {
                assert.ok(requestText(context).includes(note))
                assert.equal(fs.readFileSync(path.join(h.root, "first.txt"), "utf8"), "after-first")
                assert.equal(fs.readFileSync(path.join(h.root, "second.txt"), "utf8"), "after-second")
                assert.equal(fs.existsSync(path.join(h.root, "later.txt")), false)
                return answer(
                    `> ${note}\n\nBoth completed changes remain applied; I will explain them before more work.`,
                )
            },
        )
        await h.prompt("Review both edits in parallel")
        assert.equal(prompts, 2)
        assert.equal(h.requests.length, 2)
        const edits = h.events
            .filter((event) => event.type === "tool_execution_end")
            .filter((event) => event.toolName === "edit")
        assert.equal(edits.length, 2)
        assert.deepEqual(
            edits.map((event) => event.isError),
            [false, false],
        )
    } finally {
        unsubscribe()
        await h.cleanup()
    }
})
