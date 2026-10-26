# Queue

Backlog and Todo save work in the configured tracker without starting an Epic, Task, or Gig:

- `backlog`: work we may do later but haven't committed to;
- `todo`: work we've committed to and can pick up next.

Both hold work that hasn't started. Adding work creates no `.project` entity, artifact, branch, or saved recovery state.

## Choose the project

- `/backlog`, `/todo`, and natural-language queue requests use `target: "current"`.
- An explicit request to report a workflow defect or recurring friction ("Report this workflow issue" is enough) uses the Todo skill, destination `todo`, and `target: "workflow"`.
- The workflow target reads the global `workflowProject` source reference, plus that project's tracker configuration ([setup](./setup.md#workflow-reporting-source)).
  - Use only the returned tracker and MCP server, never the consuming project's tracker.
  - The returned `projectRoot` is local context, not report content.
- Missing or invalid configuration ends the attempt with the tool's short corrective error. Don't start setup or repair configuration.

## Add work

1. **Read configuration.** Call `inspect_integrations` with the `target`. Stop and report a missing or invalid tracker.
2. **Read the guides.** Read [communication](./communication.md) and the provider guide: [GitHub tracker](./integrations/tracker/github.md) or [Linear tracker](./integrations/tracker/linear.md). When it refers to shared rules, read [integration roles](./integrations/shared.md).
3. **Draft the intake:** the title, the description, the tracker destination, Backlog or Todo, and a configured Priority or `not set`.
4. **Entity type.** Require `epic`, `task`, or `gig` before checking mutation capability.
   - A Task needs its initialized parent Epic and the provider relationship in the selected project, not another checkout.
   - Recommend a standalone Gig for independent workflow reports.
5. **Kind** (GitHub with configured Kind labels only): `inspect_integrations` shows `labels.kind`. Reuse the Kind the request states (Epic, or a Deliverable kind); otherwise recommend the best fit and present it, or `not set`, with the other fields.
6. **Approve and create.** Get explicit approval of the complete title and body, the destination, and the provider-specific choices.
   - Call `inspect_queue_intake` with the same `target`, the `entity`, `priority`, and `kind` (`not set` when Kind labels aren't configured). Apply the returned `kindLabel` when it isn't null. Reconcile any difference from the approved destination; changed content or destination needs approval again.
   - Use only its selected registered tools, under normal permissions. Let native mutations validate their own inputs; don't preflight labels, options, workspaces, or statuses.
   - Never load the source project's credentials or run its MCP settings.

**Attribution:** submit the approved complete text and let publication code sign AI-assisted content ([attribution](./integrations/shared.md#attribution)). Use user-verbatim authorship only for complete, unchanged user-written messages. Never add a footer yourself. This applies to cross-project reports too.

**Creating:**

- An approved intake is a direct create. Don't search for duplicates first. Search only when the user asks to adopt something or a create result is uncertain.
- **GitHub:** create an ordinary issue with, for a Task, the parent. Add it to the configured Project and set Status and Priority with named writes. The Task parent and issue-scoped fields are separate calls.
- **Linear:** create only the selected Project, Task issue with parent Project, or projectless Gig, with team, state, and Priority together.
- Reuse returned identities and outcome proof; read only missing required facts. No cache or recovery state is kept.

Apart from that optional Kind label, adding work assigns no native issue Type, Linear label or kind, native Phase, branch, artifact, or pending record.

## Prepare a workflow report

Before the normal approval step, prepare a minimal, standalone description.

**Include:**

- the affected workflow, skill, or tool;
- expected and actual behavior;
- ordered reproduction steps, or a concrete example of the repeated friction;
- impact;
- relevant sanitized error or instruction excerpts.

Distinguish observed friction, or an unconfirmed cause, from a verified defect.

**Version:**

- Include the installed workflow version or source revision, package-relative file names, and known local changes, so maintainers can reproduce it. Say plainly when that evidence is unavailable or mismatched.
- The consuming project's commit is not the workflow version, and a separate source checkout's revision doesn't prove an installed copy matches it.
- Don't hash or inventory source, update installations, or change checkouts to prepare a report.

**Exclude:**

- Replace project-specific values with synthetic examples, and prefer a small independent reproduction.
- Never include consuming-project names, remotes, absolute paths, tracker links, workflow IDs, proprietary code, credentials, customer data, raw logs, or transcript or artifact dumps.
- Don't collect session history or attach files automatically. This applies to public and private destinations alike.
- Evidence that can't be made safe stays local; explain the safe reproduction that's still needed.

**Approve and submit:**

- Show the complete sanitized candidate and the destination, explain omissions and missing evidence, and use the normal intake approval above. Suggesting a report, or approving its preparation, is not approval to send it.
- Keep remote mutation tools outside skill-derived allow rules; configured permissions still apply.
- Submit it as ordinary Todo work through the provider procedure, and return its URL and any incomplete update. Maintainers handle it through the usual Todo, Gig, and Task process.
- Leave both projects' lifecycle, branches, installed workflows, and files unchanged. Don't initialize maintenance work or create report stores or recovery records.
- Continue the consuming project's task afterward, including after a declined or blocked attempt.

## If the provider response is uncertain

Follow [core outcome rules](./core.md#outcomes-and-recovery). Keep a known object's identity and retry only incomplete updates. Don't add candidate confirmation, temporary identifiers, or another recovery mechanism. Always report the object's URL and any incomplete update.

## Start the work

When the user starts a Backlog or Todo object through `/epic`, `/task`, or `/gig`:

- Reuse that object and its Priority, create the workflow entity and branch contract, and move straight to In Progress with `phase: planning`. Todo is never required between Backlog and In Progress.
- Both providers keep the request's title or name and description.
- The first accepted plan publishes as one managed GitHub comment or one Linear document attached to the issue or Project, and later updates reuse it. This is the same for workflow-created and externally submitted items; no ownership question is needed. Queue intake itself publishes no plan.
- **Phase** ([Phase](./phase.md)): GitHub uses the Project Phase field, Linear the configured label group. Other system metadata stays private.
