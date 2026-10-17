import { isDeepStrictEqual } from "node:util"

import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import { LifecycleStateSchema } from "../__lib/domain.js"
import type { EntityStatus } from "../__lib/entity.js"
import { NativePhaseFactsSchema, planPhaseMutation } from "./phase.js"
import { assertEntityEnvironment, type WorkflowEnvironment } from "./policy.js"
import { linearPriorityNumber } from "./records.js"

const Name = Type.String({ minLength: 1 })
const NumberId = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const Unversioned = Type.Object({ mode: Type.Literal("unversioned") }, { additionalProperties: false })

// Observed, normalized outcomes, using the same trust boundary as native Phase facts.
export const TrackerInitializationFactsSchema = Type.Union([
    Type.Object(
        {
            provider: Type.Literal("github"),
            repository: Type.Object({ owner: Name, repo: Name }, { additionalProperties: false }),
            issueNumber: NumberId,
            project: Type.Object(
                { owner: Name, ownerType: Type.Union([Type.Literal("user"), Type.Literal("org")]), number: NumberId },
                { additionalProperties: false },
            ),
            itemId: NumberId,
            parentIssueNumber: Type.Union([NumberId, Type.Null()]),
            lifecycle: LifecycleStateSchema,
            priority: Name,
            phase: NativePhaseFactsSchema,
            systemMetadata: Type.Union([
                Unversioned,
                Type.Object(
                    {
                        mode: Type.Literal("versioned"),
                        labels: Type.Array(Name, { uniqueItems: true }),
                        internalId: Type.Object(
                            {
                                scope: Type.Union([Type.Literal("project"), Type.Literal("issue")]),
                                field: Name,
                                value: Name,
                            },
                            { additionalProperties: false },
                        ),
                    },
                    { additionalProperties: false },
                ),
            ]),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            provider: Type.Literal("linear"),
            resource: Type.Union([Type.Literal("project"), Type.Literal("task-issue"), Type.Literal("gig-issue")]),
            id: Name,
            team: Name,
            projectId: Type.Union([Name, Type.Null()]),
            lifecycle: LifecycleStateSchema,
            priority: Type.Integer({ minimum: 0, maximum: 4 }),
            phase: NativePhaseFactsSchema,
            systemMetadata: Type.Union([
                Unversioned,
                Type.Object({ mode: Type.Literal("versioned"), internalId: Name }, { additionalProperties: false }),
            ]),
        },
        { additionalProperties: false },
    ),
])
export type TrackerInitializationFacts = Static<typeof TrackerInitializationFactsSchema>
export const ConfirmTrackerInitializationSchema = Type.Object(
    { entityDir: Name, facts: TrackerInitializationFactsSchema },
    { additionalProperties: false },
)

