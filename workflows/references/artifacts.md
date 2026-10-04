# Workflow artifacts

This is the agent-facing map of workflow directories, file meanings, and persistence. Paths are repository-relative. The `init` tool creates entity directories, `.local/` working state, `brief.md`, `metadata.json`, and `.local/notes.md`; Task/Gig initialization also creates `.local/pending.md`, while `.local/status.md` exists only without a tracker. Planning, execution, and review create the remaining files when their lifecycle gate is reached.

## Terminology

- A **tracker** is an external work system: GitHub Projects or Linear.
- Artifact Git policy is **versioned** or **unversioned**. Versioned artifacts belong in Git; unversioned artifacts stay outside Git.
- General Git membership is **in Git** or **outside Git**. Use **staged**, **unstaged**, **gitignored**, and **committed** for the corresponding Git states.
- **Local** describes files that always remain outside Git, including `.local/**`, `.project/config.local.json`, and `.agents/*.local.json`.
- Without a tracker, lifecycle and Priority use **workflow authority**. With a tracker, they use **tracker authority**.

Use these terms exactly across schemas, code, tests, agent guidance, and user documentation.

## Initialization inputs

Call `prepare_artifacts` before reading or writing entity artifacts or requesting entity integration context on initialization/resume. Stop on invalid configuration, unsafe Git membership, or an incomplete persistence-mode reversal.

Resume only an explicitly identified entity path, qualified ID, or uniquely identifiable existing entity. Resolve exactly one entity of the requested type; never initialize replacement work during resume.

Before initialization, agree on the title, standalone Request, exact Priority (a configured value or `not set`), and whether to create new tracker work or adopt one explicit Backlog or Todo object. Task/Gig also require an approved Deliverable kind; Task requires the parent and accepted plan item specified by its skill. For adoption, finish the selected provider reference's read-only preflight, then present the synthesized Request and copied Priority for approval. Otherwise obtain Priority directly. Do not infer adoption from vague discussion.

Clean the proposed title and standalone Request for durable reading:

- correct spelling, capitalization, punctuation, sentence boundaries, and clearly accidental formatting;
- preserve the user's meaning, intent, scope, emphasis, uncertainty, and level of detail;
- preserve exact code, commands, identifiers, paths, URLs, API names, product names, and quoted text;
- do not add requirements, facts, rationale, acceptance criteria, or technical decisions;
- when a possible correction could change meaning, keep the original wording and ask the user.

For new work, synthesize the Request from the user's input and agreed clarifications. The `/epic`, `/task`, and `/gig` handlers place their command argument between a generated `Epic:`, `Task:`, or `Gig:` label and a trailing skill-routing instruction such as `Use the gig skill.`; the command argument is the user input, while the generated label and instruction are workflow control text.

A tracker item is the provider-native record representing an entity. Current adapters use a GitHub issue for every entity, a Linear Project for an Epic, and a Linear issue for a Task or Gig. For adopted tracker work, synthesize the Request from the selected tracker item's title or name and description plus agreed clarifications. The user may approve that wording unchanged or revise it.

Present the cleaned title and Request together for approval. The user may accept, edit, or reject them. Do not call `init` or create a tracker item until that exact wording is approved. Never rename an adopted tracker item without separate approval. `init` stores the title in `metadata.json` and writes the Request under `brief.md`; tracker initialization uses the same exact approved title and Request.

Choose concise lowercase kebab-case slugs with a soft cap around 48 characters; shorten at word boundaries. The tool normalizes the supplied slug before creating the directory and rendering the configured branch name. One branch format applies to every entity. Linear `tracker` uses exact issue branches for Task/Gig and reconstructs the current workspace format for Epic from read-only provider data.

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
```

## Project Policy precedence

Within this workflow, current explicit user instructions take precedence over `.project/policies.md`, and `.project/policies.md` takes precedence over reusable workflow skills and references. Apply Project Policies unless the user explicitly overrides one in chat. Keep an active work-specific override in `.local/notes.md` until it is represented by the accepted artifact or metadata. When the user wants a permanent workflow-policy change for this repository, update `.project/policies.md` only with their approval. Use Project Policies to adapt the shared workflow for this repository without modifying the reusable workflow files.

## Epic

```text
.project/epics/<timestamp>.EPIC-<raw-id>.<slug>/
  brief.md                         # Exact approved Request.
  metadata.json                    # Validated ID, authority, work stage, branch contract, task target, and tracker/forge records.
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
  metadata.json                    # Validated kind, authority, work stage, branch contract, and role records; parent derives from containment.
  plan.md                          # User-accepted plan for the current kind.
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
  metadata.json                    # Validated kind, authority, work stage, branch contract, and role records.
  plan.md                          # User-accepted plan for the current kind.
  result.md                        # Feature/Bugfix/Refactor/Chore: concise delivered outcome and actual verification.
  report.md                        # Durable Research/Audit result; preserved when that work continues into implementation.
  designs/                         # Optional: only designs explicitly selected by the user for versioning.
  .local/                          # Same local status/draft/designs/scratch/review layout as Task.
