# Streamline workflow tool usage

## Overview

Make repeated workflow bookkeeping deterministic without hiding provider operations from the harness's permission checks. Replace manual Phase and tracker-binding edits with shared operations, avoid repeating unchanged artifact-safety scans, and stop teaching agents formatting algorithms already implemented in code.

### Plan highlights

- Add two local operations: set the current workflow Phase and confirm completed tracker initialization.
- Keep their domain logic independent of Pi, with thin Pi tool adapters. Portable skill scripts and cross-harness verification remain follow-up #43.
- Keep GitHub and Linear calls direct, subject to existing MCP permissions, approval, fresh-state, and recovery rules.
- Retain artifact-persistence safeguards while reusing validation only when its local inputs are unchanged.
- Replace repeated mechanics with concise invocation contracts; preserve authoring requirements and human approval gates.

## Scope and evidence

The audit covers active workflow skills, references, extension/tool contracts and their tests. It is a Refactor: entity identity, artifact formats, lifecycle semantics, branch contracts, provider-body output, and user approval behavior remain unchanged. Documentation names the current contract rather than retaining obsolete recipes.

The initial inventory identifies 17 instruction sites to simplify: six manual Phase/activity sites, two tracker-initialization completion sites, seven provider-rendering sites, and two repeated artifact-preparation mandates. This is a count of candidate instruction sites, not independent algorithms or entire sections to delete. Record the actual changes and any retained sites in the completion artifact rather than treating this count as a deletion quota.

Repository evidence:

- `__lib/project-config.ts` runs the same complete persistence inspection for explicit preparation and routine assertions. A read-only probe measured 47 ms initially and 38 ms on each of two repeated assertions, with seven Git subprocesses initially and six thereafter in versioned mode.
- Phase projection already belongs to `integrations/phase.ts`; callers separately edit metadata before requesting its calculated provider assignment.
- GitHub and Linear initialization instructions separately tell the agent to change tracker state to `bound` and remove `authority.desired` after confirming native outcomes.
- `integrations/projection.ts` already implements provider formatting. Its algorithms are repeated in references, extension documentation and integration-context output.
- MCP execution uses private clients. Permission enforcement happens at Pi's `tool_call` boundary; there is no general permission-aware registered-tool runner in the installed ExtensionAPI.

