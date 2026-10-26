import { randomUUID } from "node:crypto"
import * as path from "node:path"
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import { workflowTools } from "../__lib/tools.js"

import type { McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import { ENTITY_METADATA_FILE, readEntityStatus, resolveEntityDirectory, writeEntityStatus } from "../__lib/entity.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { loadIntegrationConfig } from "./config.js"
import { assertEntityEnvironment, resolveWorkflowEnvironment } from "./policy.js"
import { planPublicationMarker, type PublicationAdapter } from "./plan-publication.js"
import { renderProviderBody } from "./projection.js"
import type { TrackerRecord } from "./records.js"
import { EvidenceSchema } from "./resource-id-tool.js"
import { githubPublication } from "./tracker-publication-github.js"
import { linearPublication } from "./tracker-publication-linear.js"

const common = { entityDir: Type.String({ minLength: 1 }) }
const source = Type.String({ minLength: 1 })
export const TrackerPublicationSchema = Type.Union([
    Type.Object({ ...common, action: Type.Literal("prepare"), source }, { additionalProperties: false }),
    Type.Object(
        { ...common, action: Type.Literal("prepareUpdate"), source, document: EvidenceSchema, parent: EvidenceSchema },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...common, action: Type.Literal("record"), evidence: EvidenceSchema },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...common, action: Type.Literal("recover"), pages: Type.Array(EvidenceSchema, { minItems: 1 }) },
        { additionalProperties: false },
    ),
])
export type TrackerPublicationInput = Static<typeof TrackerPublicationSchema>

function runPublication<I>(input: TrackerPublicationInput, adapter: PublicationAdapter<I>) {
    const saved = adapter.state
    const render = (source: string, token: string) =>
        `${renderProviderBody(source, { kind: adapter.presentation })}\n\n${planPublicationMarker(token)}`
    if (input.action === "prepare") {
        if (saved.state === "pending")
            return {
                state: "recovery-required" as const,
                reason: "first publication creation is pending; recover before another publication",
                lookups: adapter.recoveryLookups(),
            }
        const token = saved.state === "unpublished" ? randomUUID() : saved.token
        const content = render(input.source, token)
        if (saved.state === "unpublished") {
            // Resolve the native tool before consuming the first-publication state.
            const mutation = adapter.create(content)
            adapter.save({ state: "pending", token })
            return { state: "mutation-needed" as const, mutation }
        }
        if (adapter.verification.kind === "document-parent")
            return { state: "verification-required" as const, lookups: adapter.verification.lookups(saved.id) }
        return { state: "mutation-needed" as const, mutation: adapter.update(saved.id, content) }
    }
    if (input.action === "prepareUpdate") {
        if (saved.state !== "published" || adapter.verification.kind !== "document-parent")
            throw new Error("prepareUpdate requires a published Linear document")
        adapter.verification.verify(input.document, input.parent, saved)
        return {
            state: "mutation-needed" as const,
            mutation: adapter.update(saved.id, render(input.source, saved.token)),
        }
    }
    if (saved.state === "unpublished") throw new Error("plan publication has no creation attempt to record or recover")
    if (input.action === "record") {
        if (saved.state !== "pending") throw new Error("record requires a pending first-publication creation")
        const identity = adapter.record(input.evidence, saved.token)
        adapter.save({ state: "published", token: saved.token, ...identity })
        return { state: "published" as const, ...identity }
    }
    const recovered = adapter.recover(input.pages, saved.token)
    if (!Array.isArray(recovered)) return recovered
    if (recovered.length !== 1)
        return {
            state: "blocked" as const,
            reason: `found ${recovered.length} matching plan publications; preserve state and investigate with the maintainer, without creating a replacement`,
        }
    const { body, ...identity } = recovered[0]
    if (saved.state === "published" && (identity.id !== saved.id || identity.url !== saved.url))
        return {
            state: "blocked" as const,
            reason: "observed publication conflicts with the saved identity; do not replace it",
        }
    if (saved.state === "pending") adapter.save({ state: "published", token: saved.token, ...identity })
    return { state: "identified" as const, ...identity, body }
}

export async function trackerPublication(cwd: string, raw: TrackerPublicationInput, tools: McpToolCatalog) {
    const input = Value.Parse(TrackerPublicationSchema, raw)
    const root = project.resolveRootDir(cwd)
    const directory = resolveEntityDirectory(root, cwd, input.entityDir)
    return withFileMutationQueue(path.join(directory, ENTITY_METADATA_FILE), async () => {
        assertArtifactPersistencePrepared(root)
        const environment = resolveWorkflowEnvironment(loadIntegrationConfig(root))
        const status = readEntityStatus(directory)
        assertEntityEnvironment(status, environment)
        const tracker = status.tracker
        const server = environment.tracker.mcpServer
        const save = (record: TrackerRecord) => writeEntityStatus(directory, { ...status, tracker: record })
        if (tracker.provider === "github")
            return runPublication(
                input,
                githubPublication(tracker, server, tools, (planComment) => save({ ...tracker, planComment })),
            )
        return runPublication(
            input,
            linearPublication(tracker, server, tools, (planDocument) => save({ ...tracker, planDocument })),
        )
    })
}

export function registerTrackerPublication(pi: ExtensionAPI, tools: McpToolCatalog): void {
    const toolsApi = workflowTools(pi, "integrations")
    const [prepare, update, record, recover] = TrackerPublicationSchema.anyOf
    const operations = [
        ["prepare_tracker_publication", "prepare", prepare],
        ["prepare_tracker_publication_update", "prepareUpdate", update],
        ["record_tracker_publication", "record", record],
        ["recover_tracker_publication", "recover", recover],
    ] as const
    for (const [name, action, schema] of operations) {
        const parameters = Type.Omit(schema, ["action"])
        toolsApi.registerTool({
            name,
            label: name,
            description: `${name.replaceAll("_", " ")} using approved complete plan content and exact provider evidence. Linear published updates require prepare_tracker_publication_update with exact document and parent read evidence. Recovery uses GitHub comment pages or Linear parent read, complete document listing pages, and full document reads. Saves local authoritative state only; never calls providers or authorizes publication. Pending creation never automatically retries.`,
            parameters,
            async execute(_id, input, _signal, _onUpdate, ctx) {
                const result = await trackerPublication(
                    ctx.cwd,
                    Value.Parse(TrackerPublicationSchema, { ...Value.Parse(parameters, input), action }),
                    tools,
                )
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
    }
}
