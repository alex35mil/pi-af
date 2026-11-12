import type { TrackerConfig } from "./config.js"
import { type LabelFacts, linearLabelFacts, linearLabelsNamed } from "./label-selection.js"
import { type Gate, GATE_GROUP_KEY } from "./labels.js"

/**
 * Whether a Task or Gig waits for the user's approval at one gate. The user marks an item with the
 * gate's configured label; the workflow only reads it.
 */
export type GateOutcome =
    | { gate: "awaitApproval"; label: string }
    | { gate: "continue"; reason: "unmarked"; label: string }
    | { gate: "continue"; reason: "unconfigured" }

/** Decides one gate from the item's fresh labels. */
export function gateOutcome(tracker: TrackerConfig, gate: Gate, current: LabelFacts): GateOutcome {
    switch (tracker.provider) {
        case "github": {
            if (current.provider !== "github") throw new Error("label facts don't match the configured GitHub tracker")
            const label = tracker.labels?.groups?.[GATE_GROUP_KEY]?.values[gate]?.name
            if (label === undefined) return { gate: "continue", reason: "unconfigured" }
            const marked = current.names.some((name) => name.toLowerCase() === label.toLowerCase())
            return marked ? { gate: "awaitApproval", label } : { gate: "continue", reason: "unmarked", label }
        }
        case "linear": {
            if (current.provider !== "linear") throw new Error("label facts don't match the configured Linear tracker")
            const group = tracker.labels?.groups?.[GATE_GROUP_KEY]
            const label = group?.values[gate]?.name
            if (group === undefined || label === undefined) return { gate: "continue", reason: "unconfigured" }
            const facts = linearLabelFacts(current)
            const applied = new Set(facts.applied)
            // Only the configured label in the group's scope counts; a same-named label elsewhere doesn't.
            const marked = linearLabelsNamed(facts.catalog, label, group.scope, tracker.team).some((candidate) =>
                applied.has(candidate.id),
            )
            return marked ? { gate: "awaitApproval", label } : { gate: "continue", reason: "unmarked", label }
        }
    }
}
