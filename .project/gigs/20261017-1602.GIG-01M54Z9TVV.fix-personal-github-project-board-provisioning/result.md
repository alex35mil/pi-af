# Result

## Overview

Personal GitHub Project Board creation now uses the owner’s encoded login instead of resolving a numeric user ID. The sandbox experiment confirmed the numeric route returned 404 and the login route created a Board with the requested fields, Status columns, no swimlanes, and Priority sorting. The temporary Board was removed; the original sandbox view was preserved.

Setup failures now identify the request method/path and failed stage. HTTP status and safe provider details remain visible; configured token text is redacted, and authorization headers, request bodies, and raw fetch objects are not attached. When both a write and its recovery read fail, the error retains both failures.

Organization routing, numeric field IDs, exact provisioning approval, complete Board verification, partial-resource preservation, and existing uncertain-write recovery remain unchanged. The setup guidance now uses the verified owner-login contract. Permission configuration is outside this change.

Reload Pi before using the changed setup tool. The corrected route was verified live, but full fresh-Project provisioning was not rerun against GitHub; end-to-end provisioning and failure coverage use provider fixtures.

## Verification

- Approved sandbox POST comparison with API version `2026-03-10` — numeric-owner route returned 404 with no new view; login route returned 201. Independent reads verified the Board settings. Cleanup removed only the test-created Board and confirmed the original view remained.
- `node --import tsx --test tests/workflow-github-project-setup.test.ts tests/workflow-project-config.test.ts` — 83 passed.
- `npm test` — 260 passed.
- `npx tsc --noEmit` — passed.
- Changed-file `npx oxfmt --check` — passed for both TypeScript files and all three updated guidance files.
- `git diff --check` — passed.

Regression coverage includes one personal login-route POST without an owner lookup, organization routing, safe HTTP/GraphQL/network/invalid-JSON diagnostics, provisioning-stage context, token-safe error causes, retained write/recovery-read failures, preservation after failed Board creation, and successful exact-state recovery when a 201 response lacks the expected view envelope. Existing lost-response, default-view protection, selected-view preservation, and approval checks also pass.
