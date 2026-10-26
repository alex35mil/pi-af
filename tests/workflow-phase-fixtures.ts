export const phaseValues = {
    planning: "Planning",
    execution: "Execution",
    selfReview: "Self-Review",
}

export function linearPhases() {
    return {
        issues: { scope: "workspace" as const, group: "Phase", values: { ...phaseValues } },
        projects: { scope: "workspace" as const, group: "Phase", values: { ...phaseValues } },
    }
}

const statuses = {
    backlog: "Backlog",
    todo: "Todo",
    inProgress: "In Progress",
    inReview: "In Review",
    done: "Done",
    canceled: "Canceled",
}

// A minimal valid tracker for fixtures that only exercise the forge. It's a Linear
// tracker, so incoming-PR work sees no GitHub Project board.
export function minimalTracker() {
    return {
        provider: "linear" as const,
        mcpServer: "linear",
        team: "Engineering",
        phase: linearPhases(),
        statuses: { issues: { ...statuses }, projects: { ...statuses } },
    }
}
