# Review

How to handle findings from every Epic, Task, and Gig plan, interim, and final review.

## Phase during review

The review tool's `plan`, `interim`, or `final` category is separate from workflow Phase. Which Phase each review activity uses is defined in [Phase transitions](./phase.md#transitions). Reconcile native Phase before starting or presenting a review.

A pause at the blocked-review checkpoint stays in the Phase where the review ran: Planning for plan reviews, Self-Review for interim and final reviews.

## Handling a round

1. **Read the rendered findings.** The reviewer returns one validated structured report, and the tool renders it into `review.md`. Never show raw reviewer prose as the finding list.
2. **Validate each finding** against repository evidence, active rules, and the bar for credible complexity. For source documents, check the [reviewed document shape](./artifacts.md#reviewed-document-shape):
   - the Overview represents the full details accurately and keeps material limitations visible;
   - plan highlights match the accepted scope;
   - result and report overviews state the outcome or conclusion without replacing the evidence.
3. **Resolve each finding as one of:**
   - `accepted`: evidence confirms it, and established requirements decide the fix without a new user decision.
   - `rejected`: evidence disproves it, it conflicts with an approved decision or a higher-priority rule, or it lacks causal support. Record the reason and evidence.
   - `needs user decision`: evidence supports it, but fixing it needs an unsettled product, domain, UX, scope, priority, or tradeoff decision. Present the decision and wait before editing.
4. **Record it.** Call `record_review_response` with every finding. Keep each stable label and use plain language in `Problem`, `Use case`, `Impact`, `Resolution`, and `User decision needed`. The tool writes `response.md` and returns the same Markdown. Show that Markdown unchanged in chat before the next workflow action. Never recreate, paraphrase, or reformat it.
5. **Check the blocked-review checkpoint** (below) before applying anything.
6. **Apply** accepted findings and user decisions at the owning abstraction, run affected verification, and keep the completion artifact in sync. Report planned checks that didn't run, with reasons.
7. **Review again.** When no finding needs a user decision, correct and rerun without asking. Continue until signoff is approved and no user note is unresolved.

Reflect accepted corrections directly in the current authoritative artifacts. Never ask the user to interpret local review files.

## Blocked-review checkpoint

Enabled only when `.project/config.json` sets `reviews.userConfirmationAfter`.

- Count valid `blocked` signoffs per entity and review category. A valid `approved` signoff resets the count. Failed or malformed output neither counts nor resets.
- When the count reaches the threshold, stop before corrections or their verification.
- Present each round in the batch with its labeled response, and say whether it had at least one valid blocking issue when reviewed. A block is legitimate when at least one valid blocking issue needed correction or a user decision; wrong secondary findings don't change that.
- Ask only `Was blocked review NNN legitimate?` or `Were blocked reviews NNN, … legitimate?`, then wait.
- All legitimate: apply the current round's accepted findings, update notes, the draft or implementation, and the completion artifact, then start a fresh batch.
- Any illegitimate: diagnose the reviewer guidance or tooling before proposing a fix.
- Mixed or unclear: resolve the judgment before correcting or reviewing again.
- Store no approval token or continuation state.

## Failed reviews

A round fails when the reviewer exits with an error, or returns no valid report even after the tool's one automatic correction.

- The tool may return the reviewer's unvalidated output. Use it as evidence for your own checks, never as a review, finding list, or signoff.
- After two failed rounds in a row in one category, the tool pauses. This applies whether or not the blocked-review checkpoint is enabled.
- At the pause, report the failures and any unvalidated output, then ask the user how to proceed and wait.
- Failed rounds don't count toward the blocked-review checkpoint, and a valid signoff resets the failure count.

## Round files

Each round lives in `reviews/<category>-NNN/`; the files are listed in [artifacts](./artifacts.md#review-round-files). `report.json` is the machine report, and `review.md`, `response.md`, and chat all use the one shared renderer. `outcome.json` holds the signoff used for the checkpoint count.

## Incoming PR adjudication

[Incoming PR review](./pr/incoming.md) uses the same report, renderer, and evidence standards, without entity Phase, plan or result artifacts, or the correction loop.

- Validate each finding against the exact revision, requirements, source, and causal evidence. Classify it as accepted, rejected with evidence, or needing a maintainer decision.
- Record every finding with `record_pull_request_review_response`, using its stable label, the returned round number, and that round's original PR-get evidence. Show the returned Markdown unchanged; headings carry each finding's ID and severity.
- State PR, revision, coverage, and verification limitations separately. Ask about unsettled domain decisions before proposing a fix.
- A local signoff is only critique. Publication, fixes, pushes, and merges keep their own approvals and the incoming workflow's execution boundary. Never run or apply contributor changes just to resolve a finding.
