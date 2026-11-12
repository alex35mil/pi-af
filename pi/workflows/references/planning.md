# Planning

The shared planning protocol for Epic, Task, and Gig. Entity and kind skills define plan content, and Bugfix defines when inquiry turns into investigation. When reviewing, read [review](./review.md). When changing Phase, read [Phase](./phase.md).

## Research and inquiry

1. **Inspect first.** Check relevant repository files, the parent Epic for a Task, and Project Policies before asking anything they can answer. Search or fetch external sources when they materially inform the work, and record the evidence.
2. **Keep things in their place.**
   - The approved Request stays unchanged in `brief.md`.
   - Transient understanding, findings, and open questions go in `notes.md`.
   - Settled decisions go in the plan.

   Never leave required context only in chat.
3. **Ask only what matters.** Ask only questions whose answers can change behavior, outcome, scope, constraints, architecture, verification, or decomposition. For Bugfix, that includes reproduction and causal evidence. Ask them in one batch, not a fixed questionnaire.
4. **Record answers before relying on them.** Update notes or the plan after each answer. Bugfix inquiry may continue during investigation when new evidence raises a material question.

## Choose the path

A Task or Gig takes one of two paths. Say which in one line before continuing. "plan it" and "just do it" override the choice.

| Path | When | What it skips |
| --- | --- | --- |
| Direct | The request already determines the change and leaves no design decision: documentation edits, version bumps, configuration changes, fixes whose cause is evident | `plan.md`, plan review, and plan publication |
| Planned | Everything else | Nothing |

- A direct-path Deliverable goes straight to [implementation](./deliverable.md#implementation-and-verification). Its final review takes the brief as the requirement.
- A Bugfix takes the direct path only when the report makes the cause evident. Otherwise it investigates and plans with the root cause.
- An Epic always plans.

## Writing the plan

| Entity | Plan |
| --- | --- |
| Epic | `epic.md` |
| Task, Gig | `plan.md` |

- Write the plan directly. It's the only plan file; there is no separate draft.
- Write the smallest self-contained plan that carries every settled decision. Entity skills define its content and review criteria.
- Use the [reviewed document shape](./artifacts.md#reviewed-document-shape): `## Overview` explains the brief and why it matters, then a few scope and behavior bullets under `### Plan highlights`, then the supporting sections. Keep the highlights in sync with plan changes.

## Task and Gig plans

The plan informs the user; it doesn't wait for approval.

1. Set Planning with the Phase tool for the configured tracker, then call `review_task` or `review_gig` with `phase: "plan"`. Handle the cycle as described in [review](./review.md).
2. Publish the plan, as described in [provider bodies](./integrations/shared.md#provider-bodies), and set Execution.
3. Send one message: about five highlights, any open concerns from the review, and any questions.
4. With no question, continue into implementation in the same turn. The user can interrupt at any time.

## Epic plans

Accepting an Epic plan creates tracker issues, so it waits for the user.

1. Set Planning, then call `review_epic` with `phase: "plan"` and handle the cycle as described in [review](./review.md).
2. Summarize the plan and its Task list in chat, with any open concerns, and wait for the user's acceptance.
3. On acceptance, call `accept_epic_tasks`, then continue as the Epic skill describes.

## Changing a plan

- **A decision the user makes in chat is final.** Edit the plan, republish it with a one-line [plan-update note](./integrations/shared.md#plan-update-notes), and continue. Phase stays where it is, and nothing is re-reviewed.
- **When behavior or scope must differ from the plan,** ask. The answer is a chat decision. Implementation detail never changes the plan.
- **Done work** refuses changes; separately initialized work owns them. Submitted work returns to In Progress for corrections.
- **An Epic's Task list** changes only through review and acceptance: adding, removing, canceling, retitling, or reordering Tasks needs `review_epic` with `newReview`, the user's acceptance, and `accept_epic_tasks`. Any other `epic.md` edit needs neither.
