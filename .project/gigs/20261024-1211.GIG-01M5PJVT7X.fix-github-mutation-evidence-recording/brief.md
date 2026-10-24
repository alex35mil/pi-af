# Brief

GitHub mutation recording rejects successful Project additions and comment creation

## Problem

Two workflow evidence recorders reject successful GitHub mutations because their parsers expect different response shapes. The remote operations succeed, but local identity recording fails and requires extra reads to recover.

## Reproduction

### Project addition

1. Add an issue through `projects_write:add_project_item`.
2. Receive this native response shape, shown with synthetic identifiers:

```json
{
  "id": "PVTI_example",
  "item_id": 123456,
  "full_database_id": "123456"
}
```

3. Pass the complete response unchanged to `resource_ids`, using resource `github-project-item` and action `record`.
4. Recording fails: `Error: invalid Project item ID`.

The recorder reads the GraphQL `id` instead of the numeric `item_id`.

### Plan-comment creation

1. Prepare a managed plan publication through `tracker_publication`.
2. Execute the prepared `add_issue_comment` call successfully.
3. Receive a minimal response containing string `id` and `url`.
4. Pass the complete response unchanged to `tracker_publication`, action `record`.
5. Recording fails:

```text
comment response lacks a numeric ID and issue-scoped html_url; recover through explicit comment reads
```

The recorder requires numeric `id` and `html_url`, rejecting the successful creation response.

## Expected and actual behavior

Expected: record identities directly from supported clear-success mutation responses while preserving resource-scope validation.

Actual: initialization or publication is interrupted after remote success. Recovery requires `get_project_item` or paginated issue-comment reads. Neither successful mutation should be repeated.

## Evidence and correction

Affected paths:

- `workflows/extensions/integrations/resource-id-operations.ts`: `recordResourceIdsEvidence` reads `responseObject(evidence).id` for Project addition.
- `workflows/extensions/integrations/tracker-publication-github.ts`: `identity` accepts only numeric `id` and `html_url` for comment creation.

Normalize the supported mutation response shapes at the evidence boundary, retain identity/scope checks, and add regression coverage for both native success responses and their corresponding read responses.

Original Project-addition report inspected revision: `dbcca6dbbcbd631bd65d7ed7cd09bc073c322a8b`. Both paths were rechecked at `c061ef42a283aa512c535493a292d4eaaf546407`, with no local changes in those files. The live tools’ exact source revision was not independently established.

<sub>Sent via Pi. Model: openai-codex/gpt-6.1-sol.</sub>
