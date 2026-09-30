export interface ProviderBodyOptions {
    githubIssueNumber?: number
}

export function renderProviderBody(source: string, options: ProviderBodyOptions = {}): string {
    let body = removeRootHeading(source)
    if (options.githubIssueNumber === undefined) return body

    const closingReference = `Closes #${options.githubIssueNumber}`
    if (!body) return closingReference
    body += body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n"
    return `${body}---\n\n${closingReference}`
}

function removeRootHeading(source: string): string {
    const heading = /^#[ \t]+[^\r\n]*(?:\r\n|\n|$)/.exec(source)
    if (!heading) return source

    const remainder = source.slice(heading[0].length)
    const blankLine = /^[ \t]*(?:\r\n|\n)/.exec(remainder)
    return blankLine ? remainder.slice(blankLine[0].length) : remainder
}

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
