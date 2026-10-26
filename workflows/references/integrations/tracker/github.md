# GitHub tracker

This procedure extends [integration roles](../shared.md). Read configuration through the context tools, then call the configured registered tools. Setup validates configuration fully; ordinary operations inspect only the fields and labels they need. When reconciling Phase, read [Phase](../../phase.md). Never enumerate unrelated provider metadata.

## Adopt selected queued work

Adoption applies only to an explicitly selected existing issue, before initialization.

1. Call `inspect_adoption` with the selected `entity`.
2. Read the configured repository and issue number to get:
   - title, description, URL, and labels;
   - issue-scoped Priority, when Priority is issue-scoped;
   - Task hierarchy evidence.

   Reuse facts already returned together.
3. Read every discussion page. Treat contributor messages as proposals and evidence, and resolve material requirements with the maintainer before changing scope.
4. Find the issue's item in the configured Project, requesting only the Status and Priority fields. Complete pagination, then verify:
   - repository and issue number;
   - the numeric Project-item ID;
   - Status is Backlog or Todo;
   - Priority is a configured value, or `not set` when empty.

   The Project item can supply a numeric issue ID that the issue read omits.
5. Under the explicit-selection approval in [artifacts](../../artifacts.md#initialization-inputs), reuse the title, description, copied Priority, and any configured Kind without another confirmation. Ask only for missing or conflicting information.
6. Call `adopt_github_epic`, `adopt_github_task`, or `adopt_github_gig` with the numeric issue ID, number, URL, and Project-item ID as `source`. Repository and issue number become durable; the other values are seeded locally.

**Stops adoption:** the wrong repository, Project, or parent, a non-queue Status, ambiguity, denied access, or an unconfigured Priority.

**Kind:**

- A single configured queue Kind becomes the initialized Kind unless the user changes it. Missing or conflicting Kind needs a user choice.
- After initialization, workflow metadata owns Kind.

Skip creation, membership, and hierarchy work that is already proven.

## Initialize

The initialization tool records Planning and In Progress intent, with `awaiting` for new work or `bound-pending` for adopted work. Call `initialize_integration` with the `entityDir`.

**New work:**

1. **Build one issue create** with the approved title and Request.
   - Include the Task parent issue number.
   - Include issue-scoped Priority. A Task parent and issue fields can't share the create call, so for Tasks set Priority afterward.
2. **Create.** Call `begin_resource_creation` with role `tracker`, then call the registered issue create under approval. No duplicate, label, or option preflight.
3. **Record.** On clear success, call `record_resource_creation` with the actual call as `evidence`. It saves the repository and issue number before dependent work and caches the ID and URL. A minimal ID-and-URL success isn't automatically uncertain.
4. **Project membership.** Add the issue to the configured Project and record the returned IDs with `record_resource_ids`.
   - Set In Progress and Priority with Project writes addressed by the issue.
   - Set Planning in the Phase field.
   - Combine supported issue-field writes. Don't refetch just to fill the cache.
   - A clear success proves only what that tool's contract returns; read required missing facts and reconcile partial outcomes.
5. **Labels and hierarchy.** Reuse labels and parent assignment proven at creation. For an adopted issue or an unproven correction, read current labels or hierarchy, keep unrelated labels, and change only differences. Call `prepare_tracker_mutation` with `change: labels`, or Task-only `hierarchy`, only when a correction is needed. The numeric child issue ID can come from Project evidence.
6. **Confirm.** Call `confirm_github_tracker`, as described in [confirmation](../shared.md#confirm-initialized-tracker-outcomes). Missing evidence keeps initialization pending. Never complete it by editing metadata by hand or storing provider snapshots.

Adopted Backlog or Todo work moves straight to In Progress, keeping the same issue and its Priority. A proven Project addition and parent relationship aren't repeated.

When a create result is uncertain, read [recovery](../recovery.md#uncertain-tracker-creation).

## Resume and mutations

1. Call `resume_integration` with `entityDir`, then read fresh Status, Priority, and Phase.
2. Reconcile Phase against the Project field definition and current selection. A cached Project-item ID reaches the current fields directly; that response must confirm the issue and Project.
3. Investigate missing or confirmed-stale Resource IDs through the configured tools, and record the actual response afterward. Network or permission errors don't prove absence. Ordinary resume never discovers PRs.

**What's projected:**

- Native Phase exists only during In Progress and equals the metadata Phase.
- No Kind is projected.
- Keep unrelated labels. Reuse this operation's reads and write only when the intended set differs. Confirm labels when a mutation's success doesn't show the full applied set; no full label-catalog preflight is needed.

**Changing values:**

- Use `prepare_tracker_mutation` with exactly one change: `labels`, `lifecycle`, `priority`, or Task `hierarchy`.
- For Phase, use `prepare_github_phase_mutation` with fresh facts and apply only a changed field value.
- Priority follows its configured Project or issue scope.
- Lifecycle and Priority are provider authority: never cached and never replaced by a local fallback.

## Queue and plan publication

**Queue intake** follows [queue](../../queue.md). Queued work has no workflow artifact, cache, or checkpoint. Create the issue with no Kind label or Phase, and set the selected Status and Priority.

**Plan publication:**

- The issue keeps its original title and description. New work creates them from the approved Request; adopted work keeps the existing text.
- For an accepted `epic.md` or `plan.md`, call `prepare_integration_projection`, then `prepare_tracker_publication` with `entityDir` and the full source. Sanitization and approval follow [provider bodies](../shared.md#provider-bodies).
- Run the returned comment call, never an issue body or title update.
- The first publication saves `planComment: pending`, then returns one `add_issue_comment`. Run it immediately, then record it with `record_tracker_publication`.
- Once published, preparation always returns `update_issue_comment` for that same comment.
- A pending attempt returns `recovery-required`; read [recovery](../recovery.md#github-comment).
- Don't read just to confirm a successful update. Plan-comment state lives in authoritative metadata, and Resource IDs and Phase are unaffected.
- Resume reuses saved state and never republishes on its own.
