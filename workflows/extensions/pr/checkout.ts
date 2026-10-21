import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import { StringEnum } from "@earendil-works/pi-ai"
import { withFileMutationQueue, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"

import { EvidenceSchema } from "../integrations/resource-id-tool.js"
import {
    incomingPullRequestContext,
    incomingRevision,
    sameIncomingAddress,
    resolveIncomingLocalPath,
    type IncomingRevision,
} from "../integrations/forge/github/incoming-pr-context.js"
import type { GitHubForge } from "../integrations/config.js"
import { assertGitEnvironment, checkoutGit, githubSshUrl, initializeCheckout, parentGit } from "./git.js"
import {
    readCheckoutState,
    requireProviderRevision,
    saveCheckoutState,
    stateFacts,
    historicalRebase,
    currentPublication,
    IncomingCleanupCompletionSchema,
    type CheckoutState,
} from "./state.js"
import {
    assertBaselineLineage,
    observeCheckout,
    requireClean,
    validatePhase,
    type ObservedCheckout,
} from "./worktree.js"
import { evidenceLocation } from "./paths.js"
import { continueRebase, observeTarget, publishRebase, startRebase } from "./rebase.js"
import { commitFixes, publishFixes } from "./fixes.js"
import { cleanupCheckout, inspectRemoval } from "./cleanup.js"

const common = {
    reference: Type.String({ minLength: 1, description: "Selected GitHub PR URL or #NN" }),
    evidence: EvidenceSchema,
}
const fullSha = Type.String({ pattern: "^[a-fA-F0-9]{40,64}$" })
export const IncomingCheckoutSchema = Type.Union([
    Type.Object(
        {
            ...common,
            operation: StringEnum([
                "prepare",
                "checkout",
                "inspect",
                "beginFixes",
                "observeTarget",
                "publishRebase",
                "publishFixes",
            ] as const),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...common, operation: Type.Literal("rebase"), targetSha: fullSha, expectedHeadSha: fullSha },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...common,
            operation: Type.Literal("continueRebase"),
            resolutionPaths: Type.Array(Type.String({ minLength: 1 }), {
                uniqueItems: true,
                description:
                    "Exact approved checkout-relative conflict-resolution paths; the tool stages only these paths.",
            }),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...common,
            operation: Type.Literal("commitFixes"),
            paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
            message: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...common, operation: Type.Literal("cleanup"), completion: IncomingCleanupCompletionSchema },
        { additionalProperties: false },
    ),
])
export type IncomingCheckoutInput = Static<typeof IncomingCheckoutSchema>

function fingerprint(file: string): string | null {
    try {
        return createHash("sha256").update(fs.readFileSync(file)).digest("hex")
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
        throw error
    }
}
function workingFingerprint(root: string, name: string): string | null {
    let current = root
    try {
        for (const part of name.split(path.sep)) {
            current = path.join(current, part)
            if (fs.lstatSync(current).isSymbolicLink()) return `link:${current}:${fs.readlinkSync(current)}`
        }
        return fs.lstatSync(current).isDirectory() ? "directory" : fingerprint(current)
    } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null
        throw error
    }
}
async function parentState(root: string, signal?: AbortSignal) {
    const git = (args: string[]) => parentGit(root, args, signal)
    const files = (await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]))
        .split("\0")
        .filter(Boolean)
        .sort()
    const metadata = (
        await git([
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "index",
            "--git-path",
            "config",
            "--git-path",
            "config.worktree",
            "--git-path",
            "info/exclude",
        ])
    )
        .trim()
        .split("\n")
    return {
        head: (await git(["rev-parse", "HEAD"])).trim(),
        branch: (await git(["rev-parse", "--symbolic-full-name", "HEAD"])).trim(),
        status: await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
        metadata: metadata.map((file) => [file, fingerprint(file)]),
        files: files.map((file) => [file, workingFingerprint(root, file)]),
    }
}
async function save(file: string, content: string): Promise<void> {
    await withFileMutationQueue(file, () => fs.promises.writeFile(file, content, "utf-8"))
}

