# Result

## Overview

Epic planning now explains the tradeoff between independently delivering Tasks to the repository default branch and integrating them on the Epic branch. The workflow recommends a strategy, obtains user approval, and records the choice and rationale in the reviewed Epic plan before Task initialization.

Both future-target switching and Task initialization now accept exact GitHub confirmation that the current Epic revision was merged into its stored default target, including squash merges. They reuse the existing merged-PR validator, preserving repository, source/target branch, current source-commit, and merge-timestamp checks. The existing local-ancestry route remains available.

Existing Tasks retain their immutable targets. Versioned default-target Task initialization still requires the working accepted Epic plan to match the local target's plan exactly. GitHub owns delivery confirmation; this route does not independently establish that the local target contains the squash commit or every merged implementation change. No MCP hosting or project-setup changes are needed.

## Implementation

- A shared Epic delivery operation protects target switching and all new/adopted Task initialization tools. Explicit invalid PR evidence is rejected rather than hidden by an ancestry success.
- Both local branches must exist. A newer Epic source commit invalidates evidence for the older merged revision. Validation failures leave the target pointer, parent annotation, Task artifacts, and branches unchanged.
- The Epic and Task skills and shared `workflows/references/epic.md` reference explain strategy approval, both switching directions, separate operation approvals, and preservation of existing Tasks. The strategy approval gate is agent guidance recorded in the reviewed Epic plan, not a new machine-parsed approval token.
- Delivery checks perform no provider calls, Git synchronization, lifecycle changes, or proof-snapshot persistence. Existing merge and finish policies remain unchanged.

## Verification

- Focused delivery/domain/merge/tool-discovery/instruction tests — 76 passed before the final schema-enum correction; the full suite below covers the corrected state.
- `npm test` — 669 passed before the reference-only rename; no failures, cancellations, or skipped tests. Coverage includes real local squash delivery in both artifact modes, all new/adopted Task tools, native MCP response envelopes, immutable existing targets, invalid evidence, and exact versioned-plan reachability.
- Post-rename `workflow-instructions.test.ts` — all 16 tests passed, including Markdown dependency and shared-guidance reachability checks; no old reference paths remain in workflow sources or tests.
- `npm run typecheck` — passed, including after the rename.
- `oxfmt --check` on all five changed TypeScript files — passed.
- `git diff --check` — passed.
- Read-only replay of the captured hosted GitHub merged-PR response through the unchanged shared validator — accepted without a merged-result SHA. This verifies the deployed response shape, not a new live merge or a current-branch delivery transition.

**Not run:**

- A new live GitHub squash-merge and Task transition — no remote merge was authorized or needed for verification; local Git integration tests use provider evidence fixtures matching the hosted response.
