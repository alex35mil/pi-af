import { type Static, Type } from "typebox"
import { publicationStateSchema } from "./plan-publication.js"

export const PlanDocumentSchema = publicationStateSchema(Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" }))
export type PlanDocument = Static<typeof PlanDocumentSchema>

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
