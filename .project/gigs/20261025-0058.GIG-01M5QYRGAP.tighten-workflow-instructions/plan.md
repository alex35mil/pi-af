# Tighten workflow instructions and cap their context size

## Overview

Workflow instructions have grown faster than the behavior they describe. Starting a Gig currently pulls in about 249 KB of instructions (21 of 22 workflow files), because nearly every reference tells the agent to read the others, and the text has become hard to follow, so agents misread rules. This Gig makes the instructions shorter and clearer without changing workflow behavior or weakening safeguards. It also adds guards so they don't grow back.

The work ships as four commits on one branch and one PR. Each commit is a self-contained step within the Deliverable's scope. Each one goes through an adversarial interim review and then the user's review before the next begins.

### Plan highlights

- **Commit A, size and structure.**
  - Define one explicit convention for what a skill reads up front ("Read first") and what it reads only at a later step ("When … read …").
  - Remove the eager links that pull setup-only, queue-only, and other step-specific content into every Gig and Task.
  - Move rarely used procedures into files read only at that step.
  - Give each shared rule one owner.
  - Add an instruction style guide and a per-skill size-budget test.
  - Make evidence-consuming tools accept one `evidence` input shape, and tell agents to check `describeTool` before a first call.
- **Commit B:** rewrite the Deliverable, Epic, Task, Gig, review, planning, phase, and integration references for readability.
- **Commit C:** rewrite the setup reference and the `project-setup` skill.
- **Commit D:** rewrite the incoming-PR references.
- Multiple commits within a Deliverable's scope become normal workflow behavior, replacing the "one submission commit" rule. Squash merge stays.
- "Shipping" replaces "finish" for the Deliverable merge, Done, and cleanup sequence, matching incoming-PR shipping. Activity names use nouns (`shipping`, `cancellation`), including the incoming-PR `plan_incoming_pr_shipping` and `plan_incoming_pr_cancellation` tools. The rename covers files, guidance, tool names, operation identifiers, action values, result fields, and internal functions, with no aliases.
- Safeguards, approvals, permission boundaries, and recovery behavior stay unchanged. Only how they are written and where they live changes.
- Success criteria:
  - Gig and Task each load at most ~70 KB up front (Gig is ~249 KB today; Task ~254 KB);
  - total workflow guidance shrinks by at least 35% from ~336 KB;
  - the size-budget test locks in the measured result plus ~10% headroom.

## User decisions

- One Gig with four commits, not an Epic and not follow-up issues. All commits must stay within this Deliverable's scope.
- Multiple commits per Deliverable are allowed in general. The workflow rewrite includes this rule change.
- Delivery cycle for each commit: implement, run adversarial interim review, present for user review, then commit and start the next. The final review covers the whole branch before submission.
- Squash merge stays the repository merge policy.
- The evidence-shape code change ships in this Gig, as part of commit A.
- The size budget is measured after the work plus ~10% headroom, not fixed round numbers.
- Use "shipping", not "finish", everywhere, tool names included. Activity names use nouns ("shipping", "cancellation"), not the bare verbs "ship" and "cancel". The maintainer is the primary user, so breaking renames are acceptable and old names get no aliases or shims.

## Baseline

Measured on `main@3931331` with `.local/scratch/measure.mjs`. Today there is no eager/conditional convention, so the baseline counts every Markdown dependency, backticked or linked, in any sentence that says read or follow, transitively. That is effectively what an agent following the instructions literally will load.

| Skill | Up front | Files |
| --- | --- | --- |
| gig | 249 KB | 21 |
| task | 254 KB | 21 |
| epic | 239 KB | 20 |
| project-setup | 256 KB | 19 |
| pr | 218 KB | 18 |
| backlog | 141 KB | 12 |
| todo | 142 KB | 12 |

For comparison, the full link graph of every skill reaches all 22 files (~251–287 KB). An earlier estimate of ~131 KB for a Gig counted only the first path in each instruction and missed Markdown links. It was wrong.

