import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

import {
    MCP_TOOL_DECORATORS_EVENT,
    type McpToolDecorator,
    type McpToolDecorators,
} from "../../../extensions/__lib/mcp.js"
import { identifyMcpService } from "./mcp.js"
import { decoratePublicationTool } from "./publication-tool.js"

export const decorateMcpPublication: McpToolDecorator = (native, metadata, transport) =>
    decoratePublicationTool(native, {
        provider: transport.type === "stdio" ? "other" : identifyMcpService({ url: transport.url }),
        name: metadata.serverToolName,
        inputSchema: metadata.inputSchema,
    })

export function registerWorkflowPublication(pi: Pick<ExtensionAPI, "events" | "on">): void {
    const dispose = pi.events.on(MCP_TOOL_DECORATORS_EVENT, (registration) => {
        ;(registration as McpToolDecorators).use(decorateMcpPublication)
    })
    pi.on("session_shutdown", async () => dispose())
}
