# Plan

## Overview

Extend GitHub Project setup to reproduce this repository’s Board defaults for new, existing, and resumed Projects. Inspect current settings, preview exact changes, require approval, apply documented API mutations, and verify provider state. Settings without supported update APIs use guided UI steps with explicit confirmation.

### Plan highlights

- Board layout, Status columns, **no swimlanes**, **Priority sorting with Urgent first**, Count only, and no slicing.
- Show the eight confirmed fields; keep Internal ID hidden and Kind classification in labels.
- Offer repository linking and default-repository configuration separately, both enabled for the setup repository by default.
- Preserve unrelated settings and views; distinguish verified API changes from unfinished manual setup.

## Defaults and repository choices

| Setting | Default |
| --- | --- |
| View name/layout | Board / board |
| Visible fields, saved order | Title, Assignees, configured Status, Linked pull requests, Sub-issues progress, Labels, configured Priority, configured Phase |
| Columns | Configured Status field |
| Swimlanes | None |
| Sorting | Configured Priority, Urgent → High → Medium → Low |
| Field sum / slicing | Count only / none |
| Repository association | Link the setup repository |
| Default repository | Offer the setup repository; allow opting out |

Use semantic references for workflow fields and resolve their configured names and scopes. Custom Priority names/options follow the selected metadata; the standard defaults place Urgent first. Visible-field resolution must distinguish issue-backed metadata from same-named custom Project fields and reject missing, duplicate, or ambiguous selections. Internal ID stays provisioned but hidden. Sub-issues progress represents Epic/Task children. The user deleted the legacy Kind Project field and provider reads confirmed removal; no reusable field deletion or Kind-field provisioning is added.

Association lists the Project in the repository’s Projects tab; default repository routes newly created issues. Their approved combinations are:

| Link repository | Configure default | Behavior |
| --- | --- | --- |
| Yes | Yes | Default proposal; disclose both effects, including the default setting’s link effect. |
| Yes | No | Link only; omit the default-repository step. |
| No | No | Allow both opt-outs. |
| No | Yes | Block and ask the user to change one choice; never silently override either. |

Default-repository opt-out leaves that setting unmanaged, not cleared or verified. Before removing an existing association, have the user inspect its default repository in Settings and resolve a default pointing to that repository. Stop when the state cannot be established. Include both choices and effects in preview approval; skipped default configuration creates no manual completion requirement.

## Implementation and safety

Extend the owning setup boundary in `workflows/extensions/project-setup/github-project.ts`:

- Add read-only selected-Project inspection with complete pagination of fields, views, visible fields, grouping, columns, and sorting. Mark unavailable settings explicitly.
- Extend the strict specification/defaults with presentation and separate default-repository intent. Keep these setup-only; runtime tracker configuration and entity schemas remain unchanged.
- For a new Project, configure its unique initial view, create one when absent, and stop for explicit selection when multiple exist. Existing/resumed Projects require the exact inspected view ID. Reject missing or foreign views.
- Resolve visible-field IDs after field provisioning, preserving organization-native/mixed-scope support. An unavailable field requires explicit correction, never silent omission or a duplicate stand-in field. Name/layout/visible fields are editable; roadmap requires an empty visible-field list.
- Include current/proposed view values, repository effects, and manual steps in the existing preview/hash approval. Reject stale approval, skip matching writes, and verify provider read-back. Before creation, describe the initial-view strategy symbolically and resolve IDs afterward.
- API writes change only approved name/layout/visible fields. Preserve saved filters, other settings, and other views; new views have no filter. After uncertain writes, inspect exact provider state before retrying. Preserve partial work; never blindly duplicate, replace, or delete views.

Update the tool registration description, setup skill, setup reference, extension README, provider-fake tests, and instruction tests. Preserve existing lifecycle/label/field semantics; do not copy this repository’s IDs, title, visibility, or older Status descriptions into generic defaults. No dependency changes, undocumented endpoints, browser automation, or live reprovisioning experiments.

## Supported APIs and manual completion

Verified sources: [GraphQL Projects](https://docs.github.com/en/graphql/reference/projects), [official MCP implementation](https://github.com/github/github-mcp-server/blob/main/pkg/github/projects.go), [REST views](https://docs.github.com/en/rest/projects/views), [Board customization](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout), and [default repository](https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/adding-your-project-to-a-repository).

GraphQL/MCP support updating view name/layout/visible fields. Grouping and sorting are readable but not supported by the verified existing-view update inputs; REST creation-only inputs do not justify replacing a view. Default repository, field sum, and slicing lack verified read/update support. A readable setting is not necessarily writable.

Return precise manual steps with Project/view links in preview and apply results:

1. View options → Column by (Column field) → configured Status; Board layout only.
2. Swimlanes (Group by) → No grouping.
3. Sort by → configured Priority; use only that sort and choose the direction placing Urgent before High, Medium, and Low. With custom metadata, use the selected Priority option order. Save and verify the actual ordering rather than inferring it from an icon.
4. Field sum → Count only; Slice by → No slicing. Save the view and reopen its options.
5. Only when selected: Project menu → Settings → Default repository → setup repository → Save changes; reload Settings to verify.

Read back API-visible settings after manual changes. Unreadable settings require user confirmation or a screenshot of saved state. Report API verification separately from required manual confirmation; never claim full setup complete while required steps remain unconfirmed. Keep confirmation in the conversation, not a new persisted checkpoint protocol.

## Verification

Cover exact defaults and semantic field scopes; all new/existing/resumed view paths; pagination; no-op setup; preserved settings/views; missing/foreign views; stale approval; read-back mismatch; lost-response recovery without duplicates; all four repository-choice combinations; layout constraints; and manual instructions/verification boundaries. Add assertions for no swimlanes and Priority sorting with Urgent first. Existing provisioning and credential-redaction tests remain required.

Run focused setup/instruction tests, `npm test`, `npx tsc --noEmit`, changed-file `npx oxfmt --check`, and `git diff --check`. Before this defaults revision, the implementation passed 226 tests and type-checking; three changed TypeScript files still needed formatting. Re-run verification after corrections. Live checks remain read-only; do not mutate or create a real Project for testing.
