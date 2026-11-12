import * as fs from "node:fs"
import * as path from "node:path"

import type { ExtensionContext } from "@earendil-works/pi-coding-agent"

import * as project from "../../../extensions/__lib/project.js"
import { PROJECT_ROOT } from "../__lib/domain.js"
import {
    fence,
    MAX_EMBEDDED_FILE_BYTES,
    readOptional,
    REVIEW_AUTHORITY_INSTRUCTIONS,
    REVIEW_DOCUMENT_INSTRUCTIONS,
    REVIEW_GIT_INSTRUCTIONS,
} from "./context.js"
import { reviewAgentOutputInstructions } from "./findings.js"
import { NO_PASS_PROMPT, type PassPrompt } from "./pass.js"

export interface EpicReviewPromptOptions {
    pass?: PassPrompt
    // The `candidate.md` of the last valid round: the reference for Task markers that must survive.
    previousCandidate?: string
    instructions?: string
}

export async function buildEpicReviewPrompt(
    ctx: ExtensionContext,
    epicDir: string,
    candidatePath: string,
    options: EpicReviewPromptOptions = {},
): Promise<string> {
    const { pass = NO_PASS_PROMPT, previousCandidate = "", instructions } = options
    const brief = await fs.promises.readFile(path.join(epicDir, "brief.md"), "utf-8")
    const candidate = await fs.promises.readFile(candidatePath, "utf-8")
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
        REVIEW_DOCUMENT_INSTRUCTIONS,
        "The Epic document is a current-state map of the initiative: its goal, the Task delivery strategy, and the Task list with a short outcome per Task. Detail lives in Task plans, Task results, and shipped documentation, so a missing detail is not a finding.",
        "Inspect repository context only where needed to validate the goal and decomposition.",
        REVIEW_GIT_INSTRUCTIONS,
        "Be terse. Do not demand a complete contract, implementation detail, test plans, success criteria, risk registers, status tracking, or other boilerplate.",
        "Apply product/user criteria only where relevant. For infrastructure, migration, or internal work, evaluate operational outcomes, invariants, boundaries, and observable system changes instead.",
        "",
        "Check only for meaningful problems:",
        "- a goal that mismatches the established brief or user decisions",
        "- major gaps, overlap, or bad ordering among the Task sections under `## Tasks`",
        "- Task sections that do not identify their owned outcome, or whose `Kind:` line doesn't fit the work",
        "- Task sections that are too broad, too granular, or implementation-level",
        "- hidden initiative/domain decisions that must be resolved before Tasks can start",
        "- a `## Task delivery strategy` section without `Task target: default|epic` and `Epic branch: <name>` lines, or a target that disagrees with the strategy rationale or highlights",
        "- removal or alteration of any existing Task marker ([#N] or [ENG-N]); Task identity must survive title or ordering changes",
        "- a tagged Task deleted instead of kept with `Status: canceled`",
        ...pass.instructions,
        instructions ? `\nExtra instructions:\n${instructions}` : "",
        "",
        reviewAgentOutputInstructions(),
        "",
        policies
            ? ["# Project Policies (.project/policies.md)", "", fence(policies, "markdown"), "", "---", ""].join("\n")
            : "---",
        "",
        previousCandidate
            ? [
                  "# Previously reviewed epic.md",
                  "",
                  "Shown only as the reference for existing Task markers.",
                  "",
                  fence(truncateEpic(previousCandidate), "markdown"),
                  "",
                  "---",
                  "",
              ].join("\n")
            : "",
        pass.sections ? [pass.sections, "", "---", ""].join("\n") : "",
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
