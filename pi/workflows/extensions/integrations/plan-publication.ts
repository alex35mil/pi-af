import { type TProperties, Type } from "typebox"

import type { AnnouncementPlan } from "./plan-announcement.js"
import type { ProviderEvidence } from "./resource-id-operations.js"

export const PublicationTokenSchema = Type.String({
    pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
})

// Each provider decides what a pending creation and a confirmed publication remember.
export function publicationStateSchema<P extends TProperties, Q extends TProperties>(pending: P, published: Q) {
    return Type.Union([
        Type.Object({ state: Type.Literal("unpublished") }, { additionalProperties: false }),
        Type.Object({ state: Type.Literal("pending"), ...pending }, { additionalProperties: false }),
        Type.Object({ state: Type.Literal("published"), ...published }, { additionalProperties: false }),
    ])
}

export type PublicationIdentity<I> = { id: I; url: string }
export type PublicationState<P, Q> =
    | { state: "unpublished" }
    | ({ state: "pending" } & P)
    | ({ state: "published" } & Q)
export type Pending<P> = { state: "pending" } & P
export type Published<Q> = { state: "published" } & Q
export type PublicationPhase = PublicationState<object, object>["state"]
export type NativePublicationCall = { tool: string; arguments: Record<string, unknown> }
export type RecoveryReads = { state: "recovery-read-required"; lookups: NativePublicationCall[] }
// A published plan found on the tracker item, with its full body.
export type FoundPublication<Q> = { published: Published<Q>; body: string }

// What complete recovery reads prove about a pending or published plan.
export type RecoveryOutcome<Q> =
    | RecoveryReads
    // No publication landed, so the create is safe to send.
    | { state: "absent" }
    | ({ state: "found" } & FoundPublication<Q>)
    | { state: "blocked"; reason: string }

// Discussion comments on the entity's own tracker item that announce an update to its published plan.
export interface AnnouncementAdapter {
    create(body: string): NativePublicationCall
    lookups(): NativePublicationCall[]
    // Validates clear-success creation evidence for the announcement carrying this token.
    record(evidence: ProviderEvidence, token: string): void
    // The comments on the item carrying this announcement token, from complete pages.
    matching(pages: ProviderEvidence[], token: string): string[]
}

export interface PublicationAdapter<I, P, Q extends PublicationIdentity<I>> {
    state: PublicationState<P, Q>
    save(state: PublicationState<P, Q>): void
    // The create for the source, and the pending state to save before it runs. A retry after
    // confirmed absence passes the saved pending state.
    create(source: string, retry?: Pending<P>): { mutation: NativePublicationCall; pending: Pending<P> }
    update(saved: Published<Q>, source: string): NativePublicationCall
    // Validates clear-success evidence of an update to the published plan; returns the sent body.
    recordUpdate(evidence: ProviderEvidence, saved: Published<Q>): string
    // The reviewed source rebuilt from a published body; the root title comes from the tracker item.
    restore(body: string, title: string): string
    // The reads that prove the published plan's identity and current content.
    currentReads(saved: Published<Q>): NativePublicationCall[]
    // The published plan's current body, from those reads, after checking its identity.
    currentBody(reads: ProviderEvidence[], saved: Published<Q>): string
    announcements(): AnnouncementAdapter
    // Where an announcement's plan link points for the published plan.
    announcementPlan(saved: Published<Q>): AnnouncementPlan
    // Validates clear-success creation evidence for the pending plan; returns the published state.
    record(evidence: ProviderEvidence, pending: Pending<P>): Published<Q>
    recoveryLookups(): NativePublicationCall[]
    recover(evidence: ProviderEvidence[], saved: Pending<P> | Published<Q>): RecoveryOutcome<Q>
    // Every published plan on the tracker item, for Epic restore.
    restoreCandidates(evidence: ProviderEvidence[]): FoundPublication<Q>[] | RecoveryReads
}

export function planPublicationMarker(token: string): string {
    return `<!-- plan-publication:${token} -->`
}

// With no token, matches a body carrying exactly one plan publication marker of any token.
export function hasPublicationMarker(body: unknown, token?: string): body is string {
    const marker = token === undefined ? /^<!-- plan-publication:[^ >]+ -->$/ : undefined
    return (
        typeof body === "string" &&
        body.split(/\r?\n/).filter((line) => (marker ? marker.test(line) : line === planPublicationMarker(token!)))
            .length === 1
    )
}
