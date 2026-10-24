# Incoming PR Project handling

Track the selected PR itself on the configured GitHub Project. Use the Project/server/Status mapping returned by `inspect_incoming_pr_context`; do not create an issue or initialized workflow entity. Forge and Project MCP servers may differ. Without a configured GitHub Project, report that limitation and retain forge-only private work rather than inventing a destination.

## Read and plan

Use actual configured PR-get evidence and fresh scoped Project reads. The context returns the complete repository/PR lookup arguments. Finish membership pagination before claiming absence; use the actual verified item ID when present. Read the configured single-select Status field and its option catalog through that Project's server, then read the item with that Status in `field_names`.

Call `plan_incoming_pr_intake`, `plan_incoming_pr_review`, `plan_incoming_pr_ship`, or `plan_incoming_pr_cancel` matching the explicit approved intent, with:

- `reference` and actual exact PR-get `evidence`;
- `fieldEvidence`: actual `projects_get:get_project_field` evidence in the configured Project;
- `membership`: `absent` with complete `lookup` page evidence, `present` with exact item `evidence`, or `added` with that item evidence and the successful native add `creation` evidence. During intake only, use `reconciled` after an uncertain add with fresh exact item `evidence` and `attempt` containing that actual add's `tool` and `arguments`, without a success response. A complete scoped native add/Status-write success can supply item evidence; otherwise read only the missing identity/Status facts;
- Intake additionally supplies the user's `choice`, `backlog` or `todo`. Each tool fixes its action; do not pass an `action` selector.

The local planner validates consistency and returns required native MCP arguments, unchanged state or a blocker. It neither calls providers nor grants approval or independently authenticates evidence freshness. Obtain actual reads under normal permissions; never fabricate evidence or bypass a failed/denied tool.

## Maintainer-controlled transitions

| Action                                                               | Behavior                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Missing intake                                                       | Ask Backlog or Todo; that choice approves only adding this PR and setting its initial Status.                             |
| Existing intake/resume                                               | Preserve membership and progress; no re-add or requeue. Ask about missing/conflicting state rather than choose a default. |
| Explicit review start/continuation                                   | Set In Review, or skip an already-applied assignment. Do not reopen terminal work implicitly.                             |
| Feedback, contributor updates, draft changes, rebase, fixes or tests | Stay In Review; do not infer contributor activity or set In Progress/Phase.                                               |
| Confirmed merge                                                      | Done. CI, approval, commit or push alone is not Done.                                                                     |
| Explicit cancel                                                      | Close the exact PR, confirm closed/unmerged, then Canceled. An already-merged PR is Done instead.                         |

For a missing item, execute only the planned `add_project_item` with `item_type: pull_request` and `pull_request_number`. Reuse its clear-success ID, obtain the exact scoped item read, and continue with `membership.state: added` plus the actual creation evidence. Complete the already-chosen initial Status without another arbitrary queue choice; existing In Review/terminal progress is preserved. The planner updates only configured Status, never labels, Priority, Phase, Internal ID, linked issues or unrelated items.

Use native calls returned by the planner on their exact configured servers. An open-PR cancel plan first returns the scoped close call, not a premature Canceled update. After closure, obtain actual outcome evidence and plan again. Confirmed merged evidence is checked through the same shared forge merge operation before Done.

## Recovery and reporting

Skip matching absolute assignments. After an uncertain add, use complete exact membership reads before another add. When membership is confirmed, continue the pending intake with `membership.state: reconciled`, the actual attempted add's `tool`/`arguments`, fresh item evidence and the original user's `choice`. This completes only the missing initial Status write; it does not repeat the add, require another queue choice or invent successful creation evidence. Preserve In Review/Done/Canceled progress and skip an already-matching Status. Ordinary existing membership remains `present` and is never requeued by this recovery. Reconcile uncertain closes/merges before repeating them. A confirmed remote step remains completed when a later board write fails. Keep local checkout work and evidence; do not undo confirmed merge/Done or claim all steps succeeded.

The [fork-only Action](./automation.md) adds membership without Status writes; existing cards need no intake prompt. Do not install broad native auto-add, change credentials/permissions/Project rules, or turn contributor events into lifecycle updates. User-owned conflicting settings are a reported blocker, not something to silently override.
