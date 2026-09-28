# GitHub tracker

First follow `../shared.md`.

## Validate before mutation

Run every `roles.tracker.remoteValidation` step:

1. Always validate configured Status and Priority fields/options.
2. In versioned mode, also validate configured Internal ID and Project Type fields/options.
3. Unversioned mode does not require or validate Internal ID/Type capabilities because it never uses them.

Never substitute labels, similarly named fields, or a different scope.

## Adopt an existing Backlog issue before initialization

Use this read-only flow only when `/epic`, `/task`, or `/gig` selects one explicit existing GitHub issue. Complete it before `init`; do not run it for new tracker work or routine resume.

1. Call `integration_context` with `operation: "inspect"`; require enabled `roles.tracker` provider `github`.
2. Call returned `issueRead` with method `get`, the configured repository, and the user-supplied issue number. Require its numeric issue ID, number, URL, title, and description.
3. Call returned `projectsList` with method `list_project_items` for the configured Project. Require one exact item for that issue, its Project item ID, configured Backlog Status, and configured Priority. Empty Priority becomes `not set`.
4. Supply the issue title, description, and Priority to the entity intake flow. After the user approves the exact title and Request, pass the numeric issue ID, number, URL, and Project item ID to `init`.

Reject an absent or ambiguous issue, the wrong repository or Project, a non-Backlog Status, or an unconfigured Priority.

## Initialize

Workflow `init` creates `awaiting` for new issues or `bound-pending` for approved backlog issues.

For new work:

1. Create the issue with the exact approved entity title and the exact approved Request from `brief.md` as its description. In versioned mode only, include `Internal ID: <qualified-id>`.
2. Persist `issue-bound-pending` with numeric issue ID/number/URL.
3. In versioned mode only, apply issue-scoped Type when configured.
4. Add the issue to the Project; already-present is success.
5. Persist `bound-pending` with Project item ID.
6. Set Planning Status plus Priority. In versioned mode only, also set Internal ID and Type at configured scopes.
7. For Task, attach it as a sub-issue of the bound parent Epic issue.
8. Set `bound` only after every tracker operation succeeds.

An approved backlog issue skips proven issue creation/Project addition.

## Create uncertainty

In versioned mode, search the exact qualified Internal ID in the configured repository before retrying. In unversioned mode, list recent exact-title issues in the configured repository and require user confirmation before selection or recreation. Never add a temporary ID or workflow marker to make reconciliation easier.

## Lifecycle and kind

Use configured Project Status and Priority through the absolute update/read-back procedure in `../shared.md`. In versioned mode, map Epic/Deliverable kind through configured Type after persisting an approved workflow-kind transition. Unversioned mode projects only native Status/Priority/hierarchy, not Type.

## Backlog

Create an ordinary issue without Internal ID/Type, explicitly add it to the Project, then set Backlog Status and approved Priority (`not set` clears it). On unknown create outcome, search recent exact-title repository issues and require user confirmation before selection or recreation. Once issue identity is known, retry only remaining updates.

## Artifact projection

After accepted `epic.md`/`plan.md` changes or a tracker Links refresh, call `artifactProjection` and follow the complete projection, approval, and verification contract in `../shared.md`. The GitHub destination is the bound issue body; re-read that issue for verification.
