export type ProviderBodyPresentation =
    | { kind: "github-plan-comment" }
    | { kind: "linear-plan-document" }
    | { kind: "github-pull-request"; githubIssueNumber?: number }

export const LINEAR_PLAN_DOCUMENT_TITLE = "Plan"

const expectedSource = "Provider body requires a nonempty ## Overview followed by nonempty level-two detail sections."

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
            presentation.kind === "linear-plan-document"
                ? `+++ Full plan${separation}${details}${separation}+++`
                : renderGitHubDetails("Full plan", details, newline)
        const visible = renderPlanOverview(overview, newline, presentation.kind)
        body = `${visible}${separation}${folded}`
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

function renderPlanOverview(
    overview: string,
    newline: string,
    kind: "github-plan-comment" | "linear-plan-document",
): string {
    let rendered = overview
    for (const heading of [...providerHeadings(overview)].reverse()) {
        if (heading.start === 0 && kind === "linear-plan-document") {
            rendered = rendered.slice(heading.content).replace(/^[ \t]*(?:\r\n|\n)/, "")
            continue
        }
        const title =
            heading.start === 0
                ? "# Plan"
                : heading.level === 3 && heading.title === "Plan highlights"
                  ? "## Highlights"
                  : undefined
        if (title)
            rendered =
                rendered.slice(0, heading.start) +
                title +
                (heading.heading.endsWith("\n") ? newline : "") +
                rendered.slice(heading.content)
    }
    return rendered
}

function* providerHeadings(body: string) {
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
        const heading = /^(#{2,3})[ \t]+(\S.*)$/.exec(line)
        if (heading)
            yield {
                start: match.index,
                content: match.index + match[0].length,
                title: heading[2].trimEnd(),
                heading: match[0],
                level: heading[1].length,
            }
    }
    if (fence) throw new Error(`${expectedSource} Close the fenced code block before rendering.`)
}

function splitProviderSource(body: string): { overview: string; sections: ProviderSourceSection[]; newline: string } {
    const overviewHeading = /^##[ \t]+Overview[ \t]*(?:\r\n|\n|$)/.exec(body)
    if (!overviewHeading) throw new Error(expectedSource)

    const sections = [...providerHeadings(body)].filter((heading) => heading.level === 2)
    if (sections.length < 2) throw new Error(expectedSource)
    for (let index = 0; index < sections.length; index++) {
        if (!body.slice(sections[index].content, sections[index + 1]?.start ?? body.length).trim())
            throw new Error(expectedSource)
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

const PUBLICATION_MARKER = /^<!-- plan-publication:([^ >]+) -->$/
const ATTRIBUTION = /^(?:<sub>Sent via [^\r\n]+<\/sub>|\*Sent via [^\r\n]+\*)$/

export interface RestoredPlan {
    source: string
    token: string
}

// The inverse of tracker plan rendering: rebuilds the reviewed source from a published
// GitHub comment or Linear document body. The root title comes from the tracker item.
export function restoreProviderSource(
    body: string,
    presentation: Extract<ProviderBodyPresentation, { kind: "github-plan-comment" | "linear-plan-document" }>,
    title: string,
): RestoredPlan {
    const newline = body.includes("\r\n") ? "\r\n" : "\n"
    const lines = body.split(/\r?\n/)
    const markers = lines.flatMap((line) => PUBLICATION_MARKER.exec(line.trim())?.[1] ?? [])
    if (markers.length !== 1) throw new Error("published plan must carry exactly one plan publication marker")
    const kept = lines.filter((line) => !PUBLICATION_MARKER.test(line.trim()) && !ATTRIBUTION.test(line.trim()))
    let text = kept.join("\n").replace(/\s+$/, "")

    const fold =
        presentation.kind === "github-plan-comment"
            ? /\n*<details>\n<summary>Full plan<\/summary>\n\n([\s\S]*?)\n\n<\/details>$/.exec(text)
            : /\n*\+\+\+ Full plan\n\n([\s\S]*?)\n\n\+\+\+$/.exec(text)
    if (!fold) throw new Error("published plan has no Full plan fold to restore from")
    let overview = text.slice(0, fold.index)
    const details = fold[1]
    if (presentation.kind === "github-plan-comment") {
        if (!/^# Plan\n/.test(overview)) throw new Error("published GitHub plan must start with `# Plan`")
        overview = overview.replace(/^# Plan\n/, "## Overview\n")
    } else overview = `## Overview\n\n${overview}`
    overview = overview.replace(/^## Highlights$/m, "### Plan highlights")
    text = `# ${title.trim()}\n\n${overview.replace(/\s+$/, "")}\n\n${details}\n`
    return { source: text.replaceAll("\n", newline), token: markers[0] }
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
