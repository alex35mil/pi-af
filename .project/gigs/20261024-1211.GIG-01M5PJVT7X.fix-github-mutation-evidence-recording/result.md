# Result

## Overview

Successful GitHub Project additions and managed plan-comment creation now record their identities directly from supported native responses, avoiding recovery reads caused by response-shape mismatches.

- Project additions use the numeric `item_id`, not the GraphQL node `id`.
- Comment creation accepts decimal string or numeric IDs and distinguishes minimal browser `url` from full-comment `html_url`; a full comment's API `url` does not invalidate its browser identity.
- Exact tool/request scope, positive safe-integer IDs, publication markers, and repository/issue/comment URL checks remain enforced. Read and comment-recovery behavior is unchanged.

No new provider calls, retries, metadata formats, migrations, or Linear behavior were introduced. The full test suite retains one independently reproduced pre-existing guidance-test failure.

## Verification

- `tsx --test tests/workflow-resource-id-operations.test.ts tests/workflow-tracker-publication.test.ts` — all 42 tests passed. New regressions failed against the original parsers before the fixes.
- Local reproduction probe — both supported mutation responses now record successfully.
- `npm run typecheck` — passed.
- `oxfmt --check` on the four changed implementation/test files — passed.
- `git diff --check` — passed.
- `npm test` — 610 of 611 tests passed. The sole failure, `tests/workflow-incoming-pr-guidance.test.ts:268`, expects the phrase `shared merge operation's returned arguments unchanged` in unchanged `workflows/references/integrations/forge/github.md`. Running that exact test in an isolated export of HEAD reproduced the same failure; it is outside this fix.
