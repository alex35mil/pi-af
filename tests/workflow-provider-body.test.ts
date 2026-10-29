import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { planSourceDiff, renderAnnouncement } from "../workflows/extensions/integrations/plan-announcement.ts"
import { unifiedDiff } from "../workflows/extensions/integrations/plan-diff.ts"
import { renderProviderBody } from "../workflows/extensions/integrations/projection.ts"

const overview = "## Overview\n\nMake entries easy to scan.\n\n### Plan highlights\n\n- Preserve all details."
const details =
    "## Behavior\n\nKeep `src/example.ts`, **formatting**, and tables.\n\n| Case | Outcome |\n| --- | --- |\n| Read | Complete |"
const source = `# Plan\n\n${overview}\n\n${details}\n`
const githubOverview = "# Plan\n\nMake entries easy to scan.\n\n## Highlights\n\n- Preserve all details."
const github = `${githubOverview}\n\n<details>\n<summary>Full plan</summary>\n\n${details}\n\n</details>`

describe("workflow provider body renderer", () => {
    it("titles GitHub plans and highlights while folding the complete supporting details", () => {
        assert.equal(renderProviderBody(source, { kind: "github-plan-comment" }), github)
        assert.ok(!github.includes("<details open>"))
    })

    it("uses native Linear collapsed Markdown without changing the content", () => {
        assert.equal(
            renderProviderBody(source, { kind: "linear-plan-document" }),
            `${githubOverview.slice("# Plan\n\n".length)}\n\n+++ Full plan\n\n${details}\n\n+++`,
        )
    })

    it("separates the PR overview from one fold per section, keeping Not run inside Verification", () => {
        const summary = "## Overview\n\nDelivered the concise layout. Live UI rendering is unverified."
        const support =
            "## Implementation\n\nOne shared renderer.\n\n## Verification\n\n- `npm test` — passed.\n\n**Not run:**\n\n- Live Linear rendering — no approved test entry."
        const result = `# Result\n\n${summary}\n\n${support}\n`
        assert.equal(
            renderProviderBody(result, { kind: "github-pull-request" }),
            `${summary}\n\n<hr />\n\n<details>\n<summary>Implementation</summary>\n\nOne shared renderer.\n\n</details>\n\n<details>\n<summary>Verification</summary>\n\n- \`npm test\` — passed.\n\n**Not run:**\n\n- Live Linear rendering — no approved test entry.\n\n</details>`,
        )
    })

    it("places the eligible closing reference after the closed PR fold", () => {
        const expected = `${overview}\n\n<hr />\n\n<details>\n<summary>Behavior</summary>\n\n${details.slice("## Behavior\n\n".length)}\n\n</details>`
        assert.equal(
            renderProviderBody(source, { kind: "github-pull-request", githubIssueNumber: 21 }),
            `${expected}\n\n---\n\nCloses #21`,
        )
        assert.equal(renderProviderBody(source, { kind: "github-pull-request" }), expected)
    })

    it("keeps nested subsections and fenced headings inside their owning PR section", () => {
        const content = "Evidence.\n\n### Nested details\n\n```markdown\n## Example, not a section\n```"
        assert.equal(
            renderProviderBody(
                `## Overview\n\nConclusion.\n\n## Findings\n\n${content}\n\n## Verification\n\nChecked.\n`,
                { kind: "github-pull-request" },
            ),
            `## Overview\n\nConclusion.\n\n<hr />\n\n<details>\n<summary>Findings</summary>\n\n${content}\n\n</details>\n\n<details>\n<summary>Verification</summary>\n\nChecked.\n\n</details>`,
        )
    })

    it("uses technical section headings as literal HTML-safe summary labels", () => {
        assert.equal(
            renderProviderBody('## Overview\n\nSummary.\n\n## API <T> & "options"\n\nKeep the body.\n', {
                kind: "github-pull-request",
            }),
            "## Overview\n\nSummary.\n\n<hr />\n\n<details>\n<summary>API &lt;T&gt; &amp; &quot;options&quot;</summary>\n\nKeep the body.\n\n</details>",
        )
    })

    it("preserves CRLF in per-section PR folds and the divider", () => {
        const input = "## Overview\r\n\r\nSummary.\r\n\r\n## Verification\r\n\r\nPassed.\r\n"
        assert.equal(
            renderProviderBody(input, { kind: "github-pull-request" }),
            "## Overview\r\n\r\nSummary.\r\n\r\n<hr />\r\n\r\n<details>\r\n<summary>Verification</summary>\r\n\r\nPassed.\r\n\r\n</details>",
        )
    })

    it("accepts approved sanitized sources without a root title and removes only a leading H1", () => {
        assert.equal(renderProviderBody(source.slice("# Plan\n\n".length), { kind: "github-plan-comment" }), github)
        assert.equal(
            renderProviderBody(source.replace("# Plan\n\n", "# Plan\n"), { kind: "github-plan-comment" }),
            github,
        )
    })

    it("preserves CRLF content and uses matching wrapper separation", () => {
        assert.equal(
            renderProviderBody(source.replaceAll("\n", "\r\n"), { kind: "github-plan-comment" }),
            github.replaceAll("\n", "\r\n"),
        )
    })

    it("does not split headings inside backtick or tilde fenced examples", () => {
        for (const marker of ["```", "~~~~"]) {
            const visible = `## Overview\n\nA configuration example:\n\n${marker}markdown\n## Not a boundary\n### Plan highlights\n\n<details>\n<summary>Example</summary>\n+++ Full plan\n${marker}\n\n### Highlights\n\n- Keep examples intact.`
            const support = `## Evidence\n\n${marker}markdown\n## Nested sample\n\nKeep this too.\n${marker}\n\n- A real list.`
            assert.equal(
                renderProviderBody(`# Report\n\n${visible}\n\n${support}\n`, { kind: "github-plan-comment" }),
                `${visible.replace("## Overview", "# Plan")}\n\n<details>\n<summary>Full plan</summary>\n\n${support}\n\n</details>`,
            )
        }
    })

    it("honors fence marker type, length, indentation, and trailing content", () => {
        const visible =
            "## Overview\n\nA nested fence example:\n\n   ````markdown\n```\n~~~~\n```` not a closer\n## Still inside\n   `````\n\nDone."
        assert.equal(
            renderProviderBody(`${visible}\n\n${details}`, { kind: "github-plan-comment" }),
            `${visible.replace("## Overview", "# Plan")}\n\n<details>\n<summary>Full plan</summary>\n\n${details}\n\n</details>`,
        )
    })

    it("preserves retained whitespace and normalizes only section separation", () => {
        const visible = "## Overview\n\nKeep this hard break.  "
        const support = "## Evidence\n\nKeep this indentation and trailing spaces.  "
        assert.equal(
            renderProviderBody(`${visible}\n\n\n${support}\n\n`, { kind: "linear-plan-document" }),
            `${visible.slice("## Overview\n\n".length)}\n\n+++ Full plan\n\n${support}\n\n+++`,
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
                () => renderProviderBody(invalid, { kind: "github-plan-comment" }),
                /requires a nonempty ## Overview/,
            )
    })
})

