# Integration roles

Every project configures both integration roles:

- **tracker** (GitHub or Linear): external work items, Backlog and Todo queues, lifecycle, Priority, hierarchy, and publication of accepted plans. Its object is the entity's identity.
- **forge** (GitHub): pull requests.

The local entity artifacts stay authoritative for everything else.

- A configured role isn't proof its provider tools are available. Follow each role's provider reference.
- Lifecycle and Priority live only on the tracker; nothing local replaces them.
- The [MCP boundary](../core.md#mcp-boundary) and [outcome rules](../core.md#outcomes-and-recovery) apply to every provider call. When changing Phase, read [Phase](../phase.md).

**Durable checkpoints** exist only for non-idempotent creation, duplicate-creation risk, or a user choice that can't be recovered elsewhere. Lifecycle, Priority, and board updates, and updates to an established publication, create none; recover them by reading provider state and retrying the absolute value. The first plan comment or document saves a pending token before its create; a PR saves its intent before its create.

## Operations and Resource IDs

### Context tools

These tools read local configuration, authority, and entity state. They never call providers.

| Situation | Tool |
| --- | --- |
| Inspect configuration | `inspect_integrations`, with `target` |
| Queue intake (choose entity, Priority, and Kind first) | `inspect_queue_intake`, with `target` |
| Adopt explicitly selected work | `inspect_adoption` |
| Set up the board for a new entity, or resume one | `initialize_integration`, `resume_integration` |
| Publish an accepted plan (tracker only) | `prepare_integration_projection` |
| Submit a PR (forge only) | `prepare_integration_pull_request` |
| Correct labels, lifecycle, Priority, or Task hierarchy (tracker only) | `prepare_tracker_mutation` |
| Reconcile native Phase | `prepare_github_phase_mutation`, `prepare_linear_phase_mutation`, with the fresh facts in [Phase](../phase.md#fresh-native-facts) |
| Ship a Task or Gig | `prepare_integration_shipping`, then `prepare_integration_merge` only when a merge is needed |

- `target: "current"` covers ordinary work. `target: "workflow"` is only for workflow-problem reports through Todo; when reporting, read [queue](../queue.md#prepare-a-workflow-report). Use the returned tracker configuration.
- The returned local `projectRoot` is never report content. Missing or invalid source configuration stops with a corrective error, without starting setup or falling back.
- `prepare_integration_merge` takes the PR read as `evidence` and checks the recorded PR number, repository, head, base, and local branch SHA. It returns squash-merge arguments pinned to the head, complete merged proof, or a blocker.

**Evidence and validation:**

- Provider references own the call procedures. Use approved content, configured names, recorded IDs, and required live responses directly.
- Evidence is the actual decoded provider object or the complete native MCP result. The MCP layer extracts structured content or one JSON text block and rejects errors or ambiguous results.
- The harness validates its own inputs, configuration, and delivery evidence, not provider tool schemas.

### Resource IDs

`resource-ids.json` is strict and local. Its root is `{ entity, resourceIds }`, where `entity` is the entity's directory name, and each entry stores IDs and URLs under an exact scope: entity, server, repository, Project, team, object, or head and target. Lifecycle, Priority, labels, bodies, branch names, and merge state are never cached; they're live or authoritative facts.

| Object | Durable identity and progress | Local Resource IDs |
| --- | --- | --- |
| GitHub tracker issue | repository and issue number; plan-comment state | numeric issue ID and URL; the configured Project-item ID |
| Linear Project | Project UUID; plan-document state | URL |
| Linear issue | issue UUID and identifier; a Task's parent Project UUID; plan-document state | identifier and URL |
| GitHub PR | immutable repository, head, and target intent | current PR number and URL |

- **`resolve_resource_ids`** reads the operation memo or scoped cache and reports missing IDs without calling providers.
- **`record_resource_ids`** validates a required read, or a clear-success mutation, before caching.
- **`invalidate_resource_ids`** removes only IDs the provider proved stale. A scope mismatch drops only that entry; access or network errors keep it.
- **Missing, stale, or malformed data:** investigate through the configured tracker or forge tools, then record the actual evidence. Reuse required live facts from that response; never read just to fill the cache.
- **Memo:** each context request starts a fresh addressing memo, and shutdown or reload discards it. Lifecycle and merge reads always use current facts.

### PR creation

`begin_resource_creation` saves only the immutable repository, head, and target intent in `metadata.json`. Then make one native create, and pass clear-success evidence to `record_resource_creation`, which saves the number and URL in the local IDs file. When choosing an existing PR, `select_pull_request_resource` records the user's choice in the same file.

- Recording never changes `metadata.json`. Existing intent or an uncertain outcome needs investigation, never a blind replacement.
- Initialization and mutations seed IDs they already have. Queued work keeps IDs only during its own operation.

## Initialize from the tracker object

The tracker object comes first; the local entity is named from it. New work and adoption end in the same initialization call.

1. **Preflight new work.** Call `preflight_epic` or `preflight_gig` with the approved values. A Task never creates its object; it adopts the issue its parent's [Task issue processing](../epic-tasks.md#task-issue-processing) created. It runs every local check that doesn't need the tracker object and changes nothing. A failure stops before anything is created on the tracker.
2. **Get the object.**
   - New work: create only the tracker object, with the approved title and Request, as the provider reference describes. No search first.
   - Adoption: use the explicitly selected object after its provider preflight.
3. **Initialize.** Call `init_github_<entity>` or `init_linear_<entity>` with the object's identity as `object`. It names the directory and branch from the object, creates the local entity with a ready branch, and records the object's Resource IDs.
4. **Set up the board.** Call `initialize_integration`, then apply the provider reference's board steps: Project membership, In Progress, Priority, Planning Phase, Task hierarchy, and the Kind label when configured. These are ordinary absolute updates; a failure is reconciled on resume.

**When something fails:**

- **Uncertain create:** nothing local exists yet. Before any new create for the same intake, search the tracker for the exact approved title ([recovery](./recovery.md#uncertain-tracker-creation)). One match continues at step 3; none allows a retry; several stop for the user.
- **Initialization fails after a clear create:** never create again. Report the created object and the failure, fix the cause (for example a name collision), and call initialization again with the same object.
- **Board setup incomplete on resume:** read fresh Project membership, Status, Priority, and Phase, and apply what's missing. When native Priority is unset, ask the user for it; it isn't kept locally.

## Provider bodies

**Sources:**

- `prepare_integration_projection` needs only the tracker role. It publishes the accepted `epic.md` or `plan.md`.
- PR bodies use the synchronized `result.md` or `report.md`.
- The tracker item keeps its original request in its title or name and description. GitHub publishes the plan as one managed issue comment, the same for new and adopted issues. Linear publishes it as one document attached to the issue or Project.

**Ownership and discussion:**

- The accepted artifact owns the content; the publication layer owns the attribution footer.
- Discussion, feedback, screenshots, logs, and supporting links go in separate comments. Requirements and agreed decisions go in the accepted artifact.
- Before adopting queued work, and whenever reconciling requirements, read the object's full discussion through registered tools, with complete pagination. Resolve material questions with the maintainer before initialization or a plan change. Contributor comments don't authorize scope changes on their own.

### Attribution

- Code signs AI-assisted communication sent through the official GitHub and Linear MCP registrations: GitHub gets a final `<sub>` paragraph, Linear gets italics, with no added divider. This covers initialization, queues, publication, and comments.
- Never add signatures yourself, and keep them out of repository artifacts. The signature is the only change made to approved content.
- Set `__pi_authorship: "user-verbatim"` automatically when you relay a complete user-written message unchanged; no opt-out wording is needed. Code keeps that text byte-for-byte and strips the field before sending.
- Use the default `ai-assisted` for anything you compose, reword, expand, or wrap around a quote. The mode applies per call. Metadata-only operations are unchanged.
- Edits need the complete text. Patch-only or template-only writes need explicit registered reads and a full-text write; signing never makes hidden provider calls.

### Publishing

1. **Start from the full approved source** in the [reviewed document shape](../artifacts.md#reviewed-document-shape). Never summarize or condense during publication.
2. **Local references:** published text never points readers at ignored files under `.project/.local/` ([communication](../communication.md)).
3. **Tracker plans:** call `prepare_tracker_publication` with `entityDir` and the full approved source.
   - Run its returned mutation immediately, in the same step. The first call for an unpublished plan already saves pending state before it returns. Never call it again just to look at the output; a second call returns `recovery-required` and needs recovery reads.
   - Record a first creation with `record_tracker_publication`, passing the actual call as `evidence`.
   - `reads-required`: run the returned reads, then call `prepare_tracker_publication_update` with the source and those reads. Linear documents always need them; the parent read maps the display identifier to the bound UUID. Run a Linear update by document ID only, never with parent or title arguments.
   - A missing, moved, archived, or conflicting document stops for maintainer direction, never reattachment or replacement.
   - Updates to a published Epic plan are [announced](#epic-plan-announcements).
4. **PR bodies:** call `render_provider_body` with `destination: pullRequest` and publish its returned Markdown unchanged.
5. **Rendering:** `projection.ts` owns presentation and closing references.
   - GitHub plans render `# Plan`, the overview prose, `## Highlights`, and a folded Full plan.
   - Linear's native document title is Plan; the content is the overview prose, `## Highlights`, and a native folded Full plan, with no repeated H1.
   - Source headings and PR presentation are unchanged.
6. **No second approval** is needed for deterministic renderer output, the opaque publication marker, or code-owned attribution. Any substantive omission, rewrite, addition, or new summary needs the full-candidate or exact-diff approval again. An incompatible source fails locally; fix and re-approve the source first.
7. **Publish** the complete body only to its destination: the managed GitHub comment, the attached Linear document, or the PR body.
   - Trust a clear provider success without an echo, comparison, or confirmation read. Linear's pre-update parent check is a separate scope check.
   - Provider Markdown normalization never justifies rewriting the source.
8. **Uncertain updates and pending creates:** read [recovery](./recovery.md#pending-plan-publication).

The same contract applies when an open PR's synchronized `result.md` or `report.md` changes.

### Epic plan announcements

Editing a published plan notifies nobody, so every update to a published Epic plan also posts one discussion comment on the Epic: a GitHub issue comment, or a Linear Project comment. The first publication isn't announced.

1. **Draft** a short summary of what changed in the contract and why. Show it with the `epic.md` diff; accepting the diff approves the plan update and the announcement together.
2. **Prepare.** `prepare_tracker_publication` returns `reads-required` for a published Epic plan. Pass the reads to `prepare_tracker_publication_update` with `announcement`: the summary and its origin, the Task's `entityDir` or `epic`.
3. **Rendering** is code-owned: the origin, the summary, a link to the plan, and a folded diff of the published plan against the new one. An oversized diff is left out.
4. **Run** the returned plan update, then record its clear success with `record_tracker_publication`. That returns the announcement comment; run it and record it the same way.
5. **Until it's recorded**, every publication of that Epic returns the pending announcement. When the outcome is uncertain, read [recovery](./recovery.md#pending-announcement).

Identical source returns `unchanged`; nothing is published or announced.

**Publication state:**

- GitHub keeps plan-comment identity in `planComment`; Linear keeps plan-document identity in `planDocument`. They're not disposable Resource IDs.
- Each is `unpublished` before the first attempt, `pending` with an opaque token before creation, then `published` with that token and the confirmed native ID and URL.
- Markers and signatures stay out of source artifacts.
- New issues use the approved title and Request; later publication leaves those fields alone. Resume reuses saved state and never republishes on its own.

## Branch contract

Every initialized entity has a ready branch contract: exact `name`, `start`, `target`, and a generated or tracker source. With Linear's `tracker` format, a Task or Gig uses the issue's exact `gitBranchName` and an Epic uses its dated directory name. Never invent or rewrite a provider-generated name.

## Workflow-first updates

For initialized entities, update workflow kind, `phase`, and artifacts first.

- Lifecycle and Priority are native tracker Status and Priority.
- For the tracker object, read the required fresh values, then set only the intended absolute lifecycle, Priority, or changed labels. Verify required outcome facts that a clear-success response didn't include. Reconcile uncertain or partial results before retrying.
- With configured GitHub Kind labels, keep the one managed Kind label in step with the workflow kind. Linear gets no Kind label.
- A provider failure never rolls back workflow artifacts.

Adding work to Backlog or Todo creates no workflow artifact or saved recovery state. Recover uncertain results by reading provider state.
