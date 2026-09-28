import { StringEnum } from "@earendil-works/pi-ai"
import { Type, type Static } from "typebox"

export const SHARED_LINK_SECTION = {
    heading: "Links",
    order: ["brief", "planOrEpic", "resultOrReport", "tracker", "pullRequest"],
    repositoryVariants: ["permanentCommit", "targetBranch"],
    destinations: {
        pullRequest: ["brief", "planOrEpic", "tracker"],
        tracker: ["brief", "planOrEpic", "resultOrReport", "pullRequest"],
    },
} as const

const ConfirmedUrlSchema = Type.String({ minLength: 1, pattern: "^[^\\r\\n]+$" })
const repositoryProperties = {
    permanentCommit: ConfirmedUrlSchema,
    targetBranch: Type.Object(
        {
            url: ConfirmedUrlSchema,
            state: StringEnum(["resolved", "available-after-merge"] as const),
        },
        { additionalProperties: false },
    ),
}
const RepositoryLinkSchema = Type.Object(repositoryProperties, { additionalProperties: false })
const externalProperties = {
    tracker: Type.Optional(ConfirmedUrlSchema),
    pullRequest: Type.Optional(ConfirmedUrlSchema),
}
const destination = StringEnum(["pullRequest", "tracker"] as const)

export const RenderArtifactLinksSchema = Type.Union([
    Type.Object(
        {
            artifactMode: Type.Literal("versioned"),
            destination,
            entries: Type.Object(
                {
                    brief: Type.Optional(RepositoryLinkSchema),
                    planOrEpic: Type.Optional(
                        Type.Object(
                            { label: StringEnum(["Epic", "Plan"] as const), ...repositoryProperties },
                            { additionalProperties: false },
                        ),
                    ),
                    resultOrReport: Type.Optional(
                        Type.Object(
                            { label: StringEnum(["Result", "Report"] as const), ...repositoryProperties },
                            { additionalProperties: false },
                        ),
                    ),
                    ...externalProperties,
                },
                { additionalProperties: false },
            ),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            artifactMode: Type.Literal("unversioned"),
            destination,
            entries: Type.Object(externalProperties, { additionalProperties: false }),
        },
        { additionalProperties: false },
    ),
])
export type RenderArtifactLinksInput = Static<typeof RenderArtifactLinksSchema>

type LinkSlot = (typeof SHARED_LINK_SECTION.order)[number]

/** Format verified entries only; evidence gathering and provider mutation belong to the caller. */
export function renderArtifactLinks(input: RenderArtifactLinksInput): string {
    const rendered: Partial<Record<LinkSlot, string>> = {}
    if (input.artifactMode === "versioned") {
        const { brief, planOrEpic, resultOrReport } = input.entries
        if (brief) rendered.brief = repositoryBullet("Brief", brief)
        if (planOrEpic) rendered.planOrEpic = repositoryBullet(planOrEpic.label, planOrEpic)
        if (resultOrReport) rendered.resultOrReport = repositoryBullet(resultOrReport.label, resultOrReport)
    }
    if (input.entries.tracker) rendered.tracker = `- ${markdownLink("Tracker", input.entries.tracker)}`
    if (input.entries.pullRequest) rendered.pullRequest = `- ${markdownLink("Pull request", input.entries.pullRequest)}`

    const allowed: readonly LinkSlot[] = SHARED_LINK_SECTION.destinations[input.destination]
    const lines = SHARED_LINK_SECTION.order.flatMap((slot) =>
        allowed.includes(slot) && rendered[slot] ? [rendered[slot]] : [],
    )
    return lines.length ? `## ${SHARED_LINK_SECTION.heading}\n\n${lines.join("\n")}` : ""
}

function repositoryBullet(label: string, link: Static<typeof RepositoryLinkSchema>): string {
    const suffix = link.targetBranch.state === "available-after-merge" ? " — available after merge" : ""
    return `- ${label}: ${markdownLink("commit", link.permanentCommit)} · ${markdownLink("target branch", link.targetBranch.url)}${suffix}`
}

function markdownLink(label: string, url: string): string {
    return `[${label}](${url.replace(/[\\()]/g, "\\$&")})`
}
