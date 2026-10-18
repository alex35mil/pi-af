import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"

import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

import {
    AUTHORSHIP_PARAMETER,
    AUTHORSHIP_GUIDANCE,
    classifyPublication,
    preparePublication,
    publicationBinding,
    publicationToolDescription,
    publicationToolSchema,
    publicationWireArguments,
    signPublication,
    type PublicationOperation,
    type PublicationProvider,
} from "../workflows/extensions/integrations/publication.ts"
import {
    decoratePublicationTool,
    readHarnessName,
    readPublicationIdentity,
} from "../workflows/extensions/integrations/publication-tool.ts"
import { renderProviderBody } from "../workflows/extensions/integrations/projection.ts"

const identity = { harness: "Pi", provider: "openrouter", modelId: "anthropic/claude-sonnet-4-5" }
const readIdentity = () => identity
const unavailableIdentity = () => {
    throw new Error("Identity must not be read")
}
const githubFooter = "<sub>Sent via Pi. Model: openrouter/anthropic/claude-sonnet-4-5.</sub>"
const linearFooter = "*Sent via Pi. Model: openrouter/anthropic/claude-sonnet-4-5.*"
const mappings: Array<[Exclude<PublicationProvider, "other">, string, string, string | null]> = [
    ["github", "issue_write", "body", "create"],
    ["github", "issue_write", "body", "update"],
    ["github", "create_pull_request", "body", null],
    ["github", "update_pull_request", "body", null],
    ["github", "add_issue_comment", "body", null],
    ["github", "update_issue_comment", "body", null],
    ["github", "add_reply_to_pull_request_comment", "body", null],
    ["github", "add_comment_to_pending_review", "body", null],
    ["github", "pull_request_review_write", "body", "create"],
    ["github", "pull_request_review_write", "body", "submit_pending"],
    ["github", "projects_write", "body", "create_project_status_update"],
    ["linear", "save_issue", "description", null],
    ["linear", "save_project", "description", null],
    ["linear", "save_comment", "body", null],
    ["linear", "save_status_update", "body", null],
    ["linear", "save_document", "content", null],
    ["linear", "save_release_note", "content", null],
    ["linear", "save_milestone", "description", null],
    ["linear", "save_release", "description", null],
]

function operation(provider: PublicationProvider, name: string, field = "body"): PublicationOperation {
    return {
        provider,
        name,
        inputSchema: {
            type: "object",
            properties: { [field]: { type: "string" }, method: { type: "string" } },
            additionalProperties: false,
        },
    }
}

