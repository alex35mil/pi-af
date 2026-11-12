# Deliverable

Task and Gig are the two Deliverable variants. Both follow this lifecycle exactly. Their skills add only initialization and, for Task, parent synchronization.

Related files, read when the step is reached:

- When writing or reading artifacts, read [artifacts](./artifacts.md).
- When planning, read [planning](./planning.md).
- When running or adjudicating any review, read [review](./review.md).
- When writing human-facing text or prose artifacts, read [communication](./communication.md).
- When changing Phase or lifecycle, read [Phase](./phase.md).

## Resume

1. Follow the preparation and entity-selection gates in [artifacts](./artifacts.md#initialization-inputs).
2. Read:
   - `brief.md`, `metadata.json`, `notes.md`, and `pending.md` when present;
   - `plan.md` when the work is planned, any `result.md` or `report.md`, and the relevant local review round;
   - `<repo>/.project/policies.md` when present. Apply it throughout.

   Create missing notes or pending files when continuing local work.
3. Read lifecycle and Priority fresh from the tracker.
4. Branch: switch to the stored branch `name` and verify its stored `start` and `target`. The branch contract is immutable. Never invent a branch name or base.

## Integration boundary

Initialization starts from the tracker object ([integration roles](./integrations/shared.md#initialize-from-the-tracker-object)), then `initialize_integration` sets up the board. On resume, reuse the `resume_integration` result from the artifact gate.

- Read [integration roles](./integrations/shared.md), then the provider reference for each role: [GitHub tracker](./integrations/tracker/github.md) or [Linear tracker](./integrations/tracker/linear.md), and [GitHub forge](./integrations/forge/github.md). Report an unavailable role without blocking the other.
- Permission denial, invalid configuration, or provider failure: follow the [MCP boundary](./core.md#mcp-boundary). Nothing local replaces an unavailable tracker.

After every `plan.md` change, publish the plan as described in [provider bodies](./integrations/shared.md#provider-bodies). Once it's published, each change posts a one-line [plan-update note](./integrations/shared.md#plan-update-notes), without asking.

## Kind strategy

Every Deliverable has exactly one kind: `feature`, `bugfix`, `refactor`, `research`, `audit`, or `chore`. Follow only the matching strategy; there is no generic fallback. Unless stated otherwise, use the shared [planning](./planning.md) protocol, including its choice of the direct or planned path.

| Kind | Plan defines | Execution | Final review checks |
| --- | --- | --- | --- |
| `feature` | behavior and interfaces, ownership, affected files, docs, verification | implement the plan | delivered behavior, integration, regressions, verification |
| `refactor` | structural goal, unchanged behavior and interfaces, invariants, migration boundary, verification | only behavior-preserving structural work | stated invariants hold; no unintended behavior change |
| `research` | question, required evidence, method, boundaries, intended output | read the repo and external sources; probes only under `scratch/`; no product changes | evidence supports conclusions; uncertainty is explicit |
| `audit` | scope, criteria, evidence sources, boundaries, report expectations | inspect without remediating; use an implementation kind for approved fixes | findings are evidenced, complete against scope, actionable |
| `chore` | maintenance outcome, affected config, docs, tooling, or code, constraints, verification | only that maintenance scope | requested outcome and practical verification |
| `bugfix` | see below | apply only the planned fix and run its verification | the evidenced cause is fixed without regressions |

### Bugfix

1. Ask only for context that inspection can't recover and that changes reproduction, expected behavior, scope, evidence, or access. When enough is known, investigate.
2. Investigate the symptom and evidence before editing product code. When investigation exposes an unresolved product decision, stop and ask.
3. Once the cause is evidenced, write `plan.md` with Root cause, Symptom, Evidence, Cause, Proposed fix, and Verify. Then follow the shared [Task and Gig plan](./planning.md#task-and-gig-plans) steps.
4. Edit product code only after the plan review cycle finishes. When the report makes the cause evident, the direct path skips steps 2 and 3.

### Research and audit reports

Write the report as `report.md` in the [reviewed document shape](./artifacts.md#reviewed-document-shape).

- The Overview states the question or scope, the key conclusion, and material uncertainty.
- The following sections keep the full evidence, findings, conclusions, and next steps. Use only relevant sections.
- A report is a result, not a transcript or a substitute for the plan.

When the user asks to change kind, read [kind changes](./deliverable/extras.md#changing-kind).

## Reviews

Every plan, interim, and final review follows [review](./review.md).

- The reviewer only critiques, the main agent makes changes, and the user owns product decisions.
- Reviews run automatically once their prerequisites are met. Pause only for a decision the user must make.

## Implementation and verification

1. When implementation begins, set Execution through the Phase tool for the configured tracker. Lifecycle stays `inProgress`.
2. Implement the complete change at its owning abstraction. Leave unrelated working-tree changes untouched.
3. Run focused checks while developing. Run all plan and Project Policy verification before final review.
4. A Task runs its skill's parent synchronization. A Gig has none.
5. Write or update the [completion artifact](#completion-artifact): `result.md` for feature, bugfix, refactor, and chore; `report.md` for research and audit. Never claim verification that didn't run.
6. Resolve every unchecked `pending.md` entry, or move it to separately queued work. A missing file counts as empty.
7. Set Self-Review, then call `review_task` or `review_gig` with `phase: "final"` and handle the cycle. The reviewer sees the completion artifact and every change on the branch.
8. **Stop with one message:**
   - the completion artifact's Overview;
   - any open concerns from the review, one line each;
   - for a Task, any edit made to the parent `epic.md`, in one line;
   - that nothing is pushed, and whether commit steps were committed locally.

   Then wait for "submit" or "ship it". Verification and the walkthrough stay in the artifact; they appear in the PR's folded sections.
9. **A fix the user asks for now:** apply it, rerun the affected checks, and update the completion artifact. Run a new final review, with `newReview`, only when the fix changes behavior.
10. When they ask to submit, read [submission](./deliverable/submission.md); when they ask to ship, read [shipping](./deliverable/shipping.md). Neither needs a prior acceptance of the completion artifact.

**When the plan defines commit steps:** run steps 1–6 for each step, then read [commits](./deliverable/submission.md#commits) and commit it locally once its checks pass. Nothing is pushed before "submit". Run an interim review (`phase: "interim"`) first only when the step is risky or the user asks for one. After the last step, continue with step 7; the final review covers the whole branch.

## Completion artifact

Write the completion artifact directly, before final review, so the reviewer can check its claims against the work. Both kinds use this shape:

```markdown
# Result

## Overview

- A concise walkthrough of the delivered behavior, why it matters, and material implementation or integration changes.
- Material limitations or intentionally unchanged boundaries.

## Implementation walkthrough

Optional deeper code or architecture explanation; omit when unnecessary.

## Verification

- `<command or manual check>` — `<actual result>`

**Not run:**

- `<planned check>` — `<specific reason>`
```

- Describe actual outcomes, not plans or a transcript. It must make sense without the conversation.
- Include only the delivered behavior, material changes, limitations, and verification of the Deliverable itself. Leave out workflow housekeeping: tracker or forge state, lifecycle, Priority, labels, review state, projection, and branch, PR, or merge steps.
- Omit the **Not run** list when every planned check ran.
- Keep it current after every review change, implementation change, or rerun. Keep provider metadata and links out of it.
- Research or audit work that continues into implementation keeps `report.md` as prior evidence and adds `result.md`.

When the output is a UI mockup, layout, or visual concept, read [design artifacts](./deliverable/extras.md#design-artifacts).
