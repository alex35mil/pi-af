# Recovery after uncertain outcomes

Read this only when a provider outcome is uncertain or partial, or a tool returns `recovery-required`. The general rule is in [core](../core.md#outcomes-and-recovery). This file owns the specific procedures.

## Pending plan publication

The first `prepare_tracker_publication` call for an unpublished plan saves a pending opaque token before returning its non-idempotent create. Any later call returns `recovery-required` instead of another create. Recovery then reads the provider and decides from what it finds; never create a replacement on your own.

Call `recover_tracker_publication` with the approved `source` and the complete reads below:

- **One marked publication:** the create landed. The tool records it as published.
- **None, after a complete read:** the create never landed. The tool returns the same create with the saved token, which the original approval still covers. Run it and record it as usual. Keeping the token means a late copy of the earlier create shows up as a second match.
- **Several:** stop for maintainer direction.

Still run every prepared mutation in the same step and never call prepare just to look at its output; recovery costs extra reads.

### GitHub comment

1. Read every page of the bound issue's comments with the registered `issue_read` `get_comments`. Use explicit page numbers, one consistent `perPage` (1–100), and continue until a short or empty page.
2. Call `recover_tracker_publication` with all pages.
3. Only one comment containing the saved marker establishes identity. For a pending plan, no match returns the create; duplicate matches, a missing published comment, or conflicting identity stop for maintainer direction.
4. The tool returns the identified comment body; use it to compare an uncertain update.

### Linear document

1. Call `recover_tracker_publication` with `pages` in this order: the exact bound parent read, then every registered `list_documents` page, then any full `get_document` reads the tool requests.
2. Use the prepared listing arguments (explicit fields and limit, `createdAt` order, archived included). Follow cursors until `hasNextPage: false`.
3. Epic listings use the exact Project filter. Issue listings have no issue filter, so scan the complete accessible listing. Never narrow by title, query, or team as a substitute.
4. Listings truncate content. A `recovery-read-required` result (distinct from the pending publication's `recovery-required`) returns full-read lookups for every candidate with a matching parent. Run them and resubmit all prior evidence plus those reads.
5. Only a unique token match on the bound parent establishes identity. For a pending plan, no match after every candidate is fully read returns the create. Duplicate matches, a missing published document, missing parent or content, errors, or incomplete pages stop without another create.
6. Compare an uncertain update against full `get_document` content, never against list or create previews.

## Uncertain updates

For a published comment, document, or PR body, read the exact saved body and compare it with the complete intended content. Retry only confirmed non-application.

## Uncertain tracker creation

A returned error can follow creation or partial application. Nothing local exists yet, so the approved intake is the only record.

- **GitHub:** search by the exact approved title, repository, and required relationship. Complete pagination and require exactly one match.
- **Linear:** search the exact approved title or name, configured team, and exact Task Project or projectless Gig relationship.

Initialize from the object when exactly one is confirmed. Retry the create only after confirmed absence. Never add markers, choose the first result, or create a replacement on ambiguous or denied evidence.

## Uncertain PR operations

- **Creation:** the first PR create is non-idempotent. After an uncertain result, investigate through the configured forge tools and record the actual PR read. Never prepare a replacement creation.
- **Merge:** reconcile an uncertain merge through an exact PR get before retrying. Never merge twice to repair a board or cleanup failure.

## Queue intake

Queued Backlog or Todo work has no saved recovery state. Read provider state, continue from confirmed presence, and retry only after confirmed absence.
