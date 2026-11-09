import type { ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent"

/** Add the execution contract to fixtures for tools that do not call other tools. */
export function withToolExecution(context: ExtensionContext): ExtensionToolContext {
    return Object.assign(context, {
        tools: [],
        async executeTool(name: string) {
            throw new Error(`This fixture does not provide nested tool execution: ${name}`)
        },
    })
}
