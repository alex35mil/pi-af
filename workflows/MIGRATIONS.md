# Workflow data migrations

Each breaking change to saved workflow data gets one entry below, oldest first. When an operational read rejects an entity you are actively operating on, apply every entry whose recognition cue matches the saved data in one rewrite; investigate with the user when no entry matches.

- Target is always the current schema; never step through intermediate formats.
- Convert only the entity you are actively operating on, normally while resuming it. Conversion is part of resume: perform it, then report it in one line. Done entities are never converted.
- Recognition cues are structural facts about the saved data, never dates or guesses.
- After converting, read the entity again; strict validation is the oracle. If it still fails, work through the remaining violations the same way.

## 1. Provider bindings split (2026-10)

Recognize: a GitHub tracker integration record has no `repository` and its `external` embeds `issueId`, `issueUrl`, or `projectItemId`; a Linear record embeds URLs or display identifiers.

Convert:

- GitHub trackers keep `repository` (copy it from `.project/integrations.json`) and `external: { issueNumber }` only; database IDs, URLs, and Project-item IDs move to the ignored `.local/metadata.json` Resource IDs cache through `resource_ids record`.
- Linear trackers keep object UUIDs and the Task parent Project UUID; URLs and display identifiers move to that cache.
- Linear issue branch names live in the branch contract, not the tracker record.
- GitHub PR records keep repository/head/target intent only; PR number/URL move to that cache.

Preserve: identity, authority, pending work, accepted artifacts, and branch name/start/target.
