# Workflow artifacts

This is the agent-facing map of workflow directories, file meanings, and persistence. Paths are repository-relative. Read [Workflow tool discovery](./tools.md) for the native deferred-operation catalog and exact input conventions. The entity initialization tools create entity directories, `.local/` working state, `brief.md`, `metadata.json`, and `.local/notes.md`; Task/Gig initialization also creates `.local/pending.md`, while `.local/status.md` exists only without a tracker. Planning, execution, and review create the remaining files when their lifecycle gate is reached.

## Terminology

- A **tracker** is an external work system: GitHub Projects or Linear.
- Artifact Git policy is **versioned** or **unversioned**. Versioned artifacts belong in Git; unversioned artifacts stay outside Git.
- General Git membership is **in Git** or **outside Git**. Use **staged**, **unstaged**, **gitignored**, and **committed** for the corresponding Git states.
- **Local** describes files that always remain outside Git, including `.local/**`, `.project/config.local.json`, and `.agents/*.local.json`.
- Without a tracker, lifecycle and Priority use **workflow authority**. With a tracker, they use **tracker authority**.

Use these terms exactly across schemas, code, tests, agent guidance, and user documentation.

## Initialization inputs

Initialization tools validate artifact persistence before creating artifacts. For resume, resolve the selected entity directory and call local `resume_integration` with its `entityDir` before reading or editing its artifacts, including trackerless work. This validates persistence and entity compatibility; then read the artifacts below. Stop on invalid configuration, unsafe Git membership, or an incomplete persistence-mode reversal. Use `prepare_artifacts` for setup or a reported missing preparation requirement, then retry the validation; it does not repair tracked membership.

Resume only an explicitly identified entity path, qualified ID, or uniquely identifiable existing entity. Resolve exactly one entity of the requested type; never initialize replacement work during resume.

Before initialization, establish the title, standalone Request, exact Priority (a configured value or `not set`), and whether to create new tracker work or adopt one explicit Backlog or Todo object. Task/Gig also require a Deliverable kind; Task requires the parent and accepted plan item specified by its skill. For new work, obtain Priority and approval of the intake values. Explicit selection of a Backlog or Todo object authorizes adoption using its existing title or name, description, Priority, and available workflow Kind after the selected provider's read-only preflight. Ask only for missing or conflicting information, including Kind or the Task relationship when unresolved. Do not infer adoption from vague discussion.

Clean the proposed title and standalone Request for durable reading:

- correct spelling, capitalization, punctuation, sentence boundaries, and clearly accidental formatting;
- preserve the user's meaning, intent, scope, emphasis, uncertainty, and level of detail;
- preserve exact code, commands, identifiers, paths, URLs, API names, product names, and quoted text;
- do not add requirements, facts, rationale, acceptance criteria, or technical decisions;
- when a possible correction could change meaning, keep the original wording and ask the user.

For new work, synthesize the Request from the user's input and agreed clarifications. The `/epic`, `/task`, and `/gig` handlers place their command argument between a generated `Epic:`, `Task:`, or `Gig:` label and a trailing skill-routing instruction such as `Use the gig skill.`; the command argument is the user input, while the generated label and instruction are workflow control text.

A tracker item is the provider-native record representing an entity. Current adapters use a GitHub issue for every entity, a Linear Project for an Epic, and a Linear issue for a Task or Gig. For adopted tracker work, use the selected tracker's title or name as the title and its title or name and description as the standalone Request, incorporating agreed clarifications and the meaning-preserving cleanup above. The explicit selection supplies intake approval; proceed to the matching entity/provider adoption tool without a separate confirmation of those existing values. Ask before changing meaning, scope, Priority, or Kind.

For new work, present the cleaned title and Request together for approval. The user may accept, edit, or reject them. Call the matching entity initialization tool or create a tracker item only after that exact wording and the remaining intake values are approved. Never rename an adopted tracker item without separate approval. The initialization tool stores the title in `metadata.json` and writes the Request under `brief.md`; tracker initialization uses the same exact approved title and Request.

