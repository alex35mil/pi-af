import type { IncomingRevision, Repository } from "../integrations/forge/github/incoming-pr-context.js"
import { checkoutGit, checkoutGitResult, githubSshUrl, headBranchRef, type GitResult } from "./git.js"
import { requireAddress, stateFacts, type CheckoutState } from "./state.js"
import { checkoutSourcePath, observeCheckout, requireClean, validatePhase } from "./worktree.js"

type Save = (state: CheckoutState) => Promise<void>
type Rebasing = Extract<CheckoutState, { phase: "rebasing" }>
type Rebased = Extract<CheckoutState, { phase: "rebased" }>

export async function remoteHead(
    directory: string,
    repository: Repository,
    ref: string,
    signal?: AbortSignal,
): Promise<string | null> {
    const full = await headBranchRef(directory, ref, signal)
    const result = await checkoutGitResult(
        directory,
        ["ls-remote", "--exit-code", "--refs", githubSshUrl(repository), full],
        signal,
    )
    if (result.code === 2) return null
    if (result.code !== 0) throw new Error(`Cannot observe verified branch ${full}: ${result.stderr}`)
    const lines = result.stdout.trim().split("\n")
    const parts = lines[0].split("\t")
    if (lines.length !== 1 || parts[1] !== full || !/^[a-f0-9]{40,64}$/.test(parts[0]))
        throw new Error("Git observation did not return the exact verified branch/full SHA")
    return parts[0]
}
export async function observeTarget(
    directory: string,
    state: CheckoutState,
    current: IncomingRevision,
    signal?: AbortSignal,
): Promise<CheckoutState> {
    requireAddress(state, current)
    const headRepository = state.revision.head.repository
    if (!headRepository) throw new Error("Missing contributor repository identity")
    const targetSha = await remoteHead(directory, state.revision.base.repository, state.revision.base.ref, signal)
    const headSha = await remoteHead(directory, headRepository, state.revision.head.ref, signal)
    if (!targetSha || !headSha)
        throw new Error("Verified target or contributor branch is missing; preserve checkout and reassess")
    return { ...state, providerRevision: current, observation: { targetSha, headSha } }
}

function messages(state: CheckoutState, result: GitResult): string[] {
    return [...state.messages, ...[result.stdout.trim(), result.stderr.trim()].filter(Boolean)]
}
export async function publishRebase(
    directory: string,
    state: Rebased,
    save: Save,
    signal?: AbortSignal,
): Promise<CheckoutState> {
    requireClean(await observeCheckout(directory, state, signal), state.rebase.resultSha)
    const repository = state.revision.head.repository
    if (!repository) throw new Error("Missing contributor repository identity")
    const ref = await headBranchRef(directory, state.revision.head.ref, signal)
    const confirm = async (candidate: Rebased): Promise<CheckoutState> => {
        const published = {
            ...candidate.rebase,
            publication: { kind: "confirmed" as const, headSha: candidate.rebase.resultSha },
        }
        const result: CheckoutState = {
            ...stateFacts(candidate),
            baselineSha: published.resultSha,
            phase: "fixes",
            publishedRebase: published,
        }
        await save(result)
        return result
    }
    const observed = await remoteHead(directory, repository, state.revision.head.ref, signal)
    if (observed === state.rebase.resultSha) return confirm(state)
    if (observed !== state.rebase.leaseSha) {
        const rejected: Rebased = {
            ...state,
            rebase: { ...state.rebase, publication: { kind: "rejected", observedHead: observed } },
            messages: [
                ...state.messages,
                "Contributor branch changed or disappeared. Lease rejected; local rebased result and remote work preserved.",
            ],
        }
        await save(rejected)
        return rejected
    }
    // Re-check local state after transport reads, before the irreversible operation.
    requireClean(await observeCheckout(directory, state, signal), state.rebase.resultSha)
    let attempted: Rebased = { ...state, rebase: { ...state.rebase, publication: { kind: "attempted" } } }
    await save(attempted)
    const pushed = await checkoutGitResult(
        directory,
        [
            "push",
            "--porcelain",
            "--no-verify",
            "--recurse-submodules=no",
            "--signed=false",
            `--force-with-lease=${ref}:${state.rebase.leaseSha}`,
            githubSshUrl(repository),
            `${state.rebase.resultSha}:${ref}`,
        ],
        signal,
    )
    attempted = { ...attempted, messages: messages(attempted, pushed) }
    await save(attempted)
    let after: string | null
    try {
        after = await remoteHead(directory, repository, state.revision.head.ref, signal)
    } catch {
        const uncertain = {
            ...attempted,
            messages: [
                ...attempted.messages,
                "Publication outcome is uncertain. Inspect the exact remote head before an approved publishRebase retry; do not repeat the rebase or replace its lease.",
            ],
        }
        await save(uncertain)
        return uncertain
    }
    if (after === state.rebase.resultSha) return confirm(attempted)
    const rejected: Rebased = {
        ...attempted,
        rebase: { ...attempted.rebase, publication: { kind: "rejected", observedHead: after } },
        messages: [
            ...attempted.messages,
            "Rebased head is not confirmed on the remote branch. No retry or lease refresh performed.",
        ],
    }
    await save(rejected)
    return rejected
}

