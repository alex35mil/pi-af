# Brief

## Request

Add an explicit `Canceled` state for work that will not continue.

Define separate behavior for:

- Unstarted Backlog and Todo items.
- Initialized Epics.
- Initialized Tasks and Gigs.
- Trackerless workflows.

Specify:

- Allowed cancellation, reopening, and resume transitions.
- Exact GitHub and Linear status mappings.
- GitHub issue Open/Closed state and closure reason.
- Effects on Epic progress and parent/child relationships.
- Whether reviews or completion artifacts are required.
- Branch and pull-request retention, closure, or cleanup.
- Provider read-back and interrupted-update recovery.
- Setup and migration of existing tracker Status fields.
- Integration with managed Status labels.

Canceled work must remain distinguishable from successfully completed work.

## Established decisions

- Adopt GitHub issue #10 as a Feature Gig with High priority: https://github.com/alex35mil/pi-af/issues/10.
- Branch from `main`; commit only this Gig's reviewed changes. Preserve the other Gig's artifacts and unrelated working-tree files.
- The stored branch starts from and targets `main`. GitHub initialization was verified: In Progress, High, Feature, this Gig's Internal ID, and Planning label. Binding is complete; no matching open pull request exists.

## Repository findings

- The shared lifecycle, tracker configuration, GitHub setup defaults, trackerless status, and Epic Task progress are the owning boundaries for this status.
- GitHub setup can append Canceled to this repository's populated Status field while preserving existing option IDs and unrelated options.
- Managed Status labels are separate work in issue #7: https://github.com/alex35mil/pi-af/issues/7. This Gig does not implement them.

## Current scope

- Add `canceled` to the existing lifecycle status values.
- Canceled is finished but unsuccessful, remains distinct from Done, and does not block Epic completion.
- Add exact Canceled mappings to GitHub Project Status, Linear issue Status, Linear Project Status, and trackerless local status.
- Add Canceled to project setup defaults/configuration and the existing direct documentation/tests.
- Do not add transition rules, reopening behavior, issue open/closed behavior, pull-request behavior, branch behavior, review/artifact behavior, recovery machinery, provenance, identity resolution, schema migration, managed Status labels, or any separate cancellation subsystem.
- Preserve unrelated working-tree files and the other Gig's artifacts.

No material behavior questions remain. Planning may proceed.
