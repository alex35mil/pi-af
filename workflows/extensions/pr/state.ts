import * as fs from "node:fs"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"

import { EvidenceSchema } from "../integrations/resource-id-tool.js"
import {
    incomingRevision,
    sameIncomingAddress,
    sameIncomingRevision,
    type IncomingRevision,
} from "../integrations/forge/github/incoming-pr-context.js"
import type { GitHubForge } from "../integrations/config.js"

const sha = Type.String({ pattern: "^[a-f0-9]{40,64}$" })
const repository = Type.Object({ owner: Type.String(), repo: Type.String() }, { additionalProperties: false })
const revision = Type.Object(
    {
        repository,
        number: Type.Integer({ minimum: 1 }),
        url: Type.String(),
        kind: Type.Literal("incomingPullRequest"),
        mcpServer: Type.String(),
        base: Type.Object({ repository, ref: Type.String(), sha }, { additionalProperties: false }),
        head: Type.Object(
            { repository: Type.Union([repository, Type.Null()]), ref: Type.String(), sha },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
)
const intent = { sourceSha: sha, targetSha: sha, leaseSha: sha }
const checkpoint = Type.Object(
    { nativeFingerprint: Type.String(), indexFingerprint: Type.String() },
    { additionalProperties: false },
)
const active = Type.Object(
    { ...intent, checkpoint: Type.Union([checkpoint, Type.Null()]) },
    { additionalProperties: false },
)
const publication = Type.Union([
    Type.Object({ kind: Type.Literal("pending") }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal("attempted") }, { additionalProperties: false }),
    Type.Object(
        { kind: Type.Literal("rejected"), observedHead: Type.Union([sha, Type.Null()]) },
        { additionalProperties: false },
    ),
    Type.Object({ kind: Type.Literal("confirmed"), headSha: sha }, { additionalProperties: false }),
])
const completed = Type.Object({ ...intent, resultSha: sha, publication }, { additionalProperties: false })
const published = Type.Union([completed, Type.Null()])
const fixIntent = {
    sourceSha: sha,
    treeSha: sha,
    message: Type.String({ minLength: 1 }),
    paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
    indexFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
}
export const IncomingCleanupCompletionSchema = Type.Union([
    Type.Object({ kind: Type.Literal("forgeOnly") }, { additionalProperties: false }),
    Type.Object(
        { kind: Type.Literal("project"), fieldEvidence: EvidenceSchema, itemEvidence: EvidenceSchema },
        { additionalProperties: false },
    ),
])
export type IncomingCleanupCompletion = Static<typeof IncomingCleanupCompletionSchema>
const removal = Type.Object(
    {
        sourcePhase: Type.Union([Type.Literal("prepared"), Type.Literal("contributorReview"), Type.Literal("fixes")]),
        retiredName: Type.String({ pattern: "^checkout\\.removing-[a-f0-9-]{36}$" }),
        evidence: EvidenceSchema,
        completion: IncomingCleanupCompletionSchema,
    },
    { additionalProperties: false },
)
const core = {
    revision,
    evidence: EvidenceSchema,
    reviewBaseSha: sha,
    baselineSha: sha,
    providerRevision: revision,
    messages: Type.Array(Type.String()),
    observation: Type.Union([
        Type.Object({ targetSha: sha, headSha: sha }, { additionalProperties: false }),
        Type.Null(),
    ]),
}
export const CheckoutStateSchema = Type.Union([
    Type.Object({ ...core, phase: Type.Literal("prepared") }, { additionalProperties: false }),
    Type.Object({ ...core, phase: Type.Literal("contributorReview") }, { additionalProperties: false }),
    Type.Object(
        { ...core, phase: Type.Literal("fixes"), publishedRebase: Type.Union([completed, Type.Null()]) },
        { additionalProperties: false },
    ),
    Type.Object({ ...core, phase: Type.Literal("rebasing"), rebase: active }, { additionalProperties: false }),
    Type.Object({ ...core, phase: Type.Literal("rebased"), rebase: completed }, { additionalProperties: false }),
    Type.Object(
        {
            ...core,
            phase: Type.Literal("committingFixes"),
            publishedRebase: published,
            fixes: Type.Object(fixIntent, { additionalProperties: false }),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...core,
            phase: Type.Literal("committedFixes"),
            publishedRebase: published,
            fixes: Type.Object({ ...fixIntent, resultSha: sha, publication }, { additionalProperties: false }),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...core, phase: Type.Literal("removing"), publishedRebase: published, removal },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...core, phase: Type.Literal("deleting"), publishedRebase: published, removal },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...core, phase: Type.Literal("removed"), publishedRebase: published, removal },
        { additionalProperties: false },
    ),
])
export type CheckoutState = Static<typeof CheckoutStateSchema>
export type ActiveRebase = Static<typeof active>
export type CompletedRebase = Static<typeof completed>

