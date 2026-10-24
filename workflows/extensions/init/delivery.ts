import { Type, type Static } from "typebox"

import type { McpToolCatalog } from "../../../extensions/__lib/mcp.js"
import type { ReadyBranchContract } from "../__lib/domain.js"
import * as Git from "../__lib/git.js"
import type { GitHubForge } from "../integrations/config.js"
import { planGitHubMerge } from "../integrations/forge/github/merge.js"
import { EvidenceSchema } from "../integrations/resource-id-tool.js"

export const EpicDeliverySchema = Type.Union([
    Type.Object({ kind: Type.Enum(["git-ancestry"], { type: "string" }) }, { additionalProperties: false }),
    Type.Object(
        { kind: Type.Enum(["github-pr"], { type: "string" }), evidence: EvidenceSchema },
        { additionalProperties: false },
    ),
])
export type EpicDelivery = Static<typeof EpicDeliverySchema>

// Every new/adopted default-target Task verifies current delivery; routing intent alone is not proof.
export function assertEpicDelivered(
    root: string,
    branch: ReadyBranchContract,
    delivery: EpicDelivery,
    forge: GitHubForge | undefined,
    tools: McpToolCatalog,
): void {
    const headRef = `refs/heads/${branch.name}`
    const targetRef = `refs/heads/${branch.target}`
    Git.run(root, ["show-ref", "--verify", headRef])
    Git.run(root, ["show-ref", "--verify", targetRef])
    switch (delivery.kind) {
        case "git-ancestry":
            if (!Git.succeeds(root, ["merge-base", "--is-ancestor", headRef, targetRef]))
                throw new Error(
                    `Epic branch ${branch.name} has not been merged into ${branch.target}; a non-ancestral GitHub delivery requires exact merged PR evidence`,
                )
            return
        case "github-pr": {
            if (!forge) throw new Error("GitHub Epic delivery requires a configured GitHub forge")
            const decision = planGitHubMerge(
                {
                    mcpServer: forge.mcpServer,
                    repository: forge.repository,
                    number: delivery.evidence.arguments.pullNumber as number,
                    base: branch.target,
                    head: { repository: forge.repository, ref: branch.name },
                    expectedHeadSha: Git.run(root, ["rev-parse", `${headRef}^{commit}`]),
                },
                delivery.evidence,
                tools,
            )
            if (decision.state === "blocked") throw new Error(decision.reason)
            if (decision.state !== "merged") throw new Error("Epic delivery requires a confirmed merged PR")
            return
        }
        default:
            delivery satisfies never
    }
}
