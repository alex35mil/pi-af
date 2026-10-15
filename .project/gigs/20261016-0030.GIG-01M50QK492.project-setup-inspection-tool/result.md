# Result

## What changed

- Fixed the project-setup design oversight by exposing the existing read-only inspector as `inspect_project_setup`. It returns the same setup, Git safety, tracker-binding, and credential-redacted MCP context used by `/project-setup`.
- Natural-language setup now obtains that context before asking questions and reuses known credential environment references. It no longer depends on the user invoking the slash command or on shell discovery.
- Inspection works with absent, incompatible, or malformed workflow configuration. It does not modify files or staging, prepare artifacts, call providers, or inject a user message. Existing credential redaction and provider/file approval boundaries remain unchanged.
- Setup guidance now distinguishes configured MCP registrations from available provider tools and keeps operational integration validation after valid configuration is saved.
- The current session needs the normal extension reload before the new tool registration becomes available.

## Verification

- Pre-fix isolated probe — reproduced the missing tool while the slash command supplied the configured credential reference.
- Focused setup/instruction tests — 26 passed.
- `npm test` — 177 tests passed, zero failures.
- `npx tsc --noEmit` — passed.
- `npx oxfmt --check` on the three changed TypeScript files — passed.
- `git diff --check` — passed.
- Regression tests execute both registered entry points, compare complete snapshots, verify credential-reference reuse/redaction, and confirm unchanged files, exclusions, Git index, and repository status across four setup states.
