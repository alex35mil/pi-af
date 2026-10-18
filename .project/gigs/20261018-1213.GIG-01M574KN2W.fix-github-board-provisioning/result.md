# Result

## Overview

- GitHub Board setup accepts the requested visible fields in any returned sequence. The same rule governs verification, recovery, selected-view updates, approval hashes, and captured-default safety checks. Table field order remains significant.
- Setup errors identify the safe request method/path, failed stage, and specific view mismatches. Failed create recovery includes candidate checks and the original create failure, with credential text redacted.
- Recovery still requires exactly one matching new Board and never blindly retries creation. Resuming a partial Project requires explicit existing-view selection and fresh approval; it preserves the default and unrelated views. Existing cleanup guards and manual setup requirements remain intact.
- Verified locally with simulated GitHub responses, not live provisioning; the original installation revision and complete response remain unknown, so the historical incident is not fully confirmed.

## Implementation walkthrough

`github-project.ts` normalizes Board visibility at the provider-read boundary without removing duplicates, so all view consumers share the same semantics. Shared difference checks drive both matching and diagnostic messages. REST create-response parsing and GraphQL view-read validation use the GitHub client's safe request-error handling. The setup skill, contract, and extension documentation describe visibility rather than a controllable Board card-field order.

The original installation revision and complete unexpected HTTP response remain unknown. The fix uses exact-state recovery rather than guessing another response shape. Verification used simulated GitHub responses; no live Project was provisioned or deleted.

## Verification

- `node_modules/.bin/tsx --test tests/workflow-github-project-setup.test.ts` — 87 tests passed, covering field permutations, invalid selections, request diagnostics/redaction, ambiguous recovery, table ordering, cleanup guards, and partial-Project resume.
- `npm test` — all 367 tests passed across 31 suites.
- `node_modules/.bin/tsc --noEmit` — passed.
- `node_modules/.bin/oxfmt --check` on the five changed implementation, test, and documentation files — passed.
- `git diff --check` and final scoped diff inspection — passed; no unrelated changes found.
- The original scratch reproduction (`tsx --test --test-name-pattern='HTTP success omits'` against the saved reproduction test) — passed after previously reproducing the exact reported error on unchanged product code.
