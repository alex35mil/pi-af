# Result

## What changed

- Workflow metadata now uses Phase: Planning, Execution, or Self-Review. All adversarial and local user reviews stay In Progress/Self-Review; corrections use Execution. In Review starts only after external submission or resubmission. Work without an external submission route never enters In Review.
- GitHub setup provisions a Project Phase single-select field. Linear uses separate mutually exclusive Project/issue Phase-label groups. Both artifact modes expose native Phase only during initialized In Progress work; trackerless Phase stays in metadata.
- Runtime context validates supplied native Phase metadata and calculates the required field or complete-label assignment locally. Linear preserves unrelated labels. Registered provider tools still execute external updates; unchanged assignments produce no write.
- Review and plan-presentation tools require Self-Review. Shared lifecycle, setup, provider, privacy, and completion guidance now follows the same Phase contract.
- This repository now maps the GitHub Project Phase field to Planning, Execution, and Self-Review instead of the Planning label. The native field was created through the approved setup preview; existing fields, labels, visibility, and repository association were preserved. Linear setup remains read-only and requires existing valid groups.

## Verification

- `npm test` — 173 tests passed, zero failures.
- `npx tsc --noEmit` — passed.
- `npx oxfmt --check` on the 20 changed TypeScript files and `.project/integrations.json` — passed.
- `git diff --check` — passed.
- Provider behavior verified with isolated repository and provider fixtures. GitHub setup also verified the live Phase field and its three options; the updated repository mapping passed strict setup validation. No live Linear workspace was changed.
