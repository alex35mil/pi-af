# Recovery after uncertain outcomes

Read this only when a provider outcome is uncertain or partial, or a tool returns `recovery-required`. The general rule is in [core](../core.md#outcomes-and-recovery). This file owns the specific procedures.

## Pending plan publication

The first plan publication saves a pending opaque token before its non-idempotent create. A later `prepare_tracker_publication` call returns `recovery-required` instead of another create. Never create a replacement automatically.

### GitHub comment

1. Read every page of the bound issue's comments with the registered `issue_read` `get_comments`. Use explicit page numbers, one consistent `perPage` (1–100), and continue until a short or empty page.
2. Call `recover_tracker_publication` with all pages.
3. Only one comment containing the saved marker establishes identity. No match, duplicate matches, a missing published comment, or conflicting identity stops for maintainer direction.
4. The tool returns the identified comment body; use it to compare an uncertain update.

### Linear document

1. Call `recover_tracker_publication` with `pages` in this order: the exact bound parent read, then every registered `list_documents` page, then any full `get_document` reads the tool requests.
2. Use the prepared listing arguments (explicit fields and limit, `createdAt` order, archived included). Follow cursors until `hasNextPage: false`.
3. Epic listings use the exact Project filter. Issue listings have no issue filter, so scan the complete accessible listing. Never narrow by title, query, or team as a substitute.
4. Listings truncate content. A `recovery-read-required` result (distinct from the pending publication's `recovery-required`) returns full-read lookups for every candidate with a matching parent. Run them and resubmit all prior evidence plus those reads.
5. Only a unique token match on the bound parent establishes identity. Missing or duplicate matches, missing parent or content, errors, or incomplete pages stop without another create.
6. Compare an uncertain update against full `get_document` content, never against list or create previews.

## Uncertain updates

For a published comment, document, or PR body, read the exact saved body and compare it with the complete intended content. Retry only confirmed non-application.

## Uncertain tracker creation

A returned error can follow creation or partial application. Keep the pending or known-created checkpoint.

- **GitHub:** check the original create arguments. When that create included the qualified Internal ID, recover by that exact ID. Otherwise search by the exact approved title, repository, and required relationship. This applies to Task parent-bearing creates, which omit issue fields, and to the Project-scoped Internal ID, which is assigned later. Complete pagination and require exactly one match.
- **Linear:** search the exact approved title or name, configured team, and exact Task Project or projectless Gig relationship, in both artifact modes.

Continue when exactly one object is confirmed. Retry only after confirmed absence. Never add markers, choose the first result, or create a replacement on ambiguous or denied evidence.

## Uncertain PR operations

- **Creation:** the first PR create is non-idempotent. After an uncertain result, investigate through the configured forge tools and record the actual PR read. Never prepare a replacement creation.
- **Merge:** reconcile an uncertain merge through an exact PR get before retrying. Never merge twice to repair a board or cleanup failure.

## Queue intake

Queued Backlog or Todo work has no saved recovery state. Read provider state, continue from confirmed presence, and retry only after confirmed absence.
