# Fix personal GitHub Project Board provisioning failing with 404

## Overview

Personal GitHub Project setup fails after partially provisioning a Project because Board creation addresses the owner by numeric database ID. A controlled sandbox test confirmed that the numeric-ID POST returns 404 while the same Board settings sent to the username route succeed. Fix the shared provisioning client and make setup failures identify their request and stage so users can diagnose partial setup without blindly repeating creation.

### Plan highlights

- Create personal Boards using the encoded owner login; keep the organization route and numeric field IDs unchanged.
- Include the safe request method/path and setup or provisioning stage in failures, without credentials, authorization headers, or request bodies.
- Preserve complete Board verification, partial Projects, existing views, and uncertain-write reconciliation.
- Ground regression coverage in the live route evidence and retain exact provider-effect approval.

## Root cause

### Symptom

After approving setup for a personal Project, the Project and its fields remain but the requested Board is absent. The only error is `GitHub API failed with status 404: Not Found`, so the user cannot identify the failed request or provisioning stage.

### Evidence

- `workflows/extensions/project-setup/github-project.ts:createBoardView` resolves `/users/{login}` to a numeric database ID, then POSTs `/users/{numeric_id}/projectsV2/{project_number}/views`.
- The test provider accepts only `users/42` for personal Board creation, repeating rather than independently validating that route assumption.
- GitHub's current REST view-creation documentation names a string `user_id` without resolving whether that means login or numeric ID. It documents the grouping/sorting payload and excludes fine-grained PATs and GitHub App tokens for personal Projects.
- On the user-approved public sandbox `alex35mil/__sandbox__`, Project 4, using API version `2026-03-10` and the configured environment-backed token:
  - `POST /users/4244251/projectsV2/4/views` returned 404; complete view read-back confirmed no creation.
  - `POST /users/alex35mil/projectsV2/4/views` returned 201 with the equivalent Board settings.
  - Independent read-back confirmed the five requested visible fields in order, Status columns, no swimlanes, and Priority as the sole ascending sort. Priority options were Urgent, High, Medium, Low.
  - Only the probe-created Board was deleted. Read-back confirmed the original table view and its visible fields remained. The Project retained its two items during Board verification; no item or Project-setting mutation was attempted.
- The shared `rest` and `graphql` request methods discard request method/path when formatting HTTP errors. The provisioning orchestration does not add stage context.
- Baseline focused setup/config tests: 69 passed, 0 failed.

### Cause and ownership

The shared setup client interprets a string owner identifier as a numeric ID, but the verified personal POST route requires the login. Its transport and orchestration also discard the information needed to locate a failure. The fix belongs in `github-project.ts`, not a consuming repository, manual Board workaround, alternate client, or retry fallback. Both preview/apply consumers and their guidance must use this same contract.

The exact installed revision at the original failure remains unknown. The sandbox independently reproduces the current source's numeric-route failure; no claim is made that all installed code was identical. The username probe logged HTTP success but did not retain the full response envelope, so it does not establish a new response-parsing contract. Existing exact-state recovery remains unchanged.

## Proposed fix

### Personal and organization Board requests

Remove the personal-owner REST lookup and construct `/users/{encoded_login}/projectsV2/{project_number}/views` directly from the verified Project owner. Continue to send numeric provider field IDs and the existing exact Board payload. Keep `/orgs/{encoded_org}/projectsV2/{project_number}/views` for organization Projects.

| Supported case | Required behavior |
| --- | --- |
| Fresh personal Board | One POST to the encoded owner-login route; no numeric-owner lookup or alternate-route retry. |
| Fresh organization Board | Existing organization route and full Board settings. |
| Selected existing/resumed view | Existing GraphQL update path; preserve unrelated settings and views. |
| Successful or uncertain Board create | Existing complete read-back and exact new-Board reconciliation before any captured-default cleanup. |
| Failed create with no matching new Board | Surface the contextual error; preserve the partial Project and every existing view. |
| Authentication or permission failure | Report the failure; do not change credentials, endpoint family, or approval policy. |

### Safe diagnostics

At the shared request boundary, attach the actual method and safe API path to HTTP errors, GraphQL errors, invalid JSON, and network failures. Keep status and useful provider error detail. GraphQL requests identify `POST /graphql`; the orchestration supplies their meaningful stage.

At the owning operation/provisioning boundary, identify the current stage, including discovery/preview, Project creation/settings, Project fields, repository labels, organization metadata, Board/view setup, and final verification. Preserve error causes and existing recovery behavior; successful reconciliation remains successful rather than becoming a new failure. A recovery-read failure must not erase the original failed-write context.

Never include tokens, authorization headers, full request bodies, or raw fetch request objects. Redact the configured token from returned diagnostic text, including provider-supplied error messages. This is the existing credential-safety requirement, not a new retry or recovery state machine.

## Scope and affected files

- `workflows/extensions/project-setup/github-project.ts`: owning Board route, request diagnostics, and orchestration stage context.
- `tests/workflow-github-project-setup.test.ts`: evidence-based personal route fake and behavioral regression/error tests.
- `workflows/skills/project-setup/SKILL.md` and `workflows/references/setup.md`: replace the numeric-owner claim with the verified login route; document actionable safe errors while retaining exact approval and preservation requirements.
- `workflows/extensions/project-setup/README.md`: describe the corrected personal route and contextual diagnostics where useful.

No new durable product files, dependencies, schemas, runtime tracker changes, migrations, permission changes, alternate-route fallbacks, or Project-recovery feature. Issue #27 remains separate. Temporary probe evidence stays under this Gig's ignored `.local/scratch/`.

## Risk and verification

Ordinary approved personal setup deterministically reaches the invalid numeric-owner POST after earlier writes. The live test reproduces the 404 and confirms the login POST works. The result is incomplete setup with an undiagnosable error; no timing overlap is needed. Removing the lookup is simpler than the current implementation and fixes the cause without adding fallback complexity.

Provider/network failures can occur during the actual multi-stage setup path, leaving earlier writes intact. Keeping safe request/stage context in the shared boundaries is a small diagnostic cost compared with requiring users to repeat setup to find the failure. Preserve existing recovery rather than introducing new retry machinery.

Verification will cover:

1. A personal Board POST uses the owner login exactly once, with no `/users/{login}` lookup; a numeric route is rejected by the fake.
2. Organization routing and full Board payload/verification remain correct, including custom field names, hidden/reversed Priority, and numeric field IDs.
3. A failed Board POST reports method, path, stage, HTTP status, and safe provider detail; the partial Project/default view survive and no alternate POST occurs.
4. Representative discovery, GraphQL, invalid-JSON, network, and provisioning/recovery-read failures retain useful context. Injected error messages containing the test token do not expose it; headers and bodies never appear in diagnostics.
5. Existing lost-response reconciliation, edited-default/nonempty-Project protection, selected-view preservation, approval mismatch, and credential tests continue passing.
6. Run focused setup/config tests, `npm test`, `npx tsc --noEmit`, changed-file `npx oxfmt --check`, and `git diff --check`. Record actual results and any checks not run.

The approved live route experiment is complete and cleaned up. No further live create, reprovisioning, or consuming-Project repair is included; additional provider effects need separate exact approval. Complete plan review and user acceptance before product edits, then implementation, synchronized result, final review, and user review.