export function registerIncomingCheckout(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "incoming_pull_request_checkout",
        label: "incoming_pull_request_checkout",
        description:
            "Perform approved incoming-PR checkout/review setup, inspection, static-fix transition, target observation, or STANDARD REBASE with immediate SHA-pinned --force-with-lease update of the existing contributor branch. Rebase/continuation may create replacement commits and push on success; obtain approval for that exact set and contributor consent/access first. Conflict outcomes preserve work for approved resolution. publishRebase reconciles/retries only the recorded result/lease. GitHub fetch/observation/push use SSH with existing authentication; no HTTPS credential setup or parent/global configuration changes. commitFixes creates only an approved additive commit; publishFixes separately publishes that recorded result without force. cleanup is included in an exact ship/merge request and requires confirmed merge/Project Done plus no extra/unpublished work; it removes only the managed checkout, retaining private evidence, parent state and contributor branches. No contributor-code execution, unapproved commits, GitHub publication/merge, arbitrary Git commands or plain force push. Output is limited to 2000 lines/50KB with complete private evidence paths.",
        parameters: IncomingCheckoutSchema,
        async execute(_id, params, signal, _update, ctx) {
            const input = Value.Parse(IncomingCheckoutSchema, params)
            assertGitEnvironment()
            const root = (await parentGit(ctx.cwd, ["rev-parse", "--show-toplevel"], signal)).trim()
            const context = incomingPullRequestContext(root, input.reference)
            const revision = incomingRevision(context.roles.forge.config, context.incomingPullRequest, input.evidence)
            const local = (name: string) =>
                resolveIncomingLocalPath(root, revision, path.join(context.incomingPullRequest.localDirectory, name))
            const directory = local("checkout")
            const stateFile = local("checkout.json")
            return withFileMutationQueue(stateFile, async () => {
                local("checkout")
                local("checkout.json")
                const before = await parentState(root, signal)
                let result: unknown
                let failure: unknown
                try {
                    result = await operate(
                        root,
                        directory,
                        stateFile,
                        local,
                        revision,
                        context.roles.forge.config,
                        input,
                        signal,
                    )
                } catch (error) {
                    failure = error
                }
                const after = await parentState(root)
                const saved = fs.existsSync(stateFile)
                    ? readCheckoutState(stateFile, revision, context.roles.forge.config)
                    : null
                const publication = saved ? currentPublication(saved) : null
                const localOutcome =
                    saved?.phase === "removed"
                        ? "Managed checkout removed; private evidence retained."
                        : saved?.phase === "deleting"
                          ? "Owned source removal started; inspect saved cleanup state."
                          : "Checkout preserved;"
                if (!isDeepStrictEqual(before, after))
                    throw new Error(
                        `Parent repository changed; no restoration attempted. ${localOutcome} Publication facts: ${JSON.stringify(publication)}. ${failure instanceof Error ? failure.message : ""}`,
                    )
                if (failure)
                    throw new Error(
                        `${failure instanceof Error ? failure.message : String(failure)}\n${localOutcome} parent repository verified unchanged. Publication facts: ${JSON.stringify(publication)}. Do not retry using Bash.`,
                    )
                const details = { ...(result as object), parent: { verifiedUnchanged: true } }
                const output = truncateHead(JSON.stringify(details, null, 2))
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                output.content +
                                (output.truncated
                                    ? `\nOutput truncated; complete checkout state: ${local("checkout-inspection.json")}`
                                    : ""),
                        },
                    ],
                    details,
                }
            })
        },
    })
}

