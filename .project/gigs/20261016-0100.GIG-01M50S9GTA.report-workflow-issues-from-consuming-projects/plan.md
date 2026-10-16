# Report workflow issues from consuming projects

## Outcome

An agent working in a consuming project can report a reproducible workflow defect or recurring friction by creating ordinary Todo work in the workflow project's configured tracker. It prepares a safe, concise description, gets user approval, and follows the existing Todo intake process. Maintainers pick up that Todo through the existing workflows.

The change extends the existing settings, `integration_context`, Todo skill, and queue guidance. It does not add a reporting service, context tool, maintainer skill, or new intake lifecycle.

## Configuration: reference the workflow source

Add one optional field to the existing **private global `workflows.settings.json`**, resolved through Pi's `getAgentDir()`:

```json
{
  "workflowProject": "/absolute/path/to/pi-af"
}
```

`workflowProject` is an absolute filesystem path to the workflow source checkout, not a copied tracker configuration. The file is outside Git. Existing global `branches.username` can coexist with this field; existing branch-only settings remain valid. The repository-local `.project/config.local.json` keeps its current branch-username contract and cannot override the global workflow source reference.

For example, while an agent works in `/work/private-app`, the reference `/src/pi-af` makes it read:

- `/src/pi-af/.project/integrations.json` for the existing GitHub or Linear tracker, MCP server, and native queue/priority/label configuration;
- `/src/pi-af/.project/config.json` for the existing artifact-persistence policy used by that project's queue intake.

Those source-project files stay authoritative. No new destination manifest, transport enum, duplicated tracker object, or hardcoded GitHub destination is introduced. Changes to the source project's tracker configuration are picked up by the next context read. This project's present configuration points to GitHub repository `alex35mil/pi-af`, Project 2; a different workflow source can use its own supported tracker.

The configured path must exist and identify the source repository root, not an arbitrary subdirectory whose enclosing repository is silently selected. Resolve filesystem aliases consistently, require readable source/configuration, and use existing configuration validation and read-only artifact-readiness checks. Reporting does not prepare or repair either project.

Missing configuration fails with a short actionable error, for example:

> Set `workflowProject` to the absolute workflow source path in `<resolved-agent-dir>/workflows.settings.json`.

An invalid path or missing/invalid source configuration names the exact path and required correction. A missing tracker names the source `.project/integrations.json`. The agent stops this reporting attempt; the user can lead a later fix with an agent. No setup questions, automatic writes, or fallback to the consuming project's tracker occur.

## Extend the existing context API

Add a required `target: "current" | "workflow"` to the existing `integration_context` operations `inspect` and `queueIntake`:

```text
integration_context({ operation: "inspect", target: "workflow" })
integration_context({ operation: "queueIntake", target: "workflow", entity, priority, kind })
```

- `current` keeps normal project inspection and Backlog/Todo intake behavior.
- `workflow` resolves the global source reference first, then reads the selected source project's existing tracker and queue policy. It must not read or validate the consuming project's `.project` configuration as a prerequisite. Reporting therefore also works from a project with no workflow setup or malformed local workflow configuration.
- Entity-bound initialization/resume, artifact projection, mutations, forge operations, and adoption stay tied to their existing current-project entity contract; they do not gain a workflow target.

Represent target selection once at the owning integration boundary and pass the resolved project through existing configuration/environment/policy readers. Reuse `TrackerConfigSchema` and its GitHub/Linear provider values. Keep the operation read-only: no provider calls, file/index writes, cache records, or artifact preparation. Return the selected target and source root alongside the existing context so the agent can distinguish local resolution from the external destination. Local filesystem paths are not report content.

Update all existing `inspect`/`queueIntake` callers, tests, setup instructions, and queue guidance to supply the explicit target. Do not add an optional target with an implicit fallback or retain a parallel context implementation. The selected source's tracker MCP name identifies the registered tools to call in the running reporting session; configured source credentials or MCP settings are never loaded or executed in place of registered tools.

## Reporting through ordinary Todo intake

Add the reporting case to the existing Todo skill and queue reference. Ordinary `/todo` and `/backlog` remain current-project intake. An explicit request to report a workflow problem selects the workflow target and Todo destination. Agents can briefly offer this after finding a credible workflow defect or recurring friction, without interrupting the active task or transmitting anything automatically.

1. Read workflow-target context. A failure ends the attempt with the small corrective instruction described above.
2. Prepare the report using normal queue intake fields and approvals: title, description, exact tracker destination, Todo, entity, configured Priority or `not set`, and Kind where the selected artifact/provider policy supports it. Recommend a standalone Gig for independent workflow work; use the existing entity-selection and approval rules. Any parent relationship must belong to the selected project, not the consuming project.
3. Include the affected workflow/skill/tool, expected and actual behavior, minimal ordered reproduction or concrete repeated-friction example, relevant sanitized error/instruction excerpts, impact, and uncertainty. Distinguish a verified defect from observed friction or an unconfirmed cause.
4. Explain which workflow code was involved using a known installed version or source revision when available, relevant package-relative file names, and known local changes. This is simply to help a maintainer reproduce the same behavior. Do not invent a version, treat the consuming project's commit as the workflow version, or present the configured source checkout's revision as proof of a different installed copy. State unavailable or mismatched source evidence plainly. No content hashing, source inventory, or automatic update/checkout is needed.
5. Remove private consuming-project names, remotes, absolute paths, tracker links, workflow IDs, proprietary code, credentials, customer data, transcript/artifact dumps, and raw logs. Prefer synthetic names and a minimal independent reproduction. No automatic attachments or session-history collection. Evidence that cannot be made safe stays local; explain the safe reproduction still needed. This boundary applies whether the destination is public or private.
6. Show the complete sanitized title/body and exact destination with the normal intake choices, explaining omissions or missing evidence. Obtain explicit publication approval. A suggestion to report or approval of preparation does not authorize submission. Changed destination or content requires new approval.
7. Call existing workflow-target `queueIntake` and use its returned tracker configuration and policy. Reconcile any difference from the approved destination before external mutation. Execute the existing GitHub or Linear Todo procedure through its named registered MCP tools under normal permissions.
8. Return the created entry URL and any incomplete native-field update, then continue the consuming project's work. Do not initialize an entity, create a branch or report store, change either project's active lifecycle, or start maintenance implementation.

