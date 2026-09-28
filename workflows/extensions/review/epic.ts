import * as fs from "node:fs"
import * as path from "node:path"

import type { ExtensionContext } from "@earendil-works/pi-coding-agent"

import * as project from "../../../extensions/__lib/project.js"
import { PROJECT_ROOT } from "../__lib/domain.js"
import { fence, MAX_EMBEDDED_FILE_BYTES, readOptional, REVIEW_AUTHORITY_INSTRUCTIONS } from "./context.js"
import { reviewAgentOutputInstructions } from "./findings.js"

export async function buildEpicReviewPrompt(
    ctx: ExtensionContext,
    epicDir: string,
    candidatePath: string,
    previousReviews = "",
    instructions?: string,
): Promise<string> {
    const brief = await fs.promises.readFile(path.join(epicDir, "brief.md"), "utf-8")
    const candidate = await fs.promises.readFile(candidatePath, "utf-8")
    const acceptedEpic = await readOptional(path.join(epicDir, "epic.md"))
    const policies = await readOptional(path.join(project.resolveRootDir(ctx.cwd), PROJECT_ROOT, "policies.md"))
    const relEpicDir = path.relative(ctx.cwd, epicDir)
    const relCandidate = path.relative(ctx.cwd, candidatePath)

    return [
        "# Epic review request",
        "",
        `Epic directory: ${relEpicDir}`,
        `Candidate: ${relCandidate}`,
        "",
        "You are an independent adversarial reviewer running in a fresh context.",
        "You are read-only. Do not modify files and do not ask the user questions directly.",
        ...REVIEW_AUTHORITY_INSTRUCTIONS,
        "Inspect repository context only where needed to validate the initiative contract and decomposition.",
        "Be terse. Do not demand implementation detail, test plans, success criteria, risk registers, status tracking, or other boilerplate.",
        "Apply product/user criteria only where relevant. For infrastructure, migration, or internal work, evaluate operational outcomes, invariants, boundaries, and observable system changes instead.",
        "",
        "Check only for meaningful problems:",
        "- mismatch with the established brief or user decisions",
        "- failure to stand alone for a reader without the conversation or brief",
        "- unclear outcome or architecture presented before user/operator/system behavior",
        "- material settled behavior, scope, state/configuration, workflow, failure handling, compatibility, invariant, integration boundary, or migration state missing from the candidate",
        "- missing concrete example where an example is needed to understand an agreed contract",
        "- major gaps, overlap, or bad ordering among prospective Task units",
        "- units that do not identify their owned outcome, relevant settled contract, and stopping boundary",
        "- units that are too broad, too granular, or implementation-level",
        "- hidden initiative/domain decisions that must be resolved before the epic is usable",
        acceptedEpic
            ? "- removal or alteration of any existing [TASK-…] marker; initialized Task identity must survive title or ordering changes"
            : "",
        instructions ? `\nExtra instructions:\n${instructions}` : "",
        "",
        reviewAgentOutputInstructions(),
        "",
        policies
            ? ["# Project Policies (.project/policies.md)", "", fence(policies, "markdown"), "", "---", ""].join("\n")
            : "---",
        "",
        acceptedEpic ? ["# Accepted epic.md", "", fence(acceptedEpic, "markdown"), "", "---", ""].join("\n") : "",
        previousReviews ? ["# Previous review artifacts", "", previousReviews, "", "---", ""].join("\n") : "",
        "# brief.md",
        "",
        fence(truncateEpic(brief), "markdown"),
        "",
        `# ${relCandidate}`,
        "",
        fence(truncateEpic(candidate), "markdown"),
    ].join("\n")
}

// Preserve the Epic prompt's byte-slicing contract, distinct from Deliverable text truncation.
function truncateEpic(value: string): string {
    const bytes = Buffer.from(value, "utf-8")
    if (bytes.length <= MAX_EMBEDDED_FILE_BYTES) return value
    return `${bytes.subarray(0, MAX_EMBEDDED_FILE_BYTES).toString("utf-8")}\n\n[truncated]`
}
