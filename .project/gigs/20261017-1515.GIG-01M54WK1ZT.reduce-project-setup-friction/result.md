# Result

## Overview

Project setup now discovers credential-safe GitHub repository identities from fetch remotes and verifies ownership before asking Project questions. Guidance reuses known identity, explains Project ownership, offers the repository name as a new Project title with an override, and skips unsupported metadata-scope questions for personal repositories.

Fresh empty Projects using Board layout get a REST-created Board with configured Status columns, no swimlanes, and the requested Priority order. Setup verifies those settings before deleting only the captured unchanged generated default view. Existing/resumed Projects and unrelated views are preserved.

Count, slicing, and the opted-in default repository remain manual. New table/roadmap layouts retain their existing setup path. Uncertain Project creation requires explicit recovery selection rather than inferring a deletable default.

## Verification

- `npm test` — 246 tests passed, zero failures. Coverage includes safe remote extraction, shared command/tool snapshots, repository ownership/title discovery, personal field-scope rejection, user/organization REST routes, numeric field IDs, hidden/reversed/custom Priority, full Board verification, lost-response recovery, protected defaults, and preserved adopted views.
- `npx tsc --noEmit` — passed.
- `npx oxfmt --check` on all eight changed source/test/documentation files — passed.
- `git diff --check` — passed.
- Manual inspection of setup guidance against discovery/provisioning branches — confirmed known/missing/ambiguous repository handling, ownership-filtered choices, title override, fresh-versus-adopted view behavior, and remaining manual confirmation.

**Not run:**

- Live GitHub Project/view create–verify–delete — no approval to mutate real Projects/views for verification; documented APIs and fake-provider integration tests were used instead.
