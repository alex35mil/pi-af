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
