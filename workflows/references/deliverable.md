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
   - `plan.md`, any `result.md` or `report.md`, and the relevant local review round;
   - `<repo>/.project/policies.md` when present. Apply it throughout.

   Create missing notes or pending files when continuing local work.
3. Lifecycle authority:
   - workflow authority: read `status.md`;
   - tracker authority: that file must be absent; read lifecycle and Priority fresh from the provider.
4. Branch: require `metadata.branch.state: ready`. Switch to its `name` and verify its stored `start` and `target`. For a pending Linear branch, finish tracker binding and call `finalize_linear_branch` first. A ready branch contract is immutable. Never invent a branch name or base.

## Integration boundary

After initialization, call `initialize_integration` with the Deliverable `entityDir`. On resume, reuse the `resume_integration` result from the artifact gate.

- `disabled`: continue silently.
- `enabled`: read [integration roles](./integrations/shared.md), then the provider reference for each enabled role: [GitHub tracker](./integrations/tracker/github.md), [Linear tracker](./integrations/tracker/linear.md), or [GitHub forge](./integrations/forge/github.md). Report an unavailable role without blocking the other.
- Unavailable role, permission denial, invalid configuration, or provider failure: follow the [MCP boundary](./core.md#mcp-boundary). Never substitute workflow authority for an unavailable tracker.

After every accepted `plan.md` change, publish the plan as described in [provider bodies](./integrations/shared.md#provider-bodies).

## Kind strategy

Every Deliverable has exactly one kind: `feature`, `bugfix`, `refactor`, `research`, `audit`, or `chore`. Follow only the matching strategy; there is no generic fallback. Unless stated otherwise, use the shared [planning](./planning.md) protocol.

| Kind | Plan defines | Execution | Final review checks |
| --- | --- | --- | --- |
| `feature` | behavior and interfaces, ownership, affected files, docs, verification | implement the accepted plan | delivered behavior, integration, regressions, verification |
| `refactor` | structural goal, unchanged behavior and interfaces, invariants, migration boundary, verification | only behavior-preserving structural work | stated invariants hold; no unintended behavior change |
| `research` | question, required evidence, method, boundaries, intended output | read the repo and external sources; probes only under `scratch/`; no product changes | evidence supports conclusions; uncertainty is explicit |
| `audit` | scope, criteria, evidence sources, boundaries, report expectations | inspect without remediating; use an implementation kind for approved fixes | findings are evidenced, complete against scope, actionable |
| `chore` | maintenance outcome, affected config, docs, tooling, or code, constraints, verification | only that maintenance scope | requested outcome and practical verification |
| `bugfix` | see below | apply only the accepted fix and run its verification | the evidenced cause is fixed without regressions |

### Bugfix

1. Ask only for context that inspection can't recover and that changes reproduction, expected behavior, scope, evidence, or access. When enough is known, investigate.
2. Investigate the symptom and evidence before editing product code. When investigation exposes an unresolved product decision, stop and ask.
3. Once the cause is evidenced, write `draft.md` with Root cause, Symptom, Evidence, Cause, Proposed fix, and Verify. Then follow the shared plan review and acceptance.
4. Edit product code only after the plan is accepted.

### Research and audit reports

Write a durable `report.md` in the [reviewed document shape](./artifacts.md#reviewed-document-shape).

- The Overview states the question or scope, the key conclusion, and material uncertainty.
- The following sections keep the full evidence, findings, conclusions, and next steps. Use only relevant sections.
- A report is a result, not a transcript or a substitute for the plan.

When the user asks to change kind, read [kind changes](./deliverable/extras.md#changing-kind).

## Material replanning

When accepted behavior, strategy, scope, or decomposition must change after execution began, use [material replanning](./planning.md#material-replanning) before rewriting `draft.md`. Then repeat review, acceptance, publication, implementation, verification, and final review from the corrected plan.

## Reviews

Every plan, interim, and final review follows [review](./review.md).

- The reviewer only critiques, the main agent makes changes, and the user owns product decisions and approval.
- Reviews and correction loops run automatically once their prerequisites are met. Pause for unresolved user decisions and for the configured blocked-review checkpoint.
- Accepting the reviewed plan and accepting the final result are separate approvals.

## Implementation and verification

1. When implementation begins, set Execution through the Phase tool for the current authority. Lifecycle stays `inProgress`.
2. Implement the complete approved change at its owning abstraction. Leave unrelated working-tree changes untouched.
3. Run focused checks while developing. Run all plan and Project Policy verification before final review.
4. A Task runs its skill's parent synchronization. A Gig has none.
5. Create or update the completion artifact: `result.md` for feature, bugfix, refactor, and chore; `report.md` for research and audit. Never claim verification that didn't run.
6. Resolve every unchecked `pending.md` entry, or move it to separately approved work. A missing file counts as empty.
7. Set Self-Review, then call `review_task` or `review_gig` with `phase: "final"`. Repeat review and correction until approved, keeping the completion artifact current.
8. Stay in Self-Review while presenting the implementation and completion artifact for user review.
9. When user review leads to changes, return to Execution, update the artifact, then go back to Self-Review and rerun final review for every material change.
10. When the user accepts, read [submission](./deliverable/submission.md). When the user asks to ship, read [shipping](./deliverable/shipping.md).

**When the plan defines commit steps:**

- Run steps 1–9 for each step, so each one starts in Execution, with an interim review (`phase: "interim"`) in place of the final review.
- When the user accepts a step, read [commits](./deliverable/submission.md#commits) and commit it. Accepting a step authorizes only its commit, not a push or PR.
- Run the final review over the whole branch before submission.

## Completion artifact

Write `result.md` before final review so the reviewer sees the actual outcome:

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
- Keep the artifact current after every review change, implementation change, or rerun. A material change requires another final review.
- Present it with every user review and with final approval. Keep provider metadata and links out of it.
- Research or audit work that continues into implementation keeps `report.md` as prior evidence and adds `result.md`.

When the output is a UI mockup, layout, or visual concept, read [design artifacts](./deliverable/extras.md#design-artifacts).
