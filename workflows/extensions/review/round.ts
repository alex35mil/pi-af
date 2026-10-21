import * as fs from "node:fs"
import * as path from "node:path"
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent"

import {
    runReviewAgent,
    renderReviewTranscript,
    type ReviewAgentRunOptions,
    type ReviewAgentRunResult,
} from "./agent.js"
import {
    parseReviewReport,
    renderReviewDocument,
    renderReviewFindings,
    type ReviewFinding,
    type ReviewReport,
} from "./findings.js"

export interface ReviewRoundOptions extends Omit<ReviewAgentRunOptions, "jsonlPath"> {
    directory: string
    additionalFiles: string[]
}

export async function executeReviewRound(
    options: ReviewRoundOptions,
    runner: (options: ReviewAgentRunOptions) => Promise<ReviewAgentRunResult> = runReviewAgent,
): Promise<{ report: ReviewReport; artifactText: string }> {
    const file = (name: string) => path.join(options.directory, name)
    const requestPath = file("request.md")
    const jsonlPath = file("agent.jsonl")
    await fs.promises.writeFile(requestPath, options.prompt, { encoding: "utf-8", flag: "wx" })
    let result: ReviewAgentRunResult
    try {
        result = await runner({ ...options, jsonlPath })
    } catch (error) {
        result = {
            exitCode: 1,
            finalOutput: "",
            stderr: error instanceof Error ? error.message : String(error),
            events: [],
        }
    }
    let report: ReviewReport | undefined
    let reportError: Error | undefined
    if (result.exitCode === 0) {
        try {
            report = parseReviewReport(result.finalOutput)
        } catch (error) {
            reportError = error instanceof Error ? error : new Error(String(error))
        }
    }
    if (report) {
        await fs.promises.writeFile(file("review.md"), renderReviewDocument(report), "utf-8")
        await fs.promises.writeFile(file("report.json"), `${JSON.stringify(report, null, 4)}\n`, "utf-8")
    }
    await fs.promises.writeFile(file("transcript.md"), renderReviewTranscript(result.events), "utf-8")
    if (result.stderr.trim()) await fs.promises.writeFile(file("stderr.txt"), result.stderr, "utf-8")
    await fs.promises.writeFile(
        file("outcome.json"),
        `${JSON.stringify({ exitCode: result.exitCode, signoff: report?.signoff ?? null }, null, 4)}\n`,
        "utf-8",
    )
    const files = [
        ...options.additionalFiles,
        ...(report ? [file("review.md"), file("report.json")] : []),
        requestPath,
        file("transcript.md"),
        jsonlPath,
        file("outcome.json"),
        ...(result.stderr.trim() ? [file("stderr.txt")] : []),
    ]
    const artifactText = ["Artifacts:", ...files.map((entry) => `- ${path.relative(options.cwd, entry)}`)].join("\n")
    if (result.exitCode !== 0) throw new Error(`Review agent exited with code ${result.exitCode}.\n\n${artifactText}`)
    if (!report)
        throw new Error(
            `Review agent returned an invalid structured report: ${reportError?.message ?? "missing report"}.\n\n${artifactText}`,
        )
    return { report, artifactText }
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
