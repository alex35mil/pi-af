import * as fs from "node:fs"

export const MAX_EMBEDDED_FILE_BYTES = 80 * 1024
export const REVIEW_AUTHORITY_INSTRUCTIONS = [
    "The shared permission extension enforces the same project and global permission settings as the parent agent.",
    "Within workflow guidance, established user decisions override Project Policies, and Project Policies override reusable workflow skills and references.",
] as const

export async function readOptional(filePath: string): Promise<string> {
    try {
        return await fs.promises.readFile(filePath, "utf-8")
    } catch {
        return ""
    }
}

export function fence(text: string, language: string): string {
    return `\`\`\`${language}\n${text.replace(/```/g, "`\u200b``")}\n\`\`\``
}

export function truncate(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text
    let out = text.slice(0, maxBytes)
    while (Buffer.byteLength(out, "utf-8") > maxBytes) out = out.slice(0, -1)
    return `${out}\n\n[truncated]`
}
