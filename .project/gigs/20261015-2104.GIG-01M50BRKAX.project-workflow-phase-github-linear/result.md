# Result

## What changed

- Workflow metadata now uses Phase: Planning, Execution, or Self-Review. All adversarial and local user reviews stay In Progress/Self-Review; corrections use Execution. In Review starts only after external submission or resubmission. Work without an external submission route never enters In Review.
- GitHub setup provisions a Project Phase single-select field. Linear uses separate mutually exclusive Project/issue Phase-label groups. Both artifact modes expose native Phase only during initialized In Progress work; trackerless Phase stays in metadata.
- Runtime context validates supplied native Phase metadata and calculates the required field or complete-label assignment locally. Linear preserves unrelated labels. Registered provider tools still execute external updates; unchanged assignments produce no write.
- Review and plan-presentation tools require Self-Review. Shared lifecycle, setup, provider, privacy, and completion guidance now follows the same Phase contract.
- Use requires the new tracker configuration and native Phase field/groups. GitHub provisioning retains separate exact preview approval; Linear setup remains read-only and requires existing valid groups. Live provider configuration was not changed by this implementation.

## Verification

- `npm test` — 173 tests passed, zero failures.
- `npx tsc --noEmit` — passed.
- `npx oxfmt --check` on all 20 changed TypeScript files — passed.
- `git diff --check` — passed.
- Provider behavior verified with isolated repository and provider fixtures; no live GitHub Project or Linear workspace mutation was needed to test the implementation.
