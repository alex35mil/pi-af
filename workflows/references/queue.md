# Queue

Use Backlog and Todo to save work in the configured tracker without starting an Epic, Task, or Gig:

- `backlog` — potential work we may do later but have not committed to doing;
- `todo` — queued work we have committed to doing and can pick up next.

Both destinations contain work that has not started. Adding work creates no workflow ID, `.project` entity, artifact, branch, or saved workflow recovery state.

## Select the project

Ordinary `/backlog`, `/todo`, and natural-language queue requests use `target: "current"`. An explicit request to report a workflow defect or recurring friction uses the Todo skill, destination `todo`, and `target: "workflow"`. Natural language such as “Report this workflow issue” is sufficient.

The workflow target reads the global `workflowProject` source reference and that source project's existing tracker configuration and artifact policy. See [setup](./setup.md#workflow-reporting-source). Its returned `projectRoot` is local context, not report content. Use only the returned tracker/MCP server and selected-project policy; do not substitute the consuming project's tracker. Missing or invalid configuration ends the attempt with the tool's short corrective error. Do not start setup questions or repair configuration automatically.

## Add work

1. Call local/read-only `inspect_integrations` with the selected `target` to obtain configuration. Stop and report a missing/invalid tracker; select the entity and approved values before making provider mutations.
2. Read [communication guidance](./communication.md), [shared integration rules](./integrations/shared.md), and the returned provider guide: [GitHub tracker](./integrations/tracker/github.md) or [Linear tracker](./integrations/tracker/linear.md).
3. Draft the title, description, exact selected tracker destination, Backlog or Todo, and configured Priority or `not set`.
4. For versioned GitHub, include workflow Kind as a standard intake choice: when the request states Epic, Feature, Bugfix, Research, Refactor, Audit, or Chore, reuse it; otherwise infer and recommend the best-supported value. Present the exact Kind or `not set` with the other intake fields. `not set` creates no managed Kind label. Unversioned GitHub does not ask for or apply Kind because queue intake has nowhere private to retain it.
5. Require the selected `epic | task | gig` before mutation capability checks. A Task requires its initialized parent Epic and exact selected-provider issue/Project relationship in the selected project, not another checkout. Recommend a standalone Gig for independent workflow reports.
6. Obtain explicit publication approval of the complete title/body, exact tracker destination, and provider-specific intake choices, then call `inspect_queue_intake` with the same `target`, selected `entity`, exact `priority`, and `kind` (`not set` when no Kind is used). Reconcile any difference from the approved destination before mutation; changed content or destination requires renewed approval. Use only its selected registered tracker tools in the running session under normal permissions; let native named mutations validate their own inputs without label/option/workspace/status preflight. Do not load source-project credentials or execute its MCP settings.

Queue bodies follow [shared communication attribution](./integrations/shared.md#provider-bodies): submit the approved complete text and let workflow publication code sign AI-assisted content. Automatically select local user-verbatim authorship only for complete unchanged user-written messages; do not add a footer yourself. This also applies to cross-project reports and does not require a local workflow entity.

An approved new queue intake is a direct create request. Do not search for duplicates before the first create attempt. Search for an existing object only when the user asks to adopt one or when a create response is uncertain.

GitHub creates an ordinary issue with only the approved versioned Kind (omit for `not set`) and Task parent when applicable, adds it to the configured Project, and applies selected Status/Priority through supported named writes. Task parent and issue-scoped fields are separate supported calls. Linear creates only the selected Project, parent-Project Task issue, or projectless Gig with team/state/native Priority together. Reuse returned identities and established outcome proof; obtain only required missing facts. No queued cache or persisted recovery state is created.

Except for that approved versioned GitHub Kind label, do not assign a workflow ID, native GitHub issue Type, Linear label/kind, native Phase, branch, workflow artifact, or pending workflow record while adding work to Backlog or Todo.

## Prepare a workflow report

Before the normal approval step, prepare a minimal description that stands alone:

- Affected workflow/skill/tool, expected and actual behavior, ordered reproduction steps or a concrete repeated-friction example, impact, and relevant sanitized error/instruction excerpts. Distinguish observed friction and an unconfirmed cause from a verified defect.
- Known installed workflow version or source revision, package-relative file names, and relevant known local changes, so maintainers can reproduce the same behavior. State unavailable or mismatched evidence plainly. The consuming project's commit is not the workflow version; a separately configured source checkout's revision does not prove a different installed copy matches it. Do not hash or inventory source, update installations, or change checkouts to prepare a report.
- Only necessary safe context. Replace project-specific values with synthetic examples and prefer a small independent reproduction. Exclude consuming-project names, remotes, absolute paths, tracker links, workflow IDs, proprietary code, credentials, customer data, raw logs, and transcript/artifact dumps. Do not collect session history or attach files automatically. This applies to public and private destinations. Evidence that cannot be made safe stays local; explain the safe reproduction still needed.

Show the complete sanitized candidate and exact destination, explain omissions and missing evidence, and use the ordinary intake approval above. Suggesting a report or approving preparation is not approval to transmit it. Keep remote mutation tools outside skill-derived allow rules; configured permissions still apply.

Submit ordinary Todo work through the existing provider procedure and return its URL and any incomplete update. Maintainers use the existing Todo/Gig/Task process. Leave both projects' active lifecycle, branches, installed workflows, and files unchanged; do not initialize maintenance work or create report stores or recovery records. Continue the consuming project's task after reporting or a declined/blocked attempt.

## If the provider response is uncertain

Read provider state before continuing. Continue from confirmed presence or application, retry only after confirmed absence or non-application, and report ambiguous or inconsistent state. Keep a known object's identity and retry only incomplete updates. Do not add candidate-confirmation protocols, temporary identifiers, or another recovery mechanism.

Always report the durable object URL and any incomplete update. Never bypass a denied or failed MCP tool with another client.

## Start the work

When the user starts a selected Backlog or Todo object through `/epic`, `/task`, or `/gig`, reuse that exact provider object and Priority, create the workflow entity and branch contract, and move directly to In Progress with `phase: planning`. Todo is never required between Backlog and In Progress. Both providers preserve the request title/name and description. The first accepted plan publishes in one managed GitHub issue comment or Linear document attached to the bound issue/Project, updating that same publication thereafter. This is the same for workflow-created and externally submitted items; no ownership question is required. Queue intake itself creates no plan publication.

Follow `./phase.md`: initialized GitHub work uses the Project Phase field, and Linear uses the selected mutually exclusive Project/issue-label group, in both artifact modes. Trackerless Phase stays in metadata. Versioned mode also reconciles the authoritative GitHub Kind label and may apply configured Internal ID during initialization; other system metadata stays private in unversioned mode.
