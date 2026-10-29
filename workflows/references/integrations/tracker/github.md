# GitHub tracker

This procedure extends [integration roles](../shared.md). Read configuration through the context tools, then call the configured registered tools. Setup validates configuration fully; ordinary operations inspect only the fields and labels they need. When reconciling Phase, read [Phase](../../phase.md). Never enumerate unrelated provider metadata.

## Adopt selected queued work

Adoption applies only to an explicitly selected existing issue, before initialization.

1. Call `inspect_adoption` with the selected `entity`.
2. Read the configured repository and issue number to get:
   - title, description, URL, and labels;
   - issue-scoped Priority, when Priority is issue-scoped;
   - for a Task, its parent: it must be a sub-issue of the parent Epic's issue.

   Reuse facts already returned together.
3. Read every discussion page. Treat contributor messages as proposals and evidence, and resolve material requirements with the maintainer before changing scope.
4. Find the issue's item in the configured Project, requesting only the Status and Priority fields. Complete pagination, then verify:
   - repository and issue number;
   - the numeric Project-item ID;
   - Status is Backlog or Todo;
   - Priority is a configured value, or `not set` when empty.

   The Project item can supply a numeric issue ID that the issue read omits.
5. Under the explicit-selection approval in [artifacts](../../artifacts.md#initialization-inputs), reuse the title, description, copied Priority, and any configured Kind without another confirmation. A Task's Kind comes from its plan section. Ask only for missing or conflicting information.
6. Call `init_github_epic`, `init_github_task`, or `init_github_gig` with the numeric issue ID, number, URL, and Project-item ID as `object`.

**Stops adoption:** the wrong repository, Project, or parent, a non-queue Status, ambiguity, denied access, or an unconfigured Priority.

**Kind:** a single configured Kind label on the issue becomes the initialized Kind unless the user changes it. Missing or conflicting Kind needs a user choice. After initialization, workflow metadata owns Kind.

## Initialize

Follow [initialize from the tracker object](../shared.md#initialize-from-the-tracker-object).

**Create new work** (after preflight):

- One registered `issue_write` create with the approved title and Request, the Kind label when Kind labels are configured, and issue-scoped Priority. Task issues come only from [Task issue processing](../../epic-tasks.md#task-issue-processing).
- No duplicate, label, or option preflight. Pass the returned numeric ID, number, and URL to `init_github_<entity>` as `object`. A minimal ID-and-URL success isn't automatically uncertain.

**Board setup** (after initialization, for new and adopted work):

1. Add the issue to the configured Project unless that's already proven, and record the returned IDs with `record_resource_ids`.
2. Set In Progress, Priority, and Planning in the Phase field with Project writes addressed by the issue. Combine supported issue-field writes.
3. Reuse labels and parent assignment proven at creation. Otherwise read current labels or hierarchy, keep unrelated labels, and call `prepare_tracker_mutation` with `change: labels`, or Task-only `hierarchy`, only when a correction is needed.

A clear success proves only what that tool's contract returns; read required missing facts and reconcile partial outcomes. Adopted Backlog or Todo work moves straight to In Progress, keeping the same issue and its Priority.

When a create result is uncertain, read [recovery](../recovery.md#uncertain-tracker-creation).

## Resume and mutations

1. Call `resume_integration` with `entityDir`, then read fresh Project membership, Status, Priority, and Phase. Finish any board setup that's missing; ask the user for Priority when it's unset.
2. Reconcile Phase against the Project field definition and current selection. A cached Project-item ID reaches the current fields directly; that response must confirm the issue and Project.
3. Investigate missing or confirmed-stale Resource IDs through the configured tools, and record the actual response afterward. Network or permission errors don't prove absence. Ordinary resume never discovers PRs.

**What's projected:**

- Native Phase exists only during In Progress and equals the metadata Phase.
- With configured Kind labels, exactly one managed Kind label matches the workflow Kind; without them, no Kind is projected.
- Keep unrelated labels. Reuse this operation's reads and write only when the intended set differs. Confirm labels when a mutation's success doesn't show the full applied set; no full label-catalog preflight is needed.

**Changing values:**

- Use `prepare_tracker_mutation` with exactly one change: `labels`, `lifecycle`, `priority`, or Task `hierarchy`.
- For Phase, use `prepare_github_phase_mutation` with fresh facts and apply only a changed field value.
- Priority follows its configured Project or issue scope.
- Lifecycle and Priority are provider authority: never cached and never replaced by a local fallback.

## Queue and plan publication

**Queue intake** follows [queue](../../queue.md). Queued work has no workflow artifact, cache, or checkpoint. Create the issue with no Phase, the `kindLabel` that `inspect_queue_intake` returns (none when it's null), and set the selected Status and Priority.

**Plan publication:**

- The issue keeps its original title and description. New work creates them from the approved Request; adopted work keeps the existing text.
- For an accepted `epic.md` or `plan.md`, call `prepare_integration_projection`, then `prepare_tracker_publication` with `entityDir` and the full source. Approval follows [provider bodies](../shared.md#provider-bodies).
- Run the returned comment call, never an issue body or title update.
- The first publication saves `planComment: pending`, then returns one `add_issue_comment`. Run it immediately, then record it with `record_tracker_publication`.
- Once published, updates first read the issue's comments, then use `update_issue_comment` on that same comment. Every update also posts an [announcement](../shared.md#plan-update-announcements) as a new issue comment.
- A pending attempt returns `recovery-required`; read [recovery](../recovery.md#github-comment).
- Don't read just to confirm a successful update. Plan-comment state lives in authoritative metadata, and Resource IDs and Phase are unaffected.
- Resume reuses saved state and never republishes on its own.
