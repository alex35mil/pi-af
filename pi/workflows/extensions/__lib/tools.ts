import { parseArgs, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent"
import type { TObject } from "typebox"

const installed = new WeakSet<ExtensionAPI>()
const DISCOVERY_ERROR =
    "Workflow tools require Codemode discovery. Enable the existing codemode tool with --tools +codemode, or include codemode in your tool allowlist. Workflow tools remain deferred; their permissions and approval requirements are unchanged."

export type WorkflowNamespace = "initialization" | "integrations" | "setup" | "reviews" | "pull_requests" | "delivery"

/** Respect explicit selection before enabling discovery for the package's deferred operations. */
export function activateWorkflowDiscovery(pi: ExtensionAPI, argv = process.argv.slice(2)): string | undefined {
    const args = parseArgs(argv)
    const defaults = pi.getSettings().defaultTools
    const cliAllowlist = args.tools?.some((name) => !name.startsWith("+") && !name.startsWith("-"))
    const selection = cliAllowlist ? args.tools! : [...(defaults ?? []), ...(args.tools ?? [])]
    const explicit = selection.filter((name) => ["codemode", "+codemode", "-codemode"].includes(name)).at(-1)
    const replacedDefaults = !cliAllowlist && defaults?.some((name) => !name.startsWith("+") && !name.startsWith("-"))
    const disabled =
        explicit === "-codemode" ||
        (explicit === undefined && replacedDefaults) ||
        (args.noTools && explicit !== "codemode" && explicit !== "+codemode")
    if (disabled || !pi.getAllTools().some((tool) => tool.name === "codemode" && tool.exposure !== "hidden"))
        return DISCOVERY_ERROR
    const active = pi.getActiveTools()
    if (!active.includes("codemode")) pi.setActiveTools([...active, "codemode"])
    return pi.getActiveTools().includes("codemode") ? undefined : DISCOVERY_ERROR
}

/** Register native deferred tools; schemas and execution stay with their operation owners. */
export function workflowTools(pi: ExtensionAPI, namespace: WorkflowNamespace) {
    if (!installed.has(pi)) {
        installed.add(pi)
        pi.on("session_start", () => {
            const error = activateWorkflowDiscovery(pi)
            if (error) throw new Error(error)
        })
    }
    return {
        registerTool<TParams extends TObject, TDetails>(definition: ToolDefinition<TParams, TDetails>) {
            if (definition.parameters.type !== "object" || !/^[A-Za-z0-9_-]{1,50}$/.test(definition.name))
                throw new Error(
                    `Workflow tool ${definition.name} requires an object schema and a unique ASCII name of at most 50 characters`,
                )
            pi.registerTool({
                ...definition,
                exposure: "deferred",
                namespace: {
                    name: `workflows_${namespace}`,
                    description: `Discover ${namespace.replaceAll("_", " ")} workflow operations on demand.`,
                    instructions:
                        "Use searchTools() to find the required operation and describeTool() for its exact input contract. Call it through tools.<name>(). Every operation retains normal validation, permission checks, and user approval gates; discovery grants no approval.",
                },
            })
        },
    }
}
