# Result

## What changed

- Natural-language requests such as “Report this workflow issue” use the existing Todo skill to prepare an ordinary entry in the workflow source project's tracker.
- Private global `workflows.settings.json` accepts `workflowProject`, an absolute source-checkout path. Tracker settings and artifact policy come from that checkout; consuming-project configuration is independent.
- Existing `integration_context` inspection and queue intake require an explicit `current` or `workflow` target. Entity-bound operations retain their current-project behavior.
- Missing or invalid source configuration produces a corrective error without setup, automatic repair, or fallback. Reporting guidance requires sanitized evidence and exact destination/content approval before registered MCP submission.
- Documentation and tests cover both tracker providers, both artifact modes, missing/malformed consuming-project setup, source configuration changes, read-only inspection, and existing branch-username precedence.

The private source reference is documented, not automatically created. Reload Pi to load the updated tool schema. Reporting uses existing permissions and queue recovery; it does not introduce an automated privacy sanitizer.

## Verification

- `npm test` — all 196 tests passed.
- `npx tsc --noEmit` — passed.
- `git diff --check` — passed.
- Formatting check with `oxfmt` on the five changed TypeScript files — passed.
- Manual guidance walkthrough — ordinary Todo selects the current project; workflow reporting selects the source tracker; missing configuration stops; unsafe evidence stays local; publication requires exact approval; provider denial/uncertainty follows existing queue rules.

**Not run:**

- Live GitHub/Linear report submission and independent agent interaction tests — no separately approved test report or external mutation; runtime context behavior is covered with isolated fixtures and the registered tool interface, while agent behavior is covered by instruction checks and the manual walkthrough.
