import { type TSchema, Type } from "typebox"

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

export interface PublicationAdapter<I> {
    state: PublicationState<I>
    presentation: "github-plan-comment" | "linear-plan-document"
    save(state: PublicationState<I>): void
    create(content: string): NativePublicationCall
    update(id: I, content: string): NativePublicationCall
    record(evidence: ProviderEvidence, token: string): PublicationIdentity<I>
    recoveryLookups(): NativePublicationCall[]
    // Without a token (Epic restore), matches any single plan publication marker.
    recover(evidence: ProviderEvidence[], token?: string): PublicationCandidate<I>[] | RecoveryReads
    verification:
        | { kind: "direct" }
        | {
              kind: "document-parent"
              lookups(id: I): NativePublicationCall[]
              verify(document: ProviderEvidence, parent: ProviderEvidence, identity: PublicationIdentity<I>): void
          }
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
