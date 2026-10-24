# Result

## Overview

- Workflow tests no longer check for specific wording in workflow Markdown. Instructions can be rewritten freely; only structural breakage fails tests.
- Removed prose-only assertions:
  - `tests/workflow-instructions.test.ts`: 231 assertion calls down to 18;
  - `tests/workflow-incoming-pr-guidance.test.ts`: 73 down to 8 (counted as `assert.*(` call sites);
  - one phrase match each in `workflow-project-config.test.ts` and `workflow-linear-publication.test.ts`.
- Kept structural checks:
  - Markdown links resolve;
  - each skill reaches its required references, including `queue.md` and `epic.md`;
  - incoming-PR checkout tools and `mcp(github, …)` writes appear in the ask examples but not in `pr` skill grants;
  - cleanup tool schema keys;
  - publication module import boundaries.
- Added checks:
  - heading anchors in Markdown links resolve;
  - every JSON example in `workflows/references/setup.md` parses;
  - required skill frontmatter grants are present. The permissions extension reads these at runtime, and the existing inventory test only rejects unknown names.
- Added the project rule `.agents/rules/testing.md`, scoped to `tests/**`. It tells agents to test code behavior, never workflow wording; to keep guidance checks structural; to delete rather than update a wording assertion; and to use local mocks. The rules extension delivers it only when a test file is read or edited, so other sessions pay no context cost.
- No workflow Markdown, product code, or runtime behavior changed.
- Limitation: guidance wording is no longer tested. Workflow plan and final reviews still check it, and #84 adds a size budget and style guide.

## Verification

- `npm test`: 666 tests pass, 0 fail. The baseline was 685; the difference is the removed prose-only test blocks.
- `npm run typecheck`: passes.
- Reading `tests/workflow-instructions.test.ts` in this session delivered the testing rule as a path-scoped reminder.
- Changing a guidance sentence in `workflows/references/queue.md` ("stays local" → "stay local"): the instruction and incoming-PR guidance suites still pass. Reverted.
- Breaking the `setup.md#workflow-reporting-source` anchor in `queue.md` fails "resolves every Markdown heading anchor". Making the first `setup.md` JSON example invalid fails "keeps setup configuration examples valid JSON". Both reverted.
