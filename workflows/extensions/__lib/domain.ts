import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

export const PROJECT_ROOT = ".project"
export const EPIC_ROOT = `${PROJECT_ROOT}/epics`
export const GIG_ROOT = `${PROJECT_ROOT}/gigs`

export const EntityTypeSchema = Type.Union([Type.Literal("epic"), Type.Literal("task"), Type.Literal("gig")])
export type EntityType = Static<typeof EntityTypeSchema>

export const BranchFormatSchema = Type.Union([
    Type.Literal("tracker"),
    Type.Literal("username/identifier-title"),
    Type.Literal("username/identifier"),
    Type.Literal("username-identifier-title"),
    Type.Literal("username-identifier"),
    Type.Literal("identifier-title"),
    Type.Literal("title-identifier"),
    Type.Literal("identifier"),
])
export type BranchFormat = Static<typeof BranchFormatSchema>
export type GeneratedBranchFormat = Exclude<BranchFormat, "tracker">

export const DeliverableKindSchema = Type.Union([
    Type.Literal("feature"),
    Type.Literal("bugfix"),
    Type.Literal("research"),
    Type.Literal("refactor"),
    Type.Literal("audit"),
    Type.Literal("chore"),
])
export type DeliverableKind = Static<typeof DeliverableKindSchema>

export const QueueStateSchema = Type.Union([Type.Literal("backlog"), Type.Literal("todo")])
export type QueueState = Static<typeof QueueStateSchema>

export const InitializedLifecycleStateSchema = Type.Union([
    Type.Literal("inProgress"),
    Type.Literal("inReview"),
    Type.Literal("done"),
])
export type InitializedLifecycleState = Static<typeof InitializedLifecycleStateSchema>

export const LifecycleStateSchema = Type.Union([QueueStateSchema, InitializedLifecycleStateSchema])
export type LifecycleState = Static<typeof LifecycleStateSchema>

export const WorkStageSchema = Type.Union([Type.Literal("planning"), Type.Literal("execution")])
export type WorkStage = Static<typeof WorkStageSchema>

export const PRIORITY_NOT_SET = "not set" as const
export const PrioritySchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })
export type Priority = Static<typeof PrioritySchema>

export const RawIdSchema = Type.String({ pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{9}$" })
export type RawId = Static<typeof RawIdSchema>

export const QualifiedIdSchema = Type.String({ pattern: "^(EPIC|TASK|GIG)-[0-7][0-9A-HJKMNP-TV-Z]{9}$" })
export type QualifiedId = Static<typeof QualifiedIdSchema>

export const EntityIdentitySchema = Type.Union([
    Type.Object(
        { entity: Type.Literal("epic"), rawId: RawIdSchema, slug: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
    ),
    Type.Object(
        { entity: Type.Literal("task"), rawId: RawIdSchema, slug: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
    ),
    Type.Object(
        { entity: Type.Literal("gig"), rawId: RawIdSchema, slug: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
    ),
])
export type EntityIdentity = Static<typeof EntityIdentitySchema>

export const ReadyBranchContractSchema = Type.Object(
    {
        state: Type.Literal("ready"),
        name: Type.String({ minLength: 1 }),
        start: Type.String({ minLength: 1 }),
        target: Type.String({ minLength: 1 }),
        source: Type.Union([Type.Literal("generated"), Type.Literal("tracker")]),
    },
    { additionalProperties: false },
)
export type ReadyBranchContract = Static<typeof ReadyBranchContractSchema>

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function generateRawId(timestamp = new Date()): RawId {
    const milliseconds = timestamp.getTime()
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 0xffffffffffff) {
        throw new Error(`timestamp is outside the 48-bit ID range: ${timestamp.toISOString()}`)
    }

    let value = BigInt(milliseconds)
    const encoded = new Array<string>(10)
    for (let index = encoded.length - 1; index >= 0; index--) {
        encoded[index] = CROCKFORD[Number(value & 31n)]
        value >>= 5n
    }

    return validateRawId(encoded.join(""))
}

export function validateRawId(value: string): RawId {
    if (!Value.Check(RawIdSchema, value)) throw new Error(`invalid raw workflow ID ${JSON.stringify(value)}`)
    return value
}

export function qualifyId(entity: EntityType, rawId: RawId): QualifiedId {
    const value = `${entity.toUpperCase()}-${rawId}`
    if (!Value.Check(QualifiedIdSchema, value))
        throw new Error(`invalid qualified workflow ID ${JSON.stringify(value)}`)
    return value
}

export function slugify(value: string): string {
    const slug = value
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    if (!slug) throw new Error("slug must contain at least one ASCII letter or number")
    return slug
}

export function normalizePriority(value: string): Priority {
    const priority = value.trim()
    if (!Value.Check(PrioritySchema, priority)) {
        throw new Error(`priority must be one explicit configured value or ${JSON.stringify(PRIORITY_NOT_SET)}`)
    }
    return priority
}

export function validateDeliverableKind(value: string): DeliverableKind {
    if (!Value.Check(DeliverableKindSchema, value)) {
        throw new Error(`invalid Deliverable kind ${JSON.stringify(value)}`)
    }
    return value
}

export function timestampPrefix(timestamp: Date): string {
    const part = (value: number) => value.toString().padStart(2, "0")
    return `${timestamp.getFullYear()}${part(timestamp.getMonth() + 1)}${part(timestamp.getDate())}-${part(timestamp.getHours())}${part(timestamp.getMinutes())}`
}

export function entityDirectoryName(identity: EntityIdentity, timestamp: Date): string {
    return `${timestampPrefix(timestamp)}.${identity.entity.toUpperCase()}-${identity.rawId}.${identity.slug}`
}

export function formatBranchName(identity: EntityIdentity, format: GeneratedBranchFormat, username?: string): string {
    const identifier = qualifyId(identity.entity, identity.rawId).toLowerCase()
    switch (format) {
        case "username/identifier-title":
            return `${requireUsername(username)}/${identifier}-${identity.slug}`
        case "username/identifier":
            return `${requireUsername(username)}/${identifier}`
        case "username-identifier-title":
            return `${requireUsername(username)}-${identifier}-${identity.slug}`
        case "username-identifier":
            return `${requireUsername(username)}-${identifier}`
        case "identifier-title":
            return `${identifier}-${identity.slug}`
        case "title-identifier":
            return `${identity.slug}-${identifier}`
        case "identifier":
            return identifier
    }
}

export function readyBranch(
    name: string,
    start: string,
    source: "generated" | "tracker",
    target = start,
): ReadyBranchContract {
    return { state: "ready", name, start, target, source }
}

function requireUsername(username: string | undefined): string {
    if (!username) throw new Error("branch format requires configured username")
    return username
}
