import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"

import {
    AncestryDeliveryCleanupInputSchema,
    GitHubDeliveryCleanupInputSchema,
} from "../workflows/extensions/deliverable/cleanup.ts"

// Structural checks for workflow guidance. These tests deliberately avoid asserting
// specific wording in Markdown: guidance prose is reviewed, not regex-pinned.

function markdownFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name)
        return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith(".md") ? [file] : []
    })
}

function links(file: string): { target: string; anchor?: string }[] {
    const source = fs.readFileSync(file, "utf-8")
    const raw = [
        ...[...source.matchAll(/`((?:\.\.\/|\.\/)[^`\n]+\.md)`/g)].map((match) => match[1]),
        ...[...source.matchAll(/\]\(([^\s)]+\.md(?:#[^)]*)?)\)/g)].map((match) => match[1]),
    ].filter((link) => !link.includes("://"))
    return raw.map((link) => {
        const [relative, anchor] = link.split("#")
        return { target: path.normalize(path.join(path.dirname(file), relative)), anchor }
    })
}

function dependencies(file: string): string[] {
    return [...new Set(links(file).map((link) => link.target))]
}

function guidanceGraph(entry: string, seen = new Set<string>()): Set<string> {
    if (seen.has(entry)) return seen
    seen.add(entry)
    for (const dependency of dependencies(entry)) guidanceGraph(dependency, seen)
    return seen
}

function headingSlugs(file: string): Set<string> {
    const source = fs.readFileSync(file, "utf-8").replace(/```[\s\S]*?```/g, "")
    return new Set(
        [...source.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)].map((match) =>
            match[1]
                .trim()
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s_-]/gu, "")
                .replace(/\s/g, "-"),
        ),
    )
}

function skillGrants(skill: string): string[] {
    const frontmatter = fs.readFileSync(`workflows/skills/${skill}/SKILL.md`, "utf-8").split("---")[1]
    return [...frontmatter.matchAll(/^ +- +"([^"]+)"$/gm)].map((match) => match[1])
}

const guidanceFiles = ["README.md", "UPGRADING.md", ...markdownFiles("workflows")]

describe("workflow guidance structure", () => {
    it("resolves every concrete Markdown dependency from its owning directory", () => {
        for (const file of guidanceFiles) {
            for (const dependency of dependencies(file)) {
                assert.equal(fs.existsSync(dependency), true, `${file} references missing ${dependency}`)
            }
        }
    })

    it("resolves every Markdown heading anchor", () => {
        for (const file of guidanceFiles) {
            for (const { target, anchor } of links(file)) {
                if (!anchor || !fs.existsSync(target)) continue
                assert.ok(headingSlugs(target).has(anchor), `${file} links to missing heading ${target}#${anchor}`)
            }
        }
    })

    it("keeps shared operational contracts reachable from every work skill", () => {
        for (const skill of ["epic", "task", "gig"]) {
            const graph = guidanceGraph(`workflows/skills/${skill}/SKILL.md`)
            for (const reference of [
                "artifacts.md",
                "planning.md",
                "phase.md",
                "review.md",
                "communication.md",
                "setup.md",
                "integrations/shared.md",
                "integrations/tracker/github.md",
                "integrations/tracker/linear.md",
                "integrations/forge/github.md",
            ])
                assert.ok(graph.has(`workflows/references/${reference}`), `${skill} must reach ${reference}`)
            if (skill !== "epic") assert.ok(graph.has("workflows/references/deliverable.md"))
            if (skill !== "gig") assert.ok(graph.has("workflows/references/epic.md"), `${skill} must reach epic.md`)
        }
        for (const skill of ["backlog", "todo", "project-setup"]) {
            const graph = guidanceGraph(`workflows/skills/${skill}/SKILL.md`)
            assert.ok(graph.has("workflows/references/integrations/shared.md"))
            assert.ok(graph.has("workflows/references/integrations/tracker/github.md"))
            assert.ok(graph.has("workflows/references/integrations/tracker/linear.md"))
        }
    })

    it("lets every skill reach the shared queue and reporting contract", () => {
        for (const skill of ["epic", "task", "gig", "backlog", "todo", "project-setup"]) {
            const graph = guidanceGraph(`workflows/skills/${skill}/SKILL.md`)
            assert.ok(graph.has("workflows/references/queue.md"), `${skill} must reach queue.md`)
        }
    })

    it("grants the workflow tools each skill requires", () => {
        // The permissions extension reads these grants at runtime; the tool-contract
        // inventory only rejects unknown names, so missing grants are checked here.
        const required: Record<string, string[]> = {
            epic: ["prepare_epic_plan_presentation", "prepare_tracker_publication", "render_provider_body"],
            task: ["prepare_task_plan_presentation", "prepare_tracker_publication", "render_provider_body"],
            gig: ["prepare_gig_plan_presentation", "prepare_tracker_publication", "render_provider_body"],
            "project-setup": ["inspect_permissions", "inspect_project_setup"],
        }
        for (const [skill, tools] of Object.entries(required)) {
            const grants = skillGrants(skill)
            for (const tool of tools) assert.ok(grants.includes(tool), `${skill} must grant ${tool}`)
        }
        assert.deepEqual(skillGrants("todo"), ["inspect_integrations", "inspect_queue_intake"])
    })

    it("keeps setup configuration examples valid JSON", () => {
        const setup = fs.readFileSync("workflows/references/setup.md", "utf-8")
        const blocks = [...setup.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1])
        assert.ok(blocks.length > 0)
        for (const [index, block] of blocks.entries())
            assert.doesNotThrow(() => JSON.parse(block), `setup.md JSON example ${index + 1} must parse`)
    })

    it("keeps Deliverable cleanup inputs to the one-shot tool schema", () => {
        assert.deepEqual(Object.keys(AncestryDeliveryCleanupInputSchema.properties).sort(), [
            "completionAuthority",
            "entityDir",
        ])
        assert.deepEqual(Object.keys(GitHubDeliveryCleanupInputSchema.properties).sort(), [
            "completionAuthority",
            "entityDir",
            "merge",
        ])
    })

    it("keeps publication policy separate from the Pi wrapper and MCP attachment", () => {
        const publication = fs.readFileSync("workflows/extensions/integrations/publication.ts", "utf-8")
        assert.doesNotMatch(publication, /^import\b/m)
        const wrapper = fs.readFileSync("workflows/extensions/integrations/publication-tool.ts", "utf-8")
        assert.deepEqual(
            [...wrapper.matchAll(/from "([^"]+)"/g)].map((match) => match[1]),
            ["node:fs", "node:path", "@earendil-works/pi-coding-agent", "typebox", "./publication.js"],
        )
        assert.match(
            fs.readFileSync("workflows/extensions/integrations/index.ts", "utf-8"),
            /from "\.\/publication-mcp\.js"/,
        )
    })
})
