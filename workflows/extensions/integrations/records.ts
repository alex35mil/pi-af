import { type Static, Type } from "typebox"

import {
    LINEAR_IDENTIFIER_PATTERN,
    PRIORITY_NOT_SET,
    TIMESTAMP_PATTERN,
    type TrackerReference,
} from "../__lib/domain.js"
import { PlanAnnouncementSchema } from "./plan-announcement.js"
import { assertPlanCommentUrl, PlanCommentSchema } from "./plan-comment.js"
import { assertPlanDocumentUrl, PlanDocumentSchema } from "./plan-document.js"

const LINEAR_PRIORITIES = {
    Urgent: 1,
    High: 2,
    Medium: 3,
    Low: 4,
    [PRIORITY_NOT_SET]: 0,
} as const
export type LinearPriority = keyof typeof LINEAR_PRIORITIES

export function linearPriorityNumber(priority: string): number {
    if (!Object.hasOwn(LINEAR_PRIORITIES, priority)) {
        throw new Error(`invalid Linear priority ${JSON.stringify(priority)}`)
    }
    return LINEAR_PRIORITIES[priority as LinearPriority]
}

const OneLineSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })
export const LinearIdentifierSchema = Type.String({
    pattern: LINEAR_IDENTIFIER_PATTERN,
})
const TimestampSchema = Type.String({
    pattern: TIMESTAMP_PATTERN,
    description: "ISO 8601 timestamp",
})
const GitHubRepositorySchema = Type.Object(
    { owner: OneLineSchema, repo: OneLineSchema },
    { additionalProperties: false },
)

// The tracker object identified by create or adoption evidence. It exists before the
// local entity and names it; initialization takes it whether new or adopted.
export const GitHubTrackerObjectSchema = Type.Object(
    {
        issueId: Type.Integer({ minimum: 1 }),
        issueNumber: Type.Integer({ minimum: 1 }),
        issueUrl: OneLineSchema,
        projectItemId: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
    },
    { additionalProperties: false },
)
export const LinearProjectObjectSchema = Type.Object(
    {
        projectId: OneLineSchema,
        projectUrl: OneLineSchema,
        createdAt: Type.String({
            pattern: TIMESTAMP_PATTERN,
            description: "The Linear Project's createdAt; it dates the Epic's name",
        }),
    },
    { additionalProperties: false },
)
const linearIssueObject = {
    issueId: OneLineSchema,
    identifier: LinearIdentifierSchema,
    issueUrl: OneLineSchema,
    gitBranchName: Type.Optional(OneLineSchema),
}
export const LinearTaskIssueObjectSchema = Type.Object(
    { ...linearIssueObject, projectId: OneLineSchema },
    { additionalProperties: false },
)
export const LinearGigIssueObjectSchema = Type.Object(linearIssueObject, {
    additionalProperties: false,
})
export type GitHubTrackerObject = Static<typeof GitHubTrackerObjectSchema>
export type LinearProjectObject = Static<typeof LinearProjectObjectSchema>
export type LinearTaskIssueObject = Static<typeof LinearTaskIssueObjectSchema>
export type LinearGigIssueObject = Static<typeof LinearGigIssueObjectSchema>
export type TrackerObject =
    | ({ provider: "github" } & GitHubTrackerObject)
    | ({ provider: "linear"; resource: "project" } & LinearProjectObject)
    | ({ provider: "linear"; resource: "task-issue" } & LinearTaskIssueObject)
    | ({ provider: "linear"; resource: "gig-issue" } & LinearGigIssueObject)

