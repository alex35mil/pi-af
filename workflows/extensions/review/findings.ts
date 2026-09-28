import { type Static, Type } from "typebox"

const REVIEW_SEVERITIES = ["critical", "warning", "suggestion", "question"] as const
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number]
export type ReviewSignoff = "approved" | "blocked"

export const ReviewResponseFindingSchema = Type.Object(
    {
        id: Type.String({ pattern: "^F[1-9][0-9]*$", description: "Stable finding label from the review" }),
        title: Type.String({ minLength: 1, description: "Short direct problem heading" }),
        problem: Type.String({ minLength: 1, description: "What is wrong, stated directly in plain language" }),
        useCase: Type.String({
            minLength: 1,
            description: "One simple supported scenario that demonstrates the problem",
        }),
        impact: Type.String({ minLength: 1, description: "The concrete observable consequence" }),
        resolution: Type.String({
            minLength: 1,
            description: "The accepted correction, rejection reason, or needed decision",
        }),
        userDecision: Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
            description: "Exact unsettled decision, or null when no user decision is needed",
        }),
    },
    { additionalProperties: false },
)
export type ReviewFinding = Static<typeof ReviewResponseFindingSchema> & { severity: ReviewSeverity }

export interface ReviewReport {
    findings: ReviewFinding[]
    signoff: ReviewSignoff
}

export function reviewAgentOutputInstructions(): string {
    return [
        "Return only one JSON object. Do not wrap it in Markdown or add commentary.",
        "Use this exact shape:",
        '{"findings":[{"id":"F1","title":"Short direct title","severity":"critical|warning|suggestion|question","problem":"What is wrong","useCase":"One simple supported scenario that demonstrates it","impact":"What concretely happens","resolution":"The direct correction","userDecision":null}],"signoff":"blocked"}',
        "Number finding IDs consecutively from F1. Use an empty findings array when there are no findings.",
        "Write short, direct, concrete sentences. Explain necessary technical terms. Do not use review-process jargon or list corrections without explaining the problem.",
        "Set userDecision to null when established requirements determine the correction. Otherwise state the exact decision the user must make.",
        "Use blocked when any critical, warning, or question finding remains. Suggestions may appear with either signoff. Use approved only when no blocking-severity finding remains.",
    ].join("\n")
}

const FINDING_KEYS = [...Object.keys(ReviewResponseFindingSchema.properties), "severity"]
const REPORT_KEYS = ["findings", "signoff"] as const
const SEVERITIES = new Set<ReviewSeverity>(REVIEW_SEVERITIES)

export function parseReviewReport(output: string): ReviewReport {
    let value: unknown
    try {
        value = JSON.parse(output.trim())
    } catch {
        throw new Error("reviewer output must be one JSON review report")
    }
    assertRecord(value, "review report")
    assertExactKeys(value, REPORT_KEYS, "review report")
    if (!Array.isArray(value.findings)) throw new Error("review report findings must be an array")
    if (value.signoff !== "approved" && value.signoff !== "blocked") {
        throw new Error("review report signoff must be approved or blocked")
    }

    const findings = value.findings.map((finding, index) => parseFinding(finding, index))
    if (value.signoff === "approved" && findings.some((finding) => finding.severity !== "suggestion")) {
        throw new Error("approved review report may contain only suggestion findings")
    }
    if (value.signoff === "blocked" && findings.length === 0) {
        throw new Error("blocked review report must contain at least one finding")
    }
    return { findings, signoff: value.signoff }
}

export function renderReviewFindings(findings: readonly ReviewFinding[]): string {
    const lines = ["## Review findings", ""]
    if (findings.length === 0) return [...lines, "None."].join("\n")

    findings.forEach((finding, index) => {
        lines.push(
            `### ${index + 1}. ${trimBoundaryWhitespace(finding.title)} (${finding.id})`,
            "",
            `**Problem:** ${trimBoundaryWhitespace(finding.problem)}`,
            "",
            `**Use case:** ${trimBoundaryWhitespace(finding.useCase)}`,
            "",
            `**Impact:** ${trimBoundaryWhitespace(finding.impact)}`,
            "",
            `**Resolution:** ${trimBoundaryWhitespace(finding.resolution)}`,
            "",
            `**User decision needed:** ${finding.userDecision === null ? "No." : `Yes. ${trimBoundaryWhitespace(finding.userDecision)}`}`,
        )
        if (index < findings.length - 1) lines.push("")
    })
    return lines.join("\n")
}

export function renderReviewDocument(report: ReviewReport): string {
    return `${renderReviewFindings(report.findings)}\n\n## Review status\n\n**Signoff:** ${report.signoff}\n`
}

function parseFinding(value: unknown, index: number): ReviewFinding {
    const context = `review finding ${index + 1}`
    assertRecord(value, context)
    assertExactKeys(value, FINDING_KEYS, context)
    const expectedId = `F${index + 1}`
    if (value.id !== expectedId) throw new Error(`${context} id must be ${expectedId}`)
    if (typeof value.severity !== "string" || !SEVERITIES.has(value.severity as ReviewSeverity)) {
        throw new Error(`${context} severity is invalid`)
    }
    const title = requiredString(value.title, `${context} title`)
    const useCase = requiredString(value.useCase, `${context} useCase`)
    const problem = requiredString(value.problem, `${context} problem`)
    const impact = requiredString(value.impact, `${context} impact`)
    const resolution = requiredString(value.resolution, `${context} resolution`)
    const userDecision = value.userDecision
    if (userDecision !== null && (typeof userDecision !== "string" || !userDecision.trim())) {
        throw new Error(`${context} userDecision must be null or a non-empty string`)
    }
    return {
        id: value.id,
        title,
        severity: value.severity as ReviewSeverity,
        useCase,
        problem,
        impact,
        resolution,
        userDecision,
    }
}

function assertRecord(value: unknown, context: string): asserts value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${context} must be an object`)
    }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], context: string): void {
    const actual = Object.keys(value).sort()
    const wanted = [...expected].sort()
    if (actual.join("\n") !== wanted.join("\n")) throw new Error(`${context} has unexpected or missing fields`)
}

function requiredString(value: unknown, context: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${context} must be non-empty`)
    return value
}

function trimBoundaryWhitespace(value: string): string {
    return value.trim()
}