async function operate(
    root: string,
    directory: string,
    stateFile: string,
    local: (name: string) => string,
    revision: IncomingRevision,
    forge: GitHubForge,
    input: IncomingCheckoutInput,
    signal?: AbortSignal,
) {
    let state: CheckoutState
    const persist = (value: CheckoutState) => saveCheckoutState(stateFile, value)
    if (input.operation === "cleanup") {
        const saved = fs.existsSync(stateFile) ? readCheckoutState(stateFile, revision, forge) : null
        return cleanupCheckout(
            root,
            directory,
            local,
            saved,
            revision,
            input.evidence,
            input.completion,
            persist,
            signal,
        )
    }
    if (!fs.existsSync(stateFile)) {
        if (input.operation !== "prepare") throw new Error("No managed checkout: use approved object preparation first")
        if (fs.existsSync(directory))
            throw new Error("Existing unmanaged checkout path; preserve and investigate instead of adopting it")
        if (!revision.head.repository)
            throw new Error("Missing head repository identity; cannot fetch the contributor head")
        fs.mkdirSync(path.dirname(directory), { recursive: true })
        fs.mkdirSync(directory)
        await initializeCheckout(directory, signal)
        const git = (args: string[]) => checkoutGit(directory, args, signal)
        for (const side of [revision.base, revision.head]) {
            const repository = side.repository!
            await git(["fetch", "--no-tags", "--no-recurse-submodules", githubSshUrl(repository), side.sha])
            if ((await git(["cat-file", "-t", side.sha])).trim() !== "commit")
                throw new Error("Fetched PR revision is not a commit")
        }
        const reviewBaseSha = (await git(["merge-base", revision.base.sha, revision.head.sha])).trim()
        if (!/^[a-f0-9]{40,64}$/.test(reviewBaseSha)) throw new Error("Cannot establish contributor review merge-base")
        state = {
            revision,
            evidence: input.evidence,
            reviewBaseSha,
            baselineSha: revision.head.sha,
            providerRevision: revision,
            observation: null,
            messages: [],
            phase: "prepared",
        }
        validatePhase(state, await observeCheckout(directory, state, signal))
        await persist(state)
    } else {
        state = readCheckoutState(stateFile, revision, forge)
        if (state.phase === "removing" || state.phase === "deleting" || state.phase === "removed") {
            if (input.operation === "inspect") return inspectRemoval(root, local, state, revision)
            throw new Error("Checkout was retired for cleanup; no reconstruction or ordinary Git mutation is allowed")
        }
        if (state.phase === "fixes" || state.phase === "committingFixes" || state.phase === "committedFixes")
            await assertBaselineLineage(directory, state, signal)
        const original = state.revision
        const baseline = (
            await checkoutGit(directory, ["merge-base", original.base.sha, original.head.sha], signal)
        ).trim()
        if (baseline !== state.reviewBaseSha)
            throw new Error("Recorded original review merge-base does not match fetched revision")
    }
    const git = (args: string[]) => checkoutGit(directory, args, signal)
    const observed = await observeCheckout(directory, state, signal)
    const inspection = await inspect(root, local, state, revision, observed, git)
    if (input.operation === "inspect") return inspection
    if (input.operation === "observeTarget") {
        state = await observeTarget(directory, state, revision, signal)
        await persist(state)
        return inspect(root, local, state, revision, observed, git)
    }
    requireProviderRevision(state, revision)
    try {
        validatePhase(state, observed)
    } catch (error) {
        throw new Error(`${(error as Error).message}. Actual state: ${inspection.paths.inspection.absolute}`)
    }
    if (input.operation === "checkout") {
        if (state.phase !== "prepared" && state.phase !== "contributorReview")
            throw new Error("Cannot return to contributor review over a fix draft or rebase")
        if (state.phase === "prepared") {
            await git(["checkout", "--detach", "--no-recurse-submodules", state.revision.head.sha])
            const original = await observeCheckout(directory, state, signal)
            requireClean(original, state.revision.head.sha)
            if (!original.indexMatchesContributorHead)
                throw new Error("Exact contributor-head index verification failed")
            await git(["reset", "--soft", state.reviewBaseSha])
            state = { ...stateFacts(state), phase: "contributorReview" }
            validatePhase(state, await observeCheckout(directory, state, signal))
            await persist(state)
        }
    } else if (input.operation === "beginFixes") {
        if (state.phase === "prepared") throw new Error("Contributor review must finish before beginning fixes")
        if (state.phase !== "contributorReview" && state.phase !== "fixes")
            throw new Error("Complete the approved commit/rebase/publication before beginning another fix draft")
        if (state.phase === "contributorReview") {
            await git(["reset", "--soft", state.revision.head.sha])
            requireClean(await observeCheckout(directory, state, signal), state.revision.head.sha)
            state = { ...stateFacts(state), phase: "fixes", publishedRebase: null }
            await persist(state)
        }
    } else if (input.operation === "rebase") {
        if (state.phase !== "fixes") throw new Error("Rebase requires a clean contributor-head fixes state")
        state = await startRebase(
            directory,
            state,
            revision,
            input.targetSha.toLowerCase(),
            input.expectedHeadSha.toLowerCase(),
            persist,
            signal,
        )
    } else if (input.operation === "continueRebase") {
        if (state.phase !== "rebasing") throw new Error("No managed native rebase to continue")
        state = await continueRebase(directory, state, input.resolutionPaths, persist, signal)
    } else if (input.operation === "publishRebase") {
        if (state.phase !== "rebased") throw new Error("No completed unpublished rebase to reconcile")
        state = await publishRebase(directory, state, persist, signal)
    } else if (input.operation === "commitFixes") {
        if (state.phase !== "fixes" && state.phase !== "committingFixes")
            throw new Error("Fix commit requires an approved draft or its recorded commit intent")
        state = await commitFixes(directory, state, input.paths, input.message, input.evidence, persist, signal)
    } else if (input.operation === "publishFixes") {
        if (state.phase !== "committedFixes") throw new Error("No recorded unpublished additive fix commit")
        state = await publishFixes(directory, state, input.evidence, persist, signal)
    }
    return inspect(root, local, state, revision, await observeCheckout(directory, state, signal), git)
}

