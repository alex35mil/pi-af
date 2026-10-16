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
    it("keeps GitHub presentation setup and manual verification at the owning boundary", () => {
        const skill = fs.readFileSync("workflows/skills/project-setup/SKILL.md", "utf-8")
        const reference = fs.readFileSync("workflows/references/setup.md", "utf-8")
        for (const requirement of [
            /operation: inspectProject/,
            /require explicit selection of one exact view ID/,
            /separate choices, both enabled/,
            /Before removing an existing association.*default repository in Settings/,
            /Default-repository opt-out adds no manual completion requirement/,
            /Do not claim full setup complete while required manual work remains unconfirmed/,
            /presentation and manual confirmation stay outside runtime configuration/,
            /Require explicit approval of that exact `planHash`/,
        ])
            assert.match(skill, requirement)
        for (const requirement of [
            /Presentation is a setup-only input/,
            /"kind": "workflow", "field": "priority"/,
            /defaultRepository: unmanaged/,
            /setup-repository.*associateRepository: false.*blocked/,
            /API writes change only the selected view's name\/layout\/visible fields/,
            /No grouping/,
            /Urgent → High → Medium → Low/,
            /Other orders block preview before any setup writes/,
            /Organization Priority is checked before creating a new Project/,
            /numeric option priorities rather than response-array order/,
            /field-wide change affecting other views/,
            /Count.*only/,
            /No slicing/,
            /default repository require user confirmation or a screenshot of saved state/,
            /Opting out omits step 6 and its completion requirement/,
        ])
            assert.match(reference, requirement)
    })

    it("resolves every concrete Markdown dependency from its owning directory", () => {
        for (const file of markdownFiles("workflows")) {
            for (const dependency of dependencies(file)) {
                assert.equal(fs.existsSync(dependency), true, `${file} references missing ${dependency}`)
            }
        }
    })

    it("keeps shared operational contracts reachable from every work skill", () => {
        for (const skill of ["epic", "task", "gig"]) {
            assert.match(
                fs.readFileSync(`workflows/skills/${skill}/SKILL.md`, "utf-8"),
                /    - "prepare_plan_presentation"/,
            )
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
        }
        for (const skill of ["backlog", "todo", "project-setup"]) {
            const graph = guidanceGraph(`workflows/skills/${skill}/SKILL.md`)
            assert.ok(graph.has("workflows/references/queue.md") || skill === "project-setup")
            assert.ok(graph.has("workflows/references/integrations/shared.md"))
            assert.ok(graph.has("workflows/references/integrations/tracker/github.md"))
            assert.ok(graph.has("workflows/references/integrations/tracker/linear.md"))
        }
    })

    it("routes natural-language workflow reports through ordinary Todo with privacy and exact approval", () => {
        const todo = fs.readFileSync("workflows/skills/todo/SKILL.md", "utf-8")
        assert.match(todo, /requests to report a workflow defect or friction/)
        assert.match(todo, /Ordinary intake uses `target: "current"`/)
        assert.match(todo, /Report this workflow issue.*`target: "workflow"`/)
        assert.match(todo, /allowed-tools:\n    - "integration_context"\n---/)
        const queue = fs.readFileSync("workflows/references/queue.md", "utf-8")
        for (const requirement of [
            /Ordinary.*`target: "current"`/,
            /explicit request to report.*destination `todo`.*`target: "workflow"`/,
            /same `target`/,
            /exact selected tracker destination/,
            /changed content or destination requires renewed approval/,
            /Set|short corrective error/,
            /Do not start setup questions or repair configuration automatically/,
            /Known installed workflow version or source revision/,
            /State unavailable or mismatched evidence plainly/,
            /Replace project-specific values with synthetic examples/,
            /Exclude consuming-project names, remotes, absolute paths, tracker links, workflow IDs/,
            /Evidence that cannot be made safe stays local/,
            /approving preparation is not approval to transmit/,
            /Keep remote mutation tools outside skill-derived allow rules/,
            /use the existing Todo\/Gig\/Task process/,
            /Never bypass a denied or failed MCP tool with another client/,
        ])
            assert.match(queue, requirement)
        for (const skill of ["epic", "task", "gig", "backlog", "todo", "project-setup"]) {
            const graph = guidanceGraph(`workflows/skills/${skill}/SKILL.md`)
            assert.ok(graph.has("workflows/references/queue.md"), `${skill} must reach the shared reporting contract`)
        }
        const setup = fs.readFileSync("workflows/references/setup.md", "utf-8")
        assert.match(setup, /"workflowProject": "\/absolute\/path\/to\/pi-af"/)
        assert.match(setup, /existing private global/)
        assert.match(setup, /source's `\.project\/integrations\.json` and `\.project\/config\.json`/)
        assert.match(setup, /Stop the attempt without setup questions, automatic repair/)
        const setupSkill = fs.readFileSync("workflows/skills/project-setup/SKILL.md", "utf-8")
        assert.match(setupSkill, /`operation: inspect` and `target: "current"`/)
    })

    it("treats explicit queued-work selection as intake approval", () => {
        const artifacts = fs.readFileSync("workflows/references/artifacts.md", "utf-8")
        assert.match(artifacts, /Explicit selection of a Backlog or Todo object authorizes adoption/)
        assert.match(artifacts, /existing title or name, description, Priority, and available workflow Kind/)
        assert.match(artifacts, /after the selected provider's read-only preflight/)
        assert.match(artifacts, /Ask only for missing or conflicting information/)
        assert.match(artifacts, /proceed to `init` without a separate confirmation/)
        assert.match(artifacts, /For new work, present the cleaned title and Request together for approval/)
        assert.match(artifacts, /Ask before changing meaning, scope, Priority, or Kind/)
        assert.match(artifacts, /Never rename an adopted tracker item without separate approval/)

        for (const provider of ["github", "linear"]) {
            const source = fs.readFileSync(`workflows/references/integrations/tracker/${provider}.md`, "utf-8")
            assert.match(source, /Follow the explicit-selection approval in `\.\.\/\.\.\/artifacts\.md`/)
            assert.match(source, /without another intake confirmation/)
            assert.match(source, /Ask only for missing or conflicting information/)
        }
        const github = fs.readFileSync("workflows/references/integrations/tracker/github.md", "utf-8")
        assert.match(github, /A single configured queue Kind supplies the initialized Kind/)
        assert.match(github, /missing or conflicting Kind requires a user choice/)
        assert.match(
            github,
            /Wrong repository\/Project\/parent, non-queue state, ambiguity, denied access, or unconfigured Priority stops adoption/,
        )
        const linear = fs.readFileSync("workflows/references/integrations/tracker/linear.md", "utf-8")
        assert.match(
            linear,
            /Task\/Gig Kind remains workflow-only and requires a user choice when not already supplied/,
        )
        assert.match(linear, /exact parent Epic Project ID/)
        assert.match(linear, /Priority, and no Epic Project/)
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
        assert.match(readme, /Local work:  inProgress\/planning → inProgress\/execution/)
        assert.match(readme, /Plan loop:   inProgress\/planning \(draft, review, correct, present, await approval\)/)
        assert.match(
            readme,
            /Plan drafting, review, corrections, presentation, and waiting for approval stay in Planning/,
        )
        assert.match(readme, /Interim\/final reviews and local user review of delivered work use Self-Review/)

        const planning = fs.readFileSync("workflows/references/planning.md", "utf-8")
        assert.match(planning, /## Material replanning/)
        assert.match(planning, /Restore lifecycle to `inProgress` when it is `inReview`/)
        assert.match(planning, /Record `phase: planning` in `metadata.json`/)
        assert.match(planning, /Keep metadata `phase: planning` and lifecycle `inProgress`/)
        assert.match(planning, /remain in Planning while calling `prepare_plan_presentation`/)
        assert.match(planning, /The tool selects a validated approved snapshot and returns its source and target paths/)
        assert.match(planning, /the write tool presents the approval diff/)
        assert.match(
            planning,
            /Keep `phase: planning` while correcting the reviewed plan, rerunning planning review, presenting it, and waiting for user approval/,
        )
        assert.match(planning, /On acceptance, set metadata `phase: execution`/)
        const review = fs.readFileSync("workflows/references/review.md", "utf-8")
        assert.match(review, /plan review, corrections, presentation, and waiting for plan approval remain in Planning/)
        assert.match(
            review,
            /permitted implementation corrections and verification use Execution before returning to Self-Review/,
        )
        assert.match(
            review,
            /blocked-review confirmation pause stays in Planning for plan reviews or Self-Review for interim\/final reviews/,
        )
        const deliverable = fs.readFileSync("workflows/references/deliverable.md", "utf-8")
        assert.match(deliverable, /use the material-replanning transition in `\.\/planning.md`/)
        const epic = fs.readFileSync("workflows/skills/epic/SKILL.md", "utf-8")
        assert.match(epic, /first enter the material-replanning transition/)
        assert.match(epic, /Keep Planning during plan review, corrections, presentation, and waiting for user approval/)

        const github = fs.readFileSync("workflows/references/integrations/tracker/github.md", "utf-8")
        assert.match(github, /Phase is present only for initialized In Progress work/)
        assert.match(github, /Clear native Phase outside In Progress/)
        assert.match(github, /Versioned Kind equals the authoritative workflow Kind/)
        assert.match(github, /Preserve unrelated labels/)
        assert.match(github, /write only when the intended set differs/)
        const linear = fs.readFileSync("workflows/references/integrations/tracker/linear.md", "utf-8")
        assert.match(linear, /Planning, Execution, and Self-Review all remain In Progress/)
        assert.match(linear, /Apply its entire returned label-ID set/)
        assert.match(linear, /preserve every unrelated label/)
        const phase = fs.readFileSync("workflows/references/phase.md", "utf-8")
        assert.match(
            phase,
            /Keep the entire planning loop in Planning: drafting, review, corrections, presentation, and waiting for plan approval/,
        )
        assert.match(phase, /Use Planning for `review` with category `plan` and for `prepare_plan_presentation`/)
        assert.match(phase, /Use Execution for accepted implementation and implementation corrections/)
        assert.match(phase, /Enter Self-Review before interim\/final review and local user review of delivered work/)
        assert.match(phase, /remain there while awaiting feedback/)
        assert.match(phase, /Set In Review only after work is actually submitted for external human review/)
        assert.match(phase, /With no external submission route, do not set In Review/)
        assert.match(phase, /applies equally to versioned and unversioned/)
        assert.match(phase, /A local commit is not submission/)
        assert.match(deliverable, /set metadata `phase: selfReview`/)
        assert.match(deliverable, /Enter lifecycle `inReview` only after confirmed external submission/)
        assert.match(deliverable, /Revisions on an open PR return to In Progress\/Execution/)
        const shared = fs.readFileSync("workflows/references/integrations/shared.md", "utf-8")
        assert.match(shared, /native Phase metadata \(Planning, Execution, and Self-Review\)/)
    })

    it("treats user-directed kind changes as classification-only updates at any lifecycle", () => {
        const deliverable = fs.readFileSync("workflows/references/deliverable.md", "utf-8")
        assert.match(deliverable, /When the user requests or approves a kind change, update `kind` in `metadata.json`/)
        assert.match(
            deliverable,
            /Any supported kind can change to any other supported kind at any lifecycle, including `done` and `canceled`/,
        )
        assert.match(
            deliverable,
            /Leave lifecycle, Phase, identity, branch, Task parent, `brief.md`, and existing artifacts unchanged for a kind-only update/,
        )
        assert.match(deliverable, /Future work follows the current kind's strategy/)
        assert.match(
            deliverable,
            /Actual scope or behavior changes follow the normal planning and approval rules, separately from changing kind/,
        )
        assert.match(deliverable, /Versioned GitHub reconciles the managed Kind label, preserving unrelated labels/)
        assert.match(deliverable, /Linear and unversioned GitHub keep Kind in workflow metadata only/)
        const artifacts = fs.readFileSync("workflows/references/artifacts.md", "utf-8")
        assert.match(artifacts, /User-accepted work plan/)
        assert.match(artifacts, /Kind-only updates leave accepted plans, results, and reports unchanged/)
        const readme = fs.readFileSync("workflows/README.md", "utf-8")
        assert.match(readme, /Kind can change at any point without restarting the workflow/)
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
        assert.match(deliverable, /directly publish the complete body/)
        assert.match(deliverable, /uncertain or partial update, read the exact PR before retrying/)
        assert.match(deliverable, /never create another PR/)
        assert.doesNotMatch(deliverable, /render_artifact_links|artifactLinks|destination-specific Links/)

        const forge = fs.readFileSync("workflows/references/integrations/forge/github.md", "utf-8")
        assert.match(forge, /For an approved revised completion artifact/)
        assert.match(forge, /update the exact scoped PR's whole body directly/)
        assert.match(forge, /Trust established clear success/)
        assert.match(forge, /uncertain\/partial outcomes, read the exact PR and reconcile/)
        assert.match(forge, /never blindly retry a non-idempotent create/)
        assert.match(forge, /Before the submission commit/)
        assert.match(forge, /one authorized submission commit\/push/)
        assert.match(forge, /returned number\/URL is recorded directly in the existing ignored Resource IDs file/)
        assert.match(forge, /Missing\/stale IDs or uncertain attempts require agent investigation/)
        assert.match(deliverable, /recording leaves versioned metadata unchanged/)

        const forgeReadme = fs.readFileSync("workflows/extensions/integrations/forge/README.md", "utf-8")
        assert.match(forgeReadme, /agent follows.*GitHub forge procedure/)
        assert.doesNotMatch(forgeReadme, /Artifact-link/)
        assert.doesNotMatch(fs.readFileSync("workflows/README.md", "utf-8"), /Integration roles and Links/)

        const shared = fs.readFileSync("workflows/references/integrations/shared.md", "utf-8")
        assert.match(shared, /workflow owns the entire provider body/)
        assert.match(shared, /Discussion.*belong in comments/)
        assert.match(shared, /Preserve the exact rendered request/)
        assert.match(shared, /Trust an established clear provider success/)
        assert.match(shared, /uncertain or partial update, read the exact body/)
        assert.match(shared, /removes the first Markdown H1/)
        assert.match(shared, /horizontal rule, a blank line, and `Closes #<issue number>`/)
        assert.doesNotMatch(shared, /render_artifact_links|artifactLinks|## Shared Links section/)

        for (const skill of ["epic", "task", "gig"]) {
            assert.match(fs.readFileSync(`workflows/skills/${skill}/SKILL.md`, "utf-8"), /render_provider_body/)
        }
        assert.match(
            fs.readFileSync("workflows/skills/epic/SKILL.md", "utf-8"),
            /follow the shared complete-body publishing contract.*trust established clear success and reconcile uncertain outcomes/,
        )
    })

    it("keeps reviewed overviews and lossless provider folding in the owning guidance", () => {
        const artifacts = fs.readFileSync("workflows/references/artifacts.md", "utf-8")
        assert.match(artifacts, /nonempty `## Overview` as the first content section/)
        assert.match(artifacts, /subsequent nonempty level-two sections/)
        assert.match(artifacts, /overview and details are one source document, reviewed and accepted together/)
        assert.match(artifacts, /historical completed artifacts remain untouched/)
        const planning = fs.readFileSync("workflows/references/planning.md", "utf-8")
        assert.match(planning, /### Plan highlights/)
        assert.match(planning, /not generated at publication time/)
        const epic = fs.readFileSync("workflows/skills/epic/SKILL.md", "utf-8")
        assert.match(epic, /## Overview/)
        assert.match(epic, /### Plan highlights/)
        assert.match(epic, /Overview and Plan highlights accurately represent the detailed contract/)
        const deliverable = fs.readFileSync("workflows/references/deliverable.md", "utf-8")
        assert.match(deliverable, /key conclusion, and material uncertainty/)
        assert.match(deliverable, /collapses each subsequent level-two section separately under its section heading/)
        assert.match(deliverable, /ordinary Markdown Implementation walkthrough section/)
        const shared = fs.readFileSync("workflows/references/integrations/shared.md", "utf-8")
        assert.match(shared, /Never summarize or condense during publication/)
        assert.match(shared, /both visible and collapsed content/)
        assert.match(shared, /require approval before rendering/)
        assert.match(shared, /Folding is not a privacy boundary/)
        assert.match(shared, /GitHub uses `<details>`\/`<summary>` without `open`/)
        assert.match(shared, /Linear trackers use native `\+\+\+ Full plan`/)
        assert.match(shared, /Tracker bodies retain one \*\*Full plan\*\* fold.*no new divider/)
        assert.match(shared, /PRs use a literal `<hr \/>` after Overview/)
        assert.match(shared, /one GitHub `<details>` fold per subsequent level-two section/)
        assert.match(shared, /Not run stays inside Verification/)
        assert.match(shared, /after all closed PR folds/)
        assert.match(shared, /deterministic collapse wrappers\/blank separation.*need no second approval/)
        assert.match(shared, /substantive omission, rewrite, addition, or new summary requires/)
        assert.match(shared, /incompatible source produces a local layout error/)
        const review = fs.readFileSync("workflows/references/review.md", "utf-8")
        assert.match(review, /Overview accurately represents the complete detailed contract or evidence/)
        assert.match(review, /keeps material limitations visible/)
        const linear = fs.readFileSync("workflows/references/integrations/tracker/linear.md", "utf-8")
        assert.match(linear, /native `\+\+\+ Full plan`/)
        assert.match(linear, /live issue\/Project UI rendering must be verified separately/)
    })

    it("routes commits through the available skill and supplies an explicit squash title", () => {
        for (const file of [
            "workflows/skills/epic/SKILL.md",
            "workflows/references/deliverable.md",
            "workflows/references/integrations/forge/github.md",
        ]) {
            const source = fs.readFileSync(file, "utf-8")
            assert.match(source, /`commit` skill/, file)
            assert.doesNotMatch(source, /skills\/commit\/SKILL\.md/, file)
        }
        const forge = fs.readFileSync("workflows/references/integrations/forge/github.md", "utf-8")
        for (const field of ["commit_title", "metadata.title", "merge_method: squash", "expectedHeadSha"])
            assert.ok(forge.includes(`\`${field}\``), `forge must retain ${field}`)
    })

    it("keeps Deliverable cleanup guidance aligned with the one-shot tool schema", () => {
        const deliverable = fs.readFileSync("workflows/references/deliverable.md", "utf-8")
        assert.match(
            deliverable,
            /Within that same explicit finish request, call `cleanup_delivery_branch` once without another cleanup question/,
        )
        assert.match(deliverable, /Final completion-artifact acceptance authorizes submission, not finishing/)
        assert.match(deliverable, /requires exact target\/origin equality/)
        assert.match(deliverable, /Epic-target Tasks remain on the Epic branch and leave main intact/)
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
        assert.match(skill, /- "inspect_project_setup"/)
        assert.match(
            skill,
            /For a natural-language invocation without the command snapshot, call `inspect_project_setup` before asking setup questions/,
        )
        assert.match(skill, /Reuse a supplied snapshot rather than inspecting twice/)
        assert.match(skill, /inventory describes configuration, not active tool availability/)
        assert.match(skill, /After restoration, refresh the configured inventory with `inspect_project_setup`/)
        assert.match(skill, /Require explicit approval of that exact `planHash`/)
        assert.match(skill, /Require explicit approval of that proposal/)
        assert.match(
            setup,
            /`\/project-setup` and the agent-callable `inspect_project_setup` tool use the same inspector/,
        )
        assert.match(setup, /Inspection works before configuration exists or while it is invalid/)
        assert.match(
            setup,
            /Registered-provider availability and existing provisioning\/file approval gates remain separate/,
        )
    })
})
