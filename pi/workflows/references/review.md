# Review

How to run and handle every Epic, Task, and Gig review, in every category.

## What blocks

A finding is `blocking` or a `note`. The report is `blocked` exactly when it has a blocking finding.

- **Blocking:** the work, shipped as it is, would contain a defect, would break a stated requirement, or needs a decision only the user can make. Stated requirements are the brief, the plan, user decisions, active rules, and Project Policies.
- **Note:** everything else. A note never blocks and never causes another round. Apply one only when it's clearly worth it.
- A result or report that claims behavior or verification the evidence doesn't support is blocking.
- Wording and consistency between sections of one document are out of scope for the reviewer.

## Passes

Each category gets one review and, when that review blocked, one verification pass. The review tool chooses the pass from the saved rounds; call the same tool both times.

| Saved rounds in the category | Next call runs |
| --- | --- |
| None with a valid report | Review |
| Review, blocked | Verification of that review's fixes |
| Review, approved | Nothing: the cycle is finished |
| Verification, approved or blocked | Nothing: the cycle is finished |

- The verification pass sees the blocked round's findings, your recorded responses, and the text changes, and checks only the fixes.
- A finished `plan` or `final` cycle takes another review only with `newReview`, saying what changed in behavior, scope, or the Task list. Don't pass it to get a second opinion on the same work.
- `interim`, `conflict-plan`, and `conflict-merge` reviews start a new cycle on each call after a finished one.
- Review categories don't depend on Phase.

## Handling a round

1. **Read the rendered findings.** The tool renders the reviewer's validated report. Never show raw reviewer prose as the finding list.
2. **Check each blocking finding** against repository evidence, active rules, and the bar for credible complexity. Then choose:
   - **Accept:** evidence confirms it and established requirements decide the fix. Fix it at the owning abstraction and run the affected verification. Record nothing.
   - **Reject:** evidence disproves it, or it conflicts with a user decision or a higher-priority rule. Record it with the reason.
   - **Needs the user's decision:** fixing it needs an unsettled product, domain, scope, or tradeoff decision. Record it, ask the user, and wait before editing.
3. **Record** rejected findings and ones needing a decision with `record_review_response`. The verification pass and later reviews read that record.
4. **After a blocked review,** call the review tool again for the verification pass.
5. **After the cycle finishes,** continue. Tell the user each finding still open as an open concern, one line each, in your next message to them. Never run another review to clear it.

Keep the plan, result, or report in sync with accepted fixes. Never ask the user to interpret local review files.

## Failed reviews

A round fails when the reviewer exits with an error, or returns no valid report even after the tool's one automatic correction.

- A failed round isn't a pass: the next call runs the pass the failed one would have.
- The tool may return the reviewer's unvalidated output. Use it as evidence for your own checks, never as a review, finding list, or signoff.
- After two failed rounds in a row in one category, the tool pauses. Report the failures and any unvalidated output, then ask the user how to proceed and wait.

## Round files

Each round lives in `reviews/<category>-NNN/`; the files are listed in [artifacts](./artifacts.md#review-round-files). `pass.json` says whether the round was a review or a verification, and `outcome.json` holds its signoff.

## Incoming PR adjudication

[Incoming PR review](./pr/incoming.md) uses the same report, severities, and evidence standards, without passes, entity artifacts, or the correction loop.

- Validate each finding against the exact revision, requirements, source, and causal evidence. Classify it as accepted, rejected with evidence, or needing a maintainer decision.
- Record every finding with `record_pull_request_review_response`, using its stable label, the returned round number, and that round's original PR-get evidence. Show the returned Markdown unchanged; headings carry each finding's ID and severity.
- State PR, revision, coverage, and verification limitations separately. Ask about unsettled domain decisions before proposing a fix.
- A local signoff is only critique. Publication, fixes, pushes, and merges keep their own approvals and the incoming workflow's execution boundary. Never run or apply contributor changes just to resolve a finding.
