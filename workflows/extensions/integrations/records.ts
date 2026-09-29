import { type Static, type TProperties, type TSchema, Type } from "typebox"

import { type EntityIdentity, PRIORITY_NOT_SET, readyBranch, type ReadyBranchContract } from "../__lib/domain.js"
import type { EntityStatus } from "../__lib/entity.js"
import type { WorkflowEnvironment } from "./policy.js"

const LINEAR_PRIORITIES = { Urgent: 1, High: 2, Medium: 3, Low: 4, [PRIORITY_NOT_SET]: 0 } as const
export type LinearPriority = keyof typeof LINEAR_PRIORITIES
const LINEAR_PRIORITY_NAMES = new Set<string>(Object.keys(LINEAR_PRIORITIES))

export function linearPriorityNumber(priority: string): number {
    if (!Object.hasOwn(LINEAR_PRIORITIES, priority)) {
        throw new Error(`invalid Linear priority ${JSON.stringify(priority)}`)
    }
    return LINEAR_PRIORITIES[priority as LinearPriority]
}

const OneLineSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })

export const NewInitializationSourceSchema = Type.Object({ mode: Type.Literal("new") }, { additionalProperties: false })
export const GitHubInitializationSourceSchema = Type.Object(
    {
        mode: Type.Literal("external"),
        provider: Type.Literal("github"),
        issueId: Type.Integer({ minimum: 1 }),
        issueNumber: Type.Integer({ minimum: 1 }),
        issueUrl: Type.String({ minLength: 1 }),
        projectItemId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
)
export const LinearProjectInitializationSourceSchema = Type.Object(
    {
        mode: Type.Literal("external"),
        provider: Type.Literal("linear"),
        resource: Type.Literal("project"),
        projectId: OneLineSchema,
        projectUrl: OneLineSchema,
    },
    { additionalProperties: false },
)
export const LinearTaskInitializationSourceSchema = Type.Object(
    {
        mode: Type.Literal("external"),
        provider: Type.Literal("linear"),
        resource: Type.Literal("task-issue"),
        issueId: OneLineSchema,
        identifier: OneLineSchema,
        issueUrl: OneLineSchema,
        gitBranchName: OneLineSchema,
        projectId: OneLineSchema,
    },
    { additionalProperties: false },
)
export const LinearGigInitializationSourceSchema = Type.Object(
    {
        mode: Type.Literal("external"),
        provider: Type.Literal("linear"),
        resource: Type.Literal("gig-issue"),
        issueId: OneLineSchema,
        identifier: OneLineSchema,
        issueUrl: OneLineSchema,
        gitBranchName: OneLineSchema,
    },
    { additionalProperties: false },
)
export const InitializationSourceSchema = Type.Union([
    NewInitializationSourceSchema,
    GitHubInitializationSourceSchema,
    LinearProjectInitializationSourceSchema,
    LinearTaskInitializationSourceSchema,
    LinearGigInitializationSourceSchema,
])
export type InitializationSource = Static<typeof InitializationSourceSchema>

const IssueBindingSchema = Type.Object(
    {
        issueId: Type.Integer({ minimum: 1 }),
        issueNumber: Type.Integer({ minimum: 1 }),
        issueUrl: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
)
const TrackerBindingSchema = Type.Object(
    { ...IssueBindingSchema.properties, projectItemId: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
)
const pendingOperations = () => Type.Array(OneLineSchema, { minItems: 1 })

function unboundTrackerRecords<P extends TProperties>(properties: P) {
    const common = { role: Type.Literal("tracker"), ...properties }
    return [
        Type.Object(
            { ...common, state: Type.Literal("awaiting"), operation: OneLineSchema },
            { additionalProperties: false },
        ),
        Type.Object(
            { ...common, state: Type.Literal("pending"), operations: pendingOperations() },
            { additionalProperties: false },
        ),
    ] as const
}

function boundTrackerRecords<P extends TProperties, B extends TSchema>(properties: P, external: B) {
    const common = { role: Type.Literal("tracker"), ...properties, external }
    return [
        Type.Object({ ...common, state: Type.Literal("bound") }, { additionalProperties: false }),
        Type.Object(
            { ...common, state: Type.Literal("bound-pending"), operations: pendingOperations() },
            { additionalProperties: false },
        ),
    ] as const
}

function issueTrackerRecords<P extends TProperties, I extends TSchema, B extends TSchema>(
    properties: P,
    identity: I,
    binding: B,
) {
    return [
        Type.Object(
            {
                role: Type.Literal("tracker"),
                ...properties,
                state: Type.Literal("issue-bound-pending"),
                external: identity,
                operations: pendingOperations(),
            },
            { additionalProperties: false },
        ),
        ...boundTrackerRecords(properties, binding),
    ] as const
}

const GitHubTrackerRecordSchema = Type.Union([
    ...unboundTrackerRecords({ provider: Type.Literal("github") }),
    ...issueTrackerRecords({ provider: Type.Literal("github") }, IssueBindingSchema, TrackerBindingSchema),
])

const LinearResourceSchema = Type.Union([
    Type.Literal("project"),
    Type.Literal("task-issue"),
    Type.Literal("gig-issue"),
])
const LinearProjectBindingSchema = Type.Object(
    { projectId: OneLineSchema, projectUrl: OneLineSchema },
    { additionalProperties: false },
)
const LinearTaskIssueIdentitySchema = Type.Object(
    {
        issueId: OneLineSchema,
        identifier: OneLineSchema,
        issueUrl: OneLineSchema,
        projectId: OneLineSchema,
    },
    { additionalProperties: false },
)
const LinearTaskIssueBindingSchema = Type.Object(
    { ...LinearTaskIssueIdentitySchema.properties, gitBranchName: OneLineSchema },
    { additionalProperties: false },
)
const LinearGigIssueIdentitySchema = Type.Object(
    {
        issueId: OneLineSchema,
        identifier: OneLineSchema,
        issueUrl: OneLineSchema,
    },
    { additionalProperties: false },
)
const LinearGigIssueBindingSchema = Type.Object(
    { ...LinearGigIssueIdentitySchema.properties, gitBranchName: OneLineSchema },
    { additionalProperties: false },
)

const LinearTrackerRecordSchema = Type.Union([
    ...unboundTrackerRecords({ provider: Type.Literal("linear"), resource: LinearResourceSchema }),
    ...boundTrackerRecords(
        { provider: Type.Literal("linear"), resource: Type.Literal("project") },
        LinearProjectBindingSchema,
    ),
    ...issueTrackerRecords(
        { provider: Type.Literal("linear"), resource: Type.Literal("task-issue") },
        LinearTaskIssueIdentitySchema,
        LinearTaskIssueBindingSchema,
    ),
    ...issueTrackerRecords(
        { provider: Type.Literal("linear"), resource: Type.Literal("gig-issue") },
        LinearGigIssueIdentitySchema,
        LinearGigIssueBindingSchema,
    ),
])

const GitHubForgeRecordSchema = Type.Object(
    {
        role: Type.Literal("forge"),
        provider: Type.Literal("github"),
        pullRequest: Type.Object(
            {
                number: Type.Integer({ minimum: 1 }),
                url: Type.String({ minLength: 1 }),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
)

export const IntegrationRecordSchema = Type.Union([
    GitHubTrackerRecordSchema,
    LinearTrackerRecordSchema,
    GitHubForgeRecordSchema,
])
export type IntegrationRecord = Static<typeof IntegrationRecordSchema>

export const TrackerProviderSchema = Type.Union([Type.Literal("github"), Type.Literal("linear")])

export const TrackerPendingBranchContractSchema = Type.Object(
    {
        state: Type.Literal("tracker-pending"),
        provider: Type.Literal("linear"),
        start: Type.String({ minLength: 1 }),
        target: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
)
export type TrackerPendingBranchContract = Static<typeof TrackerPendingBranchContractSchema>

export const ProvisioningBranchContractSchema = Type.Object(
    {
        state: Type.Literal("provisioning"),
        provider: Type.Literal("linear"),
        name: Type.String({ minLength: 1 }),
        start: Type.String({ minLength: 1 }),
        target: Type.String({ minLength: 1 }),
        startCommit: Type.String({ pattern: "^[0-9a-f]{40,64}$" }),
    },
    { additionalProperties: false },
)
export type ProvisioningBranchContract = Static<typeof ProvisioningBranchContractSchema>

export function trackerPendingBranch(start: string, target = start): TrackerPendingBranchContract {
    return { state: "tracker-pending", provider: "linear", start, target }
}

export type IntegrationInitialization =
    | {
          entity: "epic"
          source:
              | Static<typeof NewInitializationSourceSchema>
              | Static<typeof GitHubInitializationSourceSchema>
              | Static<typeof LinearProjectInitializationSourceSchema>
      }
    | {
          entity: "task"
          source:
              | Static<typeof NewInitializationSourceSchema>
              | Static<typeof GitHubInitializationSourceSchema>
              | Static<typeof LinearTaskInitializationSourceSchema>
      }
    | {
          entity: "gig"
          source:
              | Static<typeof NewInitializationSourceSchema>
              | Static<typeof GitHubInitializationSourceSchema>
              | Static<typeof LinearGigInitializationSourceSchema>
      }

export function createTrackerBranchContract(
    input: IntegrationInitialization,
    identity: EntityIdentity,
    startBranch: string,
    tracker: WorkflowEnvironment["tracker"],
    renderTrackerBranch?: (identity: EntityIdentity) => string,
): ReadyBranchContract | TrackerPendingBranchContract {
    if (tracker.kind !== "linear") {
        throw new Error("tracker branch format requires a Linear tracker; no fallback branch is allowed")
    }
    if (input.entity === "epic") {
        if (!renderTrackerBranch) {
            throw new Error("tracker branch format for an Epic requires a provider branch renderer")
        }
        return readyBranch(renderTrackerBranch(identity), startBranch, "tracker")
    }
    if (input.source.mode === "external") {
        if (input.source.provider !== "linear") {
            throw new Error("tracker branch format requires a Linear external source")
        }
        return readyBranch(input.source.gitBranchName, startBranch, "tracker")
    }
    return trackerPendingBranch(startBranch)
}

export function boundTrackerProjectId(status: EntityStatus): string | undefined {
    if (status.entity !== "epic") return undefined
    const tracker = status.integrations.find(
        (integration) =>
            integration.role === "tracker" &&
            integration.provider === "linear" &&
            integration.resource === "project" &&
            (integration.state === "bound" || integration.state === "bound-pending"),
    )
    return tracker?.external.projectId
}

export function assertTaskSourceProject(input: IntegrationInitialization, parentProjectId?: string): void {
    if (
        input.entity === "task" &&
        input.source.mode === "external" &&
        input.source.provider === "linear" &&
        input.source.projectId !== parentProjectId
    ) {
        throw new Error("Linear Task issue does not belong to the parent Epic Project")
    }
}

export function createInitialIntegrationRecords(
    input: IntegrationInitialization,
    environment: WorkflowEnvironment,
    exposesSystemTraces: boolean,
    parentLinearProjectId?: string,
): IntegrationRecord[] {
    switch (environment.tracker.kind) {
        case "none":
            return []
        case "github":
            return [
                input.source.mode === "external" && input.source.provider === "github"
                    ? {
                          role: "tracker",
                          provider: "github",
                          state: "bound-pending",
                          external: {
                              issueId: input.source.issueId,
                              issueNumber: input.source.issueNumber,
                              issueUrl: input.source.issueUrl,
                              projectItemId: input.source.projectItemId,
                          },
                          operations: [
                              ...(exposesSystemTraces ? ["apply configured Kind label and Internal ID"] : []),
                              "move Project Status to In Progress",
                              "add Planning label",
                              ...(input.entity === "task" ? ["attach Task issue to parent Epic issue"] : []),
                          ],
                      }
                    : { role: "tracker", provider: "github", state: "awaiting", operation: "create issue" },
            ]
        case "linear":
            switch (input.entity) {
                case "epic":
                    return [
                        input.source.mode === "external" && input.source.provider === "linear"
                            ? {
                                  role: "tracker",
                                  provider: "linear",
                                  resource: "project",
                                  state: "bound-pending",
                                  external: {
                                      projectId: input.source.projectId,
                                      projectUrl: input.source.projectUrl,
                                  },
                                  operations: [
                                      ...(exposesSystemTraces ? ["embed Internal ID"] : []),
                                      "move Linear Project to In Progress",
                                  ],
                              }
                            : {
                                  role: "tracker",
                                  provider: "linear",
                                  resource: "project",
                                  state: "awaiting",
                                  operation: "create Linear Project",
                              },
                    ]
                case "task":
                    return [
                        input.source.mode === "external" && input.source.provider === "linear"
                            ? {
                                  role: "tracker",
                                  provider: "linear",
                                  resource: "task-issue",
                                  state: "bound-pending",
                                  external: {
                                      issueId: input.source.issueId,
                                      identifier: input.source.identifier,
                                      issueUrl: input.source.issueUrl,
                                      gitBranchName: input.source.gitBranchName,
                                      projectId: input.source.projectId,
                                  },
                                  operations: [
                                      ...(exposesSystemTraces ? ["embed Internal ID"] : []),
                                      "move Linear issue to In Progress",
                                  ],
                              }
                            : {
                                  role: "tracker",
                                  provider: "linear",
                                  resource: "task-issue",
                                  state: "awaiting",
                                  operation: parentLinearProjectId
                                      ? "create Linear issue in parent Epic Project"
                                      : "wait for parent Epic Project binding, then create Linear issue",
                              },
                    ]
                case "gig":
                    return [
                        input.source.mode === "external" && input.source.provider === "linear"
                            ? {
                                  role: "tracker",
                                  provider: "linear",
                                  resource: "gig-issue",
                                  state: "bound-pending",
                                  external: {
                                      issueId: input.source.issueId,
                                      identifier: input.source.identifier,
                                      issueUrl: input.source.issueUrl,
                                      gitBranchName: input.source.gitBranchName,
                                  },
                                  operations: [
                                      ...(exposesSystemTraces ? ["embed Internal ID"] : []),
                                      "move Linear issue to In Progress",
                                  ],
                              }
                            : {
                                  role: "tracker",
                                  provider: "linear",
                                  resource: "gig-issue",
                                  state: "awaiting",
                                  operation: "create Linear issue",
                              },
                    ]
                default:
                    return input satisfies never
            }
        default:
            return environment.tracker satisfies never
    }
}

export function assertIntegrationInvariants(status: EntityStatus, fail: (message: string) => never): void {
    const roles = new Set<string>()
    for (const integration of status.integrations) {
        if (roles.has(integration.role)) fail(`duplicate integration role ${JSON.stringify(integration.role)}`)
        roles.add(integration.role)
        if (integration.role === "tracker" && integration.provider === "linear") {
            const expectedResource =
                status.entity === "epic" ? "project" : status.entity === "task" ? "task-issue" : "gig-issue"
            if (integration.resource !== expectedResource) {
                fail(`Linear tracker resource must be ${expectedResource} for ${status.entity}`)
            }
        }
    }
    const trackerIntegrations = status.integrations.filter((integration) => integration.role === "tracker")
    if (status.authority.kind === "workflow") {
        if (trackerIntegrations.length > 0) fail("workflow authority cannot contain a tracker record")
    } else {
        if (trackerIntegrations.length !== 1) fail("tracker authority requires exactly one tracker record")
        if (trackerIntegrations[0]?.provider !== status.authority.provider) {
            fail("tracker authority provider does not match its tracker record")
        }
        if ("desired" in status.authority && trackerIntegrations[0]?.state === "bound") {
            fail("confirmed tracker binding must not retain desired lifecycle/Priority")
        }
    }
    const linearTracker = status.integrations.find(
        (integration) => integration.role === "tracker" && integration.provider === "linear",
    )
    if (
        linearTracker &&
        status.authority.kind === "tracker" &&
        "desired" in status.authority &&
        !LINEAR_PRIORITY_NAMES.has(status.authority.desired.priority)
    ) {
        fail(
            `Linear tracker checkpoint has invalid native priority ${JSON.stringify(status.authority.desired.priority)}`,
        )
    }

    if (status.branch.state !== "ready") {
        if (status.entity === "epic") fail("an Epic may not have a pending branch")
        if (!linearTracker) return fail("only a Linear Task/Gig may have a pending branch")
        if (status.branch.state === "provisioning") {
            if (
                (linearTracker.state !== "bound" && linearTracker.state !== "bound-pending") ||
                linearTracker.resource === "project" ||
                status.branch.name !== linearTracker.external.gitBranchName
            ) {
                fail("provisioning branch must match the bound Linear issue branch")
            }
        }
        return
    }
    if (status.branch.source === "tracker") {
        if (!linearTracker) return fail("tracker-owned branch requires a Linear tracker record")
        if (status.entity === "epic") {
            if (linearTracker.resource !== "project") {
                fail("tracker-owned Epic branch requires a Linear Project record")
            }
        } else if (
            (linearTracker.state !== "bound" && linearTracker.state !== "bound-pending") ||
            linearTracker.resource === "project" ||
            status.branch.name !== linearTracker.external.gitBranchName
        ) {
            fail("tracker-owned Task/Gig branch must match the bound Linear issue branch")
        }
    }
}

export function assertTaskIntegrationParent(
    task: EntityStatus,
    parent: EntityStatus,
    fail: (message: string) => never,
): void {
    if (task.entity !== "task") return fail("Linear Task validation requires a Task")
    if (parent.entity !== "epic") return fail("Linear Task parent validation requires an Epic")
    const linearTracker = task.integrations.find(
        (integration) =>
            integration.role === "tracker" &&
            integration.provider === "linear" &&
            integration.resource === "task-issue" &&
            (integration.state === "issue-bound-pending" ||
                integration.state === "bound" ||
                integration.state === "bound-pending"),
    )
    if (!linearTracker) return
    const parentLinearTracker = parent.integrations.find(
        (integration) =>
            integration.role === "tracker" &&
            integration.provider === "linear" &&
            integration.resource === "project" &&
            (integration.state === "bound" || integration.state === "bound-pending"),
    )
    if (!parentLinearTracker) return fail("bound Linear Task requires a bound parent Epic Project")
    if (linearTracker.external.projectId !== parentLinearTracker.external.projectId) {
        fail("Linear Task Project does not match its parent Epic Project")
    }
}
