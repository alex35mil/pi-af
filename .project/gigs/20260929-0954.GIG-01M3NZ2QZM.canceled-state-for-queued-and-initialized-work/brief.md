# Brief

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