describe("plan update announcements", () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")

    it("diffs lines into separate hunks with three lines of context", () => {
        const before = lines(20)
        const after = before.replace("line 2\n", "line two\n").replace("line 18", "line 18\nadded")
        assert.equal(
            unifiedDiff(before, after),
            [
                "@@ -1,5 +1,5 @@",
                " line 1",
                "-line 2",
                "+line two",
                " line 3",
                " line 4",
                " line 5",
                "@@ -16,5 +16,6 @@",
                " line 16",
                " line 17",
                " line 18",
                "+added",
                " line 19",
                " line 20",
            ].join("\n"),
        )
        assert.equal(unifiedDiff(before, before), "")
    })

    it("ignores the root title, blank lines and bullet markers, but not fenced code", () => {
        const plan = "# Old title\n\n## Overview\n\n- A\n\n```\n* kept\n\n```\n"
        assert.equal(planSourceDiff(plan, "# New title\n## Overview\n* A\n```\n* kept\n\n```\n"), "")
        assert.match(planSourceDiff(plan, plan.replace("* kept", "- kept")), /^-\* kept\n\+- kept$/m)
    })

    it("renders the origin, summary, plan link and a provider-folded diff", () => {
        const common = { summary: "Changed.", token: "t", diff: "@@ -1 +1 @@\n-a\n+b" }
        const githubPlan = { presentation: "github", commentId: 555 } as const
        const linearPlan = { presentation: "linear", url: "https://linear.app/x/document/plan" } as const
        const github = renderAnnouncement({ ...common, fromTask: "ENG-4", plan: githubPlan })
        // GitHub links by fragment, so the reader stays on the issue.
        assert.match(
            github,
            /^\*\*Plan updated\*\* from Task ENG-4\n\nChanged\.\n\n\[View the updated plan\]\(#issuecomment-555\)/,
        )
        assert.doesNotMatch(github, /https?:/)
        assert.match(
            github,
            /<details>\n<summary>Plan diff<\/summary>\n\n```diff\n@@ -1 \+1 @@\n-a\n\+b\n```\n\n<\/details>/,
        )
        assert.ok(github.endsWith("<!-- plan-announcement:t -->"))
        // Without a Task origin, the heading names none.
        const linear = renderAnnouncement({ ...common, plan: linearPlan })
        assert.match(linear, /^\*\*Plan updated\*\*\n\nChanged\./)
        assert.ok(linear.includes("[View the updated plan](https://linear.app/x/document/plan)"))
        assert.match(linear, /\+\+\+ Plan diff\n\n```diff\n[\s\S]*\n```\n\n\+\+\+/)
        // A `+++` diff line would end Linear's fold early, so that diff stays unfolded.
        const unfolded = renderAnnouncement({
            ...common,
            diff: "+++ added",
            plan: linearPlan,
        })
        assert.doesNotMatch(unfolded, /Plan diff/)
        // A fence inside the diff gets a longer outer fence.
        assert.match(renderAnnouncement({ ...common, diff: "+```", plan: githubPlan }), /````diff/)
        const huge = renderAnnouncement({
            ...common,
            diff: "+x".repeat(40_000),
            plan: githubPlan,
        })
        assert.doesNotMatch(huge, /```diff/)
        assert.match(huge, /too large/)
        assert.ok(huge.endsWith("<!-- plan-announcement:t -->"))
    })
})
