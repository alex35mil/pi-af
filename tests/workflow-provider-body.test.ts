import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { renderProviderBody } from "../workflows/extensions/integrations/projection.ts"

const overview = "## Overview\n\nMake entries easy to scan.\n\n### Plan highlights\n\n- Preserve all details."
const details =
    "## Behavior\n\nKeep `src/example.ts`, **formatting**, and tables.\n\n| Case | Outcome |\n| --- | --- |\n| Read | Complete |"
const source = `# Plan\n\n${overview}\n\n${details}\n`
const github = `${overview}\n\n<details>\n<summary>Full plan</summary>\n\n${details}\n\n</details>`

describe("workflow provider body renderer", () => {
    it("keeps the reviewed overview visible and folds the complete GitHub tracker details", () => {
        assert.equal(renderProviderBody(source, { kind: "github-tracker" }), github)
        assert.ok(!github.includes("<details open>"))
    })

    it("uses native Linear collapsed Markdown without changing the content", () => {
        assert.equal(
            renderProviderBody(source, { kind: "linear-tracker" }),
            `${overview}\n\n+++ Full plan\n\n${details}\n\n+++`,
        )
    })

    it("folds all PR support, including verification and unrun checks", () => {
        const summary = "## Overview\n\nDelivered the concise layout. Live UI rendering is unverified."
        const support =
            "## Implementation\n\nOne shared renderer.\n\n## Verification\n\n- `npm test` — passed.\n\n**Not run:**\n\n- Live Linear rendering — no approved test entry."
        const result = `# Result\n\n${summary}\n\n${support}\n`
        assert.equal(
            renderProviderBody(result, { kind: "github-pull-request" }),
            `${summary}\n\n<details>\n<summary>Supporting details</summary>\n\n${support}\n\n</details>`,
        )
    })

    it("places the eligible closing reference after the closed PR fold", () => {
        const expected = github.replace("Full plan", "Supporting details")
        assert.equal(
            renderProviderBody(source, { kind: "github-pull-request", githubIssueNumber: 21 }),
            `${expected}\n\n---\n\nCloses #21`,
        )
        assert.equal(renderProviderBody(source, { kind: "github-pull-request" }), expected)
    })

    it("accepts approved sanitized sources without a root title and removes only a leading H1", () => {
        assert.equal(renderProviderBody(source.slice("# Plan\n\n".length), { kind: "github-tracker" }), github)
        assert.equal(renderProviderBody(source.replace("# Plan\n\n", "# Plan\n"), { kind: "github-tracker" }), github)
    })

    it("preserves CRLF content and uses matching wrapper separation", () => {
        assert.equal(
            renderProviderBody(source.replaceAll("\n", "\r\n"), { kind: "github-tracker" }),
            github.replaceAll("\n", "\r\n"),
        )
    })

    it("does not split headings inside backtick or tilde fenced examples", () => {
        for (const marker of ["```", "~~~~"]) {
            const visible = `## Overview\n\nA configuration example:\n\n${marker}markdown\n## Not a boundary\n\n<details>\n<summary>Example</summary>\n+++ Full plan\n${marker}\n\n### Highlights\n\n- Keep examples intact.`
            const support = `## Evidence\n\n${marker}markdown\n## Nested sample\n\nKeep this too.\n${marker}\n\n- A real list.`
            assert.equal(
                renderProviderBody(`# Report\n\n${visible}\n\n${support}\n`, { kind: "github-tracker" }),
                `${visible}\n\n<details>\n<summary>Full plan</summary>\n\n${support}\n\n</details>`,
            )
        }
    })

    it("honors fence marker type, length, indentation, and trailing content", () => {
        const visible =
            "## Overview\n\nA nested fence example:\n\n   ````markdown\n```\n~~~~\n```` not a closer\n## Still inside\n   `````\n\nDone."
        assert.equal(
            renderProviderBody(`${visible}\n\n${details}`, { kind: "github-tracker" }),
            `${visible}\n\n<details>\n<summary>Full plan</summary>\n\n${details}\n\n</details>`,
        )
    })

    it("preserves retained whitespace and normalizes only section separation", () => {
        const visible = "## Overview\n\nKeep this hard break.  "
        const support = "## Evidence\n\nKeep this indentation and trailing spaces.  "
        assert.equal(
            renderProviderBody(`${visible}\n\n\n${support}\n\n`, { kind: "linear-tracker" }),
            `${visible}\n\n+++ Full plan\n\n${support}\n\n+++`,
        )
    })

    it("rejects sources without a nonempty overview and nonempty supporting sections", () => {
        for (const invalid of [
            "",
            "# Plan\n\n## Outcome\n\nDetails.",
            "## Overview\n\nOnly an overview.",
            "## Overview\n\n## Details\n\nSupport.",
            "## Overview\n\nSummary.\n\n## Details\n",
            "## Overview\n\nSummary.\n\n## Empty\n\n## Details\n\nSupport.",
            "## Overview\n\nSummary.\n\n## Details\n\n```\nUnclosed.",
        ])
            assert.throws(
                () => renderProviderBody(invalid, { kind: "github-tracker" }),
                /requires a nonempty ## Overview/,
            )
    })
})
