import { randomUUID } from "node:crypto"
import * as path from "node:path"
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { type Static, Type } from "typebox"
import { compile, parse } from "../../../extensions/__lib/schema.js"
import { workflowTools } from "../__lib/tools.js"

import type { McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import {
    ENTITY_METADATA_FILE,
    type EntityStatus,
    readEntityStatus,
    resolveEntityDirectory,
    writeEntityStatus,
} from "../__lib/entity.js"
import { assertAcceptedTaskList } from "../__lib/epic-acceptance.js"
import { resolveAnnouncementOrigin, withPlanAnnouncement } from "./announcement-state.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { loadIntegrationConfig } from "./config.js"
import { assertEntityEnvironment, resolveWorkflowEnvironment } from "./policy.js"
import {
    type AnnouncementInput,
    AnnouncementInputSchema,
    type PlanAnnouncement,
    planFingerprint,
    planSourceDiff,
    renderAnnouncement,
} from "./plan-announcement.js"
import type { PublicationAdapter, PublicationIdentity } from "./plan-publication.js"
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
            announcement: AnnouncementInputSchema,
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
export const TrackerPublicationValidator = compile(TrackerPublicationSchema)
export type TrackerPublicationInput = Static<typeof TrackerPublicationSchema>

interface PublicationContext<I, P, Q extends PublicationIdentity<I>> {
    adapter: PublicationAdapter<I, P, Q>
    status: EntityStatus
    announcement: PlanAnnouncement | undefined
    saveAnnouncement(state: PlanAnnouncement | undefined): void
    // The heading's Task marker for an Epic update made from one of its Tasks; rejects a Task origin otherwise.
    resolveOrigin(input: AnnouncementInput["origin"]): string | undefined
}

function runPublication<I, P, Q extends PublicationIdentity<I>>(
    input: TrackerPublicationInput,
    context: PublicationContext<I, P, Q>,
) {
    const { adapter, status, announcement } = context
    const saved = adapter.state
    const announcements = () => adapter.announcements()
    const announcementPending = (pending: Extract<PlanAnnouncement, { state: "announcing" }>) => ({
        state: "recovery-required" as const,
        reason: "the plan update landed but its announcement isn't confirmed; post or recover it first",
        mutation: announcements().create(pending.body),
        lookups: announcements().lookups(),
    })

    if (input.action === "prepare") {
        if (saved.state === "pending")
            return {
                state: "recovery-required" as const,
                reason: "first publication creation is pending; recover before another publication",
                lookups: adapter.recoveryLookups(),
            }
        if (announcement?.state === "announcing") return announcementPending(announcement)
        assertAcceptedTaskList(status, input.source)
        if (saved.state === "unpublished") {
            // Resolve the native tool before consuming the first-publication state.
            const { mutation, pending } = adapter.create(input.source)
            adapter.save(pending)
            return { state: "mutation-needed" as const, mutation }
        }
        // Every update to a published plan compares with it, to announce the change.
        return { state: "reads-required" as const, lookups: adapter.currentReads(saved) }
    }

    if (input.action === "prepareUpdate") {
        if (saved.state !== "published") throw new Error("prepareUpdate requires a published plan")
        if (announcement?.state === "announcing") return announcementPending(announcement)
        assertAcceptedTaskList(status, input.source)
        const current = adapter.currentBody(input.reads, saved)
        const update = adapter.update(saved, input.source)
        const published = adapter.restore(current, status.title)
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
        const token = randomUUID()
        const body = renderAnnouncement({
            fromTask: context.resolveOrigin(input.announcement.origin),
            summary: input.announcement.summary,
            plan: adapter.announcementPlan(saved),
            diff,
            token,
        })
        // Resolve the native tool before saving, so an unavailable tool changes nothing.
        announcements().create(body)
        context.saveAnnouncement({ state: "plan-update", token, body, after: planFingerprint(input.source) })
        return { state: "mutation-needed" as const, mutation: update, announcement: body }
    }

    if (saved.state === "unpublished") throw new Error("plan publication has no creation attempt to record or recover")

    if (input.action === "record") {
        if (announcement?.state === "plan-update" || announcement?.state === "announcing") {
            if (saved.state !== "published") throw new Error("a plan announcement requires a published plan")
            if (announcement.state === "plan-update") {
                const { token, body, after } = announcement
                const content = adapter.recordUpdate(input.evidence, saved)
                if (planFingerprint(adapter.restore(content, status.title)) !== after)
                    throw new Error("the recorded plan update isn't the prepared one")
                context.saveAnnouncement({ state: "announcing", token, body })
                return { state: "mutation-needed" as const, mutation: announcements().create(body) }
            }
            announcements().record(input.evidence, announcement.token)
            context.saveAnnouncement(undefined)
            return { state: "announced" as const }
        }
        if (saved.state !== "pending") throw new Error("record requires a pending first-publication creation")
        const published = adapter.record(input.evidence, saved)
        adapter.save(published)
        return { state: "published" as const, id: published.id, url: published.url }
    }

    if (announcement?.state === "announcing") {
        const matches = announcements().matching(input.pages, announcement.token)
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
    const recovered = adapter.recover(input.pages, saved)
    switch (recovered.state) {
        case "recovery-read-required":
        case "blocked":
            return recovered
        case "absent": {
            if (saved.state !== "pending")
                return {
                    state: "blocked" as const,
                    reason: "the published plan is missing; investigate with the maintainer",
                }
            // A complete read without the pending publication proves its create never landed, so a
            // create is safe to send. The provider decides what it keeps from the pending state.
            assertAcceptedTaskList(status, input.source)
            const { mutation, pending } = adapter.create(input.source, saved)
            adapter.save(pending)
            return { state: "mutation-needed" as const, mutation }
        }
        case "found": {
            const { published, body } = recovered
            if (saved.state === "pending") adapter.save(published)
            return { state: "identified" as const, id: published.id, url: published.url, body }
        }
    }
}

export async function trackerPublication(cwd: string, raw: TrackerPublicationInput, tools: McpToolCatalog) {
    const input = parse(TrackerPublicationValidator, raw)
    const root = project.resolveRootDir(cwd)
    const directory = resolveEntityDirectory(root, cwd, input.entityDir)
    return withFileMutationQueue(path.join(directory, ENTITY_METADATA_FILE), async () => {
        assertArtifactPersistencePrepared(root)
        const environment = resolveWorkflowEnvironment(loadIntegrationConfig(root))
        const status = readEntityStatus(directory)
        assertEntityEnvironment(status, environment)
        const tracker = status.tracker
        const server = environment.tracker.mcpServer
        // Publication and announcement saves can follow each other in one call; each builds on the latest record.
        let current = tracker
        const save = (record: TrackerRecord) => {
            current = record
            writeEntityStatus(directory, { ...status, tracker: record })
        }
        const context = {
            status,
            resolveOrigin: (origin: AnnouncementInput["origin"]) =>
                resolveAnnouncementOrigin(root, cwd, directory, status, origin),
            announcement: tracker.planAnnouncement,
            saveAnnouncement: (state: PlanAnnouncement | undefined) => save(withPlanAnnouncement(current, state)),
        }
        if (tracker.provider === "github")
            return runPublication(input, {
                ...context,
                adapter: githubPublication(tracker, server, tools, (planComment) =>
                    save({ ...(current as typeof tracker), planComment }),
                ),
            })
        return runPublication(input, {
            ...context,
            adapter: linearPublication(tracker, server, tools, (planDocument) =>
                save({ ...(current as typeof tracker), planDocument }),
            ),
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
        const validator = compile(parameters)
        toolsApi.registerTool({
            name,
            label: name,
            description: `${name.replaceAll("_", " ")} using the complete current plan content and exact provider evidence. Workflow plan publications need no user approval of their text. The first prepare for an unpublished plan saves pending state before returning its create; run that create immediately. When prepare returns reads-required, run those reads and call prepare_tracker_publication_update with them and a one-line summary of what changed; it is posted as the plan-update note without asking. Record the plan update's clear success with record_tracker_publication, run the returned announcement comment, and record it too. Recovery takes the approved source and complete comment pages, or the Linear parent read, complete document listing pages, and full document reads; for a pending announcement, complete comment pages. One match identifies it; no match returns the same create; several matches stop. Saves local authoritative state only; never calls providers or authorizes publication.`,
            parameters,
            async execute(_id, input, _signal, _onUpdate, ctx) {
                const result = await trackerPublication(
                    ctx.cwd,
                    parse(TrackerPublicationValidator, { ...parse(validator, input), action }),
                    tools,
                )
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result }
            },
        })
    }
}