Total guidance (references, skills, `workflows/README.md`, `MIGRATIONS.md`): ~336 KB. Largest files: `setup.md` 40 KB, `project-setup` skill 37 KB, `pr/incoming.md` 33 KB, `artifacts.md` 24 KB, `deliverable.md` 21 KB, `integrations/shared.md` 20 KB, `pr/checkout.md` 18 KB.

## Commit A: size and structure

### Eager and conditional reading convention

Every skill and reference marks dependencies in one of two ways, and nothing else counts:

- **Eager:** a `## Read first` section at the top, containing only a list of links. The agent reads these before starting. Only skills and `core.md` may have one; references don't chain eager reads.
- **Conditional:** any other link, written as "When <situation>, read <link>". The agent reads it only when that step is reached.

The size-budget test computes each skill's up-front size as the skill file plus the files listed in its `## Read first` section, plus `core.md`'s own `## Read first`. A structural test fails when a reference other than `core.md` has a `## Read first` section, so eager chains can't come back.

### Remove setup-only and queue-only content from the Deliverable path

- `artifacts.md` currently sends every Gig and Task to `setup.md` (39 KB) for branch formats. Move the few runtime-relevant branch rules into `artifacts.md` and keep `setup.md` setup-only.
- `integrations/shared.md` links `queue.md` for one queue-intake sentence. Inline that sentence; `queue.md` stays reachable for Backlog, Todo, and reporting through their skills and `communication.md`.

### Load rare procedures on demand

Create step-specific references. Their parents link to them as "when you reach X, read Y" rather than reading them up front:

- `deliverable/shipping.md`: explicit ship request, merge, Done, and cleanup (today `deliverable.md` steps 12–14 and the matching GitHub-forge section).
- `deliverable/submission.md`: commit, push, PR creation, and resubmission (today `deliverable.md` Submission).
- `integrations/recovery.md`: uncertain-outcome and pending-publication recovery, including the long GitHub-comment and Linear-document recovery steps from `shared.md`.
- Design artifacts, kind changes, and migrations move into `deliverable/extras.md`, read only when that situation arises.

Update the structural reachability test to cover the new files: each must still be reachable from the skills that need it.

### One owner per shared rule

Create `references/core.md`, read by every skill, at most ~4 KB. It owns, once:

- the MCP boundary (call registered tools; never bypass them with HTTP, `gh`, another client, or an SDK);
- uncertain-outcome handling (read state before retrying; never blindly repeat a non-idempotent create);
- clear-success trust;
- the approval model (what each approval authorizes);
- tool discovery: call `describeTool` before the first call to any workflow tool, and let schema errors guide corrections.

Other files refer to these rules by name instead of restating them. `phase.md` stays the single owner of Phase transitions; other files link to it instead of repeating the table.

### Move maintainer notes out of agent instructions

Move module ownership (`publication.ts` and related files), the term-usage policy for code and tests, and the incoming-PR evidence file inventory into the relevant `workflows/extensions/*/README.md`.

### Multiple commits per Deliverable

Replace the "one focused submission commit" rule in `deliverable.md`, `forge/github.md`, `artifacts.md`, `integrations/shared.md`, and `workflows/extensions/integrations/README.md`:

- A Deliverable may have several commits, each within its accepted scope.
- When the plan defines commit steps, each one is implemented, interim-reviewed, and presented for user review before the next begins.
- Forge `begin_resource_creation` must finish before the first push, and its metadata change goes into a Deliverable commit, not a follow-up commit.
- The squash merge still yields one commit on the target.

### Shipping terminology

Rename the Deliverable "finish" concept to "shipping" everywhere it names that sequence. Names that denote the activity use nouns: "shipping" and "cancellation", not the verbs "ship" and "cancel". As a noun, "ship" reads as a vessel. The verb stays only where it is used as a verb ("ship it", "when the user asks to ship", "request to ship").

