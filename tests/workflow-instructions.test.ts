import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"

import { DeliveryCleanupSchema } from "../workflows/extensions/deliverable/cleanup.ts"

function markdownFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name)
        return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith(".md") ? [file] : []
    })
}

function dependencies(file: string): string[] {
    const source = fs.readFileSync(file, "utf-8")
    const links = [
        ...[...source.matchAll(/`((?:\.\.\/|\.\/)[^`\n]+\.md)`/g)].map((match) => match[1]),
        ...[...source.matchAll(/\]\(([^\s)]+\.md)(?:#[^)]*)?\)/g)].map((match) => match[1]),
    ].filter((link) => !link.includes("://"))
    return [...new Set(links.map((link) => path.normalize(path.join(path.dirname(file), link))))]
}

function guidanceGraph(entry: string, seen = new Set<string>()): Set<string> {
    if (seen.has(entry)) return seen
    seen.add(entry)
    for (const dependency of dependencies(entry)) guidanceGraph(dependency, seen)
    return seen
}

describe("workflow instruction ownership", () => {
    it("resolves every concrete Markdown dependency from its owning directory", () => {
        for (const file of markdownFiles("workflows")) {
            for (const dependency of dependencies(file)) {
                assert.equal(fs.existsSync(dependency), true, `${file} references missing ${dependency}`)
            }
        }
    })

    it("keeps shared operational contracts reachable from every work skill", () => {
        for (const skill of ["epic", "task", "gig"]) {
            const graph = guidanceGraph(`workflows/skills/${skill}/SKILL.md`)
            for (const reference of [
                "artifacts.md",
                "planning.md",
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
        }
        for (const skill of ["backlog", "project-setup"]) {
            const graph = guidanceGraph(`workflows/skills/${skill}/SKILL.md`)
            assert.ok(graph.has("workflows/references/integrations/shared.md"))
            assert.ok(graph.has("workflows/references/integrations/tracker/github.md"))
            assert.ok(graph.has("workflows/references/integrations/tracker/linear.md"))
        }
    })

    it("keeps Deliverable cleanup guidance aligned with the one-shot tool schema", () => {
        const deliverable = fs.readFileSync("workflows/references/deliverable.md", "utf-8")
        assert.match(deliverable, /After approval, call `cleanup_delivery_branch` once\./)
        assert.deepEqual(Object.keys(DeliveryCleanupSchema.properties).sort(), ["completion", "entityDir", "merge"])
    })

    it("keeps configuration examples and exact permission gates in the setup reference", () => {
        const setup = fs.readFileSync("workflows/references/setup.md", "utf-8")
        for (const literal of [
            '"artifacts": "versioned"',
            '"branches": { "username": "alex" }',
            '"tracker":',
            '"forge":',
            "https://mcp.linear.app/mcp",
            "https://api.githubcopilot.com/mcp/",
            "${LINEAR_API_KEY}",
            "${GITHUB_PERSONAL_ACCESS_TOKEN}",
        ])
            assert.ok(setup.includes(literal), `setup must retain ${literal}`)
        for (const file of ["epic", "plan", "result", "report"]) {
            for (const tool of ["write", "edit"]) assert.ok(setup.includes(`${tool}(.project/*/${file}.md)`))
        }
        assert.ok(dependencies("workflows/references/setup.md").includes("workflows/references/artifacts.md"))
    })
})
