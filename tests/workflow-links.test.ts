import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"

import registerIntegrations from "../workflows/extensions/integrations/index.ts"
import {
    renderArtifactLinks,
    RenderArtifactLinksSchema,
    type RenderArtifactLinksInput,
} from "../workflows/extensions/integrations/links.ts"

const tracker = "https://linear.app/acme/issue/ENG-1"
const pullRequest = "https://github.com/acme/app/pull/2"
const commit = `https://github.com/acme/app/blob/${"a".repeat(40)}/.project/gigs/example`
const target = "https://github.com/acme/app/blob/main/.project/gigs/example"

function repository(file: string, state: "resolved" | "available-after-merge" = "available-after-merge") {
    return {
        permanentCommit: `${commit}/${file}`,
        targetBranch: { url: `${target}/${file}`, state },
    }
}

// Deliberately supplied in reverse display order.
function entries() {
    return {
        pullRequest,
        tracker,
        resultOrReport: { label: "Result" as const, ...repository("result.md") },
        planOrEpic: { label: "Plan" as const, ...repository("plan.md") },
        brief: repository("brief.md"),
    }
}

function registeredRenderer() {
    let renderer: ToolDefinition<typeof RenderArtifactLinksSchema> | undefined
    registerIntegrations({
        events: { on: () => () => {} },
        on: () => {},
        registerCommand: () => {},
        registerTool: (tool: typeof renderer) => {
            if (tool?.name === "render_artifact_links") renderer = tool
        },
    } as unknown as ExtensionAPI)
    assert.ok(renderer)
    return renderer
}

