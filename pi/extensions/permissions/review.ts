import {
    createCodemodeExtension,
    type AgentToolResult,
    type ExtensionAPI,
    type ExtensionToolContext,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"

const ReviewNoteSchema = Type.Object({
    path: Type.String(),
    side: Type.Union([Type.Literal("current"), Type.Literal("proposed")]),
    lineStart: Type.Number(),
    lineEnd: Type.Number(),
    lines: Type.Array(Type.String()),
    note: Type.String(),
})
export type ReviewNote = Static<typeof ReviewNoteSchema>

const ReviewSchema = Type.Object({
    kind: Type.Literal("pi-af-file-review"),
    outcome: Type.Union([Type.Literal("accepted"), Type.Literal("modified"), Type.Literal("rejected")]),
    path: Type.String(),
    notes: Type.Array(ReviewNoteSchema),
})
export type FileReview = Static<typeof ReviewSchema>
export interface FileReviewDetails {
    review: FileReview
}

export const EditorChoiceSchema = Type.Union([
    Type.Object({ result: Type.Literal("Accepted"), notes: Type.Optional(Type.Array(ReviewNoteSchema)) }),
    Type.Object({
        result: Type.Literal("AcceptModified"),
        content: Type.String(),
        notes: Type.Optional(Type.Array(ReviewNoteSchema)),
    }),
    Type.Object({ result: Type.Literal("Rejected"), notes: Type.Optional(Type.Array(ReviewNoteSchema)) }),
])

export function formatReviewNotes(notes?: ReviewNote[]): string {
    if (!notes?.length) return ""
    return (
        '\n\nUser review notes require explicit response. Before doing anything else, you MUST reply in chat to the user with every note below and your response to each one. For each note in your chat reply, quote the full note text exactly with every quoted line prefixed by `>`, then write your response below the quote. Do not respond with only a label or summary. Do not ignore, silently drop, or skip a note because you disagree. A response may be as short as "Accepted and agreed.", but every note must have an explicit response: accepted, rejected with reason, or needs clarification. If every note is fully accepted and has an obvious local resolution, do not stop after the chat response and do not wait for user approval; immediately continue with the follow-up edit/tool call. Stop and ask the user only for unclear, rejected, conflicting, scope-changing, or product/domain notes.\n\nReview notes:\n' +
        notes
            .map((note, index) => {
                const range =
                    note.lineStart === note.lineEnd ? `${note.lineStart}` : `${note.lineStart}-${note.lineEnd}`
                return [
                    `- N${index + 1}: ${note.side}:${range}`,
                    `  lines: ${JSON.stringify(note.lines)}`,
                    `  note: ${note.note}`,
                ].join("\n")
            })
            .join("\n")
    )
}

export function fileReviewResult(review: FileReview, text: string): AgentToolResult<FileReviewDetails> {
    return {
        content: [{ type: "text", text: text + formatReviewNotes(review.notes) }],
        details: { review },
        ...(review.outcome === "rejected" ? { isError: true } : {}),
    }
}

export function isFileReviewDetails(details: unknown): details is FileReviewDetails {
    return !!details && typeof details === "object" && "review" in details && Value.Check(ReviewSchema, details.review)
}

function readReview(details: unknown): FileReview | undefined {
    return isFileReviewDetails(details) ? details.review : undefined
}

export function decorateReviewCodemode(native: ToolDefinition): ToolDefinition {
    return {
        ...native,
        async execute(id, input, signal, onUpdate, ctx) {
            const handoff = new AbortController()
            const combined = AbortSignal.any([...(signal ? [signal] : []), handoff.signal])
            const outcomes: Awaited<ReturnType<ExtensionToolContext["executeTool"]>>[] = []
            let ownedInterruption = false
            const executeTool: ExtensionToolContext["executeTool"] = async (name, args, options) => {
                if (outcomes.length) throw new Error("This script returned control for user review notes")
                const outcome = await ctx.executeTool(name, args, options)
                const review = name === "edit" || name === "write" ? readReview(outcome.result.details) : undefined
                if (review?.notes.length) {
                    outcomes.push(outcome)
                    // Native codemode aborts its per-call signal when a script ends independently.
                    // Do not claim that failure/cancellation as our own interruption.
                    if (!options?.signal?.aborted && !signal?.aborted) {
                        ownedInterruption = true
                        handoff.abort(new Error("Return control to the model for user review notes"))
                    }
                }
                return outcome
            }
            // Native contexts have a non-configurable executeTool value. Copy descriptors
            // to preserve live getters while replacing it on a separate context object.
            const context: ExtensionToolContext = Object.create(Object.getPrototypeOf(ctx), {
                ...Object.getOwnPropertyDescriptors(ctx),
                executeTool: { value: executeTool },
            })
            const result = await native.execute(id, input, combined, onUpdate, context)
            if (!outcomes.length) return result
            const handled = ownedInterruption && !signal?.aborted
            const explanation = handled
                ? "Script stopped for user review. The child edit outcome is final; do not repeat an accepted edit. Native cancellation text below describes the stopped script, not a failed accepted edit."
                : "User review notes were returned. The native script failure or external cancellation is preserved; child edit outcomes remain final."
            const notes = outcomes.flatMap((outcome) => outcome.result.content)
            return {
                ...result,
                ...(handled ? { isError: false } : {}),
                content: [{ type: "text", text: explanation }, ...notes, ...result.content],
                details: Object.assign({}, result.details, {
                    reviewHandoff: { status: handled ? "returned-to-model" : "failure-preserved", outcomes },
                }),
            }
        },
    }
}

export function registerReviewCodemode(pi: ExtensionAPI) {
    return createCodemodeExtension()(
        new Proxy(pi, {
            get(target, property, receiver) {
                return property === "registerTool"
                    ? (native: ToolDefinition) => pi.registerTool(decorateReviewCodemode(native))
                    : Reflect.get(target, property, receiver)
            },
        }),
    )
}