export function confirmTrackerInitialization(
    status: EntityStatus,
    environment: WorkflowEnvironment,
    facts: TrackerInitializationFacts,
    parent: EntityStatus | null,
): { status: EntityStatus; changed: boolean } {
    Value.Parse(TrackerInitializationFactsSchema, facts)
    assertEntityEnvironment(status, environment)
    const record = status.integrations.find((entry) => entry.role === "tracker")
    const tracker = environment.tracker
    if (status.authority.kind !== "tracker" || !record || tracker.kind === "none")
        throw new Error("initialization confirmation requires tracker authority")
    if (record.state === "bound") return { status, changed: false }
    if (record.state !== "bound-pending" && record.state !== "issue-bound-pending")
        throw new Error("initialization confirmation requires an identified pending tracker")
    if (!("desired" in status.authority))
        throw new Error("initialization confirmation requires approved pending intent")
    const desired = status.authority.desired
    if (status.phase !== "planning" || desired.lifecycle !== "inProgress" || facts.lifecycle !== "inProgress")
        throw new Error("initialization confirmation requires Planning and native In Progress")
    if (facts.systemMetadata.mode !== environment.artifacts.kind)
        throw new Error("initialization facts have the wrong artifact mode")
    if (status.entity === "task" ? parent?.entity !== "epic" : parent !== null)
        throw new Error("initialization confirmation requires the exact Task parent context")

    if (tracker.kind === "github" && record.provider === "github" && facts.provider === "github") {
        const configured = tracker.config
        if (
            !sameRepository(facts.repository, record.repository) ||
            facts.issueNumber !== record.external.issueNumber ||
            facts.project.owner.toLowerCase() !== configured.project.owner.toLowerCase() ||
            facts.project.ownerType !== configured.project.ownerType ||
            facts.project.number !== configured.project.number
        )
            throw new Error("initialization facts do not match the GitHub issue/Project relationship")
        if (facts.priority !== desired.priority)
            throw new Error("initialization Priority does not match approved intent")
        const parentTracker = parent?.integrations.find((entry) => entry.role === "tracker")
        if (status.entity === "task") {
            if (
                !parentTracker ||
                parentTracker.provider !== "github" ||
                !("external" in parentTracker) ||
                !sameRepository(parentTracker.repository, record.repository) ||
                facts.parentIssueNumber !== parentTracker.external.issueNumber
            )
                throw new Error("initialization facts do not match the Task parent issue")
        } else if (facts.parentIssueNumber !== null) throw new Error("standalone GitHub work cannot have a Task parent")
        if (facts.systemMetadata.mode === "versioned") {
            const expectedKind =
                status.entity === "epic"
                    ? configured.labels.kind.epic
                    : configured.labels.kind.deliverableKinds[status.kind]
            const managed = new Set([
                configured.labels.kind.epic,
                ...Object.values(configured.labels.kind.deliverableKinds),
            ])
            const actual = facts.systemMetadata.labels.filter((label) => managed.has(label))
            if (actual.length !== 1 || actual[0] !== expectedKind)
                throw new Error("initialization Kind label does not match")
            if (
                !isDeepStrictEqual(facts.systemMetadata.internalId, {
                    ...configured.fields.internalId,
                    value: status.id,
                })
            )
                throw new Error("initialization Internal ID does not match its configured field/scope")
        }
    } else if (tracker.kind === "linear" && record.provider === "linear" && facts.provider === "linear") {
        const id = record.resource === "project" ? record.external.projectId : record.external.issueId
        const projectId = record.resource === "task-issue" ? record.external.projectId : null
        if (
            facts.resource !== record.resource ||
            facts.id !== id ||
            facts.team !== tracker.config.team ||
            facts.projectId !== projectId
        )
            throw new Error("initialization facts do not match the Linear object/team/Project relationship")
        if (facts.priority !== linearPriorityNumber(desired.priority))
            throw new Error("initialization Priority does not match approved intent")
        const parentTracker = parent?.integrations.find((entry) => entry.role === "tracker")
        if (
            status.entity === "task" &&
            (!parentTracker ||
                parentTracker.provider !== "linear" ||
                parentTracker.resource !== "project" ||
                !("external" in parentTracker) ||
                parentTracker.external.projectId !== projectId)
        )
            throw new Error("initialization facts do not match the Task parent Project")
        if (facts.systemMetadata.mode === "versioned" && facts.systemMetadata.internalId !== status.id)
            throw new Error("initialization Internal ID does not match")
    } else throw new Error("initialization facts do not match the configured tracker provider")

    if (planPhaseMutation(tracker.config, status.entity, "planning", facts.lifecycle, facts.phase).changed)
        throw new Error("initialization native Phase does not match Planning")
    const { desired: _desired, ...authority } = status.authority
    const { operations: _operations, ...binding } = record
    return {
        status: {
            ...status,
            authority,
            integrations: status.integrations.map((entry) =>
                entry === record ? { ...binding, state: "bound" as const } : entry,
            ),
        },
        changed: true,
    }
}

function sameRepository(left: { owner: string; repo: string }, right: { owner: string; repo: string }) {
    return (
        left.owner.toLowerCase() === right.owner.toLowerCase() && left.repo.toLowerCase() === right.repo.toLowerCase()
    )
}
