# Shared planning protocol

Use this protocol for Epic, Task, and Gig planning. Entity/kind skills define plan content and any explicit inquiry-to-investigation branch. Follow `./review.md` for finding adjudication in every review phase.

## Research and inquiry

1. Inspect relevant repository files, the parent Epic for a Task, and Project Policies before asking questions those sources can answer. Search or fetch external sources when they materially inform the plan, and record the resulting evidence.
2. Keep `brief.md` current with the original request, current understanding, established decisions, material findings, and open questions; never leave required context only in chat.
3. Ask only questions whose answers can change behavior, outcome, scope, constraints, architecture, verification, decomposition, or—for Bugfix—reproduction and causal evidence. Ask one small coherent batch at a time; do not use a fixed questionnaire.
4. After each answer, update durable working state before relying on it. Repeat inspection and questions until no material question remains. Bugfix inquiry may continue during investigation when new evidence exposes a material question.
5. When no material questions remain, proceed directly: Bugfix enters investigation, while every other kind and Epic writes the detailed draft. The next user approval is reviewed-plan diff acceptance.

## Draft variants

| Entity   | Mutable local draft | Authoritative accepted artifact |
| -------- | ------------------- | ------------------------------- |
| Epic     | `.local/draft.md`   | `epic.md`                       |
| Task/Gig | `.local/draft.md`   | `plan.md`                       |

Write the smallest self-contained draft that carries every settled decision needed for that entity. Entity skills define its content and review criteria.

## Material replanning

When an accepted `epic.md` or `plan.md` must change materially after execution began, enter planning before writing or reviewing the replacement draft:

1. Reject replanning for lifecycle `done`; separately initialized work owns any later change.
2. Restore lifecycle to `inProgress` when it is `inReview`: update `.local/status.md` for workflow authority or update and re-read the provider's native Status for tracker authority.
3. Record `workStage: planning` in `metadata.json`.
4. Apply the configured provider's planning projection. GitHub re-adds the exact configured Planning label while preserving unrelated labels; Linear and trackerless workflows require no additional external marker.
5. Copy the accepted artifact into `.local/draft.md`, apply the material change there, and repeat planning review and acceptance. Acceptance records `workStage: execution` while lifecycle remains `inProgress`.

Editorial changes that do not alter behavior, strategy, scope, or decomposition do not enter material replanning.

## Planning review and acceptance

1. Call `review` with the exact entity, `entityDir`, and `phase: "plan"`. The tool creates `.local/reviews/plan-NNN/`, snapshots `.local/draft.md` to `candidate.md`, validates the structured reviewer report, renders canonical `review.md`, and stores request/transcript/raw diagnostics in that round directory.
2. Follow `./review.md`: adjudicate every finding through `record_review_response`, present its exact returned Markdown in chat, and continue until review is approved with no unresolved user decision.
3. When review approves, call `present_plan` with the same entity and `entityDir`. It reads the validated matching review outcome. Read its returned approved snapshot and write that exact content to its returned authoritative target through the configured write/edit user-diff gate. Do not print the candidate first.
4. A rejection or unresolved user note blocks progress. Discuss notes before changing the draft or rerunning review.
5. Compare any user-modified authoritative artifact with the reviewed snapshot. Editorial changes may proceed; a material change to behavior, strategy, or decomposition must become the mutable draft and pass a new review before implementation.
6. Before acceptance, incorporate every material user note into the authoritative artifact or current `brief.md`, according to ownership. The root `epic.md` or `plan.md` is the sole accepted plan. Proceed only when no note remains blocking.

Review criteria and downstream lifecycle remain entity-specific; local round identity, adjudication, exact signoff parsing, and user diff presentation do not.
