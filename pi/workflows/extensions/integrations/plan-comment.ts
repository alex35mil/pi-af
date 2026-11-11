import { type Static, Type } from "typebox"
import { compile } from "../../../extensions/__lib/schema.js"
import { PublicationTokenSchema, publicationStateSchema } from "./plan-publication.js"

// A GitHub plan comment carries a hidden marker with its token, which GitHub doesn't render.
export const PlanCommentSchema = publicationStateSchema(
    { token: PublicationTokenSchema },
    {
        token: PublicationTokenSchema,
        id: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        url: Type.String({ minLength: 1 }),
    },
)
export const PlanCommentValidator = compile(PlanCommentSchema)
export type PlanComment = Static<typeof PlanCommentSchema>
export type PlanCommentPending = { token: string }
export type PlanCommentPublished = { token: string; id: number; url: string }

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
