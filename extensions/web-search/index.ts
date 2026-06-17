/**
 * Web Search Extension
 *
 * Registers a `web_search` tool using Brave Search API.
 * 1,000 free queries/month.
 *
 * Auth: BRAVE_SEARCH_API_KEY from env var or settings.
 *
 * Settings file: web-search.settings.json (3-tier loading)
 *   ~/<agent-dir>/web-search.settings.json             (global)
 *   <repo-root>/.agents/web-search.settings.json       (project, committed)
 *   <repo-root>/.agents/web-search.settings.local.json (project, gitignored)
 *
 * Schema:
 * {
 *   "apiKey": "..."
 * }
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

import * as project from "../__lib/project.js"

const EXTENSION = "web-search"

interface WebSearchSettings {
    apiKey?: string
}

interface BraveSearchResult {
    title?: string
    url?: string
    description?: string
}

interface BraveSearchResponse {
    web?: { results?: BraveSearchResult[] }
    error?: string
}

export default async function (pi: ExtensionAPI) {
    const settings = project.loadExtensionSettings<WebSearchSettings>(EXTENSION, process.cwd(), mergeSettings)

    pi.registerTool({
        name: "web_search",
        label: "web_search",
        description: "Search the web using Brave Search. Returns the top 10 results with title, URL, and snippet.",
        parameters: Type.Object({
            query: Type.String({ description: "The search query" }),
        }),

        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            const apiKey = process.env.BRAVE_SEARCH_API_KEY ?? settings.apiKey

            if (!apiKey) {
                return {
                    details: undefined,
                    content: [
                        {
                            type: "text" as const,
                            text: "Web search is not configured. Set BRAVE_SEARCH_API_KEY as an environment variable, or add apiKey to web-search.settings.json.",
                        },
                    ],
                }
            }

            const query = (params as { query: string }).query
            const url = new URL("https://api.search.brave.com/res/v1/web/search")
            url.searchParams.set("q", query)
            url.searchParams.set("count", "10")

            try {
                const response = await fetch(url.toString(), {
                    headers: {
                        Accept: "application/json",
                        "Accept-Encoding": "gzip",
                        "X-Subscription-Token": apiKey,
                    },
                    signal: signal ?? undefined,
                })

                if (!response.ok) {
                    const body = await response.text()
                    return {
                        details: undefined,
                        content: [
                            {
                                type: "text" as const,
                                text: `Brave Search API error: HTTP ${response.status}\n${body}`,
                            },
                        ],
                    }
                }

                const data = (await response.json()) as BraveSearchResponse

                if (data.error) {
                    return {
                        details: undefined,
                        content: [
                            {
                                type: "text" as const,
                                text: `Brave Search API error: ${data.error}`,
                            },
                        ],
                    }
                }

                const items = data.web?.results ?? []

                if (items.length === 0) {
                    return {
                        details: undefined,
                        content: [
                            {
                                type: "text" as const,
                                text: `No results found for: ${query}`,
                            },
                        ],
                    }
                }

                const text = items
                    .map((item, i) => {
                        const title = item.title ?? "(no title)"
                        const link = item.url ?? ""
                        const snippet = item.description ?? ""
                        return `${i + 1}. ${title}\n   ${link}\n   ${snippet}`
                    })
                    .join("\n\n")

                return {
                    details: undefined,
                    content: [{ type: "text" as const, text }],
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err)
                return {
                    details: undefined,
                    content: [
                        {
                            type: "text" as const,
                            text: `Web search failed: ${message}`,
                        },
                    ],
                }
            }
        },
    })

    const apiKey = process.env.BRAVE_SEARCH_API_KEY ?? settings.apiKey
    if (!apiKey) {
        const announceStartup = (ctx: ExtensionContext) => {
            ctx.ui.setWidget(`${EXTENSION}:startup`, [`Missing: BRAVE_SEARCH_API_KEY`])
        }
        pi.on("session_start", async (_event, ctx) => announceStartup(ctx))
    }
}

function mergeSettings(
    base: Partial<WebSearchSettings>,
    override: Partial<WebSearchSettings>,
): Partial<WebSearchSettings> {
    return {
        apiKey: override.apiKey ?? base.apiKey,
    }
}