| Today | After |
| --- | --- |
| `references/deliverable/finish.md` | `references/deliverable/shipping.md` |
| `prepare_integration_finish` tool | `prepare_integration_shipping` |
| `finishRead` / `finishMerge` context operations | `shippingRead` / `shippingMerge` |
| `roles.forge.finish` result field | `roles.forge.shipping` |
| `finishReadDecision` function | `shippingReadDecision` |
| `plan_incoming_pr_ship` / `plan_incoming_pr_cancel` tools | `plan_incoming_pr_shipping` / `plan_incoming_pr_cancellation` |
| incoming Project `action: "ship" \| "cancel"` values | `"shipping" \| "cancellation"` |
| guidance wording: "finish request", "What finish authorizes", "explicit finish", "ship request" | "request to ship", "What shipping authorizes", "explicit request to ship" |
| noun uses of "ship": "ship approval", "ship intent", "ship procedure", "ship-evidence", "ship addressing", "ship/merge request" | "shipping approval", "shipping intent", "shipping procedure", "shipping evidence", "shipping addressing", "request to ship and merge" |
| noun uses of "cancel": "explicit cancel", "cancel request", "cancel plan", the `## Cancel` heading | "explicit cancellation", "request to cancel", "cancellation plan", `## Cancellation` |

- The rename happens entirely in commit A. It covers every use of "finish" that means the Deliverable sequence across `workflows/` (references, skills, extension code and READMEs, `README.md`, `STYLE.md`), `tests/`, the root `README.md`, and `UPGRADING.md`. That includes:
  - files commits B–D rewrite later, such as `forge/merge.md`, `pr/*.md`, `setup.md`, and the `project-setup` skill;
  - runtime error strings, such as "finish requires exact PR evidence" and "finish operations require a Task or Gig";
  - local variables.
- These meanings of "finish" stay: the user trigger phrase "finish it", "finish tracker binding", stream `finish` events, "finished" or "unfinished" lifecycle wording, "finish pagination", and similar uses unrelated to the Deliverable sequence.
- Historical artifacts under `.project/` (past Gig plans and results) aren't renamed or searched. This Gig's own `plan.md` and `result.md` are current documents: after the rename, update `result.md` to describe it and use "shipping" wording.
- Update the skill grants, the tool inventory fixture, tests, `tools.md`, and extension READMEs.
- `UPGRADING.md` maps only released old names to new names:
  - `prepare_integration_finish` → `prepare_integration_shipping`;
  - `roles.forge.finish` → `roles.forge.shipping`;
  - `plan_incoming_pr_ship` → `plan_incoming_pr_shipping`;
  - `plan_incoming_pr_cancel` → `plan_incoming_pr_cancellation`;
  - incoming Project `action` values `ship` and `cancel` → `shipping` and `cancellation`.

  Never mention the intermediate `ship*` names that were never released.
- No aliases or compatibility readers.

### Evidence input consistency

- `cleanup_github_delivery_branch` takes `{ entityDir, completionAuthority, evidence: { tool, arguments, response } }` with the exact configured `pull_request_read:get` evidence. It extracts merge facts using the same parser as `prepare_integration_merge` (`planGitHubMerge` in `forge/github/merge.ts`), so both tools validate the same facts the same way.
- Remove the pre-extracted `merge` input.
- Behavior stays the same: cleanup still requires merged state, the recorded PR number, repository, head, base, and a head SHA matching the local branch.
- Update tool tests (`workflow-delivery-cleanup.test.ts`, `workflow-instructions.test.ts` schema keys) and guidance.

### Guards against regrowth

- `workflows/STYLE.md`, about 1–2 KB, is a maintainer guide not loaded by skills. It covers:
  - imperative steps and one rule per bullet;
  - positive rules before exceptions;
  - tables for state machines;
  - no slash lists;
  - "exact" only where it changes behavior;
  - steps of at most ~40 words;
  - link to the owner instead of restating a rule;
  - leave input shapes to tool schemas.
- Link `STYLE.md` from `workflows/README.md`. Add a path-scoped rule in `.agents/rules/` for `workflows/**/*.md` that points agents editing guidance to it.
- A test in `tests/workflow-instructions.test.ts` measures each skill's up-front bytes using the `## Read first` convention above, and fails above a per-skill budget table. Commit A reports the convention-based size and the old literal measurement side by side, so the comparison is explicit. Commit A sets the budgets; B to D may only lower them.

