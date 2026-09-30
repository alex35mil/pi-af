# Result

## What changed

- Briefs now contain only `# Brief` followed by the approved request. Epics, Tasks, and Gigs receive local working notes; Tasks and Gigs also receive `.local/pending.md` for current-scope work.
- Final Deliverable review rejects unchecked ordered or unordered pending entries while accepting checked, empty, or missing pending-work files.
- Provider issue and pull-request bodies use accepted artifact content without its root heading. Generated Links sections and their renderer/policy were removed.
- Same-repository GitHub pull requests receive a horizontal rule, a blank line, and `Closes #<issue number>`. Linear relies on exact issue branches where available.
- GitHub forge capability now includes updating an existing pull-request body after its result or report changes, followed by exact read-back verification.
- Existing versioned briefs were normalized, including removal of accumulated execution context from the Canceled-state Gig brief.
- Approved new queue items are created directly; provider search is reserved for explicit adoption or uncertain creation.

Static Linear branches and Linear Project-backed Epics may have no automatic pull-request association.

## Verification

- `npm test` — 144 tests passed.
- `npx tsc --noEmit` — passed.
- `npx oxfmt --check <changed files>` — all changed supported files passed.
- `git diff --check` — passed.
- Stale-contract searches — no active runtime or workflow guidance retains the removed Links operation, mutable brief contract, or `## Request` brief format.