describe("workflow Links renderer", () => {
    it("renders the exact PR layout in canonical order without completion or self-links", () => {
        const input = { artifactMode: "versioned", destination: "pullRequest", entries: entries() } as const
        const before = structuredClone(input)
        const expected = [
            "## Links",
            "",
            `- Brief: [commit](${commit}/brief.md) · [target branch](${target}/brief.md) — available after merge`,
            `- Plan: [commit](${commit}/plan.md) · [target branch](${target}/plan.md) — available after merge`,
            `- [Tracker](${tracker})`,
        ].join("\n")
        assert.equal(renderArtifactLinks(input), expected)
        assert.equal(renderArtifactLinks(input), expected)
        assert.deepEqual(input, before)
    })

    it("renders every Epic/Plan and Result/Report label in the tracker layout without a tracker self-link", () => {
        for (const [label, file] of [
            ["Epic", "epic.md"],
            ["Plan", "plan.md"],
        ] as const) {
            for (const [completionLabel, completionFile] of [
                ["Result", "result.md"],
                ["Report", "report.md"],
            ] as const) {
                const input = {
                    artifactMode: "versioned",
                    destination: "tracker",
                    entries: {
                        ...entries(),
                        planOrEpic: { label, ...repository(file, "resolved") },
                        resultOrReport: { label: completionLabel, ...repository(completionFile) },
                    },
                } as const
                assert.equal(
                    renderArtifactLinks(input),
                    [
                        "## Links",
                        "",
                        `- Brief: [commit](${commit}/brief.md) · [target branch](${target}/brief.md) — available after merge`,
                        `- ${label}: [commit](${commit}/${file}) · [target branch](${target}/${file})`,
                        `- ${completionLabel}: [commit](${commit}/${completionFile}) · [target branch](${target}/${completionFile}) — available after merge`,
                        `- [Pull request](${pullRequest})`,
                    ].join("\n"),
                )
            }
        }
    })

    it("omits missing entries and the entire section after destination filtering leaves nothing", () => {
        for (const artifactMode of ["versioned", "unversioned"] as const) {
            for (const destination of ["pullRequest", "tracker"] as const) {
                assert.equal(renderArtifactLinks({ artifactMode, destination, entries: {} }), "")
                const selfLink = destination === "pullRequest" ? { pullRequest } : { tracker }
                assert.equal(renderArtifactLinks({ artifactMode, destination, entries: selfLink }), "")
            }
        }
        assert.equal(
            renderArtifactLinks({
                artifactMode: "versioned",
                destination: "pullRequest",
                entries: { resultOrReport: entries().resultOrReport, pullRequest },
            }),
            "",
        )
        assert.equal(
            renderArtifactLinks({
                artifactMode: "versioned",
                destination: "pullRequest",
                entries: { brief: repository("brief.md", "resolved") },
            }),
            `## Links\n\n- Brief: [commit](${commit}/brief.md) · [target branch](${target}/brief.md)`,
        )
    })

    it("renders only the appropriate confirmed external link in unversioned mode", () => {
        assert.equal(
            renderArtifactLinks({
                artifactMode: "unversioned",
                destination: "pullRequest",
                entries: { tracker, pullRequest },
            }),
            `## Links\n\n- [Tracker](${tracker})`,
        )
        assert.equal(
            renderArtifactLinks({
                artifactMode: "unversioned",
                destination: "tracker",
                entries: { tracker, pullRequest },
            }),
            `## Links\n\n- [Pull request](${pullRequest})`,
        )
    })

    it("requires complete repository pairs, explicit availability, and mode-appropriate entries", () => {
        const input = { artifactMode: "versioned", destination: "tracker", entries: entries() }
        assert.equal(Value.Check(RenderArtifactLinksSchema, input), true)
        for (const invalid of [
            { ...input, artifactMode: "unversioned" },
            { ...input, destination: "other" },
            { ...input, extra: true },
            { ...input, entries: { brief: { permanentCommit: `${commit}/brief.md` } } },
            { ...input, entries: { brief: { targetBranch: repository("brief.md").targetBranch } } },
            {
                ...input,
                entries: { brief: { ...repository("brief.md"), targetBranch: { url: `${target}/brief.md` } } },
            },
            { ...input, entries: { planOrEpic: { label: "Brief", ...repository("plan.md") } } },
            { ...input, entries: { resultOrReport: { label: "Plan", ...repository("result.md") } } },
            { ...input, entries: { tracker: "" } },
            { ...input, entries: { tracker: `${tracker}\n- injected` } },
            { ...input, entries: { extra: tracker } },
        ])
            assert.equal(Value.Check(RenderArtifactLinksSchema, invalid), false)
    })

    it("escapes Markdown delimiters in URLs without rewriting the referenced branch", () => {
        const url = `${target.replace("/main/", "/release(v1/")}/brief.md`
        assert.equal(
            renderArtifactLinks({
                artifactMode: "versioned",
                destination: "pullRequest",
                entries: { brief: { permanentCommit: `${commit}/brief.md`, targetBranch: { url, state: "resolved" } } },
            }),
            `## Links\n\n- Brief: [commit](${commit}/brief.md) · [target branch](${url.replace("(", "\\(")})`,
        )
    })

    it("registers one pure tool that returns the canonical Markdown and enforces its schema", async () => {
        const tool = registeredRenderer()
        assert.deepEqual(tool.parameters, RenderArtifactLinksSchema)
        const ctx = undefined as unknown as ExtensionContext
        for (const input of [
            { artifactMode: "versioned", destination: "tracker", entries: entries() },
            { artifactMode: "unversioned", destination: "tracker", entries: {} },
        ] satisfies RenderArtifactLinksInput[]) {
            const result = await tool.execute("render", input, undefined, undefined, ctx)
            const expected = { markdown: renderArtifactLinks(input) }
            assert.deepEqual(result.details, expected)
            assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(expected, null, 2) }])
        }
        await assert.rejects(() =>
            tool.execute(
                "invalid",
                {
                    artifactMode: "unversioned",
                    destination: "tracker",
                    entries: entries(),
                } as unknown as RenderArtifactLinksInput,
                undefined,
                undefined,
                ctx,
            ),
        )
    })
})
