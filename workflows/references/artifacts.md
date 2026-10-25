# Workflow artifacts

The map of workflow directories, what each file means, and how it's persisted. Paths are repository-relative.

## Terminology

- **Tracker:** an external work system, GitHub Projects or Linear. A **tracker item** is its native record for an entity: a GitHub issue for every entity; a Linear Project for an Epic, and a Linear issue for a Task or Gig.
- **Versioned** or **unversioned:** the artifact Git policy. Versioned artifacts belong in Git; unversioned artifacts stay outside it.
- **In Git** or **outside Git:** general Git membership. Use **staged**, **unstaged**, **gitignored**, and **committed** for those specific states.
- **Local:** files that always stay outside Git: `.local/**`, `.project/config.local.json`, and `.agents/*.local.json`.
- **Workflow authority** or **tracker authority:** where lifecycle and Priority live. It's workflow authority without a tracker and tracker authority with one.

## Initialization inputs

### Resume

1. Resume only an explicitly identified entity: a path, a qualified ID, or a uniquely identifiable existing entity of the requested type. Never initialize replacement work during resume.
2. Call `resume_integration` with its `entityDir` before reading or editing its artifacts, even without a tracker. It validates persistence and entity compatibility.
3. Stop on invalid configuration, unsafe Git membership, or an incomplete persistence-mode reversal. For setup or a reported missing preparation step, call `prepare_artifacts` and retry. It doesn't repair membership of files already in Git.

### Intake values

Before initialization, settle:

- the title and a standalone Request;
- Priority: a configured value or `not set`;
- new tracker work, or adoption of one explicitly selected Backlog or Todo object;
- for Task and Gig, the Deliverable kind; for Task, also the parent and accepted plan item its skill requires.

**New work:**

1. Build the Request from the user's input and agreed clarifications. The `/epic`, `/task`, and `/gig` commands wrap their argument in a generated label (`Epic:`, `Task:`, `Gig:`) and a routing line such as `Use the gig skill.`. Only the argument is user input.
2. Clean the title and Request (below) and present them together. The user may accept, edit, or reject.
3. Call the initialization tool or create a tracker item only after the wording and the other intake values are approved.

**Adopted work:**

- Explicit selection of a Backlog or Todo object approves adoption. Use its title or name as the title, and its title or name plus description as the Request, with agreed clarifications and the cleanup below. Reuse its Priority and any available workflow Kind.
- Run the selected provider's read-only preflight, then call the matching adoption tool without a separate confirmation.
- Ask only for missing or conflicting information, such as Kind or the Task relationship. Ask before changing meaning, scope, Priority, or Kind.
- Never infer adoption from vague discussion. Never rename an adopted tracker item without separate approval.

**Cleaning the title and Request:**

- Correct spelling, capitalization, punctuation, sentence boundaries, and accidental formatting.
- Keep the user's meaning, intent, scope, emphasis, uncertainty, and level of detail.
- Keep code, commands, identifiers, paths, URLs, API names, product names, and quotes unchanged.
- Don't add requirements, facts, rationale, acceptance criteria, or technical decisions.
- When a correction could change meaning, keep the original and ask.

The initialization tool stores the title in `metadata.json` and the Request in `brief.md`. Tracker initialization uses the same approved title and Request.

### Tracker items and plan publication

