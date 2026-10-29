import * as fs from "node:fs"

import {
    createEditToolDefinition,
    createWriteToolDefinition,
    type AgentToolResult,
    type ExtensionAPI,
    type ExtensionToolContext,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import { Value } from "typebox/value"
import type { TSchema } from "typebox"

import { EditorChoiceSchema, fileReviewResult, isFileReviewDetails, type FileReviewDetails } from "./review.js"

type FileKind = "edit" | "write"
// A deny carries the reason returned to the model.
export type FilePermission = { mode: "allow" } | { mode: "ask" } | { mode: "deny"; reason: string }
export type FilePermissionResolver = (
    kind: FileKind,
    input: Record<string, unknown>,
    ctx: ExtensionToolContext,
) => Promise<FilePermission>

// A native operation hook returns an editor-owned outcome without continuing the file mutation.
class ReviewedFile extends Error {
    constructor(
        readonly result: AgentToolResult<FileReviewDetails>,
        readonly completion: "review" | "turn-abort",
    ) {
        super("File review completed")
    }
}

async function reviewFile(
    kind: FileKind,
    input: Record<string, unknown>,
    ctx: ExtensionToolContext,
    signal?: AbortSignal,
) {
    signal?.throwIfAborted()
    const target = String(input.path)
    const title = JSON.stringify({ prompt: `${kind}: ${target}`, toolName: kind, toolInput: input })
    const choice = await ctx.ui.select(title, ["Accept", "Reject"], { signal })
    signal?.throwIfAborted()
    if (choice === "Accept") return
    if (choice?.startsWith("{")) {
        const value: unknown = JSON.parse(choice)
        if (!Value.Check(EditorChoiceSchema, value)) throw new Error("Invalid editor file-review response")
        const notes = value.notes ?? []
        if (value.result === "Accepted") {
            throw new ReviewedFile(
                fileReviewResult(
                    { kind: "pi-af-file-review", outcome: "accepted", path: target, notes },
                    `[accepted] User approved the edit. Changes applied to ${target} as proposed.`,
                ),
                "review",
            )
        }
        if (value.result === "AcceptModified") {
            throw new ReviewedFile(
                fileReviewResult(
                    { kind: "pi-af-file-review", outcome: "modified", path: target, notes },
                    `[accepted] User approved with modifications. ${target} was updated with user's version, which differs from what you proposed. Current content of ${target}:\n\`\`\`\n${value.content}\n\`\`\``,
                ),
                "review",
            )
        }
        if (notes.length) {
            throw new ReviewedFile(
                fileReviewResult(
                    { kind: "pi-af-file-review", outcome: "rejected", path: target, notes },
                    `[rejected] User rejected the edit to ${target}. File unchanged.`,
                ),
                "review",
            )
        }
    }
    ctx.abort()
    throw new ReviewedFile(
        fileReviewResult(
            { kind: "pi-af-file-review", outcome: "rejected", path: target, notes: [] },
            `[rejected] User rejected the edit to ${target}. File unchanged.`,
        ),
        "turn-abort",
    )
}

function isFileInput(value: unknown): value is Record<string, unknown> & { path: string } {
    return !!value && typeof value === "object" && "path" in value && typeof value.path === "string"
}

function wrapFileTool<TParams extends TSchema, TDetails, TRenderState>(
    native: ToolDefinition<TParams, TDetails | undefined, TRenderState>,
    makeReviewed: (
        cwd: string,
        review: () => Promise<void>,
    ) => ToolDefinition<TParams, TDetails | undefined, TRenderState>,
    resolvePermission: FilePermissionResolver,
    kind: FileKind,
): ToolDefinition<TParams, TDetails | FileReviewDetails | undefined, TRenderState> {
    const renderer = native.renderResult
    return {
        ...native,
        renderResult: renderer
            ? (result, options, theme, context) => {
                  const details = isFileReviewDetails(result.details) ? undefined : result.details
                  return renderer({ ...result, details }, options, theme, context)
              }
            : undefined,
        async execute(id, input, signal, onUpdate, ctx) {
            if (!isFileInput(input)) throw new Error("Expected a file path")
            const permission = await resolvePermission(kind, input, ctx)
            // A deny fails only this call; the turn continues.
            if (permission.mode === "deny") throw new Error(permission.reason)
            if (permission.mode === "allow") return native.execute(id, input, signal, onUpdate, ctx)
            if (!ctx.hasUI) throw new Error(`[rejected] Blocked (no UI for confirmation): ${native.name}`)
            const reviewed = makeReviewed(ctx.cwd, () => reviewFile(kind, input, ctx, signal))
            try {
                return await reviewed.execute(id, input, signal, onUpdate, ctx)
            } catch (error) {
                if (!(error instanceof ReviewedFile)) throw error
                if (error.completion === "review") signal?.throwIfAborted()
                return error.result
            }
        },
    }
}

export function registerPermissionFiles(pi: ExtensionAPI, resolvePermission: FilePermissionResolver) {
    pi.registerTool(
        wrapFileTool(
            createEditToolDefinition(process.cwd()),
            (cwd, review) =>
                createEditToolDefinition(cwd, {
                    operations: {
                        access: (file) => fs.promises.access(file, fs.constants.R_OK | fs.constants.W_OK),
                        async readFile(file) {
                            await review()
                            return fs.promises.readFile(file)
                        },
                        writeFile: (file, content) => fs.promises.writeFile(file, content, "utf-8"),
                    },
                }),
            resolvePermission,
            "edit",
        ),
    )
    pi.registerTool(
        wrapFileTool(
            createWriteToolDefinition(process.cwd()),
            (cwd, review) =>
                createWriteToolDefinition(cwd, {
                    operations: {
                        async mkdir(directory) {
                            await review()
                            await fs.promises.mkdir(directory, { recursive: true })
                        },
                        writeFile: (file, content) => fs.promises.writeFile(file, content, "utf-8"),
                    },
                }),
            resolvePermission,
            "write",
        ),
    )
}