```

Task and Gig share the Deliverable lifecycle and artifact meanings. Only Task has a parent Epic and may synchronize parent Epic artifacts. Its parent identity is the containing Epic directory plus the exact `[TASK-…]` marker. `metadata.branch` is a strict ready/tracker-pending/tracker-named/provisioning union; a ready branch records whether its name was generated or tracker-provided, and work cannot begin until ready. A Task's stored start/target never changes when its Epic later changes `taskTarget`. `metadata.json` is authoritative for current kind and `workStage: planning | execution`; `brief.md` remains the approved Request, and `.local/notes.md` holds transient human context. Feature/Bugfix/Refactor/Chore create `result.md` before final subagent review so the reviewer receives the actual outcome and verification evidence; Research/Audit complete `report.md` before final subagent review. A Research/Audit continuation preserves `report.md` and adds `result.md` for the implementation outcome before final subagent review. Once created, `result.md` stays synchronized with every later review change and verification rerun.

Durable provider records retain semantic identity, exact relationships/branch intent and tracker creation progress. Versioned PR repository/head/target intent is prepared before the one submission commit. Returned and explicitly selected PR number/URL are recorded directly in the existing ignored Resource IDs file `.local/metadata.json`; PR recording does not update versioned metadata after submission. See [shared integrations](./integrations/shared.md) for the single inventory and [Migrations](../MIGRATIONS.md) for resume-time conversion of an old-format entity. Normal reads use strict current schemas and never rewrite historical state.

## Persistence and authority

Call `prepare_artifacts` before initialization and every resume. It validates required `.project/config.json` and never changes the Git index.

In `versioned` mode, put these durable artifacts in Git:

- `.project/config.json`, `.project/policies.md`, and non-secret `.project/integrations.json`;
- every entity's `brief.md`, `metadata.json`, accepted `epic.md` or `plan.md`, and applicable `result.md` or `report.md`;
- only the exact Deliverable `designs/` files the user explicitly requests to preserve in Git.

Keep `.project/config.local.json` and every entity `.local/` directory local. The repository rule `.project/**/.local/` gitignores all local entity state in versioned mode. Setup adds only that missing `.gitignore` rule. Preparation requires it, rejects any local path that is in Git or staged, and adds exact `/.project/config.local.json` to `.git/info/exclude` when needed.

In `unversioned` mode, all `.project/` artifacts remain outside Git. Preparation adds exactly `/.project/` to `.git/info/exclude`; do not add `.project/` to `.gitignore`. Never stage, commit, push, or link any `.project/` path. If any path is already in Git or staged, stop; removal from Git requires separate user approval and is never automatic. To return to versioned mode, remove the managed exclude entry manually before preparation.

Workflow artifacts, IDs, relationships, branch contracts, work stage, and review gates remain authoritative. An older entity that stores lifecycle `planning` or omits `workStage` is invalid under this contract and requires an explicit project migration; initialization and resume never rewrite it implicitly. Every initialized entity stores `workStage: planning | execution` in `metadata.json`. Without a tracker, workflow authority stores Priority in `metadata.authority` and lifecycle (`inProgress | inReview | done | canceled`) in `.local/status.md`. With a tracker, tracker authority uses native provider Status/Priority and `.local/status.md` is absent. `metadata.authority.desired` exists only while initial tracker binding is pending and is removed when binding is confirmed. Keep machine data valid, keep transient human context in `.local/notes.md`, and never store provider credentials in `.project/integrations.json`.

The mutable `.local/draft.md` is not a substitute for accepted `epic.md` or `plan.md`. The review tool owns each round's structured report, canonical `review.md`, and execution diagnostics; `record_review_response` owns canonical `response.md`; the main agent owns adjudication input and approved source changes. Every accepted change must be reflected directly in the current authoritative artifact; historical review rounds remain local and are not required by a fresh checkout. Keep temporary material under `.local/scratch/`, free-form context in `.local/notes.md`, and current-scope work in a Deliverable's `.local/pending.md`. Create design sketches and iterations under `.local/designs/` by default. In versioned mode, copy only exact user-selected designs into root `designs/`; keep later iterations local until the user explicitly requests another durable update. Unversioned artifact policy cannot commit a design without an explicitly approved project migration. Do not add unrelated files to entity roots.
