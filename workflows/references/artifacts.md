# Workflow artifacts

The map of workflow directories, what each file means, and how it's persisted. Paths are repository-relative.

## Terminology

- **Tracker:** an external work system, GitHub Projects or Linear. A **tracker item** is its native record for an entity: a GitHub issue for every entity; a Linear Project for an Epic, and a Linear issue for a Task or Gig.
- **In Git** or **outside Git:** general Git membership. Use **staged**, **unstaged**, **gitignored**, and **committed** for those specific states.
- **Local:** files that always stay outside Git: everything under `.project/.local/`, `.project/config.local.json`, and `.agents/*.local.json`. Every workflow entity is local.
- **Tracker reference:** an entity's identity on the tracker: `#12` for a GitHub issue, `ENG-12` for a Linear issue. A Linear Project has no number, so its Epic is dated by the Project's UTC creation date to keep Epics chronological.

## Initialization inputs

### Resume

1. Resume only an explicitly identified entity: a path, a tracker reference, or a uniquely identifiable existing entity of the requested type. Never initialize replacement work during resume.
2. Call `resume_integration` with its `entityDir` before reading or editing its artifacts. It validates persistence and entity compatibility.
3. Stop on invalid configuration or unsafe Git membership. For setup or a reported missing preparation step, call `prepare_artifacts` and retry. It doesn't repair membership of files already in Git.

### Intake values

Before initialization, settle:

- the title and a standalone Request;
- Priority: a configured value or `not set`;
- new tracker work, or adoption of one explicitly selected Backlog or Todo object;
- for Task and Gig, the Deliverable kind; for Task, also the parent and accepted plan item its skill requires.

**New work:**