describe("workflow publication policy", () => {
    for (const [provider, name, field, method] of mappings) {
        it(`signs ${provider}/${name}${method ? `:${method}` : ""} only in ${field}`, () => {
            const tool = operation(provider, name, field)
            const input = {
                [field]: "Message.",
                title: "Title",
                priority: 2,
                labels: ["unrelated"],
                ...(method ? { method } : {}),
            }
            const before = structuredClone(input)
            let reads = 0
            assert.deepEqual(
                preparePublication(tool, input, () => {
                    reads++
                    return identity
                }),
                {
                    ...input,
                    [field]: `Message.\n\n${provider === "github" ? githubFooter : linearFooter}`,
                },
            )
            assert.equal(reads, 1)
            assert.deepEqual(input, before)
        })
    }

    it("keeps complete verbatim text exact without reading identity and signs the next AI message", () => {
        const tool = operation("github", "add_issue_comment")
        const text = `  Exact text.\r\n\r\n${githubFooter}\r\n `
        const input = { body: text, [AUTHORSHIP_PARAMETER]: "user-verbatim" }
        assert.equal(preparePublication(tool, input, unavailableIdentity).body, text)
        assert.deepEqual(publicationWireArguments(tool, preparePublication(tool, input, unavailableIdentity)), {
            body: text,
        })
        assert.equal(
            preparePublication(tool, { body: "Next AI message." }, readIdentity).body,
            `Next AI message.\n\n${githubFooter}`,
        )
    })

    it("uses each supplied identity and replaces only the terminal signature", () => {
        const tool = operation("github", "update_issue_comment")
        const input = { body: "Body.\n\n" + githubFooter, [AUTHORSHIP_PARAMETER]: "ai-assisted" }
        const prepared = preparePublication(tool, input, readIdentity)
        assert.deepEqual(preparePublication(tool, prepared, readIdentity), prepared)
        const changed = preparePublication(tool, prepared, () => ({
            harness: "Pi",
            provider: "anthropic",
            modelId: "claude-new",
        }))
        assert.equal(changed.body, "Body.\n\n<sub>Sent via Pi. Model: anthropic/claude-new.</sub>")
        const examples = `> ${githubFooter}\n\n\`\`\`html\n${githubFooter}\n\`\`\``
        assert.equal(signPublication(examples, "github", identity), `${examples}\n\n${githubFooter}`)
    })

    it("uses the requested sentence in GitHub and Linear styling", () => {
        const current = { harness: "Pi", provider: "openai-codex", modelId: "gpt-6.1-sol" }
        assert.equal(
            signPublication("Text", "github", current),
            "Text\n\n<sub>Sent via Pi. Model: openai-codex/gpt-6.1-sol.</sub>",
        )
        assert.equal(
            signPublication("Text", "linear", current),
            "Text\n\n*Sent via Pi. Model: openai-codex/gpt-6.1-sol.*",
        )
    })

    it("replaces already-published bracket footers without duplication", () => {
        for (const provider of ["github", "linear"] as const) {
            const old =
                provider === "github"
                    ? "<sub>Sent via pi [old-provider/old-model].</sub>"
                    : "*Sent via pi [old-provider/old-model].*"
            const updated = signPublication(`Existing body.\n\n${old}`, provider, identity)
            assert.equal(updated, `Existing body.\n\n${provider === "github" ? githubFooter : linearFooter}`)
            assert.equal(signPublication(updated, provider, identity), updated)
            assert.equal((updated.match(/Sent via/g) ?? []).length, 1)
        }
    })

    it("preserves source whitespace and CRLF through repeated preparation", () => {
        for (const text of ["Text.  ", "Text.\n", "Text.\n\n", "Text.\r\n", "Text.\r\n\r\n"]) {
            const signed = signPublication(text, "linear", identity)
            assert.ok(signed.startsWith(text))
            assert.equal(signPublication(signed, "linear", identity), signed)
        }
    })

    it("escapes literal identity values for HTML and italic Markdown", () => {
        const special = { harness: "p*i", provider: "a<b&c", modelId: "m_[x]" }
        assert.equal(
            signPublication("Text", "github", special),
            "Text\n\n<sub>Sent via p\\*i. Model: a&lt;b&amp;c/m\\_\\[x\\].</sub>",
        )
        assert.equal(
            signPublication("Text", "linear", special),
            "Text\n\n*Sent via p\\*i. Model: a\\<b&c/m\\_\\[x\\].*",
        )
    })

    it("leaves metadata, clears, reactions, controls, reads, and repository operations unchanged", () => {
        const cases: Array<[PublicationOperation, Record<string, unknown>]> = [
            [operation("github", "issue_write"), { method: "update", labels: ["Bug"], state: "closed" }],
            [operation("github", "issue_write"), { method: "update", body: "" }],
            [operation("github", "add_issue_comment"), { reaction: "+1" }],
            [operation("github", "pull_request_review_write"), { method: "resolve_thread", body: "not a publication" }],
            [operation("github", "projects_write"), { method: "update_project_item", body: "not a publication" }],
            [operation("linear", "save_issue", "description"), { id: "issue", state: "Done" }],
            [operation("linear", "save_issue", "description"), { description: " \n " }],
            [operation("linear", "get_issue"), { id: "issue" }],
            [operation("linear", "delete_comment"), { id: "comment" }],
            [operation("github", "push_files"), { files: [{ path: "README.md", content: "Text" }] }],
            [operation("github", "merge_pull_request"), { commit_message: "Commit text" }],
            [operation("other", "save_document", "content"), { content: "Repository file text" }],
        ]
        for (const [tool, input] of cases) assert.deepEqual(preparePublication(tool, input, unavailableIdentity), input)
    })

    it("rejects partial/template text before identity lookup and validates authorship", () => {
        const tool = operation("linear", "save_issue", "description")
        for (const input of [{ patch: [{ op: "append", text: "Addition" }] }, { template: "Template" }]) {
            assert.equal(classifyPublication(tool, input).kind, "complete-text-required")
            assert.throws(() => preparePublication(tool, input, unavailableIdentity), /complete/)
        }
        assert.throws(
            () =>
                preparePublication(
                    tool,
                    { description: "Text", [AUTHORSHIP_PARAMETER]: "invalid" },
                    unavailableIdentity,
                ),
            /authorship/,
        )
        assert.throws(
            () => preparePublication(tool, { description: "Text" }, unavailableIdentity),
            /Identity must not be read/,
        )
    })

    it("extends only mapped schemas and explains automatic authorship selection", () => {
        const tool = operation("linear", "save_comment")
        const before = structuredClone(tool.inputSchema)
        const schema = publicationToolSchema(tool)
        assert.deepEqual((schema.properties as any)[AUTHORSHIP_PARAMETER].enum, ["ai-assisted", "user-verbatim"])
        assert.deepEqual(tool.inputSchema, before)
        assert.equal((tool.inputSchema.properties as any)[AUTHORSHIP_PARAMETER], undefined)
        assert.match(
            publicationToolDescription(tool, "Comment"),
            /automatically when the user supplies the complete message/,
        )
        assert.match(AUTHORSHIP_GUIDANCE, /no special opt-out wording/)
        const other = operation("other", "save_comment")
        assert.deepEqual(publicationBinding(other), { kind: "none" })
        assert.deepEqual(publicationToolSchema(other), other.inputSchema)
        assert.equal(publicationToolDescription(other, "Original"), "Original")
        const conflict = operation("github", "add_issue_comment", AUTHORSHIP_PARAMETER)
        ;(conflict.inputSchema.properties as any).body = { type: "string" }
        assert.throws(() => publicationToolSchema(conflict), /conflicts/)
        assert.throws(() => publicationToolSchema(operation("github", "add_issue_comment", "wrong")), /expected body/)
    })

    it("retains PR dividers, folds, and closing references without changing source", () => {
        const source = "# Result\n\n## Overview\n\nSummary.\n\n## Verification\n\nChecked.\n"
        const rendered = renderProviderBody(source, { kind: "github-pull-request", githubIssueNumber: 65 })
        const signed = preparePublication(operation("github", "create_pull_request"), { body: rendered }, readIdentity)
            .body as string
        assert.equal(signed, `${rendered}\n\n${githubFooter}`)
        assert.ok(signed.endsWith(`</details>\n\n---\n\nCloses #65\n\n${githubFooter}`))
        assert.equal((signed.match(/<hr \/>|^---$/gm) ?? []).length, 2)
        assert.ok(!source.includes("Sent via"))
        assert.ok(!rendered.includes("Sent via"))
    })
})

