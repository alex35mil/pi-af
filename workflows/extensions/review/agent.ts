import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { parseReviewReport, renderReviewDocument } from "./findings.js"

const SHARED_EXTENSIONS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../extensions")
const RULES_EXTENSION_PATH = path.join(SHARED_EXTENSIONS_ROOT, "rules/index.ts")
const PERMISSION_EXTENSION_PATH = path.join(SHARED_EXTENSIONS_ROOT, "permission/index.ts")

type ReviewStatus = "running" | "completed" | "failed"

export interface ReviewAgentRunOptions {
    cwd: string
    prompt: string
    signal?: AbortSignal
    model?: string
    agentName: string
    progressLabel: string
    jsonlPath?: string
    onUpdate?: (update: string) => void
}

export interface ReviewAgentRunResult {
    exitCode: number
    finalOutput: string
    stderr: string
    events: unknown[]
}

export async function runReviewAgent(options: ReviewAgentRunOptions): Promise<ReviewAgentRunResult> {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-review-agent-"))
    const promptPath = path.join(tmpDir, "prompt.md")
    await fs.promises.writeFile(promptPath, options.prompt, { encoding: "utf-8", mode: 0o600 })

    const args = buildReviewerArgs(options.agentName, promptPath, options.model)

    const invocation = getPiInvocation(args)
    const child = spawn(invocation.command, invocation.args, {
        cwd: options.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
    })
    const abort = () => child.kill("SIGTERM")
    options.signal?.addEventListener("abort", abort, { once: true })

    const events: unknown[] = []
    let stdoutBuffer = ""
    let stderr = ""
    let finalOutput = ""
    let currentActivity = "starting"
    const jsonl = options.jsonlPath
        ? fs.createWriteStream(options.jsonlPath, { encoding: "utf-8", mode: 0o600 })
        : undefined

    const publishUpdate = (status: ReviewStatus) => {
        options.onUpdate?.(formatReviewUpdate(options.progressLabel, status, currentActivity))
    }
    const handleEvent = (event: any) => {
        events.push(event)
        if (event?.type === "tool_execution_start") {
            currentActivity = formatToolActivity(event.toolName, event.args)
            publishUpdate("running")
        }
        const output = extractFinalOutput(event)
        if (output) finalOutput = output
    }

    publishUpdate("running")
    child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8")
        jsonl?.write(text)
        stdoutBuffer += text
        const lines = stdoutBuffer.split("\n")
        stdoutBuffer = lines.pop() ?? ""
        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
                handleEvent(JSON.parse(trimmed))
            } catch {
                events.push({ type: "unparseable", line: trimmed })
            }
        }
    })
    child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8")
    })

    const exitCode = await new Promise<number>((resolve) => {
        child.on("close", (code) => resolve(code ?? 1))
        child.on("error", () => resolve(1))
    })

    if (stdoutBuffer.trim()) {
        if (jsonl) jsonl.write(stdoutBuffer.endsWith("\n") ? stdoutBuffer : `${stdoutBuffer}\n`)
        try {
            handleEvent(JSON.parse(stdoutBuffer.trim()))
        } catch {
            events.push({ type: "unparseable", line: stdoutBuffer.trim() })
        }
    }

    if (jsonl) {
        jsonl.end()
        await new Promise<void>((resolve) => jsonl.on("finish", () => resolve()))
    }
    options.signal?.removeEventListener("abort", abort)
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
    currentActivity = exitCode === 0 ? "completed" : `failed with exit code ${exitCode}`
    publishUpdate(exitCode === 0 ? "completed" : "failed")

    return { exitCode, finalOutput, stderr, events }
}

export function renderReviewTranscript(events: unknown[]): string {
    const lines = ["# Review agent transcript", ""]
    for (const event of events as any[]) {
        if (event?.type === "tool_execution_start") {
            lines.push(`- tool: ${event.toolName} ${JSON.stringify(event.args ?? {})}`)
        } else if (event?.type === "message_end") {
            const text = messageText(event.message)
            if (!text) continue
            try {
                lines.push(`\n## Assistant\n\n${renderReviewDocument(parseReviewReport(text))}`)
            } catch {
                lines.push("\n## Assistant\n\nInvalid structured review output omitted; see agent.jsonl.\n")
            }
        }
    }
    return lines.join("\n")
}

export function buildReviewerArgs(agentName: string, promptPath: string, model?: string): string[] {
    const args = [
        "--mode",
        "json",
        "--no-session",
        "--no-extensions",
        "--extension",
        RULES_EXTENSION_PATH,
        "--extension",
        PERMISSION_EXTENSION_PATH,
        "--no-skills",
        "--no-prompt-templates",
        "--tools",
        "read,grep,find,ls",
        "--name",
        agentName,
    ]
    if (model) args.push("--model", model)
    args.push(`@${promptPath}`)
    return args
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
    const currentScript = process.argv[1]
    if (currentScript && fs.existsSync(currentScript)) {
        return { command: process.execPath, args: [currentScript, ...args] }
    }
    return { command: "pi", args }
}

function formatReviewUpdate(label: string, status: ReviewStatus, activity: string): string {
    return [`${label}: ${status}`, `Current: ${activity}`].join("\n")
}

function formatToolActivity(toolName: string | undefined, args: unknown): string {
    const input = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
    const target =
        typeof input.path === "string"
            ? input.path
            : typeof input.file_path === "string"
              ? input.file_path
              : typeof input.pattern === "string"
                ? input.pattern
                : ""
    return target ? `${toolName ?? "tool"} ${target}` : (toolName ?? "tool")
}

function extractFinalOutput(event: any): string {
    if (event?.type === "agent_end" && Array.isArray(event.messages)) {
        for (let i = event.messages.length - 1; i >= 0; i--) {
            const text = messageText(event.messages[i])
            if (text) return text
        }
    }
    if (event?.type === "message_update" || event?.type === "message_end") return messageText(event.message)
    return ""
}

function messageText(message: any): string {
    if (message?.role !== "assistant" || !Array.isArray(message.content)) return ""
    return message.content
        .filter((part: any) => part?.type === "text" && typeof part.text === "string")
        .map((part: any) => part.text)
        .join("\n")
        .trim()
}