GitHub follows existing issue creation, Project membership, Todo/Priority assignment, and policy-dependent Kind labeling. Linear follows existing native object/team/state/priority and entity rules. Queue work receives no workflow identity or Phase. Existing provider success, partial-application, uncertain-create recovery, and no-client-substitution rules apply unchanged; do not create a report-specific retry mechanism or search for duplicates before the first approved create.

## Decision table

| Action or condition | Result |
| --- | --- |
| Ordinary project inspection or queue request | Explicit `current` target; behavior stays unchanged and does not require `workflowProject`. |
| Explicit workflow-problem report | Explicit `workflow` target; ordinary Todo intake in the source project's tracker. |
| Consuming project has different, missing, or invalid tracker/setup | Workflow reporting still resolves the global source reference and source-project configuration only. |
| Global reference missing/invalid, source missing/invalid, tracker absent, or source artifact readiness fails | Stop with the exact configuration location and concise correction; no automatic setup, writes, or alternate destination. |
| Named provider tools unavailable, denied, or failing | Report the blocker and preserve work; do not borrow another server, HTTP client, or consuming-project tracker. |
| Source revision unavailable or installed copy differs | State the evidence limitation in the report; never guess version equivalence. |
| Safe report cannot be prepared or publication is declined | No external entry; consuming-project work remains unchanged. |
| Approved content/destination changes before create | Require approval of the changed intake. |
| Create succeeds clearly or has uncertain/partial outcome | Follow existing queue/provider outcome and recovery rules, retaining the known object's identity. |

The material risks are sending consuming-project information to another tracker and accidentally selecting the consuming project's destination. Exact sanitized-content approval and explicit target selection address those risks at the existing queue/context boundaries. A lost create response already has credible duplicate-creation risk and is handled by the existing queue recovery contract, not new machinery.

## Implementation ownership and affected files

- **`workflows/extensions/__lib/project-config.ts`**: extend the global settings contract with `workflowProject`, keeping local branch settings separate; expose reusable global source-reference resolution. Preserve existing username precedence and strict validation.
- **`workflows/extensions/integrations/index.ts`**: extend `IntegrationContextSchema` and resolve the selected project once for `inspect`/`queueIntake`, feeding existing configuration/policy readers and returning target identity. Do not duplicate tracker/provider models or change entity-bound operations.
- **`workflows/skills/todo/SKILL.md`** and **`workflows/references/queue.md`**: route explicit workflow reporting through the existing Todo contract; own sanitized report preparation, target selection, source-evidence limitations, approval, and provider handoff.
- **`workflows/references/communication.md`**: add one small hook offering workflow reporting when a credible problem emerges. Point to Todo/queue guidance rather than duplicating the process across work skills.
- **`workflows/references/setup.md`**, **`workflows/skills/project-setup/SKILL.md`**, **`workflows/references/integrations/shared.md`**, **`workflows/extensions/integrations/README.md`**, **`workflows/README.md`**, and **`README.md`**: document exact settings location/example, source-owned tracker selection, explicit context targets, missing-config error behavior, and ordinary Todo handling.
- **`tests/workflow-project-config.test.ts`**, **`tests/workflow-integration.test.ts`**, and **`tests/workflow-instructions.test.ts`**: cover the owning settings/API boundaries and updated instruction consumers. Add focused fixtures or tests only where they make these contracts clearer.

Tracker issue/PR presentation changes are separate High-priority Todo #47 and are not implemented here. The suggested additional review-prompt prevention check is not approved work in this Gig. Keep unrelated files and existing tracker/forge, artifact, entity, and branch behavior untouched.

## Verification

- Settings tests: old branch-only configuration, source-only configuration, both fields, absent global settings, malformed JSON, invalid source path, and existing local/global username precedence. The source field is global-only; no project-local override. Missing-setting/path/config errors name the exact corrective location, and inspection never changes files or the index.
- Context tests with distinct consuming/source fixtures: `current` and `workflow`; GitHub and Linear source trackers; both source artifact modes; a consuming project with a different tracker, no `.project`, and malformed configuration. Assert workflow-target destination/policy come only from the source checkout; source tracker changes appear on reread; ordinary current operations work without the global reference.
- Schema/consumer tests: both affected operations require target, unsupported targets fail, entity-bound operations do not accept it, all existing callers are updated, and existing initialization/resume/projection/forge behavior stays unchanged. No fallback or duplicated tracker schema.
- Instruction tests and dry-runs: explicit reporting uses Todo/workflow; ordinary intake uses current; private details stay out; no transmission before exact approval; missing setup produces an error rather than a wizard; named-tool denial and uncertain creates retain the existing provider boundary. These are agent instructions and permission controls, not a claim of an infallible automated sanitizer.
- Run focused config/integration/instruction tests, full `npm test`, `npx tsc --noEmit`, and `git diff --check`. Baseline before implementation: 177 tests and type checking passed. Do not create live test reports without separately approved content. Record actual results and any unrun live/agent checks in `result.md`, then complete final review before user acceptance.