async function step(
    directory: string,
    state: Rebasing,
    args: string[],
    save: Save,
    signal?: AbortSignal,
): Promise<CheckoutState> {
    const command = await checkoutGitResult(directory, args, signal)
    const observed = await observeCheckout(directory, state, signal)
    if (
        observed.native.kind === "rebase" &&
        observed.native.sourceSha === state.rebase.sourceSha &&
        observed.native.targetSha === state.rebase.targetSha
    ) {
        const pending: Rebasing = {
            ...state,
            messages: messages(state, command),
            rebase: {
                ...state.rebase,
                checkpoint: {
                    nativeFingerprint: observed.native.fingerprint,
                    indexFingerprint: observed.indexFingerprint,
                },
            },
        }
        await save(pending)
        if (command.code === 1 && observed.unmerged.length) return pending
        throw new Error(`Rebase stopped without a verified conflict outcome; native work preserved. ${command.stderr}`)
    }
    if (command.code !== 0 || observed.native.kind !== "none" || !observed.head)
        throw new Error(`Rebase incomplete; preserve native progress and investigate. ${command.stderr}`)
    requireClean(observed, observed.head)
    await checkoutGit(directory, ["merge-base", "--is-ancestor", state.rebase.targetSha, observed.head], signal)
    const completed: Rebased = {
        ...stateFacts(state),
        phase: "rebased",
        messages: messages(state, command),
        rebase: {
            sourceSha: state.rebase.sourceSha,
            targetSha: state.rebase.targetSha,
            leaseSha: state.rebase.leaseSha,
            resultSha: observed.head,
            publication: { kind: "pending" },
        },
    }
    await save(completed)
    return publishRebase(directory, completed, save, signal)
}

export async function startRebase(
    directory: string,
    state: Extract<CheckoutState, { phase: "fixes" }>,
    current: IncomingRevision,
    targetSha: string,
    expectedHeadSha: string,
    save: Save,
    signal?: AbortSignal,
): Promise<CheckoutState> {
    requireClean(await observeCheckout(directory, state, signal), state.baselineSha)
    if (
        !state.observation ||
        state.observation.targetSha !== targetSha ||
        state.observation.headSha !== expectedHeadSha
    )
        throw new Error("Rebase target/source must match the separately observed and approved exact SHAs")
    if (expectedHeadSha !== state.baselineSha || current.head.sha !== expectedHeadSha)
        throw new Error("Contributor branch changed from the managed/provider head; reassess before rebase")
    const fresh = await observeTarget(directory, state, current, signal)
    if (fresh.observation?.targetSha !== targetSha || fresh.observation.headSha !== expectedHeadSha)
        throw new Error("Target or contributor tip changed after observation; obtain renewed exact approval")
    await checkoutGit(directory, ["var", "GIT_COMMITTER_IDENT"], signal)
    await checkoutGit(
        directory,
        ["fetch", "--no-tags", "--no-recurse-submodules", githubSshUrl(state.revision.base.repository), targetSha],
        signal,
    )
    if ((await checkoutGit(directory, ["cat-file", "-t", targetSha], signal)).trim() !== "commit")
        throw new Error("Observed target is not a commit")
    requireClean(await observeCheckout(directory, state, signal), state.baselineSha)
    const pending: Rebasing = {
        ...stateFacts(fresh),
        phase: "rebasing",
        rebase: { sourceSha: state.baselineSha, targetSha, leaseSha: expectedHeadSha, checkpoint: null },
    }
    await save(pending)
    return step(
        directory,
        pending,
        [
            "rebase",
            "--merge",
            "--no-fork-point",
            "--no-rebase-merges",
            "--no-autosquash",
            "--no-autostash",
            "--no-update-refs",
            "--no-gpg-sign",
            "--no-verify",
            "--empty=drop",
            "--no-reapply-cherry-picks",
            targetSha,
        ],
        save,
        signal,
    )
}

export async function continueRebase(
    directory: string,
    state: Rebasing,
    paths: string[],
    save: Save,
    signal?: AbortSignal,
): Promise<CheckoutState> {
    const observed = await observeCheckout(directory, state, signal)
    validatePhase(state, observed)
    const approved = paths.map((file) => checkoutSourcePath(directory, file))
    const conflicts = [...new Set(observed.unmerged.map((entry) => entry.path))]
    if (conflicts.some((file) => !approved.includes(file)))
        throw new Error("Approve each pending conflict resolution path before continuing")
    const dirty = (
        await checkoutGit(directory, ["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--"], signal)
    )
        .split("\0")
        .filter(Boolean)
    if ([...dirty, ...observed.untracked].some((file) => !approved.includes(file)))
        throw new Error(
            "Unexpected edits or untracked additions outside approved resolutions; preserve and investigate",
        )
    if (approved.length) await checkoutGit(directory, ["add", "--force", "--all", "--", ...approved], signal)
    const staged = await observeCheckout(directory, state, signal)
    if (staged.unmerged.length || staged.native.kind !== "rebase")
        throw new Error("Unresolved index or missing native rebase; no continuation performed")
    const ready: Rebasing = {
        ...state,
        rebase: {
            ...state.rebase,
            checkpoint: { nativeFingerprint: staged.native.fingerprint, indexFingerprint: staged.indexFingerprint },
        },
    }
    await save(ready)
    return step(directory, ready, ["rebase", "--continue"], save, signal)
}
