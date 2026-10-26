# Incoming PR Project handling

Track the selected PR itself on the configured GitHub Project.

- Use the Project, server, and Status mapping returned by `inspect_incoming_pr_context`. Never create an issue or initialized workflow entity.
- The forge and Project MCP servers may differ.
- Without a configured GitHub Project, report that limitation and keep forge-only private work, rather than inventing a destination.

## Read and plan

1. **Read.** Use actual configured PR-get evidence and fresh scoped Project reads. The context returns the full repository and PR lookup arguments.
   - Finish membership pagination before claiming absence, and use the actual verified item ID when present.
   - Read the configured single-select Status field and its options through that Project's server, then read the item with that Status in `field_names`.
2. **Plan.** Call `plan_incoming_pr_intake`, `plan_incoming_pr_review`, `plan_incoming_pr_shipping`, or `plan_incoming_pr_cancellation`, matching the explicitly approved intent. Each tool fixes its action, so don't pass an `action` selector. Pass:
   - `reference` and the actual PR-get `evidence`;
   - `fieldEvidence`: actual `projects_get` `get_project_field` evidence in the configured Project;
   - `membership`, one of:
     - `absent`, with complete `lookup` page evidence;
     - `present`, with the item `evidence`;
     - `added`, with that item evidence and the successful native add `creation` evidence;
     - intake only: `reconciled`, after an uncertain add, with fresh item `evidence` and `attempt` holding that add's actual `tool` and `arguments`, without a success response.

     A complete scoped add or Status-write success can supply the item evidence; otherwise read only the missing identity and Status facts.
   - intake also takes the user's `choice`, `backlog` or `todo`.
3. **What the planner does:**
   - It validates consistency and returns the required native MCP arguments, an unchanged state, or a blocker.
   - It calls no providers, grants no approval, and doesn't authenticate evidence freshness on its own.
   - Get actual reads under normal permissions. Never fabricate evidence or bypass a failed or denied tool.

## Maintainer-controlled transitions

| Action | Behavior |
| --- | --- |
| Missing intake | Ask Backlog or Todo; that choice approves only adding this PR and setting its initial Status. |
| Existing intake or resume | Keep membership and progress; no re-add or requeue. Ask about missing or conflicting state rather than picking a default. |
| Explicit review start or continuation | Set In Review, or skip an already-applied assignment. Never reopen terminal work implicitly. |
| Feedback, contributor updates, draft changes, rebase, fixes, or tests | Stay In Review. Never infer contributor activity or set In Progress or Phase. |
| Confirmed merge | Done. CI, approval, a commit, or a push alone isn't Done. |
| Explicit cancellation | Close the exact PR, confirm closed and unmerged, then Canceled. An already-merged PR is Done instead. |

**Adding a missing item:**

1. Run only the planned `add_project_item` with `item_type: pull_request` and `pull_request_number`.
2. Reuse its clear-success ID, read the exact scoped item, and continue with `membership.state: added` plus the actual creation evidence.
3. Complete the already-chosen initial Status without asking for another queue choice. Existing In Review or terminal progress is kept.

The planner updates only the configured Status, never labels, Priority, Phase, linked issues, or unrelated items.

**Running planned calls:**

- Run the planner's native calls on their exact configured servers.
- An open-PR cancellation plan first returns the scoped close call, not an early Canceled update. After closure, get the actual outcome and plan again.
- Confirmed merged evidence goes through the same shared forge merge operation before Done.

## Recovery and reporting

**Uncertain add:**

- Skip matching absolute assignments. After an uncertain add, read complete membership before another add.
- Once membership is confirmed, continue the pending intake with `membership.state: reconciled`, the actual attempted add's `tool` and `arguments`, fresh item evidence, and the user's original `choice`.
- This completes only the missing initial Status write. It doesn't repeat the add, ask for another queue choice, or invent creation evidence.
- Keep In Review, Done, and Canceled progress, and skip a Status that already matches. Ordinary existing membership stays `present` and is never requeued by this recovery.

**Other outcomes:**

- Reconcile uncertain closes and merges before repeating them.
- A confirmed remote step stays completed when a later board write fails.
- Keep local checkout work and evidence. Never undo a confirmed merge or Done, or claim every step succeeded.

**Automation:**

- The [fork-only Action](./automation.md) adds membership without Status writes, so existing cards need no intake prompt.
- Never install broad native auto-add, change credentials, permissions, or Project rules, or turn contributor events into lifecycle updates.
- User-owned conflicting settings are a reported blocker, never something to override silently.