function nativeFixture(exposure: "direct" | "deferred" | "hidden" = "deferred") {
    const calls: Parameters<ToolDefinition["execute"]>[] = []
    const result = {
        content: [{ type: "text" as const, text: "result" }],
        details: { native: true },
        structuredContent: { content: [] },
        isError: true,
    }
    // Fields used by native SDK 1.3.0; the old workspace SDK does not define all of them.
    const native = {
        name: "mcp__normalized_or_hashed_12345678",
        label: "Native tool",
        description: "Native description",
        parameters: Type.Unsafe(operation("github", "add_issue_comment").inputSchema),
        exposure,
        namespace: { name: "mcp__native", aliases: ["native"], instructions: "Native instructions" },
        outputSchema: { type: "object" },
        annotations: { readOnlyHint: false },
        reachesTools: () => "all" as const,
        renderCall: () => ({ render: () => [], invalidate() {} }),
        renderResult: () => ({ render: () => [], invalidate() {} }),
        async execute(...args: Parameters<ToolDefinition["execute"]>) {
            calls.push(args)
            return result
        },
    }
    return { native, calls, result }
}

describe("workflow Pi publication wrapper", () => {
    it("preserves native SDK metadata, results, and exact delegation context", async () => {
        const { native, calls, result } = nativeFixture()
        const before = JSON.stringify(native)
        const wrapped = decoratePublicationTool(native, operation("github", "add_issue_comment"))
        for (const key of [
            "name",
            "label",
            "exposure",
            "namespace",
            "outputSchema",
            "annotations",
            "reachesTools",
            "renderCall",
            "renderResult",
        ] as const)
            assert.equal(wrapped[key], native[key])
        const context = { model: { provider: identity.provider, id: identity.modelId } } as ExtensionContext
        const signal = new AbortController().signal
        const onUpdate = () => undefined
        const proposed = { body: "Message.", [AUTHORSHIP_PARAMETER]: "ai-assisted" }
        assert.equal(await wrapped.execute("call", proposed, signal, onUpdate, context), result)
        assert.deepEqual(calls[0], ["call", { body: `Message.\n\n${githubFooter}` }, signal, onUpdate, context])
        assert.deepEqual(proposed, { body: "Message.", [AUTHORSHIP_PARAMETER]: "ai-assisted" })
        assert.equal(JSON.stringify(native), before)
        context.model = { provider: "anthropic", id: "claude-new" } as ExtensionContext["model"]
        await wrapped.execute("changed", { body: "Message." }, undefined, undefined, context)
        assert.equal((calls[1][1] as any).body, "Message.\n\n<sub>Sent via Pi. Model: anthropic/claude-new.</sub>")
    })

    it("needs identity only for AI text, and never delegates failed preparation", async () => {
        const { native, calls } = nativeFixture()
        const wrapped = decoratePublicationTool(native, operation("github", "add_issue_comment"))
        const context = {} as ExtensionContext
        await assert.rejects(
            wrapped.execute("missing", { body: "Text" }, undefined, undefined, context),
            /current model/,
        )
        assert.equal(calls.length, 0)
        await wrapped.execute(
            "user",
            { body: " User text\r\n", [AUTHORSHIP_PARAMETER]: "user-verbatim" },
            undefined,
            undefined,
            context,
        )
        assert.deepEqual(calls[0][1], { body: " User text\r\n" })
        const partial = decoratePublicationTool(native, operation("linear", "save_document", "content"))
        await assert.rejects(
            partial.execute("patch", { patch: [] }, undefined, undefined, context),
            /complete edited text/,
        )
        assert.equal(calls.length, 1)
    })

    it("preserves exposure and wraps each fresh registration once", async () => {
        for (const exposure of ["direct", "deferred", "hidden"] as const) {
            const { native, calls } = nativeFixture(exposure)
            const wrapped = decoratePublicationTool(native, operation("github", "add_issue_comment"))
            assert.equal(wrapped.exposure, exposure)
            if (exposure === "hidden") continue // Pi makes hidden tools unreachable.
            await wrapped.execute("fresh", { body: "Fresh." }, undefined, undefined, {
                model: { provider: identity.provider, id: identity.modelId },
            } as ExtensionContext)
            assert.equal(calls.length, 1)
            assert.equal(((calls[0][1] as any).body.match(/Sent via/g) ?? []).length, 1)
        }
        const { native } = nativeFixture()
        assert.equal(decoratePublicationTool(native, operation("github", "get_issue")), native)
    })

    it("uses the running package naming contract", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-name-"))
        try {
            for (const [pkg, expected] of [
                [{ piConfig: { name: "custom-harness" } }, "custom-harness"],
                [{}, "Pi"],
                [{ piConfig: { name: "pi" } }, "Pi"],
            ] as const) {
                fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg))
                assert.equal(readHarnessName(root), expected)
            }
            assert.throws(() => readPublicationIdentity({} as ExtensionContext), /current model/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
