import { Type, type Static } from "typebox"
import {
    getMcpToolName,
    isMcpTool,
    mcpResponsePayload,
    type McpToolCatalog,
} from "../../../../../extensions/__lib/mcp.js"
import { EvidenceSchema } from "../../resource-id-tool.js"
import type { ProviderEvidence } from "../../resource-id-operations.js"
import { incomingPullRequestContext, incomingRevision } from "./incoming-pr-context.js"
import { planGitHubMerge } from "./merge.js"

const membership = Type.Union([
    Type.Object(
        { state: Type.Enum(["absent"], { type: "string" }), lookup: Type.Array(EvidenceSchema, { minItems: 1 }) },
        { additionalProperties: false },
    ),
    Type.Object(
        { state: Type.Enum(["present"], { type: "string" }), evidence: EvidenceSchema },
        { additionalProperties: false },
    ),
    Type.Object(
        { state: Type.Enum(["added"], { type: "string" }), evidence: EvidenceSchema, creation: EvidenceSchema },
        { additionalProperties: false },
    ),
])
const common = {
    operation: Type.Literal("incomingPullRequestProject"),
    reference: Type.String({ minLength: 1 }),
    evidence: EvidenceSchema,
    fieldEvidence: EvidenceSchema,
    membership,
}
export const IncomingProjectContextSchema = Type.Union([
    Type.Object(
        {
            ...common,
            action: Type.Literal("intake"),
            choice: Type.Enum(["backlog", "todo"], { type: "string" }),
            membership: Type.Union([
                membership,
                Type.Object(
                    {
                        state: Type.Enum(["reconciled"], { type: "string" }),
                        attempt: Type.Pick(EvidenceSchema, ["tool", "arguments"], { additionalProperties: false }),
                        evidence: EvidenceSchema,
                    },
                    { additionalProperties: false },
                ),
            ]),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...common, action: Type.Enum(["review", "shipping", "cancellation"], { type: "string" }) },
        { additionalProperties: false },
    ),
])
export type IncomingProjectContextInput = Static<typeof IncomingProjectContextSchema>
type Board = Extract<ReturnType<typeof incomingPullRequestContext>["project"], { state: "enabled" }>
type Decision =
    | { state: "blocked"; reason: string }
    | { state: "unchanged"; status: string | null }
    | {
          state: "mutation-needed"
          effect: "addMembership" | "setStatus" | "closePullRequest"
          desiredStatus: string
          mutation: { tool: string; arguments: Record<string, unknown> }
      }

