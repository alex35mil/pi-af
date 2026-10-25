import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"

import { INCOMING_CHECKOUT_TOOLS } from "../workflows/extensions/pr/operations.ts"

// Structural checks only: incoming-PR guidance wording is reviewed, not regex-pinned.

const procedurePath = "workflows/references/pr/incoming.md"
const checkoutPath = "workflows/references/pr/checkout.md"
const procedure = fs.readFileSync(procedurePath, "utf-8")
const skill = fs.readFileSync("workflows/skills/pr/SKILL.md", "utf-8")
const skillFrontmatter = skill.split("---")[1]
const checkout = fs.readFileSync(checkoutPath, "utf-8")

describe("incoming PR guidance structure", () => {
    it("resolves the skill entry point and scoped PR reference links", () => {
        const readFirst = skill.match(/^## Read first\n\n((?:- .*\n)+)/m)?.[1] ?? ""
        const entry = [...readFirst.matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((match) => match[1]).find((link) => link.includes("/pr/"))
        assert.ok(entry, "pr skill must list its incoming procedure under Read first")
        assert.equal(path.resolve("workflows/skills/pr", entry), path.resolve(procedurePath))
        for (const [file, source] of [
            [procedurePath, procedure],
            [checkoutPath, checkout],
        ]) {
            for (const [, target] of source.matchAll(/\[[^\]]+\]\((\.[^)\s]+)\)/g)) {
                const destination = path.resolve(path.dirname(file), target.split("#")[0])
                assert.ok(fs.existsSync(destination), `${file} links to missing ${target}`)
            }
        }
    })

    it("documents every checkout operation without granting it through the skill", () => {
        for (const name of Object.values(INCOMING_CHECKOUT_TOOLS)) {
            assert.equal(skillFrontmatter.includes(`"${name}"`), false, `pr skill must not grant ${name}`)
            assert.ok(procedure.includes(`"${name}"`), `ask example must cover ${name}`)
            assert.ok(checkout.includes(`\`${name}\``), `checkout guidance must name ${name}`)
        }
    })

    it("keeps remote GitHub writes in the ask example and out of skill grants", () => {
        for (const tool of [
            "pull_request_review_write",
            "add_comment_to_pending_review",
            "add_reply_to_pull_request_comment",
            "add_issue_comment",
            "merge_pull_request",
        ]) {
            assert.ok(procedure.includes(`mcp(github, ${tool})`), `ask example must cover ${tool}`)
            assert.equal(skillFrontmatter.includes(`mcp(github, ${tool})`), false, `pr skill must not grant ${tool}`)
        }
    })
})