Keep `/submit` (#29), `/shipit` (#30), their dedicated orchestration tools, public-repository triage, portable script packaging, and new provider-execution infrastructure outside this Gig. Rendering-related wording inside submission references may change, but submission behavior does not.

## Shared operations and Pi adapters

Implement the two new state transformations in workflow-owned shared modules with explicit typed state/configuration/fact inputs and explicit result values. Domain modules do not import Pi APIs, read Pi context, prompt users, discover credentials, or execute provider calls. Existing pure projection and Phase helpers remain their owners.

Pi adapters resolve the current repository and exact entity, enforce existing persistence/environment checks, queue the metadata read-modify-write on its absolute target through Pi's file mutation queue, invoke the shared operation, and atomically write validated metadata. Keep all validation inside the mutation window. No generic workflow engine, permission broker, script CLI, new dependency, or wholesale directory migration is introduced.

Existing entity metadata and local Resource IDs schemas remain unchanged. Do not migrate completed artifacts or add compatibility shims. Both operations preserve unrelated metadata, integration roles, branches, relationships, priorities and source artifacts, and avoid rewriting unchanged files.

### Set workflow Phase

Register `set_workflow_phase` for Epic, Task and Gig. It replaces manual metadata Phase edits followed by a projection-calculation call during active local work. Its input selects the target Phase and supplies a strict authority-specific variant:

- Workflow authority reads current lifecycle from the existing local status; it accepts no tracker facts.
- Tracker authority requires fresh normalized native lifecycle and Phase facts in the existing GitHub/Linear fact model. Validate the configured provider/environment, use `planPhaseMutation` for the requested Phase, and return the exact changed/no-op provider assignment.

Validate before persisting the new metadata Phase. The tool does not change lifecycle or call a provider. The agent still applies a changed provider assignment directly and follows existing clear-success/recovery rules. A provider failure preserves the new authoritative Phase so ordinary reconciliation can resume.

| Current condition | Operation outcome |
| --- | --- |
| Ready branch, workflow authority, local In Progress | Persist requested Phase; no provider assignment |
| Ready branch, tracker authority, fresh native In Progress and valid native facts | Persist requested Phase; return changed/no-op native assignment |
| Requested Phase already matches | Do not rewrite metadata; still calculate any needed native reconciliation |
| In Review, Done, Canceled, queue lifecycle, mismatched authority/provider, invalid native metadata, or branch not ready | Reject without mutation |

Existing lifecycle procedures restore In Progress before corrections or replanning. The existing projection-only `trackerMutation/change: phase` remains appropriate for initialization before branch readiness and for clearing native Phase outside In Progress; it does not become a compatibility alias for state mutation.

Preserve the established activity table: drafting and all plan-review/approval iterations use Planning; accepted implementation uses Execution; implementation review and final local user review use Self-Review. Moving between those activities never implies acceptance or submission.

### Confirm tracker initialization

Register `confirm_tracker_initialization` for initialized tracker-backed work. It replaces hand-edited final binding transitions after existing create/adopt and native initialization steps. It consumes strict provider-specific normalized observed outcome facts, not an unverified `complete: true` flag or a provider transcript.

Validate facts against durable identity, selected configured tracker, exact Project/team/Task relationship, and the pending approved intent:

- GitHub: exact repository/issue and configured Project-item relationship; native In Progress, copied Priority and Planning; in versioned mode the correct managed Kind and Internal ID at their configured scopes; a Task's established parent issue relationship.
- Linear: exact Project/issue UUID, configured team, exact Task parent Project or projectless Gig, native In Progress, copied native Priority and Planning label-group result; versioned Internal ID requirements already specified by initialization.
- Reuse the existing native Phase validator for configured metadata and unchanged full-label reconciliation. Do not duplicate its algorithm.

These facts are normalized by the agent from actual current-operation provider reads or established clear-success mutations, as with the existing Phase fact contract. The operation checks their consistency with intent; it does not independently authenticate their provenance or establish freshness. Missing or uncertain evidence requires provider investigation before invoking it. Never add routine reads merely to populate a new confirmation payload.

| Current condition | Operation outcome |
| --- | --- |
| Identified `bound-pending` or `issue-bound-pending`, approved intent present, all required outcomes match | Write `bound`, remove pending operations and `authority.desired` together |
| Unidentified `awaiting`/attempted `pending`, missing intent, missing/conflicting outcome, wrong provider/object/relationship, or workflow authority | Reject without mutation |
| Already bound | Return unchanged; do not repeat provider work or rewrite metadata |
| Linear Task/Gig still needs branch provisioning | Confirm tracker binding without changing the branch; the existing exact-name save/provision/finalize flow remains required before planning |

Keep all identity/creation checkpoints, Resource ID recording and Linear branch provisioning at their existing owners. The new operation neither creates objects nor replaces cache entries or branch names. An unsuccessful confirmation leaves pending binding and intent recoverable. It does not turn successful provider calls into a transaction or roll them back.

## Artifact preparation and revalidation

Keep explicit `prepare_artifacts` as setup/configuration-repair preparation: it validates the full persistence contract and adds only the existing permitted local exclusions. It never edits the Git index, stages files, repairs tracked membership, or silently reverses persistence mode.

Keep `assertArtifactPersistencePrepared` as the shared operational safety boundary for its existing consumers and the new adapters. Remove the unconditional agent requirement to call the preparation tool before every init/resume. Before manual artifact reads or edits on resume, use the existing local integration-context initialization/resume check, including trackerless work, so safety does not depend on a later review call. Initialization still validates before creating artifacts. Missing preparation stops with the existing corrective instruction; it does not prepare silently.

Introduce one small in-memory successful-validation cache at the persistence owner, not at individual callers. Load/validate current project configuration on each call. Compare local safety inputs before reusing the full inspection result:

- Current repository identity and Git-resolved active index/exclude paths, respecting linked worktrees and Git index environment selection.
- Current HEAD commit, with an explicit unborn-repository representation; HEAD matters because staged deletions are compared against it.
- Artifact mode, root ignore and Git exclusion content, local configuration existence/content, and an active-index content fingerprint.

Resolve Git paths and HEAD fresh; do not infer that only agent operations can change Git state. A terminal `git add`, index replacement, branch checkout, or editing ignore/config files is enough to invalidate reuse. Use direct file snapshots/fingerprints, not timers, watchers, persistent cache files or a session-long ready flag. Record a successful cache entry only for the inspected inputs; a change during the full scan must not label the new inputs validated.

| Input/state | Required behavior |
| --- | --- |
| First operational assertion or changed safety inputs | Full existing membership/ignore/exclude validation |
| Same validated safety inputs | Reuse the successful inspection; skip broad membership/staged-diff scans |
| Changed provider Status/Priority, entity Phase, or local notes only | Never cache those facts; their existing fresh reads remain separate from persistence validation |
| Explicit preparation | Full validation and permitted exclusion repair; refresh successful state after the repair |
| Invalid config, missing exclusion/ignore rule, forbidden tracked/staged path, or incomplete mode reversal | Stop; preserve index and unrelated files |

Preserve staged-deletion detection, forbidden local-state checks, both persistence modes, settings precedence, and actionable errors. Measure actual warm/cold subprocess counts and timing after implementation; use structural scan-count assertions rather than flaky timing thresholds in tests. The baseline establishes redundant work, not a reason to build general cache infrastructure.

## Markdown and tool-output ownership

Update the active consumers coherently:

- `references/planning.md`, `references/deliverable.md`, `references/phase.md`, and `skills/epic/SKILL.md`: replace manual state-write mechanics with the new Phase operation and retain when each activity is valid.
- `references/integrations/tracker/github.md` and `linear.md`: replace final manual binding edits with confirmation invocation and its required fresh outcomes.
- `references/artifacts.md`, affected skill allow-lists, setup guidance and extension READMEs: describe preparation/validation ownership and the new local tools once at the owning boundary.
- `references/integrations/shared.md`, tracker/forge references, deliverable completion/submission guidance and integration README/context output: call `render_provider_body` with the complete approved source and publish its exact output; remove repeated root-heading, wrapper, separator, escaping and closing-reference algorithms.

Keep source Markdown shape/Overview authoring requirements, complete-content preservation, disclosure approval, substantive-change approval, native MCP permissions, provider uncertainty recovery, and review/user-diff gates. User-facing layout summaries may remain where they help users. Source artifacts remain provider-neutral. Existing renderer output stays byte-for-byte unchanged and its tests—not prose replicas—own formatting examples.

Simplify integration-context rendering descriptions as well as Markdown, so removed algorithm text is not reinjected on every tool call. Tool descriptions carry invocation and input/output contracts, not another copy of the implementation. Keep detailed shared-operation input contracts at their owning tool/reference rather than recreating algorithms in each caller.

## Verification and completion

Baseline before implementation: 64 tests passed across project configuration, Phase, Resource ID operations, provider-body rendering and instruction ownership; `npx tsc --noEmit` passed.

Add focused operation tests for every authority/provider/entity variant and both artifact modes, success/no-op/rejection rows, unrelated-state preservation, validation-before-write, pending Linear branch handling, binding intent removal, and normalized fact mismatches. Adapter tests capture registered tools and prove no provider invocation or implicit lifecycle transition. Verify the new domain modules import without Pi runtime initialization and have no Pi runtime dependencies.

Extend persistence tests to warm reuse and invalidation after index additions/removals/replacement, HEAD changes with an unchanged index, ignore/exclude/config/local-setting changes, alternate index paths and linked-worktree paths. Retain all current no-index-mutation, staged-deletion, unversioned membership and mode-reversal tests. Use real Git operations for invalidation tests. Do not weaken safety assertions to meet a performance goal.

Update instruction tests to assert current operation invocation, reachable ownership contracts and preserved safety/approval rules rather than literal code-owned formatting recipes. Keep provider-body golden tests unchanged. Confirm no broadened MCP allow rules or provider transport changes.

Run focused new/affected tests, `npm test`, `npx tsc --noEmit`, a scoped formatting check for changed code, and `git diff --check`. Repeat the read-only persistence probe and record its actual counts/timings. Check the final documentation inventory for remaining mechanics; report actual simplifications without claiming an unsupported line-count saving.

No live provider mutations are needed to test this refactor; ordinary tracker updates for this Gig remain separate workflow housekeeping. Complete a synchronized `result.md` with actual implementation, verification and limitations, then follow final review and user acceptance before submission.