export const GitHubTrackerRecordSchema = Type.Object(
    {
        provider: Type.Literal("github"),
        repository: GitHubRepositorySchema,
        external: Type.Object({ issueNumber: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
        planComment: PlanCommentSchema,
        // Only an Epic announces plan updates; present while one is in flight.
        planAnnouncement: Type.Optional(PlanAnnouncementSchema),
    },
    { additionalProperties: false },
)
export const LinearProjectRecordSchema = Type.Object(
    {
        provider: Type.Literal("linear"),
        resource: Type.Literal("project"),
        external: Type.Object(
            { projectId: OneLineSchema, createdAt: TimestampSchema },
            { additionalProperties: false },
        ),
        planDocument: PlanDocumentSchema,
        // Present while an Epic plan update's announcement is in flight.
        planAnnouncement: Type.Optional(PlanAnnouncementSchema),
    },
    { additionalProperties: false },
)
export const LinearTaskIssueRecordSchema = Type.Object(
    {
        provider: Type.Literal("linear"),
        resource: Type.Literal("task-issue"),
        external: Type.Object(
            {
                issueId: OneLineSchema,
                identifier: LinearIdentifierSchema,
                projectId: OneLineSchema,
            },
            { additionalProperties: false },
        ),
        planDocument: PlanDocumentSchema,
    },
    { additionalProperties: false },
)
export const LinearGigIssueRecordSchema = Type.Object(
    {
        provider: Type.Literal("linear"),
        resource: Type.Literal("gig-issue"),
        external: Type.Object(
            { issueId: OneLineSchema, identifier: LinearIdentifierSchema },
            { additionalProperties: false },
        ),
        planDocument: PlanDocumentSchema,
    },
    { additionalProperties: false },
)
export const TrackerRecordSchema = Type.Union([
    GitHubTrackerRecordSchema,
    LinearProjectRecordSchema,
    LinearTaskIssueRecordSchema,
    LinearGigIssueRecordSchema,
])
export type TrackerRecord = Static<typeof TrackerRecordSchema>
export type GitHubTrackerRecord = Static<typeof GitHubTrackerRecordSchema>
export type LinearTrackerRecord = Exclude<TrackerRecord, GitHubTrackerRecord>

export const ForgeRecordSchema = Type.Object(
    {
        provider: Type.Literal("github"),
        repository: GitHubRepositorySchema,
        head: OneLineSchema,
        target: OneLineSchema,
    },
    { additionalProperties: false },
)
export type ForgeRecord = Static<typeof ForgeRecordSchema>

export function trackerReference(record: TrackerRecord | TrackerObject): TrackerReference {
    if (record.provider === "github")
        return {
            provider: "github",
            issueNumber: "external" in record ? record.external.issueNumber : record.issueNumber,
        }
    if (record.resource === "project")
        return {
            provider: "linear",
            projectCreatedAt: "external" in record ? record.external.createdAt : record.createdAt,
        }
    return {
        provider: "linear",
        identifier: "external" in record ? record.external.identifier : record.identifier,
    }
}

export function trackerRecordFromObject(
    object: TrackerObject,
    repository: { owner: string; repo: string } | undefined,
): TrackerRecord {
    switch (object.provider) {
        case "github":
            if (!repository) throw new Error("GitHub tracker record requires the configured repository")
            return {
                provider: "github",
                repository: { ...repository },
                external: { issueNumber: object.issueNumber },
                planComment: { state: "unpublished" },
            }
        case "linear":
            switch (object.resource) {
                case "project":
                    return {
                        provider: "linear",
                        resource: "project",
                        external: {
                            projectId: object.projectId,
                            createdAt: object.createdAt,
                        },
                        planDocument: { state: "unpublished" },
                    }
                case "task-issue":
                    return {
                        provider: "linear",
                        resource: "task-issue",
                        external: {
                            issueId: object.issueId,
                            identifier: object.identifier,
                            projectId: object.projectId,
                        },
                        planDocument: { state: "unpublished" },
                    }
                case "gig-issue":
                    return {
                        provider: "linear",
                        resource: "gig-issue",
                        external: {
                            issueId: object.issueId,
                            identifier: object.identifier,
                        },
                        planDocument: { state: "unpublished" },
                    }
            }
    }
}

export function assertTrackerRecordInvariants(
    entity: "epic" | "task" | "gig",
    tracker: TrackerRecord,
    fail: (message: string) => never,
): void {
    if (tracker.provider === "github") {
        const comment = tracker.planComment
        if (comment.state === "published")
            assertPlanCommentUrl(tracker.repository, tracker.external.issueNumber, comment.id, comment.url)
        if (tracker.planAnnouncement && entity !== "epic") fail("only an Epic announces plan updates")
        if (tracker.planAnnouncement && comment.state !== "published")
            fail("a plan announcement requires a published plan")
        return
    }
    const expected = entity === "epic" ? "project" : entity === "task" ? "task-issue" : "gig-issue"
    if (tracker.resource !== expected) fail(`Linear tracker resource must be ${expected} for ${entity}`)
    if (tracker.planDocument.state === "published") assertPlanDocumentUrl(tracker.planDocument.url)
    if (tracker.resource === "project" && tracker.planAnnouncement && tracker.planDocument.state !== "published")
        fail("a plan announcement requires a published plan")
}
