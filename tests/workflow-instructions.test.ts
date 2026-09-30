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
        for (const skill of ["backlog", "todo", "project-setup"]) {
            const graph = guidanceGraph(`workflows/skills/${skill}/SKILL.md`)
            assert.ok(graph.has("workflows/references/queue.md") || skill === "project-setup")
            assert.ok(graph.has("workflows/references/integrations/shared.md"))
            assert.ok(graph.has("workflows/references/integrations/tracker/github.md"))
            assert.ok(graph.has("workflows/references/integrations/tracker/linear.md"))
        }
    })

    it("keeps queue intent and planning projection explicit", () => {
        assert.match(fs.readFileSync("workflows/skills/backlog/SKILL.md", "utf-8"), /backlog it/)
        assert.match(fs.readFileSync("workflows/skills/todo/SKILL.md", "utf-8"), /todo it/)
        const queue = fs.readFileSync("workflows/references/queue.md", "utf-8")
        assert.match(queue, /^# Queue$/m)
        assert.match(queue, /Both destinations contain work that has not started/)
        assert.match(queue, /potential work we may do later but have not committed to doing/)
        assert.match(queue, /queued work we have committed to doing and can pick up next/)
        assert.match(queue, /## Add work/)
        assert.match(queue, /## If the provider response is uncertain/)
        assert.match(queue, /retry only after confirmed absence or non-application/)
        assert.match(queue, /infer and recommend the best-supported value/)
        assert.match(queue, /exact Kind or `not set`/)
        assert.match(queue, /Todo is never required between Backlog and In Progress/)
        const readme = fs.readFileSync("workflows/README.md", "utf-8")
        assert.match(readme, /\/backlog <potential work>/)
        assert.match(readme, /\/todo <queued work>/)

        const planning = fs.readFileSync("workflows/references/planning.md", "utf-8")
        assert.match(planning, /## Material replanning/)
        assert.match(planning, /Restore lifecycle to `inProgress` when it is `inReview`/)
        assert.match(planning, /Record `workStage: planning` in `metadata.json`/)
        const deliverable = fs.readFileSync("workflows/references/deliverable.md", "utf-8")
        assert.match(deliverable, /use the material-replanning transition in `\.\/planning.md`/)
        const epic = fs.readFileSync("workflows/skills/epic/SKILL.md", "utf-8")
        assert.match(epic, /first enter the material-replanning transition/)

        const github = fs.readFileSync("workflows/references/integrations/tracker/github.md", "utf-8")
        assert.match(github, /workStage: planning.*add exact configured Planning/)
        assert.match(github, /workStage: execution.*remove exact configured Planning/)
        assert.match(github, /shared material-replanning transition.*re-add Planning/)
        assert.match(github, /initialization, resume, and every approved Kind transition/)
        assert.match(github, /remove every configured managed Kind label.*add exactly the authoritative/)
        const linear = fs.readFileSync("workflows/references/integrations/tracker/linear.md", "utf-8")
        assert.match(linear, /Planning and execution both remain In Progress/)
        assert.match(linear, /workStage.*workflow metadata/)
    })

    it("keeps request-only briefs, local working state, and provider bodies explicit", () => {
        const artifacts = fs.readFileSync("workflows/references/artifacts.md", "utf-8")
        assert.match(artifacts, /`brief\.md` contains only `# Brief`, one blank line, and the exact approved Request/)
        assert.match(artifacts, /Every entity has free-form agent notes/)
        assert.match(artifacts, /Final review requires zero active entries/)
        assert.doesNotMatch(artifacts, /Keep established decisions.*brief/)

        const planning = fs.readFileSync("workflows/references/planning.md", "utf-8")
        assert.match(planning, /transient understanding.*in `\.local\/notes\.md`/)
        assert.doesNotMatch(planning, /Keep `brief\.md` current/)

        const deliverable = fs.readFileSync("workflows/references/deliverable.md", "utf-8")
        assert.match(deliverable, /final review requires zero unchecked entries/)
        assert.match(deliverable, /call `render_provider_body`/)
        assert.match(deliverable, /update operation once when different/)
        assert.match(deliverable, /After an uncertain update, re-read first/)
        assert.match(deliverable, /never create another PR/)
        assert.doesNotMatch(deliverable, /render_artifact_links|artifactLinks|destination-specific Links/)

        const forge = fs.readFileSync("workflows/references/integrations/forge/github.md", "utf-8")
        assert.match(forge, /When `result\.md` or `report\.md` changes after PR creation/)
        assert.match(forge, /updatePullRequest` once when different/)
        assert.match(forge, /Re-read with `pullRequestRead` and verify exact text/)
        assert.match(forge, /update outcome is uncertain, re-read before retrying/)
        assert.match(forge, /Never blindly repeat creation/)

        const forgeReadme = fs.readFileSync("workflows/extensions/integrations/forge/README.md", "utf-8")
        assert.match(forgeReadme, /body-update/)
        assert.doesNotMatch(forgeReadme, /Artifact-link/)
        assert.doesNotMatch(fs.readFileSync("workflows/README.md", "utf-8"), /Integration roles and Links/)

        const shared = fs.readFileSync("workflows/references/integrations/shared.md", "utf-8")
        assert.match(shared, /removes the first Markdown H1/)
        assert.match(shared, /horizontal rule and `Closes #<issue number>\.`/)
        assert.doesNotMatch(shared, /render_artifact_links|artifactLinks|## Shared Links section/)

        for (const skill of ["epic", "task", "gig"]) {
            assert.match(fs.readFileSync(`workflows/skills/${skill}/SKILL.md`, "utf-8"), /render_provider_body/)
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

        const skill = fs.readFileSync("workflows/skills/project-setup/SKILL.md", "utf-8")
        assert.match(skill, /only when that local file already exists or is proposed/)
    })
})