export function historicalRebase(state: CheckoutState): CompletedRebase | null {
    return "publishedRebase" in state ? state.publishedRebase : null
}
export function currentPublication(state: CheckoutState) {
    if (state.phase === "committedFixes") return state.fixes.publication
    if (state.phase === "rebased") return state.rebase.publication
    return historicalRebase(state)?.publication ?? null
}

export function stateFacts(state: CheckoutState) {
    const { revision, evidence, reviewBaseSha, baselineSha, providerRevision, messages, observation } = state
    return { revision, evidence, reviewBaseSha, baselineSha, providerRevision, messages, observation }
}

export function readCheckoutState(file: string, current: IncomingRevision, forge: GitHubForge): CheckoutState {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf-8"))
    if (!Value.Check(CheckoutStateSchema, value))
        throw new Error("Invalid managed checkout record; preserve it and investigate")
    const state = value
    const original = incomingRevision(forge, state.revision, state.evidence)
    if (!sameIncomingRevision(original, state.revision))
        throw new Error("Original checkout evidence does not match its recorded revision")
    if (
        state.revision.number !== current.number ||
        state.revision.repository.owner !== current.repository.owner ||
        state.revision.repository.repo !== current.repository.repo ||
        !sameIncomingAddress(state.revision, state.providerRevision)
    )
        throw new Error("Managed checkout does not belong to this PR or has inconsistent stored addressing")
    if (
        (state.phase === "committingFixes" || state.phase === "committedFixes") &&
        state.fixes.sourceSha !== state.baselineSha
    )
        throw new Error("Fix commit source does not match the published baseline")
    const integration = historicalRebase(state)
    if (integration && integration.publication.kind !== "confirmed") throw new Error("Invalid confirmed rebase history")
    return state
}

export function requireAddress(state: CheckoutState, current: IncomingRevision): void {
    if (!sameIncomingAddress(state.revision, current))
        throw new Error("PR addressing changed; preserve existing checkout and reassess")
}

export function requireProviderRevision(state: CheckoutState, current: IncomingRevision): void {
    requireAddress(state, current)
    const result =
        state.phase === "rebased"
            ? state.rebase.resultSha
            : state.phase === "committedFixes"
              ? state.fixes.resultSha
              : null
    const expected = result ? [state.baselineSha, result] : [state.baselineSha]
    if (!expected.includes(current.head.sha))
        throw new Error("PR head/revision changed; reassess before mutation. Existing checkout preserved")
    const published = historicalRebase(state) !== null
    const knownPublishedResult = result !== null && current.head.sha === result
    if (!published && !knownPublishedResult && current.base.sha !== state.providerRevision.base.sha)
        throw new Error(
            "Provider base revision changed; observe and reassess before mutation. Existing checkout preserved",
        )
}

export async function saveCheckoutState(file: string, state: CheckoutState): Promise<void> {
    Value.Parse(CheckoutStateSchema, state)
    // Caller holds this record's mutation queue for the full operation.
    const temporary = `${file}.tmp`
    await fs.promises.writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { flag: "wx" })
    await fs.promises.rename(temporary, file)
}
