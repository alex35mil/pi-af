import { mcpResponsePayload, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import { requireProviderCall } from "./provider-evidence.js"
import type { ProviderEvidence } from "./resource-id-operations.js"

/** The configured GitHub Project that a read must address. */
export interface GitHubProjectScope {
    mcpServer: string
    owner: string
    ownerType: "user" | "org"
    number: number
}

export interface SingleSelectField {
    id: number
    name: string
    dataType: string
    options: string[]
}

/** One configured field on an item read: absent when the read returned no entry for it. */
export type ItemFieldValue = { state: "absent" } | { state: "present"; value: string | null }

export function projectAddress(project: GitHubProjectScope) {
    return { owner: project.owner, owner_type: project.ownerType, project_number: project.number }
}

/** Proves a `projects_*` call in the configured Project and returns its payload. */
export function projectCall(
    project: GitHubProjectScope,
    evidence: ProviderEvidence,
    operation: string,
    expected: Record<string, unknown>,
    tools: McpToolCatalog,
): Record<string, unknown> {
    requireProviderCall(
        evidence,
        { server: project.mcpServer, operation, expected: { ...projectAddress(project), ...expected } },
        tools,
        "Project",
    )
    return mcpResponsePayload(evidence.response)
}

/** Parses a `get_project_field` read of the named single-select field, as the GitHub MCP returns it. */
export function singleSelectField(
    project: GitHubProjectScope,
    evidence: ProviderEvidence,
    name: string,
    tools: McpToolCatalog,
): SingleSelectField {
    const response = projectCall(project, evidence, "projects_get", { method: "get_project_field" }, tools)
    const id = positiveInteger(response.id, "Project field ID")
    if (
        evidence.arguments.field_id !== id ||
        response.name !== name ||
        response.data_type !== "single_select" ||
        !Array.isArray(response.options)
    )
        throw new Error(`Project ${name} must be the exact configured single-select field`)
    const options = response.options.map((option) => {
        const optionName = object(option, `${name} option`).name
        return typeof optionName === "string" ? optionName : text(object(optionName, `${name} option name`).raw)
    })
    return { id, name, dataType: response.data_type, options }
}

/** Finds the field's entry in an item read's `fields`, matched by name and checked against the field read's ID. */
export function itemFieldValue(response: Record<string, unknown>, field: { id: number; name: string }): ItemFieldValue {
    if (!Array.isArray(response.fields)) throw new Error(`Read the configured ${field.name} field on this exact item`)
    const entries = response.fields
        .map((value) => object(value, "Project item field"))
        .filter((value) => value.name === field.name)
    if (entries.length === 0) return { state: "absent" }
    if (entries.length > 1 || entries[0].id !== field.id) throw new Error(`Ambiguous Project ${field.name} identity`)
    const value = entries[0].value
    return { state: "present", value: value == null ? null : text(object(value, `${field.name} value`).name) }
}

function object(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}`)
    return value as Record<string, unknown>
}
function text(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new Error("Missing native Project text")
    return value
}
function positiveInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
        throw new Error(`Invalid native ${name}`)
    return value
}