- Every tracker item keeps its original request title or name and description. New items use the approved title and Request; adopted items keep their existing content.
- Accepted `epic.md` or `plan.md` publishes separately, as described in [provider bodies](./integrations/shared.md#provider-bodies): one issue comment on GitHub, one document attached to the issue or Project on Linear.
- GitHub records hold `planComment`; Linear records hold `planDocument`. Each is `unpublished`, `pending` with an opaque token, or `published` with that token and the confirmed native ID and URL. This is authoritative identity, persisted with the artifacts, not a disposable Resource ID.

### Slugs

Use concise lowercase kebab-case, with a soft cap around 48 characters; shorten at word boundaries. The tool normalizes the slug before creating the directory and rendering the branch name.

## Reviewed document shape

New or revised accepted `epic.md`, `plan.md`, `result.md`, and `report.md` use plain, provider-neutral Markdown:

1. a root H1 title;
2. a nonempty `## Overview` as the first section;
3. one or more nonempty level-two sections with the full supporting contract or evidence, under subject-specific headings.

| Source | Overview contains |
| --- | --- |
| `epic.md`, `plan.md` | the brief and why the work matters, then a few settled scope and behavior bullets under `### Plan highlights`; keeps the Request's meaning without repeating the tracker title |
| `result.md` | delivered behavior and material limitations |
| `report.md` | the question or scope, the key conclusion, and material uncertainty |

- Overview and details are one document, reviewed and accepted together. Keep them in sync when the source changes. `brief.md` stays unchanged.
- Sources contain no provider-specific folding. The [renderer](./integrations/shared.md#provider-bodies) keeps Overview visible and folds the rest without summarizing or dropping text.
- An older source is brought into this shape through its normal review and acceptance before its next publication. Reads never rewrite it, completed historical artifacts stay untouched, and no entity metadata migrates.

## IDs and initial branches

- A raw ID is the ten-character ULID timestamp component. Qualified IDs are `EPIC-…`, `TASK-…`, and `GIG-…`.
- In the branch format, `identifier` is the lowercase qualified ID and `title` is the normalized slug. Only initialized entities get identity, directories, and branches.
- Epic and Gig start from and target the repository default branch. It's resolved, in order, from `origin/HEAD`, an existing workflow contract, the current attached local branch, or the sole local branch. A remote is optional.
- A Task copies its parent Epic's current target. The Task skill owns its prerequisites and parent relation.
- The initialization tool renders the one configured `branches.format` for every entity. Formats starting with `username` read `branches.username` from `.project/config.local.json` or global `workflows.json`; never infer it. The Linear `tracker` format uses exact issue branch names for Task and Gig, and reconstructs the workspace format for Epic (see [Linear tracker](./integrations/tracker/linear.md)). When configuring formats, read [setup](./setup.md#project-configuration).
- Branch readiness and approved repository operations remain lifecycle gates.

## Brief and local working state

- **`brief.md`:** only `# Brief`, a blank line, and the approved Request. Change the Request only with explicit user approval. Never add decisions, findings, questions, paths, provider data, checkpoints, or history.
- **`.local/notes.md`:** free-form agent notes for transient context that doesn't belong in metadata, the draft, the accepted artifact, or a review round. Keep resume context here, and refresh it before compaction when possible. No lifecycle or completion gate.
- **`.local/pending.md`** (Task and Gig): Markdown task-list entries for current-scope work found during execution.
  - An unchecked entry is active; checked entries may stay.
  - Independently schedulable or out-of-scope work needs separate approved intake.
  - Final review requires zero active entries.
  - A missing file, for example after a fresh checkout, counts as empty.
- **`.local/draft.md`:** the mutable candidate. It never substitutes for accepted `epic.md` or `plan.md`.
- **`.local/scratch/`:** temporary research, probes, scripts, and data.
- **`.local/designs/`:** design sketches and iterations by default.
- Initialization creates the entity directory, `.local/`, `brief.md`, `metadata.json`, and `.local/notes.md`. Task and Gig also get `.local/pending.md`, and `.local/status.md` exists only without a tracker. Later gates create the rest.

## Project

```text
.project/
  config.json          # Required: artifact persistence and branch format.
  config.local.json    # Optional username for static username formats; always local.
  policies.md          # Optional repository-specific workflow additions or overrides.
  integrations.json    # Optional non-secret provider configuration; never entity state.
  epics/               # Initialized Epics and their Tasks.
  gigs/                # Initialized standalone Gigs.
  .local/              # Private project working state; always local.
    pull-requests/     # Incoming PR evidence; no initialized entities.
```

### Incoming PR evidence

[Incoming PRs](./pr/incoming.md) keep private evidence under `.project/.local/pull-requests/<number>/`, including an approved nested checkout at `checkout/` and review rounds under `reviews/<base-sha>-<head-sha>/review-NNN/inputs/`. The existing `.project/**/.local/` ignore rule (versioned) or `.project/` exclusion (unversioned) covers the whole area. These records are evidence, not approvals, and create no entity, workflow ID, lifecycle, or branch contract. Never stage, commit, or publish them. The file inventory is in the [PR extension README](../extensions/pr/README.md#private-evidence-layout).

## Project Policy precedence

Precedence is in [core approvals](./core.md#approvals).

- Apply Project Policies unless the user explicitly overrides one in chat. Keep an active override for this work in `.local/notes.md` until the accepted artifact or metadata reflects it.
- Change `.project/policies.md` only with the user's approval, when they want a permanent change for this repository.
- Use Project Policies to adapt the workflow for this repository, never by editing the reusable workflow files.

## Entity layouts

### Epic

```text
.project/epics/<timestamp>.EPIC-<raw-id>.<slug>/
  brief.md             # Approved Request.
  metadata.json        # ID, authority, Phase, branch contract, Task target, tracker and forge records.
  epic.md              # Accepted initiative contract and ordered Tasks.
  .local/              # Local entity state.
    metadata.json      # Scoped Resource IDs; disposable, never lifecycle authority.
    status.md          # Trackerless only: lifecycle.
    notes.md
    draft.md
    scratch/
    reviews/plan-NNN/  # Review round files, below.
  tasks/
    <timestamp>.TASK-<raw-id>.<slug>/
```

- `epic.md`, drafts, and review rounds appear only when their gates create them.
- A prospective Task is an untagged ordered line in accepted `epic.md`. Initialization adds its stable `[TASK-…]` marker and child directory.
- Metadata holds the immutable branch identity and `taskTarget: epic | default`. Changing the pointer affects only Tasks initialized afterward.
- The approved Task delivery strategy and its rationale belong in reviewed `epic.md`. The initial pointer is not approval.
- Record the approved routing intent before committing Epic planning, so the plan and target metadata are delivered together. Selecting default doesn't prove delivery. When initializing a default-target Task, read [Epic delivery](./epic.md).

### Task and Gig (Deliverables)

```text
.project/epics/<epic>/tasks/<timestamp>.TASK-<raw-id>.<slug>/
.project/gigs/<timestamp>.GIG-<raw-id>.<slug>/
  brief.md             # Approved Request.
  metadata.json        # Kind, authority, Phase, branch contract, role records. A Task's parent comes from its directory.
  plan.md              # Accepted work plan.
  result.md            # Feature, Bugfix, Refactor, Chore: delivered outcome and actual verification.
  report.md            # Research, Audit: durable result; kept when the work continues into implementation.
  designs/             # Optional: only designs the user explicitly chose to version.
  .local/
    metadata.json      # Scoped Resource IDs; local in both artifact modes.
    status.md          # Trackerless only: lifecycle.
    notes.md
    pending.md
    draft.md
    designs/
    scratch/
    reviews/<phase>-NNN/  # Review round files, below.
```

- Task and Gig share the Deliverable lifecycle and these meanings. Only a Task has a parent Epic and may update parent Epic artifacts. Its parent identity is the containing Epic directory plus its exact `[TASK-…]` marker.
- `metadata.branch` is `ready`, `tracker-pending`, `tracker-named`, or `provisioning`. A ready branch records whether its name was generated or tracker-provided. Work starts only when it's ready.
- A Task's stored start and target never change when its Epic later changes `taskTarget`.
- `metadata.json` is authoritative for kind and `phase: planning | execution | selfReview`.
- Completion artifacts follow the [Deliverable lifecycle](./deliverable.md#completion-artifact). Kind-only updates leave accepted plans, results, and reports unchanged.

### Review round files

Each `reviews/<phase>-NNN/` directory holds:

| File | Contents |
| --- | --- |
| `candidate.md` | Plan rounds only: the exact candidate reviewed. |
| `review.md` | Rendered reviewer findings and signoff. |
| `report.json` | Validated structured report used by the renderer. |
| `response.md` | Rendered adjudication, written by `record_review_response`. |
| `request.md` | Exact context sent to the reviewer. |
| `transcript.md` | Readable reviewer activity. |
| `agent.jsonl` | Raw Pi event stream. |
| `outcome.json` | Validated signoff, used by blocked-review confirmation. |
| `stderr.txt` | Present only when non-empty. |

### Provider records and Resource IDs

- Durable provider records keep semantic identity, relationships, branch intent, and tracker creation progress.
- Versioned PR repository, head, and target intent is saved before staging the last Deliverable commit and committed with it (see [submission](./deliverable/submission.md#with-a-forge)).
- Returned or explicitly selected PR numbers and URLs go straight into the local Resource IDs file `.local/metadata.json`. Recording a PR never changes versioned metadata.
- The full inventory is in [integration roles](./integrations/shared.md#operations-and-resource-ids). Resume-time conversion of old formats is in [core migrations](./core.md#saved-data-migrations). Normal reads use strict current schemas and never rewrite history.

## Persistence and authority

The shared guard validates `.project/config.json` and persistence safety, reusing a successful check while the relevant local inputs are unchanged. `prepare_artifacts` forces a full check during setup or repair and adds only the permitted exclusions below. Neither changes the Git index.

| | Versioned | Unversioned |
| --- | --- | --- |
| In Git | `.project/config.json`, `policies.md`, non-secret `integrations.json`; each entity's `brief.md`, `metadata.json`, accepted `epic.md` or `plan.md`, `result.md` or `report.md`; only designs the user chose to version | nothing under `.project/` |
| Kept out by | the `.project/**/.local/` rule in `.gitignore` (setup adds only that rule); `/.project/config.local.json` in `.git/info/exclude` | exactly `/.project/` in `.git/info/exclude`; never in `.gitignore` |
| Preparation stops when | a local path is in Git or staged | any `.project/` path is in Git or staged |

- In unversioned mode, never stage, commit, push, or link any `.project/` path.
- Removing a path from Git needs separate user approval and is never automatic. To return to versioned mode, remove the managed exclude entry by hand before preparation.

**Authority:**

- Artifacts, IDs, relationships, branch contracts, Phase, and review gates are authoritative. Every entity stores `phase` in `metadata.json`. When changing Phase, read [Phase](./phase.md).
- Workflow authority keeps Priority in `metadata.authority` and lifecycle (`inProgress | inReview | done | canceled`) in `.local/status.md`.
- Tracker authority uses native provider Status and Priority, and `.local/status.md` is absent. `metadata.authority.desired` exists only while initial tracker binding is pending.
- Keep machine data valid and transient context in `.local/notes.md`. Never store credentials in `.project/integrations.json`.

**Ownership:**

- The review tool writes each round's report, `review.md`, and diagnostics. `record_review_response` writes `response.md`. The main agent owns adjudication and approved source changes.
- Reflect every accepted change directly in the current authoritative artifact. Historical review rounds stay local and aren't needed in a fresh checkout.
- In versioned mode, copy only user-selected designs into root `designs/`, and update them only on another explicit request. Unversioned mode can't commit a design without an approved project migration.
- Don't add unrelated files to entity roots.
