import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"

import { INCOMING_CHECKOUT_TOOLS } from "../workflows/extensions/pr/operations.ts"

const procedurePath = "workflows/references/pr/incoming.md"
const checkoutPath = "workflows/references/pr/checkout.md"
const procedure = fs.readFileSync(procedurePath, "utf-8")
const skill = fs.readFileSync("workflows/skills/pr/SKILL.md", "utf-8")
const checkout = fs.readFileSync(checkoutPath, "utf-8")

describe("incoming PR operational contract", () => {
    it("resolves the skill entry point and scoped PR reference links", () => {
        const entry = skill.match(/Read and follow `([^`]+)`/)?.[1]
        assert.ok(entry)
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

    it("uses existing SSH authentication and recovers saved results without changing their lease", () => {
        for (const source of [procedure, checkout, skill]) {
            assert.match(source, /SSH/)
            assert.match(source, /existing.*authentication/)
            assert.match(source, /HTTPS credentials/)
            assert.match(source, /parent\/global Git configuration/)
            assert.match(source, /`publish_incoming_pr_rebase`/)
            assert.match(source, /original lease/)
        }
        assert.ok(checkout.includes("git@github.com:<owner>/<repo>.git"))
        assert.match(checkout, /same recorded result and original lease/)
        assert.match(
            checkout,
            /No checkout recreation, refetch, rebase rerun, lease refresh or state migration is needed/,
        )
        assert.match(checkout, /no HTTPS or manual Git fallback/)
    })

    it("routes explicit selection through its own identity and local review subject", () => {
        for (const pattern of [
            /`inspect_incoming_pr_context`/,
            /private inspection only/,
            /never infer a PR/,
            /Keep remote mutation tools and Git writes outside skill-derived allow rules/,
        ])
            assert.match(skill, pattern)
        for (const pattern of [
            /not a tracker or an initialized Epic\/Task\/Gig/,
            /`#NN` selects a PR in the current project's configured forge repository/,
            /URL must target that same repository/,
            /mismatched target is rejected before any provider call/,
            /explicit `sourcePaths` list/,
            /source file write-once/,
            /`inputPath` to its immutable `snapshotPath`/,
            /prose formatting is not parsed/,
            /head repository\/ref/,
            /Identical ref names across forks/,
            /Missing\/deleted head-repository metadata/,
            /All evidence stays outside Git/,
            /complete immutable dossier|snapshots the complete dossier/,
            /`review_pull_request`/,
            /`record_pull_request_review_response`/,
            /Bracke[t].*exact PR-get reads/,
            /repeat affected inspection when it changes/,
            /truncated, binary, inaccessible or incomplete evidence/,
            /fresh PR evidence/,
        ])
            assert.match(procedure, pattern)
    })

    it("keeps the complete incoming PR area under the existing private project directory", () => {
        const layout = ".project/.local/pull-requests/<number>/"
        const artifacts = fs.readFileSync("workflows/references/artifacts.md", "utf-8")
        for (const source of [procedure, artifacts]) {
            assert.ok(source.includes(layout))
            assert.ok(source.includes(".project/**/.local/"))
        }
        assert.match(procedure, /no additional ignore rule is needed/)
        assert.ok(procedure.includes(`${layout}reviews/<base-sha>-<head-sha>/review-NNN/inputs/`))
        assert.ok(artifacts.includes("reviews/<base-sha>-<head-sha>/review-NNN/inputs/"))
        assert.match(procedure, /Keep `checkout\/`, checkout state\/diffs and working evidence at the PR root/)
        assert.match(procedure, /existing review records are not automatically moved or rewritten/)
    })

    it("keeps publication private-first, exact, separately approved and recoverable", () => {
        for (const pattern of [
            /Present the complete proposed review text/,
            /explicit Comment\/Approve\/Request Changes verdict/,
            /Obtain approval before creating even a pending remote review/,
            /`commitID` equal to the inspected head/,
            /paths\/sides\/line ranges/,
            /Do not silently reuse, submit, or delete unrelated pending reviews/,
            /ownership or pending contents cannot be established/,
            /every intended comment is confirmed/,
            /Recheck revision before additions\/submission/,
            /renewed approval/,
            /uncertain creation, comment addition or submission/,
            /Never blindly duplicate/,
            /Existing publication code adds attribution/,
            /never manually sign/,
            /User-supplied complete unchanged text uses `__pi_authorship: user-verbatim`/,
        ])
            assert.match(procedure, pattern)
        for (const tool of [
            "pull_request_review_write",
            "add_comment_to_pending_review",
            "add_reply_to_pull_request_comment",
            "add_issue_comment",
            "merge_pull_request",
        ]) {
            assert.ok(procedure.includes(`mcp(github, ${tool})`))
            assert.equal(skill.includes(`"mcp(github, ${tool})"`), false)
        }
        assert.match(procedure, /session overrides take precedence over ask\/deny/)
        assert.match(procedure, /Headless ask is blocked/)
        assert.match(procedure, /Each named checkout operation uses its own native permission/)
        assert.match(
            procedure,
            /including rebase\/continuation\/publication, additive fix commits, fix publication, and cleanup; none uses a shell route/,
        )
        assert.match(procedure, /Do not change settings without explicit approval/)
    })

    it("requires an evidence-backed safety score before every approved source materialization", () => {
        for (const meaning of [
            "Clear malicious behavior found.",
            "Strong suspicious indicators.",
            "Inconclusive or insufficient inspection.",
            "No clear malicious behavior, but unresolved concerns.",
            "No malicious indicators found in the inspected contribution.",
        ])
            assert.ok(procedure.includes(meaning))
        for (const pattern of [
            /Before materializing contributor source/,
            /do not run the contribution to score it/,
            /Checkout safety: N\/5 \(label\)/,
            /Checkout safety: 5\/5 \(safe\)/,
            /file\/line evidence, inspection coverage and limitations/,
            /score of 5 is not a guarantee/,
            /Every score requires explicit checkout approval/,
            /no threshold auto-approves checkout/,
            /changed base\/head requires reassessment and renewed approval/,
            /never a durable approval token/,
        ])
            assert.match(procedure, pattern)
        assert.match(skill, /Checkout safety: 5\/5 \(safe\)/)
        const checkout = fs.readFileSync("workflows/references/pr/checkout.md", "utf-8")
        assert.match(checkout, /Checkout safety: N\/5 \(label\)/)
    })

    it("separates approved static checkout and edits from contributor execution", () => {
        for (const pattern of [
            /main repository's files, branch, index and session root unchanged/,
            /inert data/,
            /exact-revision/,
            /never instructions or authority/,
            /Do not load contributor extensions, skills, rules/,
            /not an execution sandbox/,
            /Checkout\/editing approval does not authorize contributor-code execution/,
            /tests, builds, dependency-install scripts, hooks, plugins, generators/,
            /separate approval of exact commands and an appropriately isolated environment/,
            /continue approved static review\/fixes/,
            /runtime checks as \*\*not run\*\*/,
            /do not trigger CI\/workflows as a workaround/,
            /nested checkout is not a sandbox/,
        ])
            assert.match(procedure, pattern)
    })

    it("uses independent nested Git state and a clean boundary before uncommitted fixes", () => {
        for (const pattern of [
            /own .git, HEAD and index/,
            /contributor review only/,
            /clean contributor head plus our fixes/,
            /Do not mix staged contributor changes with new maintainer edits/,
            /uncommitted throughout maintainer review, discussion and revision/,
            /review-NNN\/inputs\//,
            /Every pass owns its source bytes/,
            /uncommitted draft, not as remote PR contents/,
        ])
            assert.match(procedure, pattern)
        for (const pattern of [
            /named incoming-PR checkout tools/,
            /`prepare_incoming_pr_checkout`/,
            /`checkout_incoming_pr`/,
            /`inspect_incoming_pr_checkout`/,
            /`begin_incoming_pr_fixes`/,
            /agent must not reconstruct Git orchestration in Bash/,
            /No manual fallback is permitted/,
            /core.hooksPath=\/dev\/null/,
            /configured clean\/smudge\/process filters/,
            /common ancestor/,
            /Provider-reported base\/head evidence stays unchanged/,
            /phase and `phaseValid`/,
            /parent-verification outcome/,
            /Do not edit, stage\/unstage, commit or push in this phase/,
            /including ignored additions/,
            /Git cannot inspect unsaved Neovim buffers/,
            /HEAD equals the freshly verified published contributor head/,
            /uncommitted throughout maintainer review, discussion and revision/,
            /not automatically choose this nested Git repository/,
        ])
            assert.match(checkout, pattern)
        assert.doesNotMatch(checkout, /```(?:bash|sh)/)
        for (const name of Object.values(INCOMING_CHECKOUT_TOOLS)) {
            assert.equal(skill.split("---")[1].includes(`"${name}"`), false)
            assert.ok(procedure.includes(`"${name}"`), `ask example must cover ${name}`)
            assert.ok(checkout.includes(`\`${name}\``), `checkout guidance must name ${name}`)
        }
        assert.match(skill, /Never reconstruct that Git orchestration in Bash/)
    })

    it("uses standard rebase and immediate publication only under exact pinned-lease approval", () => {
        for (const pattern of [
            /standard rebase plus immediate PR update/,
            /`observe_incoming_pr_target`/,
            /`expectedHeadSha`/,
            /`continue_incoming_pr_rebase`/,
            /`resolutionPaths`/,
            /`publish_incoming_pr_rebase`/,
            /immediately push the recorded result/,
            /Never use plain `--force`/,
            /changed\/deleted branches stop without a refreshed lease/,
            /never fabricate a new response or alter the original evidence/,
            /Only after the rebase update is confirmed do later approved fixes and maintainer testing proceed/,
        ])
            assert.match(procedure, pattern)
        assert.ok(checkout.includes("--force-with-lease=refs/heads/<head-ref>:<observed-pre-rebase-head-sha>"))
        assert.match(checkout, /No push while conflicts remain/)
        assert.match(checkout, /pending, attempted\/uncertain, rejected with observed head, or confirmed/)
        assert.match(checkout, /custom merge-driver commands, signing\/editor helpers, rerere reuse/)
    })

    it("keeps board state maintainer-controlled until confirmed terminal outcome", () => {
        const project = fs.readFileSync("workflows/references/pr/project.md", "utf-8")
        assert.match(
            project,
            /`plan_incoming_pr_intake`, `plan_incoming_pr_review`, `plan_incoming_pr_ship`, or `plan_incoming_pr_cancel`/,
        )
        assert.match(project, /Ask Backlog or Todo/)
        assert.match(project, /Stay In Review/)
        assert.match(project, /confirmed closed\/unmerged|confirm closed\/unmerged/i)
        assert.match(project, /never labels, Priority, Phase, Internal ID/)
        assert.match(skill, /Never change the native board merely because a reference was supplied/)
    })

    it("includes safe owned cleanup in the exact ship request without another approval", () => {
        const shipping = fs.readFileSync("workflows/references/pr/shipping.md", "utf-8")
        for (const operation of [
            "commit_incoming_pr_fixes",
            "publish_incoming_pr_fixes",
            "plan_incoming_pr_merge",
            "cleanup_incoming_pr_checkout",
        ])
            assert.ok(shipping.includes(`\`${operation}\``))
        assert.match(shipping, /Do not ask a second merge or cleanup question/)
        assert.match(shipping, /No parent switch\/fetch\/fast-forward/)
        assert.match(shipping, /Cancellation preserves checkout files/)
        assert.match(shipping, /source checkout|source removal|retired|retirement/)
        assert.ok(skill.includes("../../references/pr/shipping.md"))
    })

    it("keeps workflow checks proportional and delegates merge rejection to GitHub", () => {
        const tools = fs.readFileSync("workflows/references/tools.md", "utf-8")
        const common = fs.readFileSync("workflows/references/integrations/forge/merge.md", "utf-8")
        for (const pattern of [
            /## Preflight checks and failure handling/,
            /local commands, Git operations, artifact changes, and integrations/,
            /Cheap, useful local checks are fine/,
            /execute remote operations directly and rely on their authoritative validation/,
            /explain what it prevents that handling the operation's error cannot/,
            /preserve work, stop dependent steps, and report the actual error/,
            /reconcile its actual state before any retry/,
        ])
            assert.match(tools, pattern)
        const shipping = fs.readFileSync("workflows/references/pr/shipping.md", "utf-8")
        for (const source of [common, procedure, shipping]) {
            assert.match(source, /tools\.md#preflight-checks-and-failure-handling/)
            assert.match(source, /GitHub.*(?:validates|validate) access/)
            assert.match(source, /requested.*method, configured protections, and mergeability/)
            assert.match(source, /rejected merge stops/)
        }
    })

    it("shares the repository merge contract with Deliverable finish", () => {
        const common = fs.readFileSync("workflows/references/integrations/forge/merge.md", "utf-8")
        const deliverable = fs.readFileSync("workflows/references/integrations/forge/github.md", "utf-8")
        assert.match(procedure, /shared repository merge contract/)
        assert.match(procedure, /`plan_incoming_pr_merge`/)
        assert.match(procedure, /returned merge arguments unchanged/)
        assert.match(deliverable, /shared repository merge contract/)
        assert.match(deliverable, /`roles\.forge\.finish\.arguments` unchanged/)
        assert.match(common, /one repository merge policy/)
        assert.ok(common.includes("merge_method: squash"))
        assert.match(common, /expectedHeadSha/)
    })

    it("preserves approved published history and gates later writes and merging", () => {
        for (const pattern of [
            /Propose the concrete patch and intended verification, then obtain approval/,
            /verify contributor consent and effective authenticated write access as two separate facts/,
            /Allow edits by maintainers/,
            /“consent is unverified”/,
            /not that consent is missing or still needs granting/,
            /request only its current state/,
            /do not ask the contributor to grant it again/,
            /read schema has no arbitrary-field\/raw-output option/,
            /Exposing it requires an upstream read-output change/,
            /Do not probe an update tool, fabricate the field, or bypass MCP/,
            /verify authenticated write access separately/,
            /missing, denied or ambiguous access stops writes/,
            /Do not widen credentials, enable maintainer edits, or make probe commits\/pushes/,
            /Preserve the approved published history and add new fix commits only/,
            /Obtain explicit push approval for the exact head repository\/ref/,
            /non-fast-forward rejection stops/,
            /repeat verification\/private review/,
            /Only request merge approval after concerns are resolved and required verification passes/,
            /review\/CI evidence for the reviewed head/,
            /rely on GitHub's merge response to validate access/,
            /required local checks that were not run remain blockers to merging/,
            /`expectedHeadSha` equal to the freshly verified reviewed head/,
            /no bypass, protection change, method substitution/,
            /Reconcile an uncertain merge with exact PR get/,
            /Preserve the existing PR title\/body/,
            /Do not create replacement PRs/,
            /contributor\/base branches/,
        ])
            assert.match(procedure, pattern)
    })
})