## Commits B–D: readability rewrites

Apply `STYLE.md` to each file without changing behavior.

- **B:**
  - `deliverable.md` and its new step files, `artifacts.md`, `planning.md`, `review.md`, `phase.md`, `communication.md`, `epic.md`, `tools.md`;
  - the epic, task, gig, backlog, and todo skills;
  - `integrations/shared.md`, `tracker/github.md`, `tracker/linear.md`, `forge/github.md`, `forge/merge.md`;
  - `queue.md` and `workflows/README.md`.
- **C:** `setup.md` and `skills/project-setup/SKILL.md`. Setup-only detail stays with setup but is reorganized by decision. Rare provisioning detail moves to step files under `references/setup/`.
- **D:** `pr/incoming.md`, `pr/checkout.md`, `pr/project.md`, `pr/shipping.md`, `pr/automation.md`, and `skills/pr/SKILL.md`.

Each rewrite:
- keeps every rule, approval, and safeguard;
- removes restatements of rules owned elsewhere;
- fixes known slips (for example "Strict scoped scoped Resource IDs");
- shortens the root `README.md` `/pr` bullet;
- lowers the size budgets to the new measured values plus ~10%.

## Behavior-preservation check

For each commit, before interim review, list every normative rule (must, never, only, requires, approval) in the changed files before and after. Map each old rule to its new location or to the owning rule it now references, and record the mapping in `.local/scratch/rule-map-<commit>.md`. The interim reviewer gets that mapping as an input. A rule with no new home is a defect, not a simplification, unless the user approves removing it.

## Out of scope

- Workflow behavior changes beyond the multiple-commit rule, the cleanup input shape, and the shipping and cancellation renames.
- #87 (pending publication recovery) and #71 (redundant runtime work). This Gig may make them easier but doesn't fix them.
- `/submit` and `/shipit` commands (#29, #30).

## Verification

- `npm test` and `npm run typecheck` pass after every commit.
- Structural tests pass: links, anchors, reachability including the new step files, grants, setup JSON examples, and the new size budget.
- Re-run `.local/scratch/measure.mjs` (literal read/follow closure) and the convention-based budget test after each commit. Report the per-skill up-front size and the total in `result.md` against the baseline.
- Cleanup tool tests cover the new `evidence` input: valid merged evidence, wrong PR number, unmerged PR, head SHA mismatch, and wrong tool.
- After the rename, `git grep -niE '\bfinish' -- workflows tests README.md UPGRADING.md` returns only the retained meanings listed under Shipping terminology. Any other match is a failure.
- `git grep -nE 'prepare_integration_ship\b|plan_incoming_pr_(ship|cancel)\b|\bship(Read|Merge|ReadDecision)\b|forge\??\.ship\b|"(ship|cancel)"' -- workflows tests README.md UPGRADING.md` returns only `UPGRADING.md` lines naming the released `plan_incoming_pr_ship`, `plan_incoming_pr_cancel`, and `"ship"` / `"cancel"` action values. The unreleased `prepare_integration_ship`, `ship(Read|Merge|ReadDecision)`, and `forge.ship` must return nothing anywhere, `UPGRADING.md` included.
- Prose check: `git grep -niE '\b(ship|cancel)\b' -- workflows README.md UPGRADING.md` may return only verb uses, such as "ship it", "asks to ship", "request to cancel", and the "Ship or cancel an incoming PR" title. In `UPGRADING.md` it may also return the released old names (`plan_incoming_pr_ship`, `plan_incoming_pr_cancel`, and the `"ship"` / `"cancel"` action values). The `UPGRADING.md` section heading uses the noun ("Shipping terminology and evidence inputs"). Record the reviewed match list in `result.md`.
- The tool inventory test confirms the new tool names are registered and the old ones aren't.
- Each commit's rule map is complete and has no unmapped rules.