1. Build the Request from the user's input and agreed clarifications. The `/epic`, `/task`, and `/gig` commands wrap their argument in a generated label (`Epic:`, `Task:`, `Gig:`) and a routing line such as `Use the gig skill.`. Only the argument is user input.
2. Clean the title and Request (below) and present them together. The user may accept, edit, or reject.
3. Run preflight and create the tracker item only after the wording and the other intake values are approved ([initialize from the tracker object](./integrations/shared.md#initialize-from-the-tracker-object)).

**Adopted work:**

- Explicit selection of a Backlog or Todo object approves adoption. Use its title or name as the title, and its title or name plus description as the Request, with agreed clarifications and the cleanup below. Reuse its Priority and any available workflow Kind.
- Run the selected provider's read-only preflight, then call the matching init tool with the selected object, without a separate confirmation.
- Ask only for missing or conflicting information, such as Kind or the Task relationship. Ask before changing meaning, scope, Priority, or Kind.
- Never infer adoption from vague discussion. Never rename an adopted tracker item without separate approval.

**Cleaning the title and Request:**

- Correct spelling, capitalization, punctuation, sentence boundaries, and accidental formatting.
- Keep the user's meaning, intent, scope, emphasis, uncertainty, and level of detail.
- Keep code, commands, identifiers, paths, URLs, API names, product names, and quotes unchanged.
- Don't add requirements, facts, rationale, acceptance criteria, or technical decisions.
- When a correction could change meaning, keep the original and ask.

The initialization tool stores the title in `metadata.json` and the Request in `brief.md`. A new tracker item is created with the same approved title and Request.

### Tracker items and plan publication

- Every tracker item keeps its original request title or name and description. New items use the approved title and Request; adopted items keep their existing content.
- Accepted `epic.md` or `plan.md` publishes separately, as described in [provider bodies](./integrations/shared.md#provider-bodies): one issue comment on GitHub, one document attached to the issue or Project on Linear.
- GitHub records hold `planComment`; Linear records hold `planDocument`. Each is `unpublished`, `pending` with an opaque token, or `published` with that token and the confirmed native ID and URL. This is authoritative identity, kept in `metadata.json`, not a disposable Resource ID.

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

## Names and initial branches

- An entity's directory is `<reference>-<slug>`: `12-<slug>` for a GitHub issue, `ENG-12-<slug>` for a Linear issue, and `<YYYYMMDD>-<slug>` for a Linear Epic.
- The `identifier-title` branch format uses that name in lowercase; `username/identifier-title` prefixes it with `<username>/`. Only initialized entities get directories and branches.
- Epic and Gig start from and target the repository default branch. It's resolved, in order, from `origin/HEAD`, an existing workflow contract, the current attached local branch, or the sole local branch. A remote is optional.
- A Task copies its parent Epic's current target. The Task skill owns its prerequisites and parent relation.
- The initialization tool renders the one configured `branches.format` for every entity. Formats starting with `username` read `branches.username` from `.project/config.local.json` or global `workflows.json`; never infer it. The Linear `tracker` format uses exact issue branch names for Task and Gig, and the slug for an Epic (see [Linear tracker](./integrations/tracker/linear.md)). When configuring formats, read [setup](./setup.md#project-configuration).
- Approved repository operations remain lifecycle gates.

## Brief and local working state

Entity files sit directly in the entity directory.

- **`brief.md`:** only `# Brief`, a blank line, and the approved Request. Change the Request only with explicit user approval. Never add decisions, findings, questions, paths, provider data, checkpoints, or history.
- **`notes.md`:** free-form agent notes for transient context that doesn't belong in metadata, the draft, the accepted artifact, or a review round. Keep resume context here, and refresh it before compaction when possible. No lifecycle or completion gate.
- **`pending.md`** (Task and Gig): Markdown task-list entries for current-scope work found during execution.
  - An unchecked entry is active; checked entries may stay.
  - Independently schedulable or out-of-scope work needs separate approved intake.
  - Final review requires zero active entries.
  - A missing file, for example after a fresh checkout, counts as empty.
- **`draft.md`:** the mutable candidate. It never substitutes for accepted `epic.md` or `plan.md`.
- **`scratch/`:** temporary research, probes, scripts, and data.
- **`designs/`:** design sketches and iterations.
- Initialization creates the entity directory, `brief.md`, `metadata.json`, `notes.md`, `reviews/`, and `scratch/`. Task and Gig also get `pending.md` and `designs/`. Later gates create the rest.

## Project

```text
.project/
  config.json          # Required: branch format and review settings; committed.
  config.local.json    # Optional username for static username formats; always local.
  policies.md          # Optional repository-specific workflow additions or overrides; committed.
  integrations.json    # Required tracker and forge configuration, non-secret; committed; never entity state.
  .local/              # All workflow work; never committed.
    epics/             # Initialized Epics and their Tasks.
    gigs/              # Initialized standalone Gigs.
    pull-requests/     # Incoming PR evidence; no initialized entities.
```

### Incoming PR evidence

[Incoming PRs](./pr/incoming.md) keep private evidence under `.project/.local/pull-requests/<number>/`, including an approved nested checkout at `checkout/` and review rounds under `reviews/<base-sha>-<head-sha>/review-NNN/inputs/`. The `/.project/.local/` ignore rule covers the whole area. These records are evidence, not approvals, and create no entity, lifecycle, or branch contract. Never stage, commit, or publish them. The file inventory is in the [PR extension README](../extensions/pr/README.md#private-evidence-layout).

## Project Policy precedence

Precedence is in [core approvals](./core.md#approvals).

- Apply Project Policies unless the user explicitly overrides one in chat. Keep an active override for this work in `notes.md` until the accepted artifact or metadata reflects it.
- Change `.project/policies.md` only with the user's approval, when they want a permanent change for this repository.
- Use Project Policies to adapt the workflow for this repository, never by editing the reusable workflow files.

## Entity layouts

### Epic

```text
.project/.local/epics/<reference>-<slug>/   # <YYYYMMDD>-<slug> for a Linear Project
  brief.md             # Approved Request.
  metadata.json        # Tracker identity, Phase, branch contract, Task target.
  epic.md              # Accepted initiative contract and ordered Tasks.
  resource-ids.json    # Scoped Resource IDs; disposable, never lifecycle authority.
  notes.md
  draft.md
  scratch/
  reviews/plan-NNN/    # Review round files, below.
  tasks/
    <reference>-<slug>/
```

- `epic.md`, drafts, and review rounds appear only when their gates create them.
- A prospective Task is an untagged ordered line in accepted `epic.md`. Initialization adds its stable marker, `[#N]` or `[ENG-N]`, and child directory.
- Metadata holds the immutable branch identity and `taskTarget: epic | default`. Changing the pointer affects only Tasks initialized afterward.
- The approved Task delivery strategy and its rationale belong in reviewed `epic.md`. The initial pointer is not approval.
- Selecting default doesn't prove delivery. When initializing a default-target Task, read [Epic delivery](./epic.md).

### Task and Gig (Deliverables)

```text
.project/.local/epics/<epic>/tasks/<reference>-<slug>/
.project/.local/gigs/<reference>-<slug>/
  brief.md             # Approved Request.
  metadata.json        # Kind, tracker identity, Phase, branch contract, PR intent. A Task's parent comes from its directory.
  plan.md              # Accepted work plan.
  result.md            # Feature, Bugfix, Refactor, Chore: delivered outcome and actual verification.
  report.md            # Research, Audit: the result; kept when the work continues into implementation.
  resource-ids.json    # Scoped Resource IDs; disposable.
  notes.md
  pending.md
  draft.md
  designs/
  scratch/
  reviews/<phase>-NNN/ # Review round files, below.
```

- Task and Gig share the Deliverable lifecycle and these meanings. Only a Task has a parent Epic and may update parent Epic artifacts. Its parent identity is the containing Epic directory plus its exact marker.
- `metadata.branch` records the branch name, start, target, and whether the name was generated or tracker-provided.
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

- Durable provider records keep semantic identity, relationships, and PR intent.
- PR repository, head, and target intent is saved in `metadata.json` before the PR is created (see [submission](./deliverable/submission.md#open-the-pr)).
- Returned or explicitly selected PR numbers and URLs go straight into the Resource IDs file `resource-ids.json`. Recording a PR never changes `metadata.json`.
- The full inventory is in [integration roles](./integrations/shared.md#operations-and-resource-ids). Reads use strict current schemas and never rewrite saved data.

## Persistence and authority

The shared guard validates `.project/config.json` and persistence safety, reusing a successful check while the relevant local inputs are unchanged. `prepare_artifacts` forces a full check during setup or repair and adds only the permitted exclusions below. Neither changes the Git index.

- **In Git:** only `.project/config.json`, `policies.md`, and non-secret `integrations.json`.
- **Kept out by:** the `/.project/.local/` rule in `.gitignore`, which setup writes, and `/.project/config.local.json` in `.git/info/exclude`.
- **Preparation stops when** the ignore rule is missing, or any path under `.project/.local/` or `.project/config.local.json` is in Git or staged.
- Never stage, commit, push, or link a path under `.project/.local/`.
- Removing a path from Git needs separate user approval and is never automatic.

**Authority:**

- Artifacts, tracker identity, relationships, branch contracts, Phase, and review gates are authoritative. Every entity stores `phase` in `metadata.json`. When changing Phase, read [Phase](./phase.md).
- Lifecycle and Priority are native tracker Status and Priority, read fresh; nothing local stores them.
- Keep machine data valid and transient context in `notes.md`. Never store credentials in `.project/integrations.json`.

**Ownership:**

- The review tool writes each round's report, `review.md`, and diagnostics. `record_review_response` writes `response.md`. The main agent owns adjudication and approved source changes.
- Reflect every accepted change directly in the current authoritative artifact.
- Don't add unrelated files to entity roots.
