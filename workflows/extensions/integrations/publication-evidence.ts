import { isDeepStrictEqual } from "node:util"
import { isMcpTool, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import type { ProviderEvidence } from "./resource-id-operations.js"

export function requirePublicationCall(
    evidence: ProviderEvidence,
    server: string,
    operation: string,
    expected: Record<string, unknown>,
    tools: McpToolCatalog,
): void {
    if (!isMcpTool(evidence.tool, server, operation, tools))
        throw new Error("plan publication evidence is not from the configured registered tool")
    for (const [key, value] of Object.entries(expected)) {
        const actual = evidence.arguments[key]
        const matches =
            ["owner", "repo"].includes(key) && typeof actual === "string" && typeof value === "string"
                ? actual.toLowerCase() === value.toLowerCase()
                : isDeepStrictEqual(actual, value)
        if (!matches) throw new Error(`plan publication evidence ${key} does not match the bound object`)
    }
}
