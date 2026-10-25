# GitHub Project setup

Read this when provisioning, adopting, or resuming a GitHub Project for a GitHub tracker. The tools are `inspect_github_repository_setup`, `inspect_github_project_setup`, `inspect_github_project`, `preview_github_project_setup`, and `apply_github_project_setup`. Their output's `trackerConfig` is the only source for the tracker block in `.project/integrations.json` ([setup](../setup.md#github-tracker)).

## Discovery

1. **Repository.** `inspect_github_repository_setup` takes `credentialEnv` and `repository`. It returns the canonical owner and name, the verified owner type, and `suggestedProjectTitle`, which is the repository name. Use it before asking about the Project owner. An unknown owner type or failed read stops discovery.
2. **Project owner.** Explain that the Project owner contains the Project and controls access. Offer the verified repository owner before asking for another explicit owner.
3. **Owner-level discovery.** `inspect_github_project_setup` returns existing Projects, the title suggestion, and editable defaults.
   - A new Project uses the suggested title unless the user overrides it, and the resolved title appears in the preview before creation.
   - Adopted titles stay unchanged.
4. **Field scope:**
   - Personal repositories use Project-contained Priority and Internal ID, with no scope question and no organization metadata discovery.
   - Organization repositories keep an explicit choice of Project-contained, organization-native, or custom scope, independent of the Project owner type.
   - Preview enforces repository ownership for issue-scoped inputs.
5. **Existing Projects.** `inspect_github_project` takes `credentialEnv`, `projectOwner`, and `projectNumber`. It returns the Project's short description, fields, and views, fully paginated.
   - View reads include visible fields, grouping, columns, and sorting.
   - The default repository, field sum, slicing, and the Status field's default value (`defaultStatus`) aren't available through the verified API.

## Short description

- **Value:** setup sets `ProjectV2.shortDescription` to `Repository: https://github.com/<owner>/<repo>`, using the resolved setup repository. It's derived, not a specification input, and independent of the Project owner, layout, and repository choices.
- **Preview:**
  - for a new Project, the exact text;
  - for an existing or resumed one, the current and replacement text. A changed replacement invalidates an earlier hash approval.
- **Apply:** writes only a differing description through `updateProjectV2`, then verifies the exact read-back before reporting success.
- **Preserve:** the Project README (`readme`) and unrelated settings. Whether the URL is clickable isn't verified.

## Presentation

Presentation is a setup-only input to preview and apply, never runtime configuration. Every specification includes:

```json
{
    "defaultRepository": "setup-repository",
    "presentation": {
        "target": { "mode": "initial" },
        "name": "Board",
        "layout": "board",
        "visibleFields": [
            { "kind": "field", "name": "Title" },
            { "kind": "field", "name": "Assignees" },
            { "kind": "workflow", "field": "status" },
            { "kind": "field", "name": "Linked pull requests" },
            { "kind": "field", "name": "Sub-issues progress" },
            { "kind": "field", "name": "Labels" },
            { "kind": "workflow", "field": "priority" },
            { "kind": "workflow", "field": "phase" }
        ]
    }
}
```

### Targets

| Situation | Target and behavior |
| --- | --- |
| New Project, Board layout | `initial`: create a new Board through REST, verify every configured setting, then delete only the captured, unchanged default view. |
| New Project, table or roadmap | `initial`: configure the unique initial view, or create one when there's none. |
| Existing or resumed Project | `{ "mode": "selected", "viewId": "<exact selected ID>" }` from inspection: update only that view's name, layout, and visible fields, and keep its filter, grouping, sorting, and every other view. Nothing is replaced or deleted. |

**The captured default view:**

- Take its ID from the successful Project-create response, plus its readable settings, before any further provisioning.
- Never identify it by title or number alone.
- No initial view means nothing to delete. Several initial views need explicit inspection and selection.
- Keep user-created views.

### Fields

- **Provisioning scope:** provision only the configured workflow fields. Never delete any field automatically, including custom fields the user created that the workflow doesn't use.
- **Layout** is `board`, `table`, or `roadmap`. Roadmap needs an empty visible-field list.
- **Board visible fields** are an exact, distinct selection:
  - provider-returned orderings count as equal in preview, hash approval, verification, recovery, and default-view fingerprints;
  - missing, extra, or duplicate fields fail validation;
  - GitHub supports visibility, not a controllable card-field order, so setup promises no Board field order.
- **Table views** keep ordered-field matching.
- **Semantic references:** list configured Status, Priority, and Phase as `{ "kind": "workflow", "field": "status" | "priority" | "phase" }`, never by literal field name, so custom-named metadata resolves to the right field. Other fields use `{ "kind": "field", "name": "..." }`. A missing or ambiguous field blocks; it's never dropped silently.
- **Hidden and label-backed fields:** Internal ID is provisioned but hidden. Kind is represented by repository labels.
- **Sorting:** a fresh Board's Priority sort needs the configured Priority field exposed on the Project, even when it isn't visible. Hiding it doesn't replace attaching issue-scoped Priority.

### Priority order

An existing Priority field's saved option order must match the desired order, forward or reversed.

