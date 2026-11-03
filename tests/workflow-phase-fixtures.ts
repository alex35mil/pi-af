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

export interface GitHubPhaseReadsTarget {
    server: string
    project: { owner: string; ownerType: "user" | "org"; number: number }
    repository: { owner: string; repo: string }
    issueNumber: number
}

/** `projects_get` Phase reads in the shape the GitHub MCP returns them; `current: null` omits `value`. */
export function githubPhaseReads(target: GitHubPhaseReadsTarget, current: string | null = "Planning") {
    const address = {
        owner: target.project.owner,
        owner_type: target.project.ownerType,
        project_number: target.project.number,
    }
    const tool = `mcp__${target.server}__projects_get`
    return {
        field: {
            tool,
            arguments: { method: "get_project_field", ...address, field_id: 427 },
            response: {
                id: 427,
                node_id: "PVTSSF_phase",
                name: "Phase",
                data_type: "single_select",
                options: Object.values(phaseValues).map((raw, index) => ({
                    id: `option-${index}`,
                    color: "BLUE",
                    description: { raw: "", html: "" },
                    name: { raw, html: raw },
                })),
            },
        },
        item: {
            tool,
            arguments: { method: "get_project_item", ...address, item_id: 291, field_names: ["Status", "Phase"] },
            response: {
                id: 291,
                node_id: "PVTI_item",
                content_type: "Issue",
                content: {
                    id: 900,
                    number: target.issueNumber,
                    repository: `${target.repository.owner}/${target.repository.repo}`,
                    html_url: `https://github.com/${target.repository.owner}/${target.repository.repo}/issues/${target.issueNumber}`,
                },
                fields: [
                    {
                        id: 418,
                        name: "Status",
                        data_type: "single_select",
                        value: { id: "in-progress", name: "In Progress", color: "YELLOW" },
                    },
                    {
                        id: 427,
                        name: "Phase",
                        data_type: "single_select",
                        ...(current === null ? {} : { value: { id: "phase", name: current, color: "BLUE" } }),
                    },
                ],
            },
        },
    }
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
