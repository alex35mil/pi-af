/**
 * Test-only compatibility fixture from earendil-works/pi-claude-code (MIT),
 * src/transcript.ts at 70abb65186592ca788b29b3db22c3160d629c41f.
 * Reproduces that revision's normalization, not a runtime schema workaround.
 */
function withoutNullVariant(schema: unknown): unknown {
    if (Array.isArray(schema)) return schema.map(withoutNullVariant)
    if (!schema || typeof schema !== "object") return schema
    const input = schema as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) output[key] = withoutNullVariant(value)
    if (Array.isArray(output.type) && output.type.includes("null")) {
        const remaining = output.type.filter((value) => value !== "null")
        output.type = remaining.length === 1 ? remaining[0] : remaining
    }
    if (Array.isArray(output.anyOf)) {
        const nonNull = output.anyOf.filter(
            (branch) => !(branch && typeof branch === "object" && (branch as Record<string, unknown>).type === "null"),
        )
        if (nonNull.length === 1 && nonNull.length !== output.anyOf.length) {
            const replacement = nonNull[0]
            delete output.anyOf
            if (replacement && typeof replacement === "object") Object.assign(output, replacement)
        }
    }
    return output
}
export function claudeCodeSchema(schema: unknown): Record<string, unknown> {
    const normalized = withoutNullVariant(schema) as Record<string, unknown>
    for (const key of ["oneOf", "allOf", "anyOf"]) delete normalized[key]
    if (!normalized.type) normalized.type = "object"
    if (normalized.type === "object" && (!normalized.properties || typeof normalized.properties !== "object"))
        normalized.properties = {}
    return normalized
}