- Any other order blocks preview before any setup writes.
- Organization Priority is checked before a new Project is created, using the [Issue Field API](https://docs.github.com/en/rest/orgs/issue-fields)'s numeric option priorities, not response-array order. Missing or ambiguous priorities block as unverifiable; there's no array-order fallback.
- The conflict names the saved and desired orders and the owning settings: Project Settings → the configured Priority field, or the organization's Issue Field settings for issue-backed Priority.
- Reordering existing options or changing the requested order needs separate approval, keeps every option value, and requires a new inspection and preview. It changes the field for every view, so setup never does it implicitly.

### Repository association and default repository

These are separate choices, both offered enabled for the setup repository.

| Choice | Effect |
| --- | --- |
| `project.associateRepository` | lists the Project in the repository's **Projects** tab |
| `defaultRepository: setup-repository` | routes new issues created from the Project to the repository, and also links it |
| `defaultRepository: unmanaged` | leaves that setting untouched, without clearing it |

- `setup-repository` with `associateRepository: false` is blocked, because setting a default also links the repository. Both opt-outs are valid.
- Before removing an existing association, check the default in the UI and resolve a default that points at that repository. Stop when its state can't be confirmed.

## Preview and approval

The preview hash covers exact view changes, the resolved title and scopes, repository effects, and manual steps. A fresh Board preview explicitly includes:

- REST creation with the configured Status columns;
- no swimlanes;
- Priority as the only sort, in the configured order;
- deletion only of the captured, unchanged default, after verification.

## Board creation over REST

**Routes:** `/orgs/{org}/projectsV2/{project_number}/views` or `/users/{user_id}/projectsV2/{project_number}/views`, with the encoded owner login in both. The personal route's `user_id` takes the login, as verified by live Board creation.

**Request fields:** send numeric provider field IDs, never decoded GraphQL node IDs:

- `visible_fields`;
- Status as `vertical_group_by`;
- an empty `group_by`;
- Priority as the only `sort_by`, in the direction that produces the configured option order.

**Stops:**

- The personal endpoint doesn't support fine-grained or GitHub App tokens. Permission or authentication errors stop provisioning; never switch to another API.
- A missing numeric field ID or exposed sort field stops before any view is created or deleted.

**Verify and clean up:**

1. Verify the created view's Project, name, layout, visible fields, columns, grouping, and sorting.
2. Confirm the Project is empty and the captured default unchanged.
3. Delete only that ID through `deleteProjectV2View`.
4. Verify its absence and that the Board is still correct.

An edited default, a nonempty Project, or a failed verification keeps all views and requires inspection. Keep unrelated views added during setup.

## Diagnostics

Setup failures identify:

- the safe request method and path, and the setup or provisioning stage;
- the HTTP status and useful provider error details.

**Specifics:**

- Board response-shape errors include the create request context.
- Verification names the missing or unexpected view, or the failed name, layout, field, column, grouping, or sort check. Field mismatches list missing, extra, or duplicate IDs.
- Unsuccessful create recovery reports candidate identities and mismatches together with the original failure.
- GraphQL requests identify `POST /graphql`, and the stage locates the operation. Recovery-read failures keep the original failed-write context.

**Never included:** credentials, authorization headers, or request bodies. Configured token text is redacted from provider messages.

Keep partial resources and investigate the exact provider state instead of blindly retrying creation.

## Recovery

- **Lost Board-create response:** recover only one newly appeared view matching the approved Board. Zero or several matches stop without another create or deletion.
- **Uncertain deletion:** reconcile through exact view-state reads.
- **Failed or interrupted apply:** inspect the confirmed Project, explicitly select its existing Board using `resume-created`, and approve a fresh preview and hash. This only updates the selected view, keeps its other settings and every other view, and never infers default-view provenance or deletion permission from an earlier run.
- **Lost Project-create response:** it can't establish default-view provenance. Report the confirmed Project and require explicit `resume-created` inspection and selection, without deleting any view.

Keep partial work after failures. Apply returns `state: provisioned` only for verified API configuration, with a separate manual-confirmation requirement.

## Guided UI steps

The documented GraphQL view update, and current MCP, support name, layout, filter, and visible fields. REST creation also configures grouping and sorting for fresh Boards; adopted or resumed views keep their update path instead of being replaced. The setup tool returns these steps with the Project and view links.

| Steps | When |
| --- | --- |
| 1–3 | existing or resumed views, and new table or roadmap views; never a verified fresh Board |
| 4–7 | every Project, including a verified fresh Board (step 6 only with `defaultRepository: setup-repository`) |

1. Open the selected view → **View** → **Column by** (also called **Column field**) → the configured Status. Board layout only.
2. **View** → **Swimlanes** (also called **Group by**) → **No grouping**.
3. **View** → **Sort by** → only the configured Priority, in the direction that puts **Urgent → High → Medium → Low** first. Custom Priority options follow their selected order. Save, then check the actual order, not just the icon.
4. **View** → **Field sum** → **Count** only.
5. **View** → **Slice by** → **No slicing**.
6. Only with `defaultRepository: setup-repository`: Project menu → **Settings** → **Default repository** → the setup repository → **Save changes**. This also links it.
7. For every Project mode and layout: Project menu → **Settings** → the configured Status field → **Default value** → the configured Backlog option → save.
   - The `defaultStatus` manual follow-up note explains that available MCP tools and documented public APIs don't expose a setter, so this default isn't applied automatically.
   - Use the returned Project link, not a view option. Leave built-in automations and existing item values unchanged.

**Confirming:**

- Save the view and reopen its options to confirm steps 1–5. Reload Settings to confirm steps 6–7.
- Re-read API-visible settings after manual changes. Field sum, slicing, default repository, and the saved Status-field default need user confirmation or a screenshot of the saved state.
- Never claim setup is complete while required manual work is unconfirmed.
- Opting out of the default repository drops step 6 and its confirmation; step 7 is always required.

**Capability sources:** [native field defaults](https://github.blog/changelog/2026-04-09-release-info-in-issue-sidebar-and-project-defaults/), [GraphQL Projects](https://docs.github.com/en/graphql/reference/projects), [REST view creation](https://docs.github.com/en/rest/projects/views), [Board customization](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout), and [default repository](https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/adding-your-project-to-a-repository). Use only documented APIs. Repository association doesn't prove the default repository.
