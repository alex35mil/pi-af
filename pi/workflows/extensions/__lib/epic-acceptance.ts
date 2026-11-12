import * as fs from "node:fs"
import * as path from "node:path"

import { type EntityStatus, readEntityStatus, writeEntityStatus } from "./entity.js"
import { type AcceptedTask, epicTaskList, parseEpicTasks, taskListDifference } from "./epic-tasks.js"
import { CANDIDATE_FILE, readReviewCycle, unfinishedCycleReason } from "./review-rounds.js"

// The Epic's accepted Task list. Only a list the user accepted, after a reviewer saw it, can create
// issues or reach the tracker. Other edits to epic.md need neither review nor acceptance.

type EpicStatus = Extract<EntityStatus, { entity: "epic" }>

function epicStatus(directory: string): EpicStatus {
    const status = readEntityStatus(directory)
    switch (status.entity) {
        case "epic":
            return status
        case "task":
        case "gig":
            throw new Error(`Task list acceptance requires an Epic, not a ${status.entity}`)
    }
}

function readTaskList(file: string): AcceptedTask[] {
    return epicTaskList(parseEpicTasks(fs.readFileSync(file, "utf-8")))
}

/**
 * Saves epic.md's Task list as accepted. The newest plan review cycle must be finished and its last
 * valid round must have reviewed this exact list, so a list no reviewer saw can't be accepted.
 */
export function acceptEpicTasks(directory: string): { state: "accepted"; tasks: AcceptedTask[] } {
    const status = epicStatus(directory)
    const cycle = readReviewCycle(directory, "plan")
    switch (cycle.state) {
        case "none":
        case "awaitingVerification":
            throw new Error(
                `accepting the Task list requires a finished plan review: ${unfinishedCycleReason(cycle, "plan")}`,
            )
        case "finished":
            break
    }
    const current = readTaskList(path.join(directory, "epic.md"))
    const reviewed = readTaskList(path.join(cycle.last.directory, CANDIDATE_FILE))
    const difference = taskListDifference(reviewed, current)
    if (difference)
        throw new Error(
            `the Task list changed after ${cycle.last.entry} reviewed it; run review_epic with newReview naming the change, then accept:\n${difference}`,
        )
    writeEntityStatus(directory, { ...status, acceptedTasks: current })
    return { state: "accepted", tasks: current }
}

/** Refuses an Epic Task list, from epic.md or a plan source, that differs from the accepted one. */
export function assertAcceptedTaskList(status: EntityStatus, source: string): void {
    switch (status.entity) {
        case "task":
        case "gig":
            return
        case "epic":
            break
    }
    if (!status.acceptedTasks)
        throw new Error(
            "the Epic's Task list isn't accepted yet; get the user's acceptance, then call accept_epic_tasks",
        )
    const difference = taskListDifference(status.acceptedTasks, epicTaskList(parseEpicTasks(source)))
    if (difference)
        throw new Error(
            `the Epic's Task list differs from the accepted one; review it with review_epic (newReview), get the user's acceptance, and call accept_epic_tasks:\n${difference}`,
        )
}
