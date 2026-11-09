import * as fs from "node:fs"
import * as path from "node:path"

import { withFileMutationQueue, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent"

import * as project from "../../../extensions/__lib/project.js"
import { ENTITY_METADATA_FILE, readEntityStatus, resolveEntityPath } from "../__lib/entity.js"
import { savePlanAnnouncement } from "../integrations/announcement-state.js"
import { type PlanAnnouncement, planFingerprint } from "../integrations/plan-announcement.js"

// Ties a presented plan-update summary to the write of its target. The user sees the summary while
// the target's file review runs, however the write is issued (directly or from a codemode script),
// and the saved state follows the write's outcome:
//
// - `presented` + successful write: `accepted`, fingerprinted to the file as written, so user edits
//   made on acceptance still match at publication;
// - `presented` + failed or rejected write: cleared;
// - `accepted` + any later successful write: cleared, so the next publication needs a new summary.
//   A failed later write leaves the file, and so the accepted fingerprint, unchanged.
//
// A call another `tool_call` handler blocks never reaches `tool_result`, so its state is unchanged;
// `tool_execution_end` still runs for it and clears the widget.

export const PLAN_ANNOUNCEMENT_WIDGET = "piton:plan-announcement"

const PLAN_FILES = { epic: "epic.md", task: "plan.md", gig: "plan.md" } as const

type PlanTarget = { directory: string; file: string; announcement: PlanAnnouncement | undefined }

// The entity whose accepted plan the path is, when it is one.
function planTarget(cwd: string, rawPath: unknown): PlanTarget | undefined {
    if (typeof rawPath !== "string" || !rawPath.trim()) return undefined
    const cleaned = rawPath.trim().replace(/^@/, "")
    // Resolved the same way workflow tools resolve `entityDir`.
    let directory: string
    try {
        directory = resolveEntityPath(project.resolveRootDir(cwd), cwd, path.dirname(cleaned))
    } catch {
        return undefined
    }
    const target = path.join(directory, path.basename(cleaned))
    if (!fs.existsSync(path.join(directory, ENTITY_METADATA_FILE))) return undefined
    const status = readEntityStatus(directory)
    if (path.basename(target) !== PLAN_FILES[status.entity]) return undefined
    return { directory, file: target, announcement: status.tracker.planAnnouncement }
}

function announcementWidget(summary: string): string[] {
    return ["Plan update announcement, approved together with this diff:", "", ...summary.trim().split(/\r?\n/)]
}

export function registerPlanAnnouncementWrites(pi: ExtensionAPI): void {
    // Calls currently showing the widget.
    const showing = new Set<string>()

    pi.on("tool_call", async (event, ctx) => {
        if (event.toolName !== "write" && event.toolName !== "edit") return
        const target = planTarget(ctx.cwd, (event.input as { path?: unknown }).path)
        if (target?.announcement?.state !== "presented") return
        showing.add(event.toolCallId)
        ctx.ui.setWidget(PLAN_ANNOUNCEMENT_WIDGET, announcementWidget(target.announcement.summary))
    })

    pi.on("tool_execution_end", async (event, ctx: ExtensionContext) => {
        if (!showing.delete(event.toolCallId)) return
        if (showing.size === 0) ctx.ui.setWidget(PLAN_ANNOUNCEMENT_WIDGET, undefined)
    })

    pi.on("tool_result", async (event, ctx) => {
        if (event.toolName !== "write" && event.toolName !== "edit") return
        const target = planTarget(ctx.cwd, event.input.path)
        if (!target?.announcement) return
        const { directory, file } = target
        await withFileMutationQueue(path.join(directory, ENTITY_METADATA_FILE), async () => {
            // Re-read under the queue: the state may have changed since the path was matched.
            const announcement = readEntityStatus(directory).tracker.planAnnouncement
            switch (announcement?.state) {
                case undefined:
                case "plan-update":
                case "announcing":
                    return
                case "presented": {
                    if (event.isError) return savePlanAnnouncement(directory, undefined)
                    const written = fs.readFileSync(file, "utf-8")
                    const { summary, origin } = announcement
                    return savePlanAnnouncement(directory, {
                        state: "accepted",
                        summary,
                        ...(origin ? { origin } : {}),
                        after: planFingerprint(written),
                    })
                }
                case "accepted":
                    if (!event.isError) savePlanAnnouncement(directory, undefined)
                    return
            }
        })
    })
}
