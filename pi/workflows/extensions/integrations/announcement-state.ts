import * as path from "node:path"

import { type EntityStatus, readEntityStatus, resolveEntityDirectory, taskMarker } from "../__lib/entity.js"
import type { AnnouncementInput, PlanAnnouncement } from "./plan-announcement.js"
import type { TrackerRecord } from "./records.js"

// The tracker record with its in-flight plan announcement replaced or removed.
export function withPlanAnnouncement(record: TrackerRecord, state: PlanAnnouncement | undefined): TrackerRecord {
    const { planAnnouncement: _, ...rest } = record
    return (state ? { ...rest, planAnnouncement: state } : rest) as TrackerRecord
}

// The heading's Task marker for an Epic update made from one of its Tasks. Only an Epic update can
// come from a Task, and the Task must be one of its own.
export function resolveAnnouncementOrigin(
    root: string,
    cwd: string,
    directory: string,
    status: EntityStatus,
    origin: AnnouncementInput["origin"],
): string | undefined {
    if (origin === undefined) return undefined
    switch (status.entity) {
        case "epic": {
            const task = resolveEntityDirectory(root, cwd, origin.entityDir)
            if (path.dirname(task) !== path.join(directory, "tasks"))
                throw new Error("the announcing Task must be a Task of this Epic")
            return taskMarker(readEntityStatus(task))
        }
        case "task":
        case "gig":
            throw new Error(`a ${status.entity} plan update has no Task origin; omit origin`)
    }
}