Every tracker item preserves its original request title/name and description: new items use the approved title/Request; adopted items retain existing content. Accepted `epic.md`/`plan.md` publishes under the [shared publication contract](./integrations/shared.md#provider-bodies): GitHub uses one issue comment; Linear uses one document attached to the existing issue or Project. GitHub records require `planComment`; Linear records require `planDocument`. Both store unpublished, pending with an opaque token, or published with that token and confirmed native ID/URL. This authoritative identity/intent follows artifact persistence; it is not a disposable Resource ID.

Choose concise lowercase kebab-case slugs with a soft cap around 48 characters; shorten at word boundaries. The tool normalizes the supplied slug before creating the directory and rendering the configured branch name. One branch format applies to every entity. Linear `tracker` uses exact issue branches for Task/Gig and reconstructs the current workspace format for Epic from read-only provider data.

## Reviewed document shape

Newly authored or revised accepted `epic.md`, `plan.md`, `result.md`, and `report.md` use ordinary, provider-neutral Markdown:

1. The normal root H1 title.
2. A nonempty `## Overview` as the first content section.
3. One or more subsequent nonempty level-two sections carrying the complete supporting contract or evidence.

For Epic/Plan sources, Overview explains the brief and why the work matters, followed by a few settled scope/behavior bullets under `### Plan highlights`. Preserve the approved Request's meaning without repeating the tracker title. Result overviews describe delivered behavior and material limitations; report overviews state the question/scope, key conclusion, and material uncertainty. Detailed sections retain all necessary contract, evidence, and verification; keep their headings subject-specific.

The overview and details are one source document, reviewed and accepted together. Keep both synchronized when that source changes. The request-only `brief.md` remains unchanged. Source artifacts do not encode provider-specific collapse wrappers: the [shared integration renderer](./integrations/shared.md#provider-bodies) keeps Overview visible and folds the remaining sections without summarizing or dropping text.

An older source is brought into this shape through its normal review and user-acceptance gates before its next publication. Reads never rewrite it automatically; historical completed artifacts remain untouched. This presentation change does not migrate entity metadata.

## IDs and initial branches

A raw ID is the ten-character ULID timestamp component. Qualified IDs are `EPIC-...`, `TASK-...`, and `GIG-...`; the branch-format `identifier` token is the qualified ID in lowercase, while `title` is the normalized slug. Only initialized entities receive workflow identity, directories, and branches.

Epic and Gig start from and target the repository default branch, resolved in order from configured `origin/HEAD`, an existing workflow contract, the current attached local branch, or the sole local branch. A remote is optional. Task copies its parent Epic's current target; the Task skill owns its prerequisites and parent relation. Follow `./setup.md` for configured branch formats and username sources, and the selected provider reference for tracker branch initialization. Branch readiness and approved repository operations remain lifecycle gates.

## Brief and local working state

### `brief.md`

`brief.md` contains only `# Brief`, one blank line, and the exact approved Request. For adopted tracker work, the tracker item's title or name and description may supply that Request unchanged. Change the Request only through explicit user approval; never add decisions, findings, questions, paths, provider data, checkpoints, or execution history.

### `.local/notes.md`

Every entity has free-form agent notes for transient context that does not belong in metadata, the mutable draft, the accepted artifact, or a review round. Keep useful resume context here and refresh it before conversation compaction when possible. Notes have no lifecycle or completion gate.

### `.local/pending.md`

Tasks and Gigs use Markdown task-list entries for current-scope work discovered during execution. An unchecked ordered or unordered entry is active and unresolved; checked entries may remain. Independently schedulable or out-of-scope work requires separate approved workflow/tracker intake. Final review requires zero active entries. A missing local pending-work file, such as after a fresh checkout, has no recoverable entries and is treated as empty.

## Project

```text
.project/
  config.json          # Required project artifact-persistence and branch-format configuration.
  config.local.json    # Optional username override for static username branch formats; always outside Git.
  policies.md          # Optional repository-specific workflow additions or overrides.
  integrations.json    # Optional non-secret provider configuration; never authoritative entity state.
  epics/               # Initialized Epics and their child Tasks.
  gigs/                # Initialized standalone Gigs.
  .local/              # Private project working state; always outside Git.
    pull-requests/     # Incoming PR evidence; no initialized entities.
```

### Incoming PR evidence

[Incoming PRs](./pr/incoming.md) target the current configured repository and keep private evidence under `.project/.local/pull-requests/<number>/`. An approved independent nested Git repository lives at `checkout/`, with its own .git, HEAD and index. The named registered incoming-PR checkout operations own preparation, checkout/review setup, inspection, validated transitions and approved standard rebase with immediate SHA-pinned lease-protected contributor update; agents do not reconstruct those operations in Bash. `checkout.json` records original evidence/revision, merge-base, separate observed target/source tips, native rebase progress, pinned lease, publication outcome and current working baseline; `checkout-inspection.json` records observed state/phase validation. `checkout-contribution.diff`, `checkout-rebase.diff`, `checkout-conflicts.diff`, `checkout-fixes.diff` and `checkout-untracked.json` are complete mutable inspection inputs for later immutable reviewer snapshots. These records are not approvals. Safety assessments and notes stay outside that checkout. Checkout files, state/diffs and working evidence stay at the PR root. Each exact `reviews/<base-sha>-<head-sha>/review-NNN/inputs/` holds that pass's write-once source/diff/dependency files, including successive uncommitted drafts at the same PR head. Each `review-NNN/` directory also holds: `revision.json`, actual provider `evidence.json`, saved dossier `evidence.md`, `source-files.json` mapping original paths to immutable source snapshots, and shared request/report/review/response/transcript/agent/outcome files. Existing review records are not moved or rewritten automatically; current round lookup uses the `reviews/` namespace only. Full repository identities remain in the revision metadata; PR number and commit SHAs identify local evidence. The entire incoming-PR area is covered by the existing `.project/**/.local/` ignore rule in versioned mode and the `.project/` exclusion in unversioned mode. No root entity metadata, accepted plan/result, workflow ID, lifecycle, branch contract, or approval token is created; fresh provider reads establish current state. Do not stage, commit, or publish these private artifacts.

## Project Policy precedence

Within this workflow, current explicit user instructions take precedence over `.project/policies.md`, and `.project/policies.md` takes precedence over reusable workflow skills and references. Apply Project Policies unless the user explicitly overrides one in chat. Keep an active work-specific override in `.local/notes.md` until it is represented by the accepted artifact or metadata. When the user wants a permanent workflow-policy change for this repository, update `.project/policies.md` only with their approval. Use Project Policies to adapt the shared workflow for this repository without modifying the reusable workflow files.

## Epic

```text
.project/epics/<timestamp>.EPIC-<raw-id>.<slug>/
  brief.md                         # Exact approved Request.
  metadata.json                    # Validated ID, authority, Phase, branch contract, task target, and tracker/forge records.
  epic.md                          # User-accepted initiative contract and ordered prospective/initialized Tasks.
  .local/                          # Local entity state; always gitignored in versioned mode.
    metadata.json                  # Strict scoped scoped Resource IDs; disposable, never lifecycle authority.
    status.md                      # Trackerless only: authoritative lifecycle state.
    notes.md                       # Free-form agent working notes; no completion gate.
    draft.md                       # Mutable candidate; never the accepted contract.
    scratch/                       # Temporary research, probes, scripts, and one-off data.
    reviews/
      plan-NNN/
        candidate.md               # Exact candidate reviewed in this round.
        review.md                  # Canonically rendered reviewer findings and signoff.
        report.json                # Validated structured reviewer report used by the shared renderer.
        response.md                # Canonically rendered adjudication; created by record_review_response.
        request.md                 # Exact context sent to the reviewer.
        transcript.md              # Human-readable reviewer subprocess activity.
        agent.jsonl                # Raw Pi event stream.
        outcome.json               # Validated signoff used by optional blocked-review confirmation.
        stderr.txt                 # Present only when non-empty.
  tasks/
    <timestamp>.TASK-<raw-id>.<slug>/  # Initialized Tasks belonging to this Epic.
```

`epic.md`, draft/snapshots, and review artifacts do not exist until their corresponding lifecycle gates create them. Prospective Tasks exist only as untagged ordered lines in accepted `epic.md`; initialization adds their stable `[TASK-…]` relation and child directory. Epic status keeps immutable branch identity and `taskTarget: epic | default`; changing that pointer affects only Tasks initialized afterward.

## Task

```text
.project/epics/<epic>/tasks/<timestamp>.TASK-<raw-id>.<slug>/
  brief.md                         # Exact approved Request.
  metadata.json                    # Validated kind, authority, Phase, branch contract, and role records; parent derives from containment.
  plan.md                          # User-accepted work plan.
  result.md                        # Feature/Bugfix/Refactor/Chore: concise delivered outcome and actual verification.
  report.md                        # Durable Research/Audit result; preserved when that work continues into implementation.
  designs/                         # Optional: only designs explicitly selected by the user for versioning.
  .local/                          # Local entity state; always gitignored in versioned mode.
    metadata.json                  # Strict scoped scoped Resource IDs; outside Git in both artifact modes.
    status.md                      # Trackerless only: authoritative lifecycle state.
    notes.md                       # Free-form agent working notes; no completion gate.
    pending.md                     # Pending work; final review requires no active entries.
    draft.md                       # Mutable plan candidate before review and acceptance.
    designs/                       # Default location for design sketches and iterations.
    scratch/                       # Temporary scripts, probes, generated data, and debugging material.
    reviews/
      <phase>-NNN/
        candidate.md               # Plan phase only: exact reviewed candidate.
        review.md                  # Canonically rendered reviewer findings and signoff.
        report.json                # Validated structured reviewer report used by the shared renderer.
        response.md                # Canonically rendered adjudication; created by record_review_response.
        request.md                 # Exact reviewer request.
        transcript.md              # Human-readable subprocess activity.
        agent.jsonl                # Raw Pi event stream.
        outcome.json               # Validated signoff used by optional blocked-review confirmation.
        stderr.txt                 # Present only when non-empty.
```

## Gig

```text
.project/gigs/<timestamp>.GIG-<raw-id>.<slug>/
  brief.md                         # Exact approved Request.
  metadata.json                    # Validated kind, authority, Phase, branch contract, and role records.
  plan.md                          # User-accepted work plan.
  result.md                        # Feature/Bugfix/Refactor/Chore: concise delivered outcome and actual verification.
  report.md                        # Durable Research/Audit result; preserved when that work continues into implementation.
  designs/                         # Optional: only designs explicitly selected by the user for versioning.
  .local/                          # Same local status/draft/designs/scratch/review layout as Task.
```

Task and Gig share the Deliverable lifecycle and artifact meanings. Only Task has a parent Epic and may synchronize parent Epic artifacts. Its parent identity is the containing Epic directory plus the exact `[TASK-…]` marker. `metadata.branch` is a strict ready/tracker-pending/tracker-named/provisioning union; a ready branch records whether its name was generated or tracker-provided, and work cannot begin until ready. A Task's stored start/target never changes when its Epic later changes `taskTarget`. `metadata.json` is authoritative for current kind and `phase: planning | execution | selfReview`; `brief.md` remains the approved Request, and `.local/notes.md` holds transient human context. Feature/Bugfix/Refactor/Chore create `result.md` before final subagent review so the reviewer receives the actual outcome and verification evidence; Research/Audit complete `report.md` before final subagent review. Kind-only updates leave accepted plans, results, and reports unchanged. Subsequent implementation preserves existing reports as prior evidence and provides `result.md` for the implementation outcome before final subagent review. Once created, `result.md` stays synchronized with every later review change and verification rerun.

Durable provider records retain semantic identity, exact relationships/branch intent and tracker creation progress. Versioned PR repository/head/target intent is prepared before the one submission commit. Returned and explicitly selected PR number/URL are recorded directly in the existing ignored Resource IDs file `.local/metadata.json`; PR recording does not update versioned metadata after submission. See [shared integrations](./integrations/shared.md) for the single inventory and [Migrations](../MIGRATIONS.md) for resume-time conversion of an old-format entity. Normal reads use strict current schemas and never rewrite historical state.

## Persistence and authority

The shared operational guard validates current `.project/config.json` and persistence safety, reusing a successful inspection only while relevant local inputs are unchanged. `prepare_artifacts` forces a full check during setup or configuration repair and adds only the permitted exclusions below. Neither operation changes the Git index.

In `versioned` mode, put these durable artifacts in Git:

- `.project/config.json`, `.project/policies.md`, and non-secret `.project/integrations.json`;
- every entity's `brief.md`, `metadata.json`, accepted `epic.md` or `plan.md`, and applicable `result.md` or `report.md`;
- only the exact Deliverable `designs/` files the user explicitly requests to preserve in Git.

Keep `.project/config.local.json` and every entity `.local/` directory local. The repository rule `.project/**/.local/` gitignores all local entity state in versioned mode. Setup adds only that missing `.gitignore` rule. Preparation requires it, rejects any local path that is in Git or staged, and adds exact `/.project/config.local.json` to `.git/info/exclude` when needed.

In `unversioned` mode, all `.project/` artifacts remain outside Git. Preparation adds exactly `/.project/` to `.git/info/exclude`; do not add `.project/` to `.gitignore`. Never stage, commit, push, or link any `.project/` path. If any path is already in Git or staged, stop; removal from Git requires separate user approval and is never automatic. To return to versioned mode, remove the managed exclude entry manually before preparation.

Workflow artifacts, IDs, relationships, branch contracts, Phase, and review gates remain authoritative. Every initialized entity stores `phase: planning | execution | selfReview` in `metadata.json`. Follow `./phase.md` for transitions and native projection; strict reads require the current schema. Without a tracker, workflow authority stores Priority in `metadata.authority` and lifecycle (`inProgress | inReview | done | canceled`) in `.local/status.md`. With a tracker, tracker authority uses native provider Status/Priority and `.local/status.md` is absent. `metadata.authority.desired` exists only while initial tracker binding is pending and is removed when binding is confirmed. Keep machine data valid, keep transient human context in `.local/notes.md`, and never store provider credentials in `.project/integrations.json`.

The mutable `.local/draft.md` is not a substitute for accepted `epic.md` or `plan.md`. The review tool owns each round's structured report, canonical `review.md`, and execution diagnostics; `record_review_response` owns canonical `response.md`; the main agent owns adjudication input and approved source changes. Every accepted change must be reflected directly in the current authoritative artifact; historical review rounds remain local and are not required by a fresh checkout. Keep temporary material under `.local/scratch/`, free-form context in `.local/notes.md`, and current-scope work in a Deliverable's `.local/pending.md`. Create design sketches and iterations under `.local/designs/` by default. In versioned mode, copy only exact user-selected designs into root `designs/`; keep later iterations local until the user explicitly requests another durable update. Unversioned artifact policy cannot commit a design without an explicitly approved project migration. Do not add unrelated files to entity roots.
