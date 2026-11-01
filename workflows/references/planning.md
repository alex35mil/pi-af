# Planning

The shared planning protocol for Epic, Task, and Gig. Entity and kind skills define plan content, and Bugfix defines when inquiry turns into investigation. When reviewing, read [review](./review.md). When changing Phase, read [Phase](./phase.md).

## Research and inquiry

1. **Inspect first.** Check relevant repository files, the parent Epic for a Task, and Project Policies before asking anything they can answer. Search or fetch external sources when they materially inform the plan, and record the evidence.
2. **Keep things in their place.**
   - The approved Request stays unchanged in `brief.md`.
   - Transient understanding, findings, and open questions go in `notes.md`.
   - Settled decisions go in `draft.md`, then the accepted artifact.

   Never leave required context only in chat.
3. **Ask only what matters.** Ask only questions whose answers can change behavior, outcome, scope, constraints, architecture, verification, or decomposition. For Bugfix, that includes reproduction and causal evidence. Ask one small coherent batch at a time, not a fixed questionnaire.
4. **Record answers before relying on them.** Update notes or the draft after each answer. Repeat until no material question remains. Bugfix inquiry may continue during investigation when new evidence raises a material question.
5. **Then proceed.** Bugfix starts investigating; every other kind, and Epic, writes the draft. The next user approval is accepting the reviewed plan's diff.

## Drafts

| Entity | Draft | Accepted artifact |
| --- | --- | --- |
| Epic | `draft.md` | `epic.md` |
| Task, Gig | `draft.md` | `plan.md` |

- Write the smallest self-contained draft that carries every settled decision. Entity skills define its content and review criteria.
- Use the [reviewed document shape](./artifacts.md#reviewed-document-shape): `## Overview` explains the brief and why it matters, then a few scope and behavior bullets under `### Plan highlights`, then the supporting sections.
- The Overview is reviewed and accepted with the details, not generated at publication. Keep the highlights in sync with plan changes.

## Plan review and acceptance

Lifecycle stays `inProgress` and Phase stays Planning throughout: drafting, review, corrections, presentation, and waiting for approval.

1. Set Planning with the Phase tool for the configured tracker. Then call `review_epic`, `review_task`, or `review_gig` with `entityDir` and `phase: "plan"`. The tool snapshots the draft and numbers the round.
2. Adjudicate every finding as described in [review](./review.md). Repeat until review approves with no unresolved user decision.
3. When review approves, call `prepare_epic_plan_presentation`, `prepare_task_plan_presentation`, or `prepare_gig_plan_presentation` with `entityDir`. It returns the approved snapshot path and the target path. Read the snapshot and write its exact content to the target with the write tool, which shows the user the approval diff. Don't print the candidate first. When the plan is already published, the result asks for the [announcement](./integrations/shared.md#plan-update-announcements) summary; show it in the same message as the diff.
4. A rejection or an unresolved user note blocks progress. Discuss notes before changing the draft or rerunning review.
5. When the user edits the target directly, compare it with the reviewed snapshot. Editorial edits may proceed. A material change to behavior, strategy, or decomposition goes back into the draft and through review again.
6. Before acceptance, record every material user note in the accepted artifact or `notes.md`, whichever owns it. The root `epic.md` or `plan.md` is the only accepted plan.
7. On acceptance, set Execution. Lifecycle stays `inProgress`.

Review criteria and what happens after acceptance are entity-specific. Round numbering, adjudication, signoff parsing, and diff presentation are shared.

## Material replanning

When accepted behavior, strategy, scope, or decomposition must change after execution began:

1. Refuse when lifecycle is `done`; separately initialized work owns later changes.
2. When lifecycle is `inReview`, restore `inProgress`: update and re-read native Status.
3. Set Planning with the Phase tool and apply any returned native assignment.
4. Copy the accepted artifact into `draft.md`, make the change there, and repeat plan review and acceptance. Show the [announcement](./integrations/shared.md#plan-update-announcements) summary with the diff.

Editorial changes that don't alter behavior, strategy, scope, or decomposition skip replanning. A published plan's editorial change is still announced; its summary says it's editorial.
