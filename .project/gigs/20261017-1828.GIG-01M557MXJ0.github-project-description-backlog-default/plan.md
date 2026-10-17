# Plan

## Overview

GitHub Project setup must automatically identify the configured repository in the Project description and leave an explicit manual follow-up note to make Backlog the Status field's default value. The available MCP tools and documented public APIs do not expose that field-default setting. Today, setup neither writes the description nor reports the required follow-up.

### Plan highlights

- Set the Project's short description to `Repository: https://github.com/<owner>/<repo>`, using the resolved setup repository, through the existing preview/hash-approved provisioning flow.
- Leave a manual follow-up note explaining the API limitation and how to select the configured Backlog option as the configured Status field's default value. Use the existing saved-state confirmation flow before claiming full setup completion.
- Apply these requirements to new, existing, and resumed Projects, independently of layout and default-repository opt-out.
- Leave built-in automations, Project README content, existing item values, and unrelated Project/view settings unchanged. URL clickability is not part of the verified outcome.

## Root cause

### Symptom

A user runs `/project-setup` and follows its returned steps. The Project has no repository-reference description from setup, and the Status field's default remains unchanged instead of being deliberately set to Backlog. The originating issue reported Todo; the historical Project and installed revision were not established.

### Evidence

- `workflows/extensions/project-setup/github-project.ts`: `ProjectDetails` and `getProject` do not read `shortDescription`. `planProjectSettings` and the application path manage visibility and repository association only. No description mutation exists.
- `desiredProjectFields` and `updateNativeStatus` configure Status options, not a field default. `manualStepsFor` does not include a default-Status step. The existing fresh-Board test explicitly expects only field sum, slicing, and default repository as outstanding manual settings.
- Baseline verification: `npx tsx --test tests/workflow-github-project-setup.test.ts` — 61 passed, zero failures.
- GitHub's published schema at <https://docs.github.com/public/fpt/schema.docs.graphql> exposes `ProjectV2.shortDescription` and `UpdateProjectV2Input.shortDescription`, separately from `readme`. Its Project-field update input has no field-default assignment; the documented REST Project-field API also provides no default-value setter.
- GitHub announced native field defaults at <https://github.blog/changelog/2026-04-09-release-info-in-issue-sidebar-and-project-defaults/>. The user explicitly selected the Status field's default value, not the separate item-added automation documented at <https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations>.

### Cause

The setup provisioning contract models neither the repository description nor the native Status field default. Creating a Backlog option does not configure that option as the field default. This is an omission in the shared setup boundary, not an evidenced GitHub dependency defect.

## Proposed fix

### Project description

Extend Project-detail reads with the nullable native `shortDescription`. Derive the exact desired text from the resolved setup repository identity, not the Project owner or title. Keep the public setup-input schema unchanged: this value is determined by the requested setup contract.

For new Projects, include the exact description write in the preview and apply it after creation. For existing and `resume-created` Projects, compare the current short description and plan a write only when it differs. The preview must show the existing value and exact replacement; both participate in the approval hash so a changed replacement cannot reuse stale approval. The requested description replaces existing short-description text only through that exact approved preview.

Apply through the documented `updateProjectV2` short-description input. Read back and verify exact persistence through the existing final-settings verification. A failed or ignored write must not produce API-verified success. Preserve partial work and the existing safe error/stage reporting; resume from inspected provider state without creating another Project. Preserve the existing visibility and repository-association behavior.

### Native Status field default

Extend the shared returned manual steps with a `defaultStatus` follow-up note. State explicitly that this setting was not applied automatically because the available MCP tools and documented public APIs do not expose a setter. Its desired value is `fields.status.options.backlog.name`, and its instructions name `fields.status.field`, so customized names work without hardcoded Status/Backlog literals.

The note directs the user to Project settings, the configured Status field, and its default-value control: select the configured Backlog option, save, then reopen/reload the field settings and confirm the saved default. Provide the exact Project link after apply, rather than presenting this Project-level setting as a view option. Mark `defaultStatus` as unavailable to API inspection alongside the existing unreadable settings.

Include this step in preview/hash approval and apply results for every Project mode and layout, including when default repository is unmanaged. API provisioning remains separately verified; full setup completion requires user confirmation or a screenshot of the saved Status-field default in addition to the other required manual settings. Do not use an undocumented API or infer this default from option order, option presence, or an existing item's Status.

### Decision table

| Supported case | Description behavior | Status field default | Preserved boundary |
| --- | --- | --- | --- |
| New Project | Preview exact desired text; write after creation; verify | Required guided UI step | Existing safe creation/view cleanup rules |
| Existing Project, description already exact | No description write | Required guided UI confirmation | Existing item values and unrelated settings |
| Existing Project, description empty or different | Preview current and replacement; approved write; verify | Required guided UI step | Project README, other repository links, and unrelated settings |
| `resume-created` Project | Compare, preview, and finish only a missing description change | Required guided UI step | Existing selected-view and recovery rules |
| Board, table, or roadmap; default repository managed or unmanaged | Same repository-derived description | Same configured Status/Backlog names | Default-repository choices and existing layout-specific manual steps |
| Description write fails or read-back differs | Stop with safe stage/request context; preserve partial resources | Do not claim full setup completion | No replacement Project or unapproved retry |
| API work succeeds, default-status confirmation outstanding | API verification only | Setup remains awaiting manual confirmation | No claim that API verified the default |

No item-added automation, other automation, existing item Status, or Project README is changed. Native field defaults affect newly added items according to GitHub's behavior; this work does not promise precedence over independently configured automations.

### Ownership and cost

The shared provisioning code owns discovery, preview, application, verification, and manual-step generation. Update its direct consumers rather than adding skill-only workarounds. The supported trigger is ordinary setup; omitted settings remain unchanged on the current execution path, producing the reported incomplete configuration. No concurrency or speculative failure handling is introduced. A description action/read and one existing-model manual step address the omission without a new runtime setting, migration, or external-state checkpoint.

## Affected files

- `workflows/extensions/project-setup/github-project.ts`: Project description discovery/planning/application/verification; default-status manual instructions and unavailable-setting reporting.
- `workflows/skills/project-setup/SKILL.md`: include both intended effects in the approved setup proposal and require saved Status-default confirmation.
- `workflows/references/setup.md`: document description replacement, native field-default scope, supported API boundary, and the expanded manual-completion contract.
- `workflows/extensions/project-setup/README.md`: synchronize provisioning capabilities and required manual steps.
- `tests/workflow-github-project-setup.test.ts`: extend the provider fake and regression coverage at the provisioning boundary.
- `tests/workflow-instructions.test.ts`: protect the corresponding skill/reference completion instructions.

## Verify

- Provisioning tests cover new, existing, and `resume-created` descriptions; matching-description no-op; explicit differing-description replacement; using the setup repository rather than a different Project owner; exact inspection/read-back; stale approval after a changed description; failed and ignored writes; preserved unrelated state.
- Manual-step tests cover all Project modes and layouts, custom Status/Backlog names, and default-repository opt-out. Assert `defaultStatus` remains manual/unavailable, names the Project field, and requires saved-state confirmation. Assert no Status-default API or automation mutation is introduced.
- Run `npx tsx --test tests/workflow-github-project-setup.test.ts tests/workflow-instructions.test.ts`, `npm test`, `npx tsc --noEmit`, and `git diff --check`.
- Inspect the final diff for unchanged runtime tracker schemas, Project README, existing item values, automation behavior, and unrelated view/settings logic.
- Live Project mutation and UI verification are not authorized by this code-change request. Record that limitation explicitly rather than claiming a live description/default was changed or that the URL is clickable.
