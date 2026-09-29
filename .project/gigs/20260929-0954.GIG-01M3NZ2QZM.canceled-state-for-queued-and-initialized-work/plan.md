# Add Canceled status

## Outcome

Add `canceled` to the existing status model for queued and initialized work.

Canceled is a finished unsuccessful outcome. It remains distinct from successful Done. A canceled Task is terminal and does not block finishing its Epic.

## Implementation

- Add `canceled` to the shared lifecycle status schemas and types.
- Allow trackerless `.local/status.md` to store `canceled` with the entity's existing `workStage`.
- Update Epic Task progress so Done and Canceled remain visibly distinct while both count as finished.
- Add a required `canceled` mapping to GitHub Project Status, Linear issue Status, and Linear Project Status configuration.
- Add Canceled to GitHub Project setup defaults and allow setup to append the missing option to an existing compatible Status field without changing existing option IDs or unrelated options.
- Update Linear setup to select six exact issue and Project statuses, including Canceled.
- Update this repository's GitHub Project Status and `.project/integrations.json` with the Canceled mapping through the existing approved setup flow.
- Update only direct lifecycle/configuration documentation and tests.

## Boundaries

Do not add transition rules, reopening behavior, issue open/closed behavior, pull-request behavior, branch behavior, review or completion-artifact behavior, recovery machinery, lifecycle history, provenance, identity resolution, schema migration, managed Status labels, or a separate cancellation subsystem.

Do not alter the other Gig's artifacts or unrelated working-tree files.

## Verification

- Test lifecycle schemas and trackerless Canceled status.
- Test GitHub and Linear configuration requiring six distinct status mappings.
- Test Epic progress distinguishing Done from Canceled while treating both as finished.
- Test GitHub setup appending Canceled without changing existing option IDs or unrelated options.
- Run `npm test`.
- Run `npx tsc --noEmit`.
