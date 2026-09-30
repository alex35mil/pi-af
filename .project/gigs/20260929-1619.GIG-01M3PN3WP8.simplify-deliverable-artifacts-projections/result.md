# Result

## What changed

- Briefs now contain only `# Brief` followed by the approved request. Epics, Tasks, and Gigs receive local working notes; Tasks and Gigs also receive a local Markdown todo checklist.
- Final Deliverable review rejects unchecked ordered or unordered todo entries while accepting checked, empty, or missing local checklists.
- Provider issue and pull-request bodies use accepted artifact content without its root heading. Generated Links sections and their renderer/policy were removed.
- Same-repository GitHub pull requests receive a horizontal rule followed by `Closes #<issue number>.` Linear relies on exact issue branches where available.
- GitHub forge capability now includes updating an existing pull-request body after its result or report changes, followed by exact read-back verification.
- Existing versioned briefs were normalized, including removal of accumulated execution context from the Canceled-state Gig brief.

Static Linear branches and Linear Project-backed Epics may have no automatic pull-request association.

## Verification

- `npm test` — 144 tests passed.
- `npx tsc --noEmit` — passed.
- `npx oxfmt --check <changed files>` — all changed supported files passed.
- `git diff --check` — passed.
- Stale-contract searches — no active runtime or workflow guidance retains the removed Links operation, mutable brief contract, or `## Request` brief format.
