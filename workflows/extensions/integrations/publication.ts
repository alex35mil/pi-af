export type PublicationProvider = "github" | "linear" | "other"

export interface PublicationOperation {
    provider: PublicationProvider
    name: string
    inputSchema: Readonly<Record<string, unknown>>
}

export const AUTHORSHIP_PARAMETER = "__pi_authorship"
export type PublicationAuthorship = "ai-assisted" | "user-verbatim"
export const AUTHORSHIP_GUIDANCE =
    "AI-assisted communication is signed automatically. Set __pi_authorship to user-verbatim automatically when the user supplies the complete message and you relay it unchanged; no special opt-out wording is needed. Preserve that text exactly. Use ai-assisted (the default) for content you compose, reword, expand, or generate around a user quotation. Never add a signature yourself. Content edits require complete text, not patches."
export const REVIEW_GUIDANCE =
    "User review before sending: when a call creates or changes message text (the body, description, or content), first show the user the complete text and the destination, then wait for explicit approval. Skip the text review only when the user explicitly approved sending without review, the content comes from an artifact or workflow step the user already approved (including bodies rendered by workflow code from it; anything beyond that rendering needs new approval), or the user supplied the complete message and you relay it unchanged; the destination must still be clear. A request to tell, reply to, or update someone asks for a draft, not a send. Metadata-only calls are unaffected."

interface PublicationDefinition {
    field: "body" | "description" | "content"
    methods: readonly string[] | null
}

export type PublicationBinding =
    | { kind: "none" }
    | (PublicationDefinition & { kind: "communication"; service: "github" | "linear" })

