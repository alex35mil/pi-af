/**
 * Fetch Extension
 *
 * Registers a `fetch` tool that fetches a URL and extracts readable
 * content as markdown.
 *
 * Pipeline: HTTP -> HTTPS upgrade
 *           → fetch() with timeout
 *           → reject binary Content-Type
 *           → Readability article extraction
 *           → Turndown+GFM HTML -> markdown
 *           → cleanup
 *           → truncate to 100k chars
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"
import TurndownService from "turndown"
import { gfm } from "turndown-plugin-gfm"

const MAX_LENGTH = 100_000
const TIMEOUT_MS = 30_000

const BINARY_CONTENT_TYPES = [
    "application/octet-stream",
    "image/",
    "audio/",
    "video/",
    "application/pdf",
    "application/zip",
    "application/gzip",
    "application/x-tar",
    "font/",
]

export default async function (pi: ExtensionAPI) {
    pi.registerTool({
        name: "fetch",
        label: "fetch",
        description:
            "Fetch a URL and return its contents as clean, readable markdown. Extracts article content from HTML pages, stripping navigation, ads, and boilerplate. Also handles plain text and JSON. Upgrades HTTP to HTTPS automatically.",
        parameters: Type.Object({
            url: Type.String({ description: "The URL to fetch" }),
        }),

        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            let url = (params as { url: string }).url

            // HTTP → HTTPS upgrade
            if (url.startsWith("http://")) {
                url = "https://" + url.slice(7)
            }

            // Ensure valid URL
            if (!url.startsWith("https://")) {
                url = "https://" + url
            }

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

            // Forward external abort signal
            if (signal) {
                signal.addEventListener("abort", () => controller.abort())
            }

            try {
                const response = await fetch(url, {
                    signal: controller.signal,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9",
                    },
                    redirect: "follow",
                })

                if (!response.ok) {
                    return {
                        details: undefined,
                        content: [
                            {
                                type: "text" as const,
                                text: `HTTP ${response.status} ${response.statusText} for ${url}`,
                            },
                        ],
                    }
                }

                const contentType = response.headers.get("content-type") ?? ""

                if (isBinaryContentType(contentType)) {
                    return {
                        details: undefined,
                        content: [
                            {
                                type: "text" as const,
                                text: `Refused to fetch binary content (${contentType}) from ${url}`,
                            },
                        ],
                    }
                }

                const body = await response.text()
                let result: string

                if (contentType.includes("text/html")) {
                    result = htmlToMarkdown(body, url)
                } else if (contentType.includes("application/json")) {
                    try {
                        result = JSON.stringify(JSON.parse(body), null, 2)
                    } catch {
                        result = body
                    }
                } else {
                    result = body
                }

                // Truncate
                if (result.length > MAX_LENGTH) {
                    result = result.slice(0, MAX_LENGTH) + `\n\n[Truncated — content exceeded ${MAX_LENGTH} characters]`
                }

                return {
                    details: undefined,
                    content: [{ type: "text" as const, text: result }],
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err)
                return {
                    details: undefined,
                    content: [
                        {
                            type: "text" as const,
                            text: `Failed to fetch ${url}: ${message}`,
                        },
                    ],
                }
            } finally {
                clearTimeout(timeout)
            }
        },
    })
}

function isBinaryContentType(contentType: string): boolean {
    const ct = contentType.toLowerCase()
    return BINARY_CONTENT_TYPES.some((prefix) => ct.startsWith(prefix))
}

function htmlToMarkdown(html: string, url: string): string {
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    let content: string
    let title: string | undefined

    if (article?.content) {
        content = article.content
        title = article.title ?? undefined
    } else {
        // Fallback: strip non-content elements and extract main content
        const fallbackDom = new JSDOM(html, { url })
        const doc = fallbackDom.window.document
        doc.querySelectorAll("script, style, noscript, nav, header, footer, aside").forEach((el) => el.remove())

        title = doc.querySelector("title")?.textContent?.trim()
        const main = doc.querySelector("main, article, [role='main'], .content, #content") || doc.body
        content = main?.innerHTML || ""
    }

    const turndown = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
    })
    turndown.use(gfm)
    turndown.addRule("removeEmptyLinks", {
        filter: (node) => node.nodeName === "A" && !node.textContent?.trim(),
        replacement: () => "",
    })

    let md = turndown.turndown(content)

    // Clean up whitespace
    md = md
        .replace(/\[\\?\[\s*\\?\]\]\([^)]*\)/g, "")
        .replace(/ +/g, " ")
        .replace(/\s+,/g, ",")
        .replace(/\s+\./g, ".")
        .replace(/\n{3,}/g, "\n\n")
        .trim()

    if (title) {
        md = `# ${title}\n\n${md}`
    }

    return md
}
