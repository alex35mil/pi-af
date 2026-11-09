import "./host-runtime.ts"

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it, type TestContext } from "node:test"

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent"

const packageRoot = path.resolve(import.meta.dirname, "..")
const bundledSkill = path.join(packageRoot, "skills/commit/SKILL.md")

function fixture(t: TestContext) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "commit-skill-")))
    const cwd = path.join(root, "project")
    const home = path.join(root, "home")
    const agentDir = path.join(home, ".pi/agent")
    fs.mkdirSync(path.join(cwd, ".git"), { recursive: true })
    fs.mkdirSync(agentDir, { recursive: true })
    fs.writeFileSync(
        path.join(agentDir, "settings.json"),
        JSON.stringify({ packages: [{ source: packageRoot, extensions: [], prompts: [], themes: [] }] }),
    )
    const previousHome = process.env.HOME
    process.env.HOME = home
    t.after(() => {
        if (previousHome === undefined) delete process.env.HOME
        else process.env.HOME = previousHome
        fs.rmSync(root, { recursive: true, force: true })
    })
    return {
        cwd,
        skill(relative: string) {
            const file = path.join(cwd, relative, "SKILL.md")
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(
                file,
                "---\nname: commit\ndescription: Use the project's commit policy.\n---\n\nUse Title Case subjects.\n",
            )
            return file
        },
        async load() {
            const loader = new DefaultResourceLoader({
                cwd,
                agentDir,
                settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted: true }),
                noExtensions: true,
                noPromptTemplates: true,
                noThemes: true,
                noContextFiles: true,
            })
            await loader.reload()
            return loader.getSkills()
        },
    }
}

describe("commit skill package integration", () => {
    it("discovers the enabled default through the package manifest without validation warnings", async (t) => {
        const f = fixture(t)
        const { skills, diagnostics } = await f.load()
        const commits = skills.filter((skill) => skill.name === "commit")
        assert.equal(commits.length, 1)
        assert.equal(commits[0].filePath, bundledSkill)
        assert.equal(commits[0].disableModelInvocation, false)
        assert.deepEqual(diagnostics, [])
    })

    it("selects a project-local commit skill over the package default", async (t) => {
        const f = fixture(t)
        const projectSkill = f.skill(".pi/skills/commit")
        const { skills, diagnostics } = await f.load()
        assert.deepEqual(
            skills.filter((skill) => skill.name === "commit").map((skill) => skill.filePath),
            [projectSkill],
        )
        assert.ok(
            diagnostics.some(
                (entry) => entry.collision?.winnerPath === projectSkill && entry.collision.loserPath === bundledSkill,
            ),
        )
    })

    it("honors a project-configured skill before both auto-discovery and the package default", async (t) => {
        const f = fixture(t)
        f.skill(".pi/skills/commit")
        const configuredSkill = f.skill("team/commit")
        fs.writeFileSync(path.join(f.cwd, ".pi/settings.json"), JSON.stringify({ skills: ["../team/commit"] }))
        const { skills } = await f.load()
        assert.deepEqual(
            skills.filter((skill) => skill.name === "commit").map((skill) => skill.filePath),
            [configuredSkill],
        )
    })
})
