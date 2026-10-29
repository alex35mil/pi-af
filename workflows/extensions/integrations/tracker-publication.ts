import { randomUUID } from "node:crypto"
import * as path from "node:path"
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import { workflowTools } from "../__lib/tools.js"

import type { McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import {
    ENTITY_METADATA_FILE,
    type EntityStatus,
    readEntityStatus,
    resolveEntityDirectory,
    taskMarker,
    writeEntityStatus,
} from "../__lib/entity.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { loadIntegrationConfig } from "./config.js"
import { assertEntityEnvironment, resolveWorkflowEnvironment } from "./policy.js"
import {
    type AnnouncementInput,
    AnnouncementInputSchema,
    type AnnouncementOrigin,
    hasAnnouncementMarker,
    type PlanAnnouncement,
    planFingerprint,
    planSourceDiff,
    renderAnnouncement,
} from "./plan-announcement.js"
import { planPublicationMarker, type PublicationAdapter } from "./plan-publication.js"
import { renderProviderBody, restoreProviderSource } from "./projection.js"
import type { TrackerRecord } from "./records.js"
import { EvidenceSchema } from "./resource-id-tool.js"
import { githubPublication } from "./tracker-publication-github.js"
import { linearPublication } from "./tracker-publication-linear.js"

const common = { entityDir: Type.String({ minLength: 1 }) }
const source = Type.String({ minLength: 1 })
const evidencePages = Type.Array(EvidenceSchema, { minItems: 1 })
export const TrackerPublicationSchema = Type.Union([
    Type.Object({ ...common, action: Type.Literal("prepare"), source }, { additionalProperties: false }),
    Type.Object(
        {
            ...common,
            action: Type.Literal("prepareUpdate"),
            source,
            reads: Type.Array(EvidenceSchema, {
                minItems: 1,
                description: "The exact reads that prepare returned in `lookups`, with their actual responses",
            }),
            announcement: Type.Optional(AnnouncementInputSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...common, action: Type.Literal("record"), evidence: EvidenceSchema },
        { additionalProperties: false },
    ),
    Type.Object(
        { ...common, action: Type.Literal("recover"), source, pages: evidencePages },
        { additionalProperties: false },
    ),
])
export type TrackerPublicationInput = Static<typeof TrackerPublicationSchema>

interface PublicationContext<I> {
    adapter: PublicationAdapter<I>
    status: EntityStatus
    announcement: PlanAnnouncement | undefined
    saveAnnouncement(state: PlanAnnouncement | undefined): void
    resolveOrigin(input: AnnouncementInput["origin"]): AnnouncementOrigin
}

function runPublication<I>(input: TrackerPublicationInput, context: PublicationContext<I>) {
    const { adapter, status, announcement } = context
    const saved = adapter.state
    const epic = status.entity === "epic"
    const render = (source: string, token: string) =>
        `${renderProviderBody(source, { kind: adapter.presentation })}\n\n${planPublicationMarker(token)}`
    const announcements = () => adapter.announcements()
    const announcementPending = () => ({
        state: "recovery-required" as const,
        reason: "the plan update landed but its announcement isn't confirmed; post or recover it first",
        mutation: announcements().create(announcement!.body),
        lookups: announcements().lookups(),
    })

    if (input.action === "prepare") {
        if (saved.state === "pending")
            return {
                state: "recovery-required" as const,
                reason: "first publication creation is pending; recover before another publication",
                lookups: adapter.recoveryLookups(),
            }
        if (announcement?.state === "announcing") return announcementPending()
        if (saved.state === "unpublished") {
            const token = randomUUID()
            // Resolve the native tool before consuming the first-publication state.
            const mutation = adapter.create(render(input.source, token))
            adapter.save({ state: "pending", token })
            return { state: "mutation-needed" as const, mutation }
        }
        // An Epic compares with the published plan to announce the change.
        if (epic || adapter.updateCheck === "current-reads")
            return { state: "reads-required" as const, lookups: adapter.currentReads(saved.id) }
        return {
            state: "mutation-needed" as const,
            mutation: adapter.update(saved.id, render(input.source, saved.token)),
        }
    }

    if (input.action === "prepareUpdate") {
        if (saved.state !== "published") throw new Error("prepareUpdate requires a published plan")
        if (announcement?.state === "announcing") return announcementPending()
        const current = adapter.currentBody(input.reads, saved)
        const update = adapter.update(saved.id, render(input.source, saved.token))
        if (!epic) {
            if (input.announcement) throw new Error("only an Epic announces plan updates")
            return { state: "mutation-needed" as const, mutation: update }
        }
        const published = restoreProviderSource(current, { kind: adapter.presentation }, status.title).source
        // An earlier update landed without being recorded; finish its announcement.
        if (announcement?.state === "plan-update" && planFingerprint(published) === announcement.after) {
            const { token, body } = announcement
            context.saveAnnouncement({ state: "announcing", token, body })
            return { state: "mutation-needed" as const, mutation: announcements().create(body) }
        }
        const diff = planSourceDiff(published, input.source)
        if (!diff) {
            if (announcement) context.saveAnnouncement(undefined)
            return { state: "unchanged" as const }
        }
        if (!input.announcement)
            throw new Error(
                "an update to a published Epic plan needs an announcement: the approved summary and its origin",
            )
        const token = randomUUID()
        const body = renderAnnouncement({
            origin: context.resolveOrigin(input.announcement.origin),
            summary: input.announcement.summary,
            planUrl: saved.url,
            diff,
            token,
            presentation: adapter.presentation === "github-plan-comment" ? "github" : "linear",
        })
        // Resolve the native tool before saving, so an unavailable tool changes nothing.
        announcements().create(body)
        context.saveAnnouncement({ state: "plan-update", token, body, after: planFingerprint(input.source) })
        return { state: "mutation-needed" as const, mutation: update, announcement: body }
    }

    if (saved.state === "unpublished") throw new Error("plan publication has no creation attempt to record or recover")

    if (input.action === "record") {
        if (announcement) {
            if (saved.state !== "published") throw new Error("a plan announcement requires a published plan")
            if (announcement.state === "plan-update") {
                const { token, body, after } = announcement
                const content = adapter.recordUpdate(input.evidence, saved)
                if (
                    planFingerprint(
                        restoreProviderSource(content, { kind: adapter.presentation }, status.title).source,
                    ) !== after
                )
                    throw new Error("the recorded plan update isn't the prepared one")
                context.saveAnnouncement({ state: "announcing", token, body })
                return { state: "mutation-needed" as const, mutation: announcements().create(body) }
            }
            announcements().record(input.evidence, announcement.token)
            context.saveAnnouncement(undefined)
            return { state: "announced" as const }
        }
        if (saved.state !== "pending") throw new Error("record requires a pending first-publication creation")
        const identity = adapter.record(input.evidence, saved.token)
        adapter.save({ state: "published", token: saved.token, ...identity })
        return { state: "published" as const, ...identity }
    }

    if (announcement?.state === "announcing") {
        const matches = announcements()
            .bodies(input.pages)
            .filter((body) => hasAnnouncementMarker(body, announcement.token))
        if (matches.length === 1) {
            context.saveAnnouncement(undefined)
            return { state: "announced" as const }
        }
        // A complete read without it proves the announcement never landed; the same create is safe.
        if (matches.length === 0)
            return { state: "mutation-needed" as const, mutation: announcements().create(announcement.body) }
        return {
            state: "blocked" as const,
            reason: `found ${matches.length} matching announcements; preserve state and investigate with the maintainer`,
        }
    }
    const recovered = adapter.recover(input.pages, saved.token)
    if (!Array.isArray(recovered)) return recovered
    // A complete read with no marked publication proves a pending create never landed, so the
    // same create is safe to send. Keeping the token lets a late earlier create show up as a duplicate.
    if (recovered.length === 0 && saved.state === "pending")
        return { state: "mutation-needed" as const, mutation: adapter.create(render(input.source, saved.token)) }
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
        // The origin Task must belong to this Epic; its issue marker names it.
        const resolveOrigin = (origin: AnnouncementInput["origin"]): AnnouncementOrigin => {
            if (origin.kind === "epic") return { kind: "epic" }
            const task = resolveEntityDirectory(root, cwd, origin.entityDir)
            if (path.dirname(task) !== path.join(directory, "tasks"))
                throw new Error("the announcing Task must be a Task of this Epic")
            return { kind: "task", marker: taskMarker(readEntityStatus(task)) }
        }
        // Only records that can belong to an Epic carry an announcement.
        const announcing = <R extends Extract<TrackerRecord, { planAnnouncement?: PlanAnnouncement }>>(record: R) => ({
            announcement: record.planAnnouncement,
            saveAnnouncement: (state: PlanAnnouncement | undefined) => {
                const { planAnnouncement: _, ...rest } = record
                save((state ? { ...rest, planAnnouncement: state } : rest) as TrackerRecord)
            },
        })
        const context = { status, resolveOrigin }
        if (tracker.provider === "github")
            return runPublication(input, {
                ...context,
                ...announcing(tracker),
                adapter: githubPublication(tracker, server, tools, (planComment) => save({ ...tracker, planComment })),
            })
        const adapter = linearPublication(tracker, server, tools, (planDocument) => save({ ...tracker, planDocument }))
        if (tracker.resource === "project")
            return runPublication(input, { ...context, ...announcing(tracker), adapter })
        return runPublication(input, {
            ...context,
            announcement: undefined,
            saveAnnouncement: () => {
                throw new Error("only an Epic announces plan updates")
            },
            adapter,
        })
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
            description: `${name.replaceAll("_", " ")} using approved complete plan content and exact provider evidence. The first prepare for an unpublished plan saves pending state before returning its create; run that create immediately. When prepare returns reads-required, run those reads and call prepare_tracker_publication_update with them. An update to a published Epic plan requires the approved announcement; record the plan update's clear success with record_tracker_publication, run the returned announcement comment, and record it too. Recovery takes the approved source and complete comment pages, or the Linear parent read, complete document listing pages, and full document reads; for a pending announcement, complete comment pages. One match identifies it; no match returns the same create; several matches stop. Saves local authoritative state only; never calls providers or authorizes publication.`,
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
