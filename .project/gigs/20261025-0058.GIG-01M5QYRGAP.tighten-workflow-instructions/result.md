# Result

## Overview

- **Commit A, size and structure.** Skills now load only what they list under `## Read first`. Every other reference is read only when its step is reached. Starting a Gig loads 38 KB instead of about 249 KB.
- **New files:**
  - `references/core.md` owns the shared rules: tool discovery and evidence shape, the MCP boundary, outcomes and recovery, approvals, and migrations;
  - step files for submission, shipping, and rare Deliverable situations;
  - `integrations/recovery.md`.
- **Maintainer notes moved out of agent instructions:** publication module ownership, terminology policy, and the incoming-PR evidence inventory now live in extension READMEs.
- **Multiple commits:** a Deliverable may have several commits within its accepted scope. Each planned commit step gets an interim review and user review, then a commit. Forge PR intent is saved before staging the last commit and committed with the work.
- **Cleanup input:** `cleanup_github_delivery_branch` takes the merged PR read as `evidence` and validates it with the same code as `prepare_integration_merge`.
- **Shipping terminology:** "shipping" replaces "finish" for the Deliverable merge, Done, and cleanup sequence, matching incoming-PR shipping. Names for an activity use nouns ("shipping", "cancellation"), because "ship" as a noun reads as a vessel. This is a breaking rename with no aliases:
  - `deliverable/shipping.md` replaces `deliverable/finish.md`;
  - `prepare_integration_shipping` replaces `prepare_integration_finish`;
  - `roles.forge.shipping` replaces `roles.forge.finish`;
  - `shippingRead` and `shippingMerge` replace `finishRead` and `finishMerge`;
  - `shippingReadDecision` replaces `finishReadDecision`;
  - `plan_incoming_pr_shipping` and `plan_incoming_pr_cancellation` replace `plan_incoming_pr_ship` and `plan_incoming_pr_cancel`;
  - incoming Project `action` values `"shipping"` and `"cancellation"` replace `"ship"` and `"cancel"`;
  - error messages and all guidance wording follow ("request to ship", "shipping approval", "explicit cancellation", `## Cancellation`).

  The verb stays where it is a verb: "ship it", "asks to ship", "request to cancel", "Ship or cancel an incoming PR". "finish it" stays only as a user trigger phrase. `UPGRADING.md` maps each released old name to its new one.
- **Guards against regrowth:**
  - `workflows/STYLE.md`, and a path-scoped rule pointing guidance editors to it;
  - a test that forbids `## Read first` outside skills;
  - a per-skill size-budget test.
- **Limitation:** commits B–D (readability rewrites) haven't started. Total guidance shrank only slightly in A, because A mostly moves text. The ≥35% total reduction target applies after D.

## Measurements

Up front means the skill file plus files listed under its `## Read first`.

| Skill | Baseline literal closure | After A, Read first | After A, literal closure* | Budget |
| --- | --- | --- | --- | --- |
| gig | 249 KB (21 files) | 38.1 KB | 82 KB (6 files) | 41.5 KB |
| task | 254 KB (21) | 42.7 KB | 87 KB (6) | 46.5 KB |
| epic | 239 KB (20) | 46.0 KB | 237 KB (23) | 50.0 KB |
| pr | 218 KB (18) | 41.3 KB | 38 KB (5) | 45.5 KB |
| project-setup | 256 KB (19) | 80.6 KB | 260 KB (23) | 88.6 KB |
| backlog | 141 KB (12) | 12.1 KB | 1 KB (1) | 13.5 KB |
| todo | 142 KB (12) | 12.4 KB | 1 KB (1) | 13.7 KB |

\* The literal closure is the old measurement: every Markdown link in any sentence mentioning "read" or "follow". It over-counts now that links say "When …, read …", which is why epic and project-setup still show high values. The convention-based Read first size is what the budget test enforces.

Total guidance (references, skills, `workflows/README.md`, `MIGRATIONS.md`): about 336 KB before, 327 KB after A.

## Verification

- `npm test`: 670 pass, 0 fail.
- `npm run typecheck`: passes.
- Structural tests pass:
  - links and heading anchors;
  - reachability, including core, recovery, merge, and the three Deliverable step files from Task and Gig;
  - core and migrations reachable from every skill;
  - no `Read first` heading outside skills, at any heading level and whatever list style follows;
  - every bulleted or numbered `Read first` item is counted, including blank-separated ones;
  - size budgets.
- Finish check: `grep -rniE '\bfinish'` over `workflows/`, `tests/`, `README.md`, and `UPGRADING.md` returns only the retained meanings: the "finish it" trigger, "finish tracker binding" and "finish parent binding", pagination, stream `finish` events, finished or unfinished lifecycle wording, contributor review, and metadata ordering. It also returns the upgrade note naming old names, and the gitignored transition file `workflows/transition/finish-legacy-work.md`, which is outside Git and refers to legacy work, not shipping.
- Identifier check: `prepare_integration_ship`, `ship(Read|Merge|ReadDecision)`, and `forge.ship`, the intermediate names that were never released, appear nowhere. `plan_incoming_pr_ship`, `plan_incoming_pr_cancel`, and the `"ship"` / `"cancel"` action values appear only in the `UPGRADING.md` mapping table.
- Prose check: `grep -rniE '\b(ship|cancel|shipment)\b'` over every file type in `workflows/` (Markdown and the extension code, which holds tool descriptions), `README.md`, and `UPGRADING.md` returns only verb uses. "Shipment" was replaced with "shipping". Reviewed list:
  - `deliverable/shipping.md`: the "Ship a Deliverable" title, "asks to ship" with the "ship it" and "ship this" triggers, and "request to ship" twice;
  - `deliverable/submission.md`: "request to ship" with the triggers;
  - `deliverable.md`: "asks to ship";
  - `pr/shipping.md`: the "Ship or cancel an incoming PR" title, "request to ship and merge" three times, "merely to ship it", and "request to cancel";
  - `pr/incoming.md`, `skills/pr/SKILL.md`: "request to ship and merge";
  - tool descriptions in `extensions/pr/checkout.ts` and `extensions/integrations/forge/github/incoming-pr-context.ts`: "request to ship and merge";
  - `integrations/shared.md`, `forge/merge.md`, `workflows/README.md`: "request to ship";
  - `UPGRADING.md`: the released `"ship"` / `"cancel"` action values in the mapping table.

  In `tests/`, the only matches are fixture request text ("Ship Tasks independently", "Ship first"), which also uses the verb.
- The tool inventory test confirms `prepare_integration_shipping`, `plan_incoming_pr_shipping`, and `plan_incoming_pr_cancellation` are registered and the old names aren't.
- Cleanup tests cover the new `evidence` input: valid merged PR, unmerged PR, wrong PR number, head SHA mismatch, and wrong tool.
- Rule map: `.local/scratch/rule-map-A.md`. All 138 changed normative sentences are accounted for: 116 are confirmed automatically, and 22 are mapped by hand to their new homes.

**Not run:**

- Live end-to-end workflow run under the new structure: the restructure changes instructions only. This Gig itself now runs on the new files from commit B onward.
