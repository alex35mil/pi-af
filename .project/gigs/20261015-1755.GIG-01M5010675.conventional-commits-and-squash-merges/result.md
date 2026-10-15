# Result

## What changed

- Added the reusable `commit` skill for authorized, focused Git commits. It preserves unrelated work and partial staging, follows the repository's explicit conventions or clearly established history, and uses Conventional Commits only when no style is established. Unclear style or skill selection requires asking the user.
- Kept skill selection harness-neutral: honor the harness's resolution, prefer an exposed repository-specific skill when several candidates are available, and use the supplied location rather than rediscovering files.
- Epic commits and Task/Gig submission use the available commit skill. The policy also applies to standalone use; it is not confined to workflow instructions.
- GitHub squash merges explicitly supply `commit_title`, using the approved item title as the summary in the selected commit style. Readable PR titles, merge approval, and checks against the exact local commit remain unchanged.
- Documented the skill in the README and clarified which merge checks belong to the runtime. This is an agent-instruction change, not runtime validation of commit-message style.

## Verification

- `npm test` — 162 passed, 0 failed.
- Focused skill, workflow instruction, integration, Resource IDs operation, and Git cleanup tests — 41 passed, 0 failed.
- `tsc --noEmit` — passed.
- `oxfmt --check tests/commit-skill.test.ts tests/workflow-instructions.test.ts` — passed.
- `git diff --check` — passed.
- Pi's real resource loader — verified package discovery, a project-local skill overriding the package default, and an explicitly configured project skill taking precedence over both.
- Manual instruction walkthrough — checked repository-specific skills, non-Conventional repository rules, established history, no-style defaults, ambiguous policy, unrelated staging, and PRs that need merging, are already merged, or fail validation. These checks do not establish model compliance.
