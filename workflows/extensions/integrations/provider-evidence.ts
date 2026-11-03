import { isDeepStrictEqual } from "node:util"
import { isMcpTool, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import type { ProviderEvidence } from "./resource-id-operations.js"

// GitHub owner and repository names are case-insensitive; every other argument must match exactly.
const caseInsensitiveArguments = new Set(["owner", "repo", "item_owner", "item_repo"])

export interface ProviderCall {
    server: string
    operation: string
    expected: Record<string, unknown>
}

/**
 * Proves that evidence comes from the configured registered tool, called with the expected arguments.
 * `label` names the evidence in errors, for example "plan publication" or "Project".
 */
export function requireProviderCall(
    evidence: Pick<ProviderEvidence, "tool" | "arguments">,
    call: ProviderCall,
    tools: McpToolCatalog,
    label: string,
): void {
    if (!isMcpTool(evidence.tool, call.server, call.operation, tools))
        throw new Error(`${label} evidence is not from the configured registered tool`)
    for (const [key, value] of Object.entries(call.expected)) {
        const actual = evidence.arguments[key]
        const matches =
            caseInsensitiveArguments.has(key) && typeof actual === "string" && typeof value === "string"
                ? actual.toLowerCase() === value.toLowerCase()
                : isDeepStrictEqual(actual, value)
        if (!matches) throw new Error(`${label} evidence argument ${key} does not match the required scope`)
    }
}
