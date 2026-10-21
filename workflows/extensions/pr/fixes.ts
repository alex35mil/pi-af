import * as fs from "node:fs"
import * as path from "node:path"
import type { ProviderEvidence } from "../integrations/resource-id-operations.js"
import { checkoutGit, checkoutGitResult, githubSshUrl, headBranchRef } from "./git.js"
import { remoteHead } from "./rebase.js"
import { historicalRebase, stateFacts, type CheckoutState } from "./state.js"
import { checkoutSourcePath, matchesFixCommit, observeCheckout, requireClean, validatePhase } from "./worktree.js"

type Save = (state: CheckoutState) => Promise<void>
type Editing = Extract<CheckoutState, { phase: "fixes" }>
type Committing = Extract<CheckoutState, { phase: "committingFixes" }>
type Committed = Extract<CheckoutState, { phase: "committedFixes" }>
function open(evidence: ProviderEvidence) {
    const response = evidence.response as Record<string, unknown>
    if (response.state !== "open" || response.merged !== false)
        throw new Error("Confirm an open unmerged PR before writing its branch")
}
function messageText(message: string): string {
    if (!message.trim() || message.includes("\0")) throw new Error("Approve a nonempty literal commit message")
    return message.endsWith("\n") ? message : message + "\n"
}

export async function commitFixes(
    directory: string,
    state: Editing | Committing,
    paths: string[],
    message: string,
    evidence: ProviderEvidence,
    save: Save,
    signal?: AbortSignal,
): Promise<CheckoutState> {
    open(evidence)
    const git = (args: string[]) => checkoutGit(directory, args, signal)
    const approved = paths.map((file) => checkoutSourcePath(directory, file)).sort()
    if (new Set(approved).size !== approved.length) throw new Error("Approve unique exact source paths")
    const text = messageText(message)
    let pending: Committing
    if (state.phase === "committingFixes") {
        if (state.fixes.message !== text || JSON.stringify(state.fixes.paths) !== JSON.stringify(approved))
            throw new Error("Recovery must match the exact recorded commit paths/message")
        validatePhase(state, await observeCheckout(directory, state, signal))
        pending = state
    } else {
        const observed = await observeCheckout(directory, state, signal)
        validatePhase(state, observed)
        if (observed.staged || observed.unmerged.length)
            throw new Error("Unexplained index changes; preserve staging before commit")
        const changed = [
            ...new Set([
                ...(
                    await git([
                        "diff",
                        "--name-only",
                        "-z",
                        "--no-ext-diff",
                        "--no-textconv",
                        "--no-renames",
                        state.baselineSha,
                        "--",
                    ])
                )
                    .split("\0")
                    .filter(Boolean),
                ...observed.untracked,
            ]),
        ].sort()
        if (!changed.length) throw new Error("No unpublished fixes to commit; skip the commit step")
        if (JSON.stringify(changed) !== JSON.stringify(approved))
            throw new Error("Changed/untracked paths must match the complete approved fix set")
        for (const file of approved) {
            try {
                if (fs.lstatSync(path.join(directory, file)).isDirectory())
                    throw new Error("Approve individual source files, not recursive directory staging")
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            }
        }
        await git(["var", "GIT_COMMITTER_IDENT"])
        await git(["add", "--force", "--all", "--", ...approved])
        const staged = await observeCheckout(directory, state, signal)
        const treeSha = (await git(["write-tree"])).trim()
        if (treeSha === staged.headCommit?.tree) throw new Error("No actual fix tree change; no empty commit created")
        if (!staged.worktreeMatchesIndex || staged.untracked.length || staged.native.kind !== "none")
            throw new Error("Fix source changed during staging; preserve it and reassess")
        pending = {
            ...stateFacts(state),
            phase: "committingFixes",
            publishedRebase: historicalRebase(state),
            fixes: {
                sourceSha: state.baselineSha,
                treeSha,
                message: text,
                paths: approved,
                indexFingerprint: staged.indexFingerprint,
            },
        }
        await save(pending)
    }
    let observed = await observeCheckout(directory, pending, signal)
    validatePhase(pending, observed)
    let messages = pending.messages
    if (observed.head === pending.fixes.sourceSha) {
        const result = await checkoutGitResult(
            directory,
            ["commit", "--no-verify", "--no-gpg-sign", "--cleanup=verbatim", `--message=${pending.fixes.message}`],
            signal,
        )
        messages = [...messages, ...[result.stdout.trim(), result.stderr.trim()].filter(Boolean)]
        observed = await observeCheckout(directory, pending, signal)
        if (observed.head === pending.fixes.sourceSha)
            throw new Error(`Fix commit did not complete; intent preserved. ${result.stderr}`)
    }
    if (!observed.head || !matchesFixCommit(observed, pending.fixes))
        throw new Error("Fix commit result does not match recorded parent/tree/message; preserve and investigate")
    const completed: Committed = {
        ...stateFacts(pending),
        phase: "committedFixes",
        messages,
        publishedRebase: pending.publishedRebase,
        fixes: { ...pending.fixes, resultSha: observed.head, publication: { kind: "pending" } },
    }
    await save(completed)
    requireClean(observed, completed.fixes.resultSha)
    return completed
}

