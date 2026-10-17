# Result

## Overview

GitHub Project setup now provisions the short description as `Repository: https://github.com/<owner>/<repo>` using the resolved setup repository. New, existing, and resumed Projects share exact preview approval and persistence verification; matching descriptions need no write. Project README content, existing item values, automations, and unrelated settings remain unchanged.

Every Project mode and layout also returns a manual follow-up note to set the configured Status field's default to the configured Backlog option. The note explains that available MCP tools and documented public APIs do not expose a setter, links to the Project, and requires saved-state confirmation before full setup completion. This remains present with default-repository opt-out.

No live Project description or field default was changed during verification. URL clickability was not verified.

## Verification

- `npx tsx --test tests/workflow-github-project-setup.test.ts tests/workflow-instructions.test.ts` — 79 tests passed.
- `npm test` — 284 tests passed.
- `npx tsc --noEmit` — passed.
- `npx oxfmt --check workflows/extensions/project-setup/github-project.ts tests/workflow-github-project-setup.test.ts tests/workflow-instructions.test.ts` — passed.
- `git diff --check` — passed.
- Regression coverage verifies description creation/replacement/no-op, changed-description approval invalidation, exact inspection, failed/ignored/lost-response writes and safe resume, unrelated-state preservation, and manual follow-up across all modes/layouts with custom names and default-repository opt-out.

**Not run:**

- Live Project mutation and UI confirmation — outside the approved code-change scope; provider behavior was verified through the published API schema and the test provider.
