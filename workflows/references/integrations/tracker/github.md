# GitHub tracker

First follow `../shared.md`.

## Validate before mutation

Run every `roles.tracker.remoteValidation` step:

1. Always validate the configured Project Status field/options, Priority metadata, and exact repository Planning label.
2. In versioned mode, also validate configured Internal ID and every exact managed Kind label.
3. Unversioned mode does not require or validate Internal ID or Kind-label capabilities because it never uses them.

Never substitute another label, similarly named field, or different scope.

## Adopt an existing queued issue before initialization

Use this read-only flow only when `/epic`, `/task`, or `/gig` selects one explicit existing GitHub issue. Complete it before `init`; do not run it for new tracker work or routine resume.

1. Call `integration_context` with `operation: "inspect"`; require enabled `roles.tracker` provider `github`.
2. Call returned `issueRead` with method `get`, the configured repository, and the user-supplied issue number. Require its numeric issue ID, number, URL, title, description, and labels.
3. Call returned `projectsList` with method `list_project_items` for the configured Project. Require one exact item for that issue, its Project item ID, configured Backlog or Todo Status, and configured Priority. Empty Priority becomes `not set`.
4. Supply the issue title, description, queue state, Priority, and any managed Kind label as intake evidence. The queue label never overrides entity intake: obtain normal approval of Epic identity or Deliverable Kind, then pass the numeric issue ID, number, URL, and Project item ID to `init`.

Reject an absent or ambiguous issue, the wrong repository or Project, any status other than configured Backlog or Todo, or an unconfigured Priority.

## Initialize

Workflow `init` creates `awaiting` for new issues or `bound-pending` for approved queued issues. It records `workStage: planning`; the intended tracker lifecycle is In Progress.

For new work:

1. Create the issue with the exact approved entity title and Request from `brief.md`. In versioned mode only, include issue-scoped `Internal ID: <qualified-id>` when configured.
2. Persist `issue-bound-pending` with numeric issue ID/number/URL.
3. Add the issue to the Project; already-present is success.
4. Persist `bound-pending` with Project item ID.
5. Set In Progress Status plus Priority. In versioned mode only, also set Internal ID at its configured scope.
6. Read the complete current issue labels. Preserve unrelated labels and apply the Planning projection below. In versioned mode, also remove every configured managed Kind label and add exactly the Kind from workflow metadata. Write the complete intended label set and re-read it.
7. For Task, attach it as a sub-issue of the bound parent Epic issue.
8. Set `bound` only after every tracker operation succeeds.

An approved Backlog or Todo issue skips proven issue creation and Project addition. It moves directly to In Progress; never force Backlog through Todo.

## Create uncertainty

After an uncertain create, read GitHub. In versioned mode, search the exact qualified Internal ID. In unversioned mode, search recent exact-title repository issues and require the exact repository/relationship. Continue when one exact object is confirmed, retry only after confirmed absence, and report ambiguous or inconsistent state. Never add a temporary identifier.

## Lifecycle, work stage, and kind

Use configured Project Status and Priority through the absolute update/read-back procedure in `../shared.md`.

The Planning label is an absolute projection of workflow stage:

- In Progress plus `workStage: planning` — read labels, add exact configured Planning, preserve unrelated labels, update, and re-read.
- In Progress plus `workStage: execution` — read labels, remove exact configured Planning, preserve unrelated labels, update, and re-read.
- In Review, Done, or Canceled — remove exact configured Planning through the same read/update/read-back flow.

After the shared material-replanning transition records In Progress plus `workStage: planning`, re-add Planning through the absolute label flow above. After accepted planning records `workStage: execution`, remove Planning without changing In Progress. Never create or use an Execution label or phase field.

In versioned mode, workflow metadata is authoritative for initialized Kind. On initialization, resume, and every approved Kind transition, read the complete current labels, remove every configured managed Kind label, add exactly the authoritative Epic or Deliverable Kind label, preserve unrelated labels, write the complete intended set, and re-read it. A missing or different queue Kind is replaced rather than trusted. Unversioned mode projects only native Status/Priority/hierarchy and the Planning label; it never applies or validates Kind labels.

## Add to Backlog or Todo

Follow `../../queue.md`. Create an ordinary issue without Internal ID or Planning label. In versioned mode, include the approved configured Kind label, or no managed Kind label for `not set`, then verify the issue labels. In unversioned mode, never apply a Kind label. Add the issue to the Project, then set the selected Backlog or Todo Status and approved Priority (`not set` clears it). Recover uncertain provider results through read-back as defined there.

## Artifact projection

After accepted `epic.md`/`plan.md` changes or a tracker Links refresh, call `artifactProjection` and follow the complete projection, approval, and verification contract in `../shared.md`. The GitHub destination is the bound issue body; re-read that issue for verification.