const github: Record<string, PublicationDefinition> = {
    issue_write: { field: "body", methods: ["create", "update"] },
    create_pull_request: { field: "body", methods: null },
    update_pull_request: { field: "body", methods: null },
    add_issue_comment: { field: "body", methods: null },
    update_issue_comment: { field: "body", methods: null },
    add_reply_to_pull_request_comment: { field: "body", methods: null },
    add_comment_to_pending_review: { field: "body", methods: null },
    pull_request_review_write: { field: "body", methods: ["create", "submit_pending"] },
    projects_write: { field: "body", methods: ["create_project_status_update"] },
}
const linear: Record<string, PublicationDefinition> = {
    save_issue: { field: "description", methods: null },
    save_project: { field: "description", methods: null },
    save_comment: { field: "body", methods: null },
    save_status_update: { field: "body", methods: null },
    save_document: { field: "content", methods: null },
    save_release_note: { field: "content", methods: null },
    save_milestone: { field: "description", methods: null },
    save_release: { field: "description", methods: null },
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function publicationBinding(tool: PublicationOperation): PublicationBinding {
    const definitions = tool.provider === "github" ? github : tool.provider === "linear" ? linear : undefined
    const definition = definitions && Object.hasOwn(definitions, tool.name) ? definitions[tool.name] : undefined
    if (!definition) return { kind: "none" }
    const schema = tool.inputSchema
    if (schema.type !== "object" || !record(schema.properties) || !record(schema.properties[definition.field])) {
        throw new Error(
            `Unsupported publication schema for ${tool.provider}/${tool.name}: expected ${definition.field}.`,
        )
    }
    if (Object.hasOwn(schema.properties, AUTHORSHIP_PARAMETER)) {
        throw new Error(`Native publication schema conflicts with local ${AUTHORSHIP_PARAMETER}.`)
    }
    return { kind: "communication", service: tool.provider as "github" | "linear", ...definition }
}

export function publicationToolSchema(tool: PublicationOperation): Record<string, unknown> {
    if (publicationBinding(tool).kind === "none") return structuredClone(tool.inputSchema)
    return {
        ...structuredClone(tool.inputSchema),
        properties: {
            ...structuredClone(tool.inputSchema.properties as Record<string, unknown>),
            [AUTHORSHIP_PARAMETER]: {
                type: "string",
                enum: ["ai-assisted", "user-verbatim"],
                description: AUTHORSHIP_GUIDANCE,
            },
        },
    }
}

export function publicationToolDescription(tool: PublicationOperation, description: string): string {
    return publicationBinding(tool).kind === "none"
        ? description
        : `${description}\n\n${REVIEW_GUIDANCE}\n\n${AUTHORSHIP_GUIDANCE}`
}

export interface PublicationIdentity {
    harness: string
    provider: string
    modelId: string
}

function markdownLiteral(text: string): string {
    return text.replace(/[\\`*_[\]<>]/g, "\\$&")
}

function htmlLiteral(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export function signPublication(
    text: string,
    service: Exclude<PublicationProvider, "other">,
    identity: PublicationIdentity,
): string {
    const escape = service === "github" ? (value: string) => markdownLiteral(htmlLiteral(value)) : markdownLiteral
    const sentence = `Sent via ${escape(identity.harness)}. Model: ${escape(identity.provider)}/${escape(identity.modelId)}.`
    const footer = service === "github" ? `<sub>${sentence}</sub>` : `*${sentence}*`
    const previous =
        /(^|(?:\r?\n){2})(?:<sub>Sent via [^\r\n]+(?: \[[^\r\n]+\]\.|\. Model: [^\r\n]+\.)<\/sub>|\*Sent via [^\r\n]+(?: \[[^\r\n]+\]\.|\. Model: [^\r\n]+\.)\*)((?:\r?\n)*)$/.exec(
            text,
        )
    if (previous) return text.slice(0, previous.index) + previous[1] + footer + previous[2]
    const newline = text.includes("\r\n") ? "\r\n" : "\n"
    const separation = text.endsWith(newline.repeat(2)) ? "" : text.endsWith(newline) ? newline : newline.repeat(2)
    return text + separation + footer
}

export type Publication =
    | { kind: "none" }
    | { kind: "complete-text-required"; reason: string }
    | { kind: "text"; field: string; text: string; service: "github" | "linear"; authorship: PublicationAuthorship }

export function classifyPublication(tool: PublicationOperation, input: Record<string, unknown>): Publication {
    const binding = publicationBinding(tool)
    if (binding.kind === "none") return binding
    const authorship = input[AUTHORSHIP_PARAMETER] ?? "ai-assisted"
    if (authorship !== "ai-assisted" && authorship !== "user-verbatim")
        throw new Error("Invalid publication authorship.")
    if (binding.methods && !binding.methods.includes(input.method as string)) return { kind: "none" }
    if (tool.provider === "linear" && input.patch !== undefined) {
        return {
            kind: "complete-text-required",
            reason: "Read the exact object through its registered tool and send the complete edited text instead of patch.",
        }
    }
    const text = input[binding.field]
    if (input.template !== undefined && (typeof text !== "string" || !text.trim())) {
        return {
            kind: "complete-text-required",
            reason: "Supply complete publication text instead of relying on remote template content.",
        }
    }
    if (text === undefined || (typeof text === "string" && !text.trim())) return { kind: "none" }
    if (typeof text !== "string") throw new Error(`Publication ${binding.field} must be text.`)
    return { kind: "text", field: binding.field, text, service: binding.service, authorship }
}

// Workflow execution prepares content before delegating to the native tool.
export function preparePublication(
    tool: PublicationOperation,
    input: Record<string, unknown>,
    readIdentity: () => PublicationIdentity,
): Record<string, unknown> {
    const publication = classifyPublication(tool, input)
    if (publication.kind === "complete-text-required") throw new Error(publication.reason)
    if (publication.kind === "none" || publication.authorship === "user-verbatim") return input
    return {
        ...input,
        [publication.field]: signPublication(publication.text, publication.service, readIdentity()),
    }
}

export function publicationWireArguments(
    tool: PublicationOperation,
    prepared: Record<string, unknown>,
): Record<string, unknown> {
    if (publicationBinding(tool).kind === "none") return prepared
    const { [AUTHORSHIP_PARAMETER]: _authorship, ...native } = prepared
    return native
}
