# Queue

Use Backlog and Todo to save work in the configured tracker without starting an Epic, Task, or Gig:

- `backlog` — potential work we may do later but have not committed to doing;
- `todo` — queued work we have committed to doing and can pick up next.

Both destinations contain work that has not started. Adding work creates no workflow ID, `.project` entity, artifact, branch, or saved workflow recovery state.

## Add work

1. Call `integration_context` with `operation: "queueIntake"` to obtain the configured tracker. Stop and report a missing, invalid, or unavailable tracker.
2. Read [communication guidance](./communication.md), [shared integration rules](./integrations/shared.md), and the returned provider guide: [GitHub tracker](./integrations/tracker/github.md) or [Linear tracker](./integrations/tracker/linear.md).
3. Draft the title, description, selected Backlog or Todo destination, and configured Priority or `not set`.
4. For versioned GitHub, include workflow Kind as a standard intake choice: when the request states Epic, Feature, Bugfix, Research, Refactor, Audit, or Chore, reuse it; otherwise infer and recommend the best-supported value. Present the exact Kind or `not set` with the other intake fields. `not set` creates no managed Kind label. Unversioned GitHub does not ask for or apply Kind because queue intake has nowhere private to retain it.
5. For Linear, also require `epic | task | gig`. A Task requires one initialized Linear-backed parent Epic.
6. Obtain explicit approval of the complete provider-specific intake, run the returned provider checks, and use only the returned tracker MCP tools.

An approved new queue intake is a direct create request. Do not search for duplicates before the first create attempt. Search for an existing object only when the user asks to adopt one or when a create response is uncertain.

GitHub creates an ordinary issue, applies the approved managed Kind label only in versioned mode when Kind is not `not set`, verifies its labels, adds it to the configured Project, and applies the selected Status and Priority. Linear creates a Project for Epic, an issue in the parent Epic Project for Task, or a projectless issue for Gig, then applies the selected queue state and native Priority.

Except for that approved versioned GitHub Kind label, do not assign a workflow ID, native GitHub issue Type, Linear label/kind, Planning label, branch, workflow artifact, or pending workflow record while adding work to Backlog or Todo.

## If the provider response is uncertain

Read provider state before continuing. Continue from confirmed presence or application, retry only after confirmed absence or non-application, and report ambiguous or inconsistent state. Keep a known object's identity and retry only incomplete updates. Do not add candidate-confirmation protocols, temporary identifiers, or another recovery mechanism.

Always report the durable object URL and any incomplete update. Never bypass a denied or failed MCP tool with another client.

## Start the work

When the user starts a selected Backlog or Todo object through `/epic`, `/task`, or `/gig`, reuse that exact provider object and Priority, create the workflow entity and branch contract, and move directly to In Progress with `workStage: planning`. Todo is never required between Backlog and In Progress.

GitHub also adds the configured Planning label while planning is active. Linear and trackerless workflows use no separate external planning marker. Versioned mode reconciles the authoritative workflow Kind label and may apply configured Internal ID during initialization; unversioned mode keeps system metadata in workflow artifacts.
