import { type Static, Type } from "typebox"
import { compile } from "../../../extensions/__lib/schema.js"
import { publicationStateSchema } from "./plan-publication.js"

// Linear renders any marker as visible text, so a plan document carries none. A pending creation
// remembers the fingerprint of the plan it sent; a published one, the document's identity.
export const PlanDocumentSchema = publicationStateSchema(
    { fingerprint: Type.String({ pattern: "^[0-9a-f]{64}$" }) },
    { id: Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" }), url: Type.String({ minLength: 1 }) },
)
export const PlanDocumentValidator = compile(PlanDocumentSchema)
export type PlanDocument = Static<typeof PlanDocumentSchema>
export type PlanDocumentPending = { fingerprint: string }
export type PlanDocumentPublished = { id: string; url: string }

export function assertPlanDocumentUrl(url: string): void {
    const parsed = new URL(url)
    if (
        parsed.protocol !== "https:" ||
        parsed.host !== "linear.app" ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        !/^\/[^/]+\/document\/[^/]+$/.test(parsed.pathname)
    )
        throw new Error("plan document URL must identify a Linear document")
}
