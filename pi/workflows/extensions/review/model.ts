import * as fs from "node:fs"
import { ModelRuntime, resolveCliModel, type ExtensionAPI, type ModelRegistry } from "@earendil-works/pi-coding-agent"
import type { Provider } from "@earendil-works/pi-ai"

export interface ReviewerEnvironment {
    defaultProvider: string | undefined
    defaultModel: string | undefined
    claudeCode: { kind: "loaded"; provider: Provider; extensionPath: string } | { kind: "unavailable" }
}

export type ReviewerLaunch =
    | { kind: "standard"; model: string | undefined }
    | { kind: "claude-code"; model: string | undefined; extensionPath: string }

/** Native command provenance already reflects package resolution, resource filters and project trust. */
export function reviewerEnvironment(
    pi: Pick<ExtensionAPI, "getSettings" | "getCommands">,
    registry: Pick<ModelRegistry, "getRegisteredNativeProvider">,
): ReviewerEnvironment {
    const settings = pi.getSettings()
    const provider = registry.getRegisteredNativeProvider("claude-code")
    const command = pi
        .getCommands()
        .find((command) => command.name === "claude-code-status" && command.source === "extension")
    return {
        defaultProvider: settings.defaultProvider,
        defaultModel: settings.defaultModel,
        claudeCode:
            provider && command
                ? { kind: "loaded", provider, extensionPath: command.sourceInfo.path }
                : { kind: "unavailable" },
    }
}

function claudeLaunch(environment: ReviewerEnvironment, model: string | undefined): ReviewerLaunch {
    if (environment.claudeCode.kind !== "loaded")
        throw new Error(
            "Claude Code reviewer provider is unavailable. Install and enable pi-claude-code, log in with Claude Code, and reload Pi before selecting claude-code/model. No provider was installed or substituted.",
        )
    const extensionPath = environment.claudeCode.extensionPath
    if (!fs.existsSync(extensionPath) || !fs.statSync(extensionPath).isFile())
        throw new Error(
            "The loaded Claude Code provider entry point is unavailable. Restore its configured package and reload Pi; the reviewer will not install or substitute a provider.",
        )
    return { kind: "claude-code", model, extensionPath }
}

export async function resolveReviewerLaunch(
    environment: ReviewerEnvironment,
    model: string | undefined,
    signal?: AbortSignal,
): Promise<ReviewerLaunch> {
    signal?.throwIfAborted()
    if (model === undefined) {
        // Keep the child CLI's existing configured-default/automatic selection behavior.
        return environment.defaultProvider === "claude-code" && environment.defaultModel
            ? claudeLaunch(environment, `claude-code/${environment.defaultModel}`)
            : { kind: "standard", model: undefined }
    }
    if (model.toLowerCase().startsWith("claude-code/") && environment.claudeCode.kind !== "loaded")
        return claudeLaunch(environment, model)

    // The same public resolver as the CLI owns IDs, fuzzy patterns, ambiguity and thinking suffixes.
    // Provider registration reuses the already trusted provider object, never another extension factory.
    const runtime = await ModelRuntime.create({ allowModelNetwork: false, signal })
    const prefix = model.split("/", 1)[0].toLowerCase()
    const explicitStandard =
        prefix !== "claude-code" && runtime.getProviders().some((provider) => provider.id.toLowerCase() === prefix)
    if (!explicitStandard && environment.claudeCode.kind === "loaded") {
        runtime.registerNativeProvider(environment.claudeCode.provider)
        await runtime.refresh({ providers: ["claude-code"], allowNetwork: false, signal })
    }
    const selection = resolveCliModel({ cliModel: model, modelRuntime: runtime })
    if (selection.error) throw new Error(`Reviewer model selection failed: ${selection.error}`)
    if (!selection.model) throw new Error("Reviewer model selection did not resolve a provider; use provider/model.")
    if (selection.model.provider === "claude-code") {
        if (!runtime.hasConfiguredAuth("claude-code"))
            throw new Error(
                "Claude Code reviewer authentication is unavailable. Log in with the configured Claude Code CLI; no login or provider substitution was attempted.",
            )
        return claudeLaunch(environment, model)
    }
    return { kind: "standard", model }
}
