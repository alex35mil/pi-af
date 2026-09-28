export type ProjectionVerification =
    | { result: "exact"; verified: true; requiresApproval: false }
    | { result: "different"; verified: false; requiresApproval: true; guidance: string }

export function verifyMarkdownProjection(expected: string, actual: string): ProjectionVerification {
    if (expected === actual) return { result: "exact", verified: true, requiresApproval: false }
    return {
        result: "different",
        verified: false,
        requiresApproval: true,
        guidance:
            "Review the exact diff. If this is harmless formatting and byte-for-byte comparison is annoying, consider using a Markdown parser and normalized comparison.",
    }
}
