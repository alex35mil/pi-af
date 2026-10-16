export type ProviderBodyPresentation =
    | { kind: "github-tracker" }
    | { kind: "linear-tracker" }
    | { kind: "github-pull-request"; githubIssueNumber?: number }

export function renderProviderBody(source: string, presentation: ProviderBodyPresentation): string {
    const { overview, sections, newline } = splitProviderSource(removeRootHeading(source))
    const separation = newline.repeat(2)
    let body: string
    if (presentation.kind === "github-pull-request") {
        const folds = sections.map((section) =>
            renderGitHubDetails(
                section.title,
                trimSectionEnd(section.content.replace(/^(?:[ \t]*\r?\n)+/, "")),
                newline,
            ),
        )
        body = `${overview}${separation}<hr />${separation}${folds.join(separation)}`
    } else {
        const details = trimSectionEnd(sections.map((section) => section.heading + section.content).join(""))
        const folded =
            presentation.kind === "linear-tracker"
                ? `+++ Full plan${separation}${details}${separation}+++`
                : renderGitHubDetails("Full plan", details, newline)
        body = `${overview}${separation}${folded}`
    }
    return presentation.kind === "github-pull-request" && presentation.githubIssueNumber !== undefined
        ? `${body}${separation}---${separation}Closes #${presentation.githubIssueNumber}`
        : body
}

interface ProviderSourceSection {
    title: string
    heading: string
    content: string
}

function renderGitHubDetails(title: string, content: string, newline: string): string {
    const label = title
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
    const separation = newline.repeat(2)
    return `<details>${newline}<summary>${label}</summary>${separation}${content}${separation}</details>`
}

function splitProviderSource(body: string): { overview: string; sections: ProviderSourceSection[]; newline: string } {
    const expected = "Provider body requires a nonempty ## Overview followed by nonempty level-two detail sections."
    const overviewHeading = /^##[ \t]+Overview[ \t]*(?:\r\n|\n|$)/.exec(body)
    if (!overviewHeading) throw new Error(expected)

    const sections: { start: number; content: number; title: string; heading: string }[] = []
    let fence: { marker: string; length: number } | undefined
    for (const match of body.matchAll(/[^\n]*(?:\n|$)/g)) {
        const line = match[0].replace(/\r?\n$/, "")
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
        if (fence) {
            if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim())
                fence = undefined
            continue
        }
        if (marker && (marker[1][0] === "~" || !marker[2].includes("`"))) {
            fence = { marker: marker[1][0], length: marker[1].length }
            continue
        }
        if (/^##[ \t]+\S/.test(line))
            sections.push({
                start: match.index,
                content: match.index + match[0].length,
                title: line.replace(/^##[ \t]+/, "").trimEnd(),
                heading: match[0],
            })
    }
    if (fence) throw new Error(`${expected} Close the fenced code block before rendering.`)
    if (sections.length < 2) throw new Error(expected)
    for (let index = 0; index < sections.length; index++) {
        if (!body.slice(sections[index].content, sections[index + 1]?.start ?? body.length).trim())
            throw new Error(expected)
    }

    const boundary = sections[1].start
    return {
        overview: trimSectionEnd(body.slice(0, boundary)),
        sections: sections.slice(1).map((section, index) => ({
            title: section.title,
            heading: section.heading,
            content: body.slice(section.content, sections[index + 2]?.start ?? body.length),
        })),
        newline: overviewHeading[0].endsWith("\r\n") ? "\r\n" : "\n",
    }
}

function trimSectionEnd(section: string): string {
    return section.replace(/(?:\r?\n[ \t]*)+$/, "")
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
