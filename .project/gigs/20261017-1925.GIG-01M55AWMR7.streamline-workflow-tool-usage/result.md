# Result

## Overview

Workflow bookkeeping now uses two local operations instead of manual metadata edits: `set_workflow_phase` and `confirm_tracker_initialization`. They validate inputs before saving, preserve existing storage formats, and leave provider calls visible to the harness's normal permission checks.

All 17 identified instruction sites were simplified. Formatting mechanics remain in the existing renderer; approval, evidence, authoring, and recovery requirements remain in Markdown. The new operations load without a Pi runtime, ready for the separate portable-script work.

Artifact safety checks reuse successful inspections only while relevant inputs match. Local measurements improved repeated checks from 38 ms and six Git calls to 13–14 ms and two calls. The first check is more expensive: 56 ms and nine calls versus the 47 ms/seven-call baseline. These are small local observations, not general performance guarantees.

## Implementation

- `phase.ts` owns Phase mutation and native assignment calculation; `initialization.ts` owns binding confirmation. `operations.ts` supplies thin Pi adapters with queued, validated metadata writes. There is no new stored-state schema, provider transport, or permission broker.
- Initialization confirmation uses normalized observed facts, matching the existing Phase trust boundary. It checks consistency with approved intent but does not independently authenticate provenance or freshness. Missing/uncertain evidence still requires direct provider investigation.
- Persistence validation fingerprints configuration, ignore/exclude content and the active index, with fresh Git paths and HEAD. Changed inputs rerun the full safety checks, including staged-deletion detection. Explicit preparation remains a forced setup/repair check.
- The documentation inventory comprises six Phase/activity sites, two binding-completion sites, seven rendering sites and two preparation mandates. Owning references, tool context output, allow-lists and adapter documentation were updated consistently; provider rendering output is unchanged.
- Portable script entrypoints, cross-harness verification, submission/completion command orchestration and live provider/UI changes remain outside this refactor.

## Verification

- `npm test` — all 298 tests passed, including new operation and real-Git cache-invalidation tests.
- `npx tsc --noEmit` — passed.
- Scoped `npx oxfmt --check` on all 11 changed TypeScript files — passed.
- `git diff --check` — passed.
- Isolated imports rejecting Pi runtime dependencies — both shared operation modules loaded successfully.
- Persistence probe with Git tracing — first assertion 56 ms/nine Git calls; repeated assertions 14 ms and 13 ms/two calls each, with no repeated membership scans.
- Active instruction audit — all 17 candidate sites now use shared operation/renderer contracts or operational validation; safety and approval boundaries remain.
