import { type TSchema, Type } from "typebox"

import type { AnnouncementPlan } from "./plan-announcement.js"
import type { ProviderEvidence } from "./resource-id-operations.js"

export function publicationStateSchema<I extends TSchema>(id: I) {
    const token = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" })
    return Type.Union([
        Type.Object({ state: Type.Literal("unpublished") }, { additionalProperties: false }),
        Type.Object({ state: Type.Literal("pending"), token }, { additionalProperties: false }),
        Type.Object(
            { state: Type.Literal("published"), token, id, url: Type.String({ minLength: 1 }) },
            { additionalProperties: false },
        ),
    ])
}

export type PublicationIdentity<I> = { id: I; url: string }
export type PublicationState<I> =
    | { state: "unpublished" }
    | { state: "pending"; token: string }
    | ({ state: "published"; token: string } & PublicationIdentity<I>)
export type NativePublicationCall = { tool: string; arguments: Record<string, unknown> }
export type PublicationCandidate<I> = PublicationIdentity<I> & { body: string }
export type RecoveryReads = { state: "recovery-read-required"; lookups: NativePublicationCall[] }

// Discussion comments on the tracker item that announce an Epic plan update.
export interface AnnouncementAdapter {
    create(body: string): NativePublicationCall
    lookups(): NativePublicationCall[]
    // Validates creation evidence for the announcement carrying this token.
    record(evidence: ProviderEvidence, token: string): void
    // Every comment body on the item, from complete pages.
    bodies(pages: ProviderEvidence[]): string[]
}

export interface PublicationAdapter<I> {
    state: PublicationState<I>
    presentation: "github-plan-comment" | "linear-plan-document"
    save(state: PublicationState<I>): void
    create(content: string): NativePublicationCall
    update(id: I, content: string): NativePublicationCall
    // `direct`: an unannounced update needs no reads first. `current-reads`: every update first
    // proves the published plan's identity and scope through `currentReads`.
    updateCheck: "direct" | "current-reads"
    // Validates clear-success evidence of an update to the published plan; returns the sent body.
    recordUpdate(evidence: ProviderEvidence, saved: PublishedPlan<I>): string
    // The reads that prove the published plan's identity and current content.
    currentReads(id: I): NativePublicationCall[]
    // The published plan's current body, from those reads, after checking its identity.
    currentBody(reads: ProviderEvidence[], saved: PublishedPlan<I>): string
    announcements(): AnnouncementAdapter
    // Where an announcement's plan link points for the published plan.
    announcementPlan(saved: PublishedPlan<I>): AnnouncementPlan
    record(evidence: ProviderEvidence, token: string): PublicationIdentity<I>
    recoveryLookups(): NativePublicationCall[]
    // Without a token (Epic restore), matches any single plan publication marker.
    recover(evidence: ProviderEvidence[], token?: string): PublicationCandidate<I>[] | RecoveryReads
}

export type PublishedPlan<I> = Extract<PublicationState<I>, { state: "published" }>

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