export async function publishFixes(
    directory: string,
    state: Committed,
    evidence: ProviderEvidence,
    save: Save,
    signal?: AbortSignal,
): Promise<CheckoutState> {
    validatePhase(state, await observeCheckout(directory, state, signal))
    const repository = state.revision.head.repository
    if (!repository) throw new Error("Missing contributor repository identity")
    const ref = await headBranchRef(directory, state.revision.head.ref, signal)
    const confirm = async (candidate: Committed): Promise<CheckoutState> => {
        const result: Editing = {
            ...stateFacts(candidate),
            baselineSha: candidate.fixes.resultSha,
            phase: "fixes",
            publishedRebase: candidate.publishedRebase,
        }
        await save(result)
        return result
    }
    const before = await remoteHead(directory, repository, state.revision.head.ref, signal)
    if (before === state.fixes.resultSha) return confirm(state)
    if (before !== state.fixes.sourceSha) {
        const rejected: Committed = {
            ...state,
            fixes: { ...state.fixes, publication: { kind: "rejected", observedHead: before } },
            messages: [
                ...state.messages,
                "Contributor branch changed or disappeared; local fix commit preserved. No push or history rewrite.",
            ],
        }
        await save(rejected)
        return rejected
    }
    open(evidence)
    validatePhase(state, await observeCheckout(directory, state, signal))
    let attempted: Committed = { ...state, fixes: { ...state.fixes, publication: { kind: "attempted" } } }
    await save(attempted)
    const pushed = await checkoutGitResult(
        directory,
        [
            "push",
            "--porcelain",
            "--no-verify",
            "--recurse-submodules=no",
            "--signed=false",
            githubSshUrl(repository),
            `${state.fixes.resultSha}:${ref}`,
        ],
        signal,
    )
    attempted = {
        ...attempted,
        messages: [...attempted.messages, ...[pushed.stdout.trim(), pushed.stderr.trim()].filter(Boolean)],
    }
    await save(attempted)
    let after: string | null
    try {
        after = await remoteHead(directory, repository, state.revision.head.ref, signal)
    } catch {
        const uncertain = {
            ...attempted,
            messages: [
                ...attempted.messages,
                "Fix publication is uncertain; inspect the exact remote before an approved retry. Do not recommit or force-push.",
            ],
        }
        await save(uncertain)
        return uncertain
    }
    if (after === state.fixes.resultSha) return confirm(attempted)
    const rejected: Committed = {
        ...attempted,
        fixes: { ...attempted.fixes, publication: { kind: "rejected", observedHead: after } },
        messages: [...attempted.messages, "Fix head not confirmed remotely; no retry or force performed."],
    }
    await save(rejected)
    return rejected
}
