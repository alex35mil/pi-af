# Result

## What changed

- Added `canceled` as a finished unsuccessful lifecycle outcome, distinct from successful `done`, including trackerless status storage.
- Made canceled Tasks a distinct terminal Epic progress outcome so they do not block Epic completion.
- Required Canceled mappings for GitHub Project Status and Linear issue and Project statuses.
- Added Canceled to GitHub Project setup and safely appended it to this repository's populated Status field without changing existing option IDs or unrelated options.
- Updated this repository's integration configuration and direct lifecycle/setup documentation.
- Updated shared result-artifact guidance to exclude workflow bookkeeping from implementation results.
- Kept transition, reopening, issue/PR, branch, recovery, migration, managed-label, and cancellation-subsystem behavior unchanged.

## Verification

- `npm test` — 144 tests passed.
- `npx tsx --test tests/workflow-instructions.test.ts` — 5 tests passed after the result-artifact guidance update.
- `npx tsc --noEmit` — passed with no errors.
- `npx oxfmt --check workflows/extensions/__lib/domain.ts workflows/extensions/__lib/entity.ts workflows/extensions/integrations/config.ts workflows/extensions/project-setup/github-project.ts tests/workflow-domain.test.ts tests/workflow-github-project-setup.test.ts tests/workflow-integration.test.ts tests/workflow-project-config.test.ts` — all checked files use the correct format.
