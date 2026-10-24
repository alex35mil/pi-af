# Plan

## Overview

Record successful GitHub Project additions and managed plan-comment creation directly from their supported native responses. Both remote operations can succeed today while local identity recording rejects the returned shape, interrupting initialization or publication and requiring recovery reads.

### Plan highlights

- Normalize Project-addition database IDs and comment-creation identity fields at their workflow evidence boundaries.
- Keep exact registered-tool, request-scope, publication-marker, URL, and safe-integer validation.
- Cover native mutation responses and existing read/recovery responses without repeating remote mutations.

## Root cause

### Symptom

Passing complete successful MCP responses unchanged to `resource_ids record` or `tracker_publication record` fails after the external resource already exists.

### Evidence

A local probe at `.local/scratch/reproduce.ts` invokes the actual recorder and publication adapter with native MCP JSON-text envelopes. It reproduces:

- Project addition: `invalid Project item ID` for `{ id: "PVTI_example", item_id: 123456, full_database_id: "123456" }`.
- Comment creation: `comment response lacks a numeric ID and issue-scoped html_url; recover through explicit comment reads` for string `id` plus issue-scoped `url`.

The current GitHub MCP server source in `pkg/github/projects.go` constructs the Project-addition response with a GraphQL node `id`, numeric `item_id`, and string `full_database_id`. Its `pkg/github/issues.go` constructs the minimal comment response using the created comment's HTML URL. These source reads support the reported shapes; the deployed server's exact revision remains unverified.

Sources:
- https://github.com/github/github-mcp-server/blob/main/pkg/github/projects.go
- https://github.com/github/github-mcp-server/blob/main/pkg/github/issues.go

### Cause

`workflows/extensions/integrations/resource-id-operations.ts` reads `response.id` for `projects_write:add_project_item`, although that field is a GraphQL node ID rather than the numeric database ID required by subsequent Project tools.

`workflows/extensions/integrations/tracker-publication-github.ts` shares an identity parser between creation and comment-list recovery, but accepts only numeric `id` and `html_url`. Minimal successful creation returns a decimal string ID and `url`.

The generic MCP envelope decoder is working: it extracts the payload unchanged. The defect belongs to the workflow-owned provider evidence adapters, not generic transport or their callers.

## Proposed fix

### Evidence decision table

| Evidence | Identity source | Required validation |
| --- | --- | --- |
| Exact Project-addition success | `item_id` | Positive safe integer; configured registered tool and exact Project, repository, issue, and item-type arguments. The GraphQL `id` is not a database ID. |
| Exact Project-item read | Existing numeric `id` | Preserve request `item_id`, Project, repository, issue number, and content-type checks; continue harvesting issue identity from validated content. |
| Exact comment creation, minimal response | Decimal string or numeric `id`, `url` | Positive safe integer; exact HTTPS GitHub repository/issue URL and matching comment fragment, configured tool/request, and pending marker. |
| Exact comment creation, full response | Decimal string or numeric `id`, `html_url` | Same creation and identity checks. |
| Explicit comment-list recovery | Existing `id` and `html_url` | Preserve complete pagination, marker matching, exact issue scope, and unique-match requirements. |
| Error, malformed identity, unsafe integer, or wrong scope | No identity recorded | Preserve the existing IDs/publication state and require investigation or existing recovery. |

Update the Project-addition branch in `resource-id-operations.ts` to validate `item_id` using the existing integer parser. Do not use `full_database_id` or the GraphQL node ID as a fallback for an absent or invalid `item_id`; the supported safe numeric mutation response supplies it directly.

Normalize comment creation in `tracker-publication-github.ts`: accept positive safe integer IDs represented as numbers or decimal digit strings. For full comment responses, use the supplied `html_url` as the browser identity; their separate `url` is an API endpoint, not a browser link. For minimal creation responses without `html_url`, use their HTML `url`. Apply the existing exact repository/issue/comment URL assertion to that browser identity before recording. A supplied invalid `html_url` remains invalid rather than falling back to another field. Keep recovery's native full-comment parsing and pagination contract intact. GitHub's documented full response illustrates both URL fields: https://docs.github.com/en/rest/issues/comments#get-an-issue-comment.

### Consumers and boundaries

- Initialized GitHub tracker work records the Project database ID directly after a successful addition; subsequent cached-ID reads are unchanged.
- Managed GitHub plans for Epics, Tasks, and Gigs record the same durable published comment identity and update that comment on later publication.
- Incoming-PR Project handling requires content and Status facts that the minimal addition response does not contain. It retains its required exact item read; do not weaken those outcome checks or change that separate flow.
- No provider calls, new retries, creation behavior, metadata schema, resource-ID format, migration, lifecycle rules, Linear behavior, or generic MCP decoding changes.
- No speculative race handling: these are deterministic response-shape failures. Small owning-boundary corrections and regression tests address the proven interruption without introducing additional recovery machinery.

## Verify

Add focused regression coverage in:

- `tests/workflow-resource-id-operations.test.ts`: record the native Project-addition response from complete MCP evidence, assert the numeric item ID reaches the cache and operation memo, and preserve read-response issue-ID harvesting. Reject malformed or unsafe database IDs, error envelopes, wrong tools, and mismatched request scopes without recording IDs.
- `tests/workflow-tracker-publication.test.ts`: record minimal string-ID/`url` success and full numeric-ID/`html_url` success through existing envelope forms; include both API `url` and browser `html_url` in the full-response fixture. Assert published numeric identity and subsequent update of the same comment. Preserve full-read recovery coverage and reject malformed/unsafe IDs, mismatched browser URL identity, wrong request/tool/marker, and error envelopes without consuming pending publication state.

Run:

1. `node_modules/.bin/tsx --test tests/workflow-resource-id-operations.test.ts tests/workflow-tracker-publication.test.ts`
2. The local reproduction probe; both supported success cases must record successfully.
3. `npm test`
4. `npm run typecheck`
5. `git diff --check`

Tests and the local probe use synthetic identities and temporary fixture state. No live resource creation is needed for verification.