async function inspect(
    root: string,
    local: (name: string) => string,
    state: CheckoutState,
    providerRevision: IncomingRevision,
    observed: ObservedCheckout,
    git: (args: string[]) => Promise<string>,
) {
    const location = (name: string) => evidenceLocation(root, local(name))
    const paths = {
        checkout: location("checkout"),
        record: location("checkout.json"),
        inspection: location("checkout-inspection.json"),
        contributionDiff: location("checkout-contribution.diff"),
        fixesDiff: location("checkout-fixes.diff"),
        publishedFixesDiff: location("checkout-published-fixes.diff"),
        rebaseDiff: location("checkout-rebase.diff"),
        conflictsDiff: location("checkout-conflicts.diff"),
        untracked: location("checkout-untracked.json"),
    }
    const contribution = await git([
        "diff",
        "--binary",
        "--no-ext-diff",
        "--no-textconv",
        state.reviewBaseSha,
        state.revision.head.sha,
        "--",
    ])
    const editing = state.phase === "fixes" || state.phase === "committingFixes" || state.phase === "committedFixes"
    const historical = historicalRebase(state)
    const fixes = editing
        ? await git(["diff", "--binary", "--no-ext-diff", "--no-textconv", state.baselineSha, "--"])
        : ""
    const publishedFixes = editing
        ? await git([
              "diff",
              "--binary",
              "--no-ext-diff",
              "--no-textconv",
              historical?.resultSha ?? state.revision.head.sha,
              state.baselineSha,
              "--",
          ])
        : ""
    const rebase = state.phase === "rebasing" || state.phase === "rebased" ? state.rebase : historical
    const integrationHead =
        state.phase === "rebasing"
            ? observed.head
            : state.phase === "rebased"
              ? state.rebase.resultSha
              : historical?.resultSha
    const rebased =
        rebase && integrationHead
            ? await git(["diff", "--binary", "--no-ext-diff", "--no-textconv", rebase.sourceSha, integrationHead, "--"])
            : ""
    const conflicts = observed.unmerged.length
        ? await git(["diff", "--cc", "--no-ext-diff", "--no-textconv", "--"])
        : ""
    await save(paths.contributionDiff.absolute, contribution)
    await save(paths.fixesDiff.absolute, fixes)
    await save(paths.publishedFixesDiff.absolute, publishedFixes)
    await save(paths.rebaseDiff.absolute, rebased)
    await save(paths.conflictsDiff.absolute, conflicts)
    await save(paths.untracked.absolute, JSON.stringify(observed.untracked, null, 2) + "\n")
    let phaseValid = true
    try {
        validatePhase(state, observed)
    } catch {
        phaseValid = false
    }
    const result = {
        paths,
        revision: state.revision,
        providerRevision,
        reviewBaseSha: state.reviewBaseSha,
        baselineSha: state.baselineSha,
        observation: state.observation,
        phase: state.phase,
        phaseValid,
        rebase,
        fixCommit: state.phase === "committingFixes" || state.phase === "committedFixes" ? state.fixes : null,
        messages: state.messages,
        providerAddressMatches: sameIncomingAddress(state.revision, providerRevision),
        providerHeadMatchesBaseline: providerRevision.head.sha === state.baselineSha,
        git: observed,
        limitations: [
            "Git cannot inspect unsaved editor buffers; confirm before phase changes.",
            "Submodules/filter/LFS assets are not fetched; a checkout is not an execution sandbox.",
            "Rebase conflicts use ours=target plus already replayed commits, theirs=the contributor commit being replayed. Rebase publication does not mean tests passed.",
        ],
    }
    await save(paths.inspection.absolute, JSON.stringify(result, null, 2) + "\n")
    return result
}
