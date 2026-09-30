# Simplify Deliverable artifacts and provider projections

## Outcome

Refactor workflow artifact ownership so the durable brief is only the approved Request, transient working context has explicit local homes, and provider bodies contain the relevant accepted artifact without generated navigation metadata. Preserve workflow identity, branch contracts, lifecycle and Priority authority, Kind projection, review history, accepted plan ownership, provider mutation recovery, and unrelated tracker/forge behavior.

The intentional contract changes are limited to request-only briefs, local notes and pending work, finalization gating on unresolved pending entries, root-heading removal, native GitHub closing references, Linear branch association, removal of generated Links sections, and direct creation of approved new queue items.

## Artifact ownership

- Every Epic, Task, and Gig `brief.md` contains only `# Brief` followed by the approved Request. Decisions, findings, questions, provider identifiers, checkpoints, review state, and execution history never enter the brief.
- Every initialized Epic, Task, and Gig receives `.local/notes.md`. It is free-form agent working state with no lifecycle or completion gate. Resume and compaction guidance uses it for transient context that does not belong in metadata, a mutable draft, an accepted artifact, or a review round.
- Every initialized Task and Gig receives `.local/pending.md`. Pending entries use Markdown task-list syntax. An unchecked entry is active and unresolved; checked entries may remain. Other working prose belongs in `notes.md`.
- Before Deliverable final review, the review boundary reads `.local/pending.md` and rejects any unchecked entry. This is the mechanical finalization gate: work cannot receive final signoff while accepted current-scope work remains unresolved. A missing local pending-work file has no recoverable entries after a fresh checkout and is treated as empty; initialization and resume guidance create it when local working state is established.
- Material decisions still belong in the mutable draft and then the accepted `epic.md` or `plan.md`; implementation outcomes still belong in `result.md` or `report.md`. Local notes and pending work do not become provider content or durable completion artifacts.

## Provider body projection

- Delete the Links renderer and stop adding `## Links` sections or artifact/provider links to issue and pull-request bodies.
- Add one body renderer that removes the first `# Title` line and its following blank line. Tracker issues use the remaining `epic.md` or `plan.md` text. Pull requests use the remaining `result.md` or `report.md` text.
- Unversioned tracker bodies keep their existing privacy check before heading removal. Any required removal of workflow IDs, `.project` paths, or raw workflow structure still needs the existing exact-diff approval.
- For a GitHub tracker issue and GitHub pull request in the same repository, append a horizontal rule, a blank line, and `Closes #<issue number>` to the pull-request body.
- Linear adds nothing to the pull-request body. Tasks and Gigs using Linear's exact issue branch get Linear's native association. Static branches and Linear Project-backed Epics may have no automatic association; this is accepted.
- Add GitHub's pull-request update operation. When `result.md` or `report.md` changes after the pull request exists, rebuild its body, preserve unrelated provider text through the existing approval rule, update it once when different, then read it back and compare exact text. If the update result is uncertain, read the pull request before retrying. Never create another pull request.
- Heading removal and the same-repository `Closes` block are automatic. Every other difference keeps the existing exact-diff approval rule.

## Queue intake

- An approved request for a new Backlog or Todo item creates it directly without a duplicate search.
- Search for an existing provider object only when the user asks to adopt one or when a create response is uncertain.

## Implementation ownership

- `workflows/extensions/__lib/entity.ts` — define local notes/pending paths and the shared unchecked-entry detection contract.
- `workflows/extensions/init/entity.ts` — initialize `notes.md` for all entities and `pending.md` for Tasks/Gigs alongside existing local state.
- `workflows/extensions/review/index.ts` — enforce zero unchecked pending entries before building a final Deliverable review request.
- `workflows/extensions/integrations/projection.ts` and `workflows/extensions/integrations/index.ts` — remove the first heading, append the same-repository GitHub `Closes` block when applicable, and expose that body renderer.
- `workflows/extensions/integrations/forge/github.ts`, `capabilities.ts`, `policy.ts`, `README.md`, and the obsolete `links.ts` module — add GitHub pull-request body updates and remove the Links tool and policy.
- `workflows/references/artifacts.md`, `planning.md`, `review.md`, `deliverable.md`, `queue.md`, `integrations/shared.md`, `integrations/forge/github.md`, and the Epic/Task/Gig skills — state the new artifact ownership, resume behavior, pending-work gate, direct queue creation, provider rendering, and submission rules from the positive contract.
- `.project/gigs/20260929-0954.GIG-01M3NZ2QZM.canceled-state-for-queued-and-initialized-work/brief.md` — remove accumulated execution context so the existing brief contains only its approved Request.
- Domain, review, integration, instruction, and provider-rendering tests — verify exact one-heading brief bytes for Epic/Task/Gig initialization; initialized local files; unchecked-task blocking; checked, empty, and missing-checklist acceptance; root-H1 rendering; GitHub closing references; existing-PR updates after completion-artifact changes; accepted Linear association gaps; restricted unversioned composition; removed Links capabilities; and request-only guidance.

## Invariants and boundaries

- Local files remain under the existing `.project/**/.local/` exclusion and are never committed or projected. No persistence-policy change is required.
- Existing accepted Epic/Plan/Result/Report content is not rewritten. Existing provider bodies are not migrated solely to remove old Links blocks. Only the explicitly identified polluted brief is cleaned.
- Provider title, lifecycle, Priority, labels, hierarchy, branch identity, and exact projection verification remain unchanged.
- A pending entry is current-scope work discovered while executing one Deliverable. Independently schedulable or out-of-scope work still requires approved separate workflow/tracker intake.
- The pending-work gate addresses a credible failure path: work discovered during implementation can otherwise remain only in conversation, conversation compaction can hide it, and final review can then approve incomplete work. Checking a small local Markdown task list at the existing final-review boundary prevents that outcome without adding lifecycle state or provider synchronization.

## Verification

- Focused tests for initialization, final-review pending-work gating, provider-body rendering, integration policy/context, and instruction ownership.
- `npm test`
- `npx tsc --noEmit`
- `npx oxfmt --check` on changed TypeScript, test, JSON, and Markdown files supported by the repository formatter.
- `git diff --check`
- Exhaustive searches confirm no active workflow guidance or runtime code references `render_artifact_links`, `artifactLinks`, generated `## Links`, or mutable brief state.
- Manual artifact inspection confirms all entity templates use request-only briefs, local notes/pending files have the agreed scope, and the prior polluted brief retains its exact Request only.
