import * as fs from "node:fs"
import * as path from "node:path"

import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

import { isMcpTool, mcpResponsePayload, type McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import * as project from "../../../extensions/__lib/project.js"
import { EPIC_ROOT, entityName, readyBranch, slugify } from "../__lib/domain.js"
import {
    EntityStatusSchema,
    LOCAL_NOTES_FILE,
    LOCAL_REVIEWS_DIR,
    LOCAL_SCRATCH_DIR,
    readEntityStatus,
    resolveEntityDirectory,
    writeEntityStatus,
} from "../__lib/entity.js"
import { hasEpicTasksSection, parseEpicRouting, parseEpicTasks } from "../__lib/epic-tasks.js"
import { writeTextAtomically } from "../__lib/files.js"
import { assertArtifactPersistencePrepared } from "../__lib/project-config.js"
import { loadIntegrationConfig } from "../integrations/config.js"
import { resolveWorkflowEnvironment, type WorkflowEnvironment } from "../integrations/policy.js"
import { restoreProviderSource } from "../integrations/projection.js"
import { trackerReference, type TrackerObject, type TrackerRecord } from "../integrations/records.js"
import type { ProviderEvidence } from "../integrations/resource-id-operations.js"
import { EvidenceSchema } from "../integrations/resource-id-tool.js"
import { githubPublication } from "../integrations/tracker-publication-github.js"
import { linearPublication } from "../integrations/tracker-publication-linear.js"
import { resolveDefaultBranch } from "./entity.js"

const planPages = Type.Array(EvidenceSchema, {
    minItems: 1,
    description:
        "The plan reads publication recovery uses: every GitHub get_comments page; or the Linear parent read, every list_documents page, and full get_document reads of matching candidates",
})

export const RestoreEpicSchema = Type.Object(
    {
        slug: Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" }),
        epic: Type.Union([EvidenceSchema], {
            description: "The Epic's own read: GitHub issue_read get, or Linear get_project",
        }),
        pages: planPages,
    },
    { additionalProperties: false },
)
export type RestoreEpicInput = Static<typeof RestoreEpicSchema>

export const RestoreEpicPlanSourceSchema = Type.Object(
    { entityDir: Type.String({ minLength: 1 }), pages: planPages },
    { additionalProperties: false },
)
export type RestoreEpicPlanSourceInput = Static<typeof RestoreEpicPlanSourceSchema>

interface EpicFacts {
    object: TrackerObject
    title: string
    description: string
    createdAt: string
}

function epicFacts(environment: WorkflowEnvironment, evidence: ProviderEvidence, tools: McpToolCatalog): EpicFacts {
    const tracker = environment.tracker
    const response = mcpResponsePayload(evidence.response)
    const text = (value: unknown, name: string) => {
        if (typeof value !== "string" || !value.trim()) throw new Error(`Epic read lacks its ${name}`)
        return value
    }
    if (tracker.provider === "github") {
        if (!isMcpTool(evidence.tool, tracker.mcpServer, "issue_read", tools) || evidence.arguments.method !== "get")
            throw new Error("Epic evidence must be the configured issue_read get")
        const repository = `${tracker.repository.owner}/${tracker.repository.repo}`.toLowerCase()
        const args = `${evidence.arguments.owner}/${evidence.arguments.repo}`.toLowerCase()
        if (args !== repository || response.number !== evidence.arguments.issue_number)
            throw new Error("Epic read is not an issue in the configured repository")
        const issueNumber = response.number as number
        const issueId = typeof response.id === "string" ? Number(response.id) : response.id
        if (!Number.isSafeInteger(issueId) || (issueId as number) < 1) throw new Error("Epic read lacks its issue ID")
        return {
            object: {
                provider: "github",
                issueId: issueId as number,
                issueNumber,
                issueUrl: text(response.html_url ?? response.url, "URL"),
            },
            title: text(response.title, "title"),
            description: typeof response.body === "string" ? response.body : "",
            createdAt: text(response.created_at, "creation time"),
        }
    }
    if (!isMcpTool(evidence.tool, tracker.mcpServer, "get_project", tools))
        throw new Error("Epic evidence must be the configured get_project")
    return {
        object: {
            provider: "linear",
            resource: "project",
            projectId: text(response.uuid, "UUID"),
            projectUrl: text(response.url, "URL"),
            createdAt: text(response.createdAt, "creation time"),
        },
        title: text(response.name, "name"),
        description: typeof response.description === "string" ? response.description : "",
        createdAt: text(response.createdAt, "creation time"),
    }
}

function publishedPlan(
    environment: WorkflowEnvironment,
    record: TrackerRecord,
    title: string,
    pages: ProviderEvidence[],
    tools: McpToolCatalog,
) {
    const server = environment.tracker.mcpServer
    const noop = () => {
        throw new Error("plan restore never saves publication state")
    }
    const adapter =
        record.provider === "github"
            ? githubPublication(record, server, tools, noop)
            : linearPublication(record, server, tools, noop)
    const candidates = adapter.recover(pages)
    if (!Array.isArray(candidates))
        throw new Error(
            `read the remaining candidate documents first: ${candidates.lookups.map((call) => JSON.stringify(call.arguments)).join(", ")}`,
        )
    if (candidates.length !== 1)
        throw new Error(
            `found ${candidates.length} published plans; restore needs exactly one, so investigate with the maintainer`,
        )
    const candidate = candidates[0] as { id: number | string; url: string; body: string }
    const restored = restoreProviderSource(candidate.body, { kind: adapter.presentation }, title)
    // The restored plan must be usable before anything relies on it.
    if (!hasEpicTasksSection(restored.source)) throw new Error("published plan has no `## Tasks` section")
    parseEpicTasks(restored.source)
    const routing = parseEpicRouting(restored.source)
    return { ...restored, id: candidate.id, url: candidate.url, routing }
}

function unpublishedRecord(object: TrackerObject, environment: WorkflowEnvironment): TrackerRecord {
    if (object.provider === "github") {
        if (environment.tracker.provider !== "github") throw new Error("configured tracker is not GitHub")
        return {
            provider: "github",
            repository: { ...environment.tracker.repository },
            external: { issueNumber: object.issueNumber },
            planComment: { state: "unpublished" },
        }
    }
    if (object.resource !== "project") throw new Error("a Linear Epic is a Project")
    return {
        provider: "linear",
        resource: "project",
        external: { projectId: object.projectId, createdAt: object.createdAt },
        planDocument: { state: "unpublished" },
    }
}

// Recreates a missing local Epic from its tracker object and published plan.
export function restoreEpic(cwd: string, input: RestoreEpicInput, tools: McpToolCatalog) {
    const root = project.resolveRootDir(cwd)
    assertArtifactPersistencePrepared(root)
    const environment = resolveWorkflowEnvironment(loadIntegrationConfig(root))
    const facts = epicFacts(environment, input.epic, tools)
    const unpublished = unpublishedRecord(facts.object, environment)
    const plan = publishedPlan(environment, unpublished, facts.title, input.pages, tools)

    const slug = slugify(input.slug)
    const name = entityName(trackerReference(facts.object), slug)
    const directory = path.join(root, EPIC_ROOT, name)
    // Restore never touches an existing directory, with or without metadata.
    if (fs.existsSync(directory)) throw new Error(`target directory already exists: ${path.join(EPIC_ROOT, name)}`)
    // Any local Epic for the same tracker item, under any slug, blocks restore.
    const epicsRoot = path.join(root, EPIC_ROOT)
    const reference = JSON.stringify(trackerReference(facts.object))
    for (const entry of fs.existsSync(epicsRoot) ? fs.readdirSync(epicsRoot) : []) {
        if (!fs.existsSync(path.join(epicsRoot, entry, "metadata.json"))) continue
        if (JSON.stringify(trackerReference(readEntityStatus(path.join(epicsRoot, entry)).tracker)) === reference)
            throw new Error(`a local Epic already exists for this tracker item: ${path.join(EPIC_ROOT, entry)}`)
    }

    const tracker: TrackerRecord =
        unpublished.provider === "github"
            ? {
                  ...unpublished,
                  planComment: { state: "published", token: plan.token, id: plan.id as number, url: plan.url },
              }
            : {
                  ...unpublished,
                  planDocument: { state: "published", token: plan.token, id: plan.id as string, url: plan.url },
              }
    const defaultBranch = resolveDefaultBranch(root)
    const status = Value.Parse(EntityStatusSchema, {
        entity: "epic",
        slug,
        title: facts.title.trim(),
        createdAt: new Date(facts.createdAt).toISOString(),
        phase: "execution",
        branch: readyBranch(plan.routing.epicBranch, defaultBranch, "generated"),
        tracker,
    })
    fs.mkdirSync(epicsRoot, { recursive: true })
    // Non-recursive, so a directory created concurrently fails here instead of being reused.
    fs.mkdirSync(directory)
    try {
        for (const entry of [LOCAL_REVIEWS_DIR, LOCAL_SCRATCH_DIR, "tasks"]) fs.mkdirSync(path.join(directory, entry))
        fs.writeFileSync(path.join(directory, "brief.md"), `# Brief\n\n${facts.description.trim() || facts.title}\n`)
        fs.writeFileSync(path.join(directory, LOCAL_NOTES_FILE), "# Notes\n")
        writeTextAtomically(path.join(directory, "epic.md"), plan.source)
        writeEntityStatus(directory, status)
        readEntityStatus(directory)
    } catch (error) {
        fs.rmSync(directory, { recursive: true, force: true })
        throw error
    }
    return { directory: path.relative(root, directory), status }
}

// Returns the published plan as epic.md source for an existing local Epic; writes nothing.
export function restoreEpicPlanSource(cwd: string, input: RestoreEpicPlanSourceInput, tools: McpToolCatalog) {
    const root = project.resolveRootDir(cwd)
    assertArtifactPersistencePrepared(root)
    const environment = resolveWorkflowEnvironment(loadIntegrationConfig(root))
    const directory = resolveEntityDirectory(root, cwd, input.entityDir)
    const status = readEntityStatus(directory)
    if (status.entity !== "epic") throw new Error("plan source restore requires an Epic")
    const plan = publishedPlan(environment, status.tracker, status.title, input.pages, tools)
    return { source: plan.source, routing: plan.routing }
}
