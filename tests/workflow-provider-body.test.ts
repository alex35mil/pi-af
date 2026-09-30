import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { renderProviderBody } from "../workflows/extensions/integrations/projection.ts"

describe("workflow provider body renderer", () => {
    it("removes the first root heading and its following blank line", () => {
        assert.equal(renderProviderBody("# Plan\n\n## Outcome\n\nKeep this.\n"), "## Outcome\n\nKeep this.\n")
        assert.equal(renderProviderBody("# Result\r\n\r\nDelivered.\r\n"), "Delivered.\r\n")
    })

    it("leaves content unchanged when it does not start with a root heading", () => {
        const source = "## Outcome\n\nKeep this exactly.\n"
        assert.equal(renderProviderBody(source), source)
    })

    it("removes only the root heading when no blank line follows it", () => {
        assert.equal(renderProviderBody("# Plan\nImmediate text\n"), "Immediate text\n")
    })

    it("appends a same-repository GitHub closing reference to pull-request content", () => {
        assert.equal(
            renderProviderBody("# Result\n\nDelivered.\n", { githubIssueNumber: 21 }),
            "Delivered.\n\n---\nCloses #21.",
        )
        assert.equal(renderProviderBody("# Result\n", { githubIssueNumber: 21 }), "Closes #21.")
    })
})
