import { type Static, Type } from "typebox"
import { publicationStateSchema } from "./plan-publication.js"

export const PlanCommentSchema = publicationStateSchema(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
export type PlanComment = Static<typeof PlanCommentSchema>

export function assertPlanCommentUrl(
    repository: { owner: string; repo: string },
    issueNumber: number,
    id: number,
    url: string,
): void {
    const parsed = new URL(url)
    if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "github.com" ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.pathname.toLowerCase() !==
            `/${repository.owner}/${repository.repo}/issues/${issueNumber}`.toLowerCase() ||
        parsed.hash !== `#issuecomment-${id}`
    )
        throw new Error("plan comment URL does not match its exact repository, issue and comment ID")
}
