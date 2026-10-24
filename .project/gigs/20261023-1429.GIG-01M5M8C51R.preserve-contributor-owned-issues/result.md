# Result

## Overview

Original tracker requests now stay in their titles/names and descriptions. GitHub publishes accepted plans in one managed issue comment; Linear publishes them in one Plan document attached to the existing issue or Project. Later accepted revisions update that same publication, without ownership questions or duplicate tracking objects. Local plans remain authoritative.

GitHub comments show Plan, overview prose, Highlights, and collapsed Full plan. Linear uses its native document title Plan, then overview prose, Highlights, and native collapsed Full plan without a repeated H1. Supporting content is preserved. Source artifact headings, PR presentation, and closing references remain unchanged.

The shared operation saves creation intent before preparing a first create and records confirmed native identity. Interrupted creation recovers only a unique, correctly scoped token match; missing or ambiguous evidence stops without another automatic create. Linear updates require exact document/parent reads and never pass parent arguments, so publication does not move the document. Linear initialization no longer requests or validates an unsupported embedded workflow ID. GitHub native Internal ID management, lifecycle, Phase, Priority, relationships, branches, and approval gates retain their contracts.

Live issue-attached document API behavior is verified. Live initialized Linear flows, Project attachment, and UI appearance remain unverified; automated fixtures cover the workflow and Project branches.

## Implementation

- `tracker-publication.ts` owns one publication flow and queued atomic metadata persistence. GitHub and Linear adapters own their native arguments, identity checks, and pagination. No provider calls occur inside the local operation.
- Portable shared schemas define unpublished, pending, and published state; GitHub retains its existing numeric `planComment` identity, while Linear requires string-ID `planDocument` state. Creation, binding confirmation, and ordinary mutations preserve those fields.
- Linear document listings truncate content and use native display identifiers in parent references. Recovery validates complete listings, requests full reads of every matching-parent candidate, and proves the parent identifier against its bound UUID through an exact parent read. Errors, incomplete scans, missing facts, moved/archived documents, and conflicting identities preserve saved state.
- The renderer owns both publication layouts. Shared attribution remains code-owned. Linear initialization schemas, validation, policy, creation-recovery guidance, and all publication consumers now match original-description preservation. Migration guidance converts only actively operated old records and leaves historical completed work unchanged. Adoption and requirements reconciliation explicitly require complete discussion reads before initialization or plan changes. No permission settings were changed.

## Verification

- Focused domain, operation, integration, instruction, rendering, and provider-publication tests — all 132 passed, including 22 new Linear document tests and 20 GitHub comment tests.
- `npm run typecheck` — passed.
- `npm test` — 601 of 602 passed. The sole failure is the pre-existing merge-guide wording assertion in `tests/workflow-incoming-pr-guidance.test.ts`; that test and its target forge guide remain unchanged from HEAD. No unrelated fix was applied.
- `oxfmt --check` on all 26 changed/new TypeScript files — passed.
- `git diff --check` — passed.
- Live GitHub comment creation, scoped identity recovery, and same-comment updates — passed through registered tools.
- Live Linear native API/rendering test — created one issue-attached Plan document from the complete accepted plan, read full content and listing metadata, verified correlation-marker retention and parent UUID/identifier mapping, and updated that same document by ID without parent arguments. The test issue's existing description remained unchanged. Evidence covers native API/rendering behavior, not a live initialized workflow state-machine run.

**Not run:**

- Live Project-attached document round trip — no additional test Project was approved; fixture coverage verifies Epic routing and parent checks.
- Manual Linear document UI rendering — API content was verified, but the UI was not inspected.
- Live initialized Linear publication/initialization flow — this repository uses a GitHub tracker. The complete Linear state-machine matrix is fixture-tested; no synthetic initialized entity or production tracker configuration was introduced for the native API test.