function object(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}`)
    return value as Record<string, unknown>
}
function text(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new Error("Missing native Project text")
    return value
}
function integer(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
        throw new Error("Invalid native Project ID")
    return value
}
function callScope(
    evidence: Pick<ProviderEvidence, "tool" | "arguments">,
    server: string,
    tool: string,
    expected: Record<string, unknown>,
    tools: McpToolCatalog,
) {
    if (!isMcpTool(evidence.tool, server, tool, tools))
        throw new Error("Project evidence is not from the configured tool")
    for (const [key, value] of Object.entries(expected)) {
        const actual = evidence.arguments[key]
        const matches =
            ["owner", "item_owner", "item_repo"].includes(key) &&
            typeof actual === "string" &&
            typeof value === "string"
                ? actual.toLowerCase() === value.toLowerCase()
                : actual === value
        if (!matches) throw new Error(`Project evidence ${key} does not match configured scope`)
    }
}
function call(
    evidence: ProviderEvidence,
    server: string,
    tool: string,
    expected: Record<string, unknown>,
    tools: McpToolCatalog,
) {
    callScope(evidence, server, tool, expected, tools)
    return mcpResponsePayload(evidence.response)
}
function address(board: Board) {
    return { owner: board.project.owner, owner_type: board.project.ownerType, project_number: board.project.number }
}
function field(board: Board, evidence: ProviderEvidence, tools: McpToolCatalog): number {
    const response = call(
        evidence,
        board.mcpServer,
        "projects_get",
        { method: "get_project_field", ...address(board) },
        tools,
    )
    const id = integer(response.id)
    if (
        evidence.arguments.field_id !== id ||
        response.name !== board.status.field ||
        response.data_type !== "single_select" ||
        !Array.isArray(response.options)
    )
        throw new Error("Project Status must be the exact configured single-select field")
    const options = response.options.map((option) => {
        const name = object(option, "Status option").name
        return typeof name === "string" ? name : text(object(name, "Status option name").raw)
    })
    if (Object.values(board.status.values).some((value) => !options.includes(value)))
        throw new Error("Configured Project Status options are missing")
    return id
}
function item(
    board: Board,
    evidence: ProviderEvidence,
    repository: string,
    number: number,
    fieldId: number,
    tools: McpToolCatalog,
) {
    const mutation = isMcpTool(evidence.tool, board.mcpServer, "projects_write", tools)
    const adding = mutation && evidence.arguments.method === "add_project_item"
    const expected = adding
        ? {
              method: "add_project_item",
              ...address(board),
              item_owner: repository.split("/")[0],
              item_repo: repository.split("/")[1],
              item_type: "pull_request",
              pull_request_number: number,
          }
        : { method: mutation ? "update_project_item" : "get_project_item", ...address(board) }
    const response = call(evidence, board.mcpServer, mutation ? "projects_write" : "projects_get", expected, tools)
    const id = integer(response.id)
    const content = object(response.content, "Project content")
    if (
        (!adding && evidence.arguments.item_id !== id) ||
        response.content_type !== "PullRequest" ||
        text(content.repository).toLowerCase() !== repository ||
        content.number !== number
    )
        throw new Error("Project item must be this exact PR, not an issue or another repository")
    if (
        (!mutation &&
            (!Array.isArray(evidence.arguments.field_names) ||
                !evidence.arguments.field_names.includes(board.status.field))) ||
        !Array.isArray(response.fields)
    )
        throw new Error("Read the configured Status field on this exact PR item")
    const fields = response.fields
        .map((value) => object(value, "Project item field"))
        .filter((value) => value.name === board.status.field)
    if (fields.length > 1 || (fields.length === 1 && fields[0].id !== fieldId))
        throw new Error("Ambiguous Project Status identity")
    if (mutation && fields.length !== 1)
        throw new Error("Mutation success lacks required Status facts; obtain the exact item read")
    const value = fields[0]?.value
    const status = value == null ? null : text(object(value, "Status value").name)
    if (mutation && !adding) {
        const changed = object(evidence.arguments.updated_field, "updated Project field")
        if (changed.name !== board.status.field || changed.value !== status)
            throw new Error("Mutation does not confirm this exact absolute Status outcome")
    }
    return { id, status }
}
function absence(board: Board, pages: ProviderEvidence[], repository: string, number: number, tools: McpToolCatalog) {
    let after: string | undefined
    pages.forEach((page, index) => {
        const response = call(
            page,
            board.mcpServer,
            "projects_list",
            {
                method: "list_project_items",
                ...address(board),
                query: `repo:${repository} is:pr`,
                after,
            },
            tools,
        )
        if (page.arguments.before !== undefined || !Array.isArray(response.items))
            throw new Error("Invalid complete Project lookup")
        for (const value of response.items) {
            const entry = object(value, "Project item")
            const content = object(entry.content, "Project content")
            if (entry.content_type !== "PullRequest" || text(content.repository).toLowerCase() !== repository)
                throw new Error("Project lookup is incomplete, redacted or outside the exact PR scope")
            if (content.number === number) throw new Error("PR membership already exists; use its exact item read")
        }
        const pageInfo = object(response.pageInfo, "Project pagination")
        if (pageInfo.hasNextPage === true) {
            after = text(pageInfo.nextCursor)
            if (index === pages.length - 1) throw new Error("Finish Project membership pagination")
        } else if (pageInfo.hasNextPage !== false || index !== pages.length - 1)
            throw new Error("Project membership pagination does not prove absence")
    })
}

export function incomingProjectContext(cwd: string, input: IncomingProjectContextInput, tools: McpToolCatalog) {
    const context = incomingPullRequestContext(cwd, input.reference, tools)
    const board = context.project
    if (board.state !== "enabled")
        return {
            ...context,
            operation: "incomingPullRequestProject" as const,
            projectAction: { state: "blocked" as const, reason: board.reason },
        }
    let decision: Decision
    try {
        const revision = incomingRevision(
            context.roles.forge.config,
            context.incomingPullRequest,
            input.evidence,
            tools,
        )
        const response = mcpResponsePayload(input.evidence.response)
        const fieldId = field(board, input.fieldEvidence, tools)
        const repository = `${revision.repository.owner}/${revision.repository.repo}`
        const values = board.status.values
        const mutation = (
            effect: "addMembership" | "setStatus" | "closePullRequest",
            desiredStatus: string,
            tool: string,
            args: Record<string, unknown>,
        ): Decision => ({ state: "mutation-needed", effect, desiredStatus, mutation: { tool, arguments: args } })
        const projectWrite = (effect: "addMembership" | "setStatus", desired: string, args: Record<string, unknown>) =>
            mutation(effect, desired, getMcpToolName(board.mcpServer, "projects_write", tools), {
                ...address(board),
                ...args,
            })
        let desired: string
        if (input.action === "shipping" || (input.action === "cancellation" && response.merged === true)) {
            const proof = planGitHubMerge(
                {
                    mcpServer: revision.mcpServer,
                    repository: revision.repository,
                    number: revision.number,
                    base: revision.base.ref,
                    head: { repository: revision.head.repository, ref: revision.head.ref },
                    expectedHeadSha: revision.head.sha,
                },
                input.evidence,
                tools,
            )
            if (proof.state !== "merged") throw new Error("Confirm exact PR merge before Project Done")
            desired = values.done
        } else if (input.action === "cancellation") {
            if (response.merged !== false) throw new Error("Confirm PR merge/close outcome before cancellation")
            if (response.state === "open") {
                decision = mutation(
                    "closePullRequest",
                    values.canceled,
                    getMcpToolName(revision.mcpServer, "update_pull_request", tools),
                    { ...revision.repository, pullNumber: revision.number, state: "closed" },
                )
                return { ...context, operation: "incomingPullRequestProject" as const, projectAction: decision }
            }
            if (response.state !== "closed") throw new Error("Confirm unmerged closure before Project Canceled")
            desired = values.canceled
        } else {
            if (response.state !== "open" || response.merged !== false)
                throw new Error("Intake/review requires an open unmerged PR")
            desired = input.action === "intake" ? values[input.choice] : values.inReview
        }
        if (input.membership.state === "absent") {
            absence(board, input.membership.lookup, repository, revision.number, tools)
            if (input.action === "review")
                throw new Error("Choose Backlog or Todo and complete PR intake before review")
            decision = projectWrite("addMembership", desired, {
                method: "add_project_item",
                item_owner: revision.repository.owner,
                item_repo: revision.repository.repo,
                item_type: "pull_request",
                pull_request_number: revision.number,
            })
        } else {
            const observed = item(board, input.membership.evidence, repository, revision.number, fieldId, tools)
            if (input.membership.state === "added" || input.membership.state === "reconciled") {
                const attempt =
                    input.membership.state === "added" ? input.membership.creation : input.membership.attempt
                callScope(
                    attempt,
                    board.mcpServer,
                    "projects_write",
                    {
                        method: "add_project_item",
                        ...address(board),
                        item_owner: revision.repository.owner,
                        item_repo: revision.repository.repo,
                        item_type: "pull_request",
                        pull_request_number: revision.number,
                    },
                    tools,
                )
                if (input.membership.state === "added") {
                    const added = mcpResponsePayload(input.membership.creation.response)
                    if (integer(added.id) !== observed.id)
                        throw new Error("Added Project item does not match current membership")
                }
            }
            if (
                input.action === "intake" &&
                (input.membership.state === "present" ||
                    [values.inReview, values.done, values.canceled].includes(observed.status ?? ""))
            )
                decision = { state: "unchanged", status: observed.status }
            else if (input.action === "review" && [values.done, values.canceled].includes(observed.status ?? ""))
                throw new Error("Do not reopen terminal Project work implicitly")
            else if (observed.status === desired) decision = { state: "unchanged", status: observed.status }
            else
                decision = projectWrite("setStatus", desired, {
                    method: "update_project_item",
                    item_id: observed.id,
                    updated_field: { name: board.status.field, value: desired },
                })
        }
    } catch (error) {
        decision = { state: "blocked", reason: error instanceof Error ? error.message : String(error) }
    }
    return { ...context, operation: "incomingPullRequestProject" as const, projectAction: decision }
}
