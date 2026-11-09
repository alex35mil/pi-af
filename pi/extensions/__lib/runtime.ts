/**
 * Where this Pi runs: directly on the host, or inside a sandbox such as a nono worker.
 *
 * Selected by PI_AF_RUNTIME: unset or empty means host, `sandbox` means sandboxed.
 * Any other value is invalid, so a typo never silently falls back to host policy.
 */

export const RUNTIME_ENV = "PI_AF_RUNTIME"

export type Runtime = "host" | "sandbox"

export type RuntimeResult = { runtime: Runtime } | { error: Error }

export function resolveRuntime(env: NodeJS.ProcessEnv = process.env): RuntimeResult {
    const value = env[RUNTIME_ENV]
    if (value === undefined || value === "") return { runtime: "host" }
    if (value === "sandbox") return { runtime: "sandbox" }
    return {
        error: new Error(
            `invalid ${RUNTIME_ENV} ${JSON.stringify(value)}: expected "sandbox", or unset for the host runtime`,
        ),
    }
}

/** The current runtime, throwing the invalid-runtime error for callers that report settings errors. */
export function requireRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
    const result = resolveRuntime(env)
    if ("error" in result) throw result.error
    return result.runtime
}
