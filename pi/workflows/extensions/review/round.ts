import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent"

import {
    runReviewAgent,
    renderReviewTranscript,
    type ReviewAgentRunOptions,
    type ReviewAgentRunResult,
} from "./agent.js"
import { fence } from "./context.js"
import {
    parseReviewReport,
    renderReviewDocument,
    renderReviewFindings,
    reviewAgentOutputInstructions,
    type ReviewFinding,
    type ReviewReport,
} from "./findings.js"

export const INVALID_REPORT_FILE = "invalid-report.md"

export interface ReviewRoundOptions extends Omit<ReviewAgentRunOptions, "jsonlPath" | "session"> {
    directory: string
    additionalFiles: string[]
}

type ReviewRunner = (options: ReviewAgentRunOptions) => Promise<ReviewAgentRunResult>

interface ParsedRun {
    result: ReviewAgentRunResult
    report?: ReviewReport
    reportError?: Error
}

export function reviewCorrectionPrompt(error: string, previousOutput: string): string {
    return [
        "# Correct your review report",
        `Your previous final answer could not be accepted as the review report: ${error}.`,
        "Do not review again and do not read more files. Return the same review, with the same findings and signoff, as one corrected JSON report.",
        "Your previous final answer, in full:",
        fence(previousOutput, "text"),
        reviewAgentOutputInstructions(),
    ].join("\n\n")
}

/**
 * The model-facing result of a successful review round. The signoff stays the final line; a notice, such as
 * the blocked-review pause, goes first. Round file paths appear only in failed-round errors.
 */
export function renderReviewRoundResult(report: ReviewReport, round: number, notice?: string): string {
    return [notice, `**Review round:** ${round}`, renderReviewDocument(report).trimEnd()]
        .filter((part) => part !== undefined)
        .join("\n\n")
}

export async function executeReviewRound(
    options: ReviewRoundOptions,
    runner: ReviewRunner = runReviewAgent,
): Promise<{ report: ReviewReport }> {
    const file = (name: string) => path.join(options.directory, name)
    const requestPath = file("request.md")
    const jsonlPath = file("agent.jsonl")
    await fs.promises.writeFile(requestPath, options.prompt, { encoding: "utf-8", flag: "wx" })
    const sessionDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-review-session-"))
    let first: ParsedRun
    let correction: ParsedRun | undefined
    try {
        first = await runParsed(runner, { ...options, jsonlPath, session: { directory: sessionDir, resume: false } })
        if (first.reportError && !options.signal?.aborted) {
            const prompt = reviewCorrectionPrompt(first.reportError.message, first.result.finalOutput)
            await fs.promises.appendFile(requestPath, `\n\n---\n\n${prompt}`, "utf-8")
            correction = await runParsed(runner, {
                ...options,
                prompt,
                jsonlPath,
                session: { directory: sessionDir, resume: true },
            })
        }
    } finally {
        await fs.promises.rm(sessionDir, { recursive: true, force: true })
    }
    const final = correction ?? first
    const result: ReviewAgentRunResult = {
        exitCode: final.result.exitCode,
        finalOutput: final.result.finalOutput,
        stderr: [first.result.stderr, correction?.result.stderr ?? ""].filter((text) => text.trim()).join("\n"),
        events: [...first.result.events, ...(correction?.result.events ?? [])],
    }
    const report = final.report
    const reportError = final.reportError ?? first.reportError
    const unvalidatedOutput = report
        ? ""
        : ([correction?.result.finalOutput, first.result.finalOutput].find((text) => text?.trim()) ?? "")
    if (report) {
        await fs.promises.writeFile(file("review.md"), renderReviewDocument(report), "utf-8")
        await fs.promises.writeFile(file("report.json"), `${JSON.stringify(report, null, 4)}\n`, "utf-8")
    }
    await fs.promises.writeFile(file("transcript.md"), renderReviewTranscript(result.events), "utf-8")
    if (result.stderr.trim()) await fs.promises.writeFile(file("stderr.txt"), result.stderr, "utf-8")
    if (unvalidatedOutput && reportError) {
        await fs.promises.writeFile(
            file(INVALID_REPORT_FILE),
            `# Unvalidated reviewer output\n\nThis is not a validated review or signoff. Validation error: ${reportError.message}.\n\n${fence(unvalidatedOutput, "text")}\n`,
            "utf-8",
        )
    }
    await fs.promises.writeFile(
        file("outcome.json"),
        `${JSON.stringify({ exitCode: result.exitCode, signoff: report?.signoff ?? null }, null, 4)}\n`,
        "utf-8",
    )
    if (report) return { report }
    const files = [
        ...options.additionalFiles,
        requestPath,
        file("transcript.md"),
        jsonlPath,
        file("outcome.json"),
        ...(result.stderr.trim() ? [file("stderr.txt")] : []),
        ...(unvalidatedOutput && reportError ? [file(INVALID_REPORT_FILE)] : []),
    ]
    const artifactText = ["Artifacts:", ...files.map((entry) => `- ${path.relative(options.cwd, entry)}`)].join("\n")
    const unvalidated =
        unvalidatedOutput && reportError
            ? `\n\nUnvalidated reviewer output. Use it only as evidence; it is not a review or signoff:\n\n${fence(unvalidatedOutput, "text")}`
            : ""
    const failure =
        result.exitCode !== 0
            ? `Review agent exited with code ${result.exitCode}${correction ? " during the report correction" : ""}.`
            : `Review agent returned an invalid structured report${correction ? " after one correction" : ""}: ${reportError?.message ?? "missing report"}.`
    throw new Error(`${failure}${unvalidated}\n\n${artifactText}`)
}

async function runParsed(runner: ReviewRunner, options: ReviewAgentRunOptions): Promise<ParsedRun> {
    let result: ReviewAgentRunResult
    try {
        result = await runner(options)
    } catch (error) {
        result = {
            exitCode: 1,
            finalOutput: "",
            stderr: error instanceof Error ? error.message : String(error),
            events: [],
        }
    }
    if (result.exitCode !== 0) return { result }
    try {
        return { result, report: parseReviewReport(result.finalOutput) }
    } catch (error) {
        return { result, reportError: error instanceof Error ? error : new Error(String(error)) }
    }
}

export async function recordRoundResponse(
    directory: string,
    findings: Omit<ReviewFinding, "severity">[],
    status: string,
): Promise<string> {
    const reportPath = path.join(directory, "report.json")
    const report = parseReviewReport(await fs.promises.readFile(reportPath, "utf-8"))
    if (findings.length !== report.findings.length)
        throw new Error(`response must contain all ${report.findings.length} review findings`)
    const complete = findings.map((finding, index) => {
        const reviewed = report.findings[index]
        if (finding.id !== reviewed.id)
            throw new Error(`response finding ${index + 1} must retain review label ${reviewed.id}`)
        return { ...finding, severity: reviewed.severity }
    })
    const content = `${renderReviewFindings(complete)}\n\n## Review status\n\n${status.trim()}\n`
    const responsePath = path.join(directory, "response.md")
    await withFileMutationQueue(responsePath, () => fs.promises.writeFile(responsePath, content, "utf-8"))
    return content
}
