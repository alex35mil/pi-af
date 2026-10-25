import * as fs from "node:fs"
import { randomUUID } from "node:crypto"
import type { McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import type { IncomingRevision } from "../integrations/forge/github/incoming-pr-context.js"
import { incomingPullRequestContext } from "../integrations/forge/github/incoming-pr-context.js"
import { incomingProjectContext } from "../integrations/forge/github/incoming-pr-project.js"
import { planGitHubMerge } from "../integrations/forge/github/merge.js"
import type { ProviderEvidence } from "../integrations/resource-id-operations.js"
import { checkoutGit } from "./git.js"
import {
    historicalRebase,
    requireAddress,
    stateFacts,
    type CheckoutState,
    type IncomingCleanupCompletion,
} from "./state.js"
import { assertBaselineLineage, observeCheckout, requireClean, validatePhase } from "./worktree.js"
import { evidenceLocation } from "./paths.js"

type Save = (state: CheckoutState) => Promise<void>
type Removal = Extract<CheckoutState, { phase: "removing" | "deleting" | "removed" }>
type Removable = Extract<CheckoutState, { phase: "prepared" | "contributorReview" | "fixes" }>
function sourceState(state: Removal): Removable {
    const facts = stateFacts(state)
    if (state.removal.sourcePhase === "prepared") return { ...facts, phase: "prepared" }
    if (state.removal.sourcePhase === "contributorReview") return { ...facts, phase: "contributorReview" }
    return { ...facts, phase: "fixes", publishedRebase: state.publishedRebase }
}
async function safeSource(directory: string, state: Removable, signal?: AbortSignal) {
    const observed = await observeCheckout(directory, state, signal)
    validatePhase(state, observed)
    if (state.phase === "fixes") {
        requireClean(observed, state.baselineSha)
        await assertBaselineLineage(directory, state, signal)
    }
    if (observed.untracked.length || observed.unmerged.length || observed.native.kind !== "none")
        throw new Error("Unpublished source/native work blocks cleanup")
    const refs = await checkoutGit(directory, ["for-each-ref", "--format=%(refname)"], signal)
    if (refs.trim()) throw new Error("Additional local refs/branches/stash are preserved; cleanup refused")
    const worktrees = await checkoutGit(directory, ["worktree", "list", "--porcelain"], signal)
    if (worktrees.split("\n").filter((line) => line.startsWith("worktree ")).length > 1)
        throw new Error("Additional linked worktrees are preserved; cleanup refused")
}
function completion(
    root: string,
    current: IncomingRevision,
    state: CheckoutState | null,
    evidence: ProviderEvidence,
    done: IncomingCleanupCompletion,
    tools: McpToolCatalog,
) {
    if (state) requireAddress(state, current)
    const expected = state?.revision ?? current
    const proof = planGitHubMerge(
        {
            mcpServer: expected.mcpServer,
            repository: expected.repository,
            number: expected.number,
            base: expected.base.ref,
            head: { repository: expected.head.repository, ref: expected.head.ref },
            expectedHeadSha: state?.baselineSha ?? current.head.sha,
        },
        evidence,
        tools,
    )
    if (proof.state !== "merged")
        throw new Error("Cleanup requires exact matching confirmed merge/head/timestamp evidence")
    const context = incomingPullRequestContext(root, current.url, tools)
    if (context.project.state === "enabled") {
        if (done.kind !== "project") throw new Error("Configured Project Done must be confirmed before cleanup")
        const planned = incomingProjectContext(
            root,
            {
                operation: "incomingPullRequestProject",
                reference: current.url,
                evidence,
                fieldEvidence: done.fieldEvidence,
                membership: { state: "present", evidence: done.itemEvidence },
                action: "shipping",
            },
            tools,
        )
        if (
            planned.projectAction.state !== "unchanged" ||
            planned.projectAction.status !== context.project.status.values.done
        )
            throw new Error("Project Done is unconfirmed; preserve checkout and resume the unfinished board step")
    } else if (done.kind !== "forgeOnly")
        throw new Error("Use explicit forge-only completion only with no configured GitHub Project")
    return proof.merge
}

export function inspectRemoval(
    root: string,
    local: (name: string) => string,
    state: Removal,
    current: IncomingRevision,
) {
    const retired = local(state.removal.retiredName)
    return {
        phase: state.phase,
        phaseValid: true,
        revision: state.revision,
        providerRevision: current,
        baselineSha: state.baselineSha,
        paths: {
            checkout: evidenceLocation(root, local("checkout")),
            retired: evidenceLocation(root, retired),
            record: evidenceLocation(root, local("checkout.json")),
        },
        cleanup: {
            state: state.phase,
            retiredExists: fs.existsSync(retired),
            replacementAtOriginalPath: fs.existsSync(local("checkout")),
        },
        messages: state.messages,
        limitations: [
            "Source has been retired for owned cleanup; no reconstruction or parent Git discovery is performed.",
        ],
    }
}

export async function cleanupCheckout(
    root: string,
    directory: string,
    local: (name: string) => string,
    state: CheckoutState | null,
    current: IncomingRevision,
    evidence: ProviderEvidence,
    done: IncomingCleanupCompletion,
    save: Save,
    tools: McpToolCatalog,
    signal?: AbortSignal,
) {
    completion(root, current, state, evidence, done, tools)
    signal?.throwIfAborted()
    if (!state) {
        if (fs.existsSync(directory)) throw new Error("Unmanaged checkout preserved; cleanup cannot adopt or remove it")
        return {
            phase: "absent",
            cleanup: { state: "notNeeded" },
            paths: { checkout: evidenceLocation(root, directory) },
        }
    }
    if (state.phase === "removed") return inspectRemoval(root, local, state, current)
    let removing: Removal
    if (state.phase === "removing" || state.phase === "deleting") removing = state
    else {
        if (state.phase !== "prepared" && state.phase !== "contributorReview" && state.phase !== "fixes")
            throw new Error("Pending fix/rebase/native work blocks cleanup; preserve it")
        await safeSource(directory, state, signal)
        removing = {
            ...stateFacts(state),
            providerRevision: current,
            phase: "removing",
            publishedRebase: historicalRebase(state),
            removal: {
                sourcePhase: state.phase,
                retiredName: `checkout.removing-${randomUUID()}`,
                evidence,
                completion: done,
            },
        }
        await save(removing)
    }
    const retired = local(removing.removal.retiredName)
    if (removing.phase === "removing") {
        if (!fs.existsSync(retired) && fs.existsSync(directory)) {
            await safeSource(directory, sourceState(removing), signal)
            signal?.throwIfAborted()
            await fs.promises.rename(directory, retired)
        }
        if (fs.existsSync(retired)) await safeSource(retired, sourceState(removing), signal)
        signal?.throwIfAborted()
        removing = { ...removing, phase: "deleting" }
        await save(removing)
    }
    // This owned path is never an editing destination. A newly recreated original checkout
    // remains untouched even when deletion is resumed after process interruption.
    signal?.throwIfAborted()
    if (fs.existsSync(retired)) await fs.promises.rm(retired, { recursive: true })
    const removed: Removal = {
        ...removing,
        phase: "removed",
        messages: [
            ...removing.messages,
            "Confirmed merged checkout removed; notes/reviews, parent repository and contributor branches retained.",
        ],
    }
    await save(removed)
    return inspectRemoval(root, local, removed, current)
}
