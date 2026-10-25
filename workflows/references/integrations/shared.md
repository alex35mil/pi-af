# Integration roles

There are two optional integration roles:

- **tracker:** external work items, Backlog and Todo queues, lifecycle, Priority, hierarchy, and publication of accepted plans;
- **forge:** pull requests.

Either may be absent. The `.project/` artifacts stay authoritative in both artifact modes.

- An enabled role means it's configured, not that its provider tools have been probed. For each enabled role, follow its provider reference.
- Tracker lifecycle and Priority never fall back to workflow authority.
- The [MCP boundary](../core.md#mcp-boundary) and [outcome rules](../core.md#outcomes-and-recovery) apply to every provider call. When changing Phase, read [Phase](../phase.md).

**Durable checkpoints** exist only for non-idempotent creation or provisioning, duplicate-creation risk, or a user choice that can't be recovered elsewhere. Lifecycle and Priority updates on a bound object, and updates to an established publication, create none; recover them by reading provider state and retrying the absolute value. The first plan comment or document saves a pending token before its create.

## Operations and Resource IDs

### Context tools

These tools read local configuration, authority, and entity state. They never call providers.

| Situation | Tool |
| --- | --- |
| Inspect configuration | `inspect_integrations`, with `target` |
| Queue intake (choose entity, Priority, and Kind first) | `inspect_queue_intake`, with `target` |
| Adopt explicitly selected work | `inspect_adoption` |
| Start or resume an initialized entity | `initialize_integration`, `resume_integration` |
| Publish an accepted plan (tracker only) | `prepare_integration_projection` |
| Submit a PR (forge only) | `prepare_integration_pull_request` |
| Correct labels, lifecycle, Priority, or Task hierarchy (tracker only) | `prepare_tracker_mutation` |
| Reconcile native Phase | `prepare_github_phase_mutation`, `prepare_linear_phase_mutation`, with the fresh facts in [Phase](../phase.md#fresh-native-facts) |
| Ship a Task or Gig | `prepare_integration_shipping`, then `prepare_integration_merge` only when a merge is needed |

- `target: "current"` covers ordinary work. `target: "workflow"` is only for workflow-problem reports through Todo; when reporting, read [queue](../queue.md#prepare-a-workflow-report). Use the returned tracker and artifact policy.
- The returned local `projectRoot` is never report content. Missing or invalid source configuration stops with a corrective error, without starting setup or falling back.
- `prepare_integration_merge` takes the PR read as `evidence` and checks the recorded PR number, repository, head, base, and local branch SHA. It returns squash-merge arguments pinned to the head, complete merged proof, or a blocker.

**Evidence and validation:**

- Provider references own the call procedures. Use approved content, configured names, recorded IDs, and required live responses directly.
- Evidence is the actual decoded provider object or the complete native MCP result. The MCP layer extracts structured content or one JSON text block and rejects errors or ambiguous results.
- The harness validates its own inputs, configuration, and delivery evidence, not provider tool schemas.

### Resource IDs

`.local/metadata.json` is strict and local in both artifact modes. Its root is `{ entityId, resourceIds }`, and each entry stores IDs and URLs under an exact scope: entity, server, repository, Project, team, object, or head and target. Lifecycle, Priority, labels, bodies, branch names, and merge state are never cached; they're live or authoritative facts.

| Object | Durable identity and progress | Local Resource IDs |
| --- | --- | --- |
| GitHub tracker issue | repository and issue number; pending creation or initialization work; plan-comment state | numeric issue ID and URL; the configured Project-item ID |
| Linear Project | Project UUID; pending work; plan-document state | URL |
| Linear issue | issue UUID; a Task's parent Project UUID; branch contract; plan-document state | identifier and URL |
| GitHub PR | immutable versioned repository, head, and target intent | current PR number and URL |

- **`resolve_resource_ids`** reads the operation memo or scoped cache and reports missing IDs without calling providers.
- **`record_resource_ids`** validates a required read, or a clear-success mutation, before caching.
- **`invalidate_resource_ids`** removes only IDs the provider proved stale. A scope mismatch drops only that entry; access or network errors keep it.
- **Missing, stale, or malformed data:** investigate through the configured tracker or forge tools, then record the actual evidence. Reuse required live facts from that response; never read just to fill the cache.
- **Memo:** each context request starts a fresh addressing memo, and shutdown or reload discards it. Lifecycle and merge reads always use current facts.

### Creation checkpoints

- **Tracker initialization:** `begin_resource_creation` records the attempted create under its approval.
- **PRs:** `begin_resource_creation` saves only the immutable repository, head, and target intent, before staging the last Deliverable commit; commit that change with the work. Then make one native create, and pass clear-success evidence to `record_resource_creation`, which saves the number and URL in the local IDs file. When choosing an existing PR, `select_pull_request_resource` records the user's choice in the same file.
- Recording never changes versioned metadata. Existing intent or an uncertain outcome needs investigation, never a blind replacement.
- Adoption and mutations seed IDs they already have. Queued work keeps IDs only during its own operation.

Saved-data rejections follow [core migrations](../core.md#saved-data-migrations).

## Confirm initialized tracker outcomes

After the provider's initialization steps succeed, call the confirmation tool for the configured provider and artifact mode: `confirm_versioned_github_tracker`, `confirm_unversioned_github_tracker`, or `confirm_linear_tracker`.

- Pass `entityDir` and `facts` from this operation's reads or clear-success mutations. Reuse proof you already have; don't add routine confirmation reads.
- The tool checks the facts against the pending approved intent and completes the binding. It calls no providers, doesn't verify freshness on its own, records no Resource IDs, and provisions no branches.
- Missing or conflicting facts leave the binding pending; investigate through the configured MCP tools.
- It returns `changed`. An already-bound object is a local no-op. Branch naming and finalization, and creation and Resource ID recording, stay at their own steps.

Every confirmation needs native `lifecycle`, `priority`, and `phase` facts ([Phase](../phase.md#fresh-native-facts)). The rest depends on provider and mode:

| | Required facts | Priority | System metadata |
| --- | --- | --- | --- |
| Versioned GitHub | `repository`, `issueNumber`, configured `project` (`owner`, `ownerType`, `number`), observed `itemId`, and `parentIssueNumber` for a Task | configured value or `not set` | `{ labels, internalId: { scope, field, value } }` with the complete observed labels and the Internal ID outcome |
| Unversioned GitHub | same as versioned | same | none |
| Linear | `resource: project \| task-issue \| gig-issue`, the object UUID as `id`, configured `team`, and `projectId` for a Task | native 0–4 | `{ mode: versioned \| unversioned }` matching configuration; no embedded workflow ID |

Omit `parentIssueNumber` or `projectId` only when the relationship was observed to be absent. A binding completes only for a pending, identified object with matching In Progress and Planning, copied Priority, relationships, and applicable system metadata. For Linear, the UUID and relationships are the binding identity.

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
2. **Unversioned mode:** first remove or minimally rewrite only the forbidden content (below), in both visible and folded parts. Show the full sanitized candidate or exact diff, explain each change, and get approval before rendering. Folding is not a privacy boundary.
3. **Tracker plans:** call `prepare_tracker_publication` with `entityDir` and the full approved source.
   - Run its returned mutation immediately, in the same step. The first call for an unpublished plan already saves pending state before it returns. Never call it again just to look at the output. A second call returns `recovery-required`, and when nothing was posted, recovery can't proceed without the maintainer (#87).
   - Record a first creation with `record_tracker_publication`, passing the actual call as `evidence`.
   - For a published Linear document, preparation asks for verification reads. Read the saved document and its bound issue or Project, then call `prepare_tracker_publication_update` with `source`, `document`, and `parent` evidence. The parent read maps the native display identifier to the bound UUID. Run the returned update by document ID only, never with parent or title arguments.
   - A missing, moved, archived, or conflicting document stops for maintainer direction, never reattachment or replacement.
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

**Publication state:**

- GitHub keeps plan-comment identity in `planComment`; Linear keeps plan-document identity in `planDocument`. They're not disposable Resource IDs.
- Each is `unpublished` before the first attempt, `pending` with an opaque token before creation, then `published` with that token and the confirmed native ID and URL.
- Markers and signatures stay out of source artifacts.
- New issues use the approved title and Request; later publication leaves those fields alone. Resume reuses saved state and never republishes on its own.

### Unversioned disclosure

**May be projected:**

- an opaque publication marker with no internal identity;
- the approved title, and the approved Request during initialization;
- the accepted plan after planning;
- native lifecycle, native Phase (Planning, Execution, Self-Review), and Priority;
- native hierarchy and Project relationships;
- the exact provider branch name;
- an explicitly approved PR reference.

**Never projected:**

- qualified workflow IDs;
- `.project` paths or links;
- entity or kind labels and types;
- workflow or review terminology beyond native Phase;
- review artifacts;
- raw workflow artifact structure.

Ordinary repository implementation paths aren't private. The same attribution footer, carrying only the harness and the configured provider and model, applies in both modes.

## Branch gate

- A ready branch contract has exact `name`, `start`, `target`, and a generated or tracker source.
- A Linear `tracker` Epic is ready once current branch settings are reconstructed.
- A Linear Task or Gig passes through `tracker-pending`, `tracker-named` (the saved name), and `provisioning` (name and start commit) before ready. Save a returned name before creating its local branch. Generated names need no provider branch.
- Don't plan, review, push, or create a PR until `finalize_linear_branch` returns a ready contract. Never invent or rewrite a provider-generated name.

## Workflow-first updates

For initialized entities, update workflow kind, `phase`, and artifacts first.

- Workflow authority keeps Priority in `metadata.authority` and lifecycle in `.local/status.md`. Tracker authority uses native Status and Priority, with no `.local/status.md`.
- For a bound tracker object, read the required fresh values, then set only the intended absolute lifecycle, Priority, or changed labels. Verify required outcome facts that a clear-success response didn't include. Reconcile uncertain or partial results before retrying.
- Versioned GitHub reconciles the managed Kind label from workflow metadata. Unversioned GitHub and Linear keep Kind in workflow artifacts only.
- A provider failure never rolls back workflow artifacts.

Adding work to Backlog or Todo creates no workflow artifact or saved recovery state. Recover uncertain results by reading provider state.
