# Workflow data migrations

Each breaking change to saved workflow data gets one entry below, oldest first. When an operational read rejects an entity you are actively operating on, apply every entry whose recognition cue matches the saved data in one rewrite; investigate with the user when no entry matches.

- Target is always the current schema; never step through intermediate formats.
- Convert only the entity you are actively operating on, normally while resuming it. Conversion is part of resume: perform it, then report it in one line. Done entities are never converted.
- Recognition cues are structural facts about the saved data, never dates or guesses.
- After converting, read the entity again; strict validation is the oracle. If it still fails, work through the remaining violations the same way.

## 1. Provider bindings split (2026-10)

Recognize: a GitHub tracker integration record has no `repository` and its `external` embeds `issueId`, `issueUrl`, or `projectItemId`; a Linear record embeds URLs or display identifiers.

Convert:

- GitHub trackers keep `repository` (copy it from `.project/integrations.json`) and `external: { issueNumber }` only; database IDs, URLs, and Project-item IDs move to the ignored `.local/metadata.json` Resource IDs cache through `record_resource_ids`.
- Linear trackers keep object UUIDs and the Task parent Project UUID; URLs and display identifiers move to that cache.
- Linear issue branch names live in the branch contract, not the tracker record.
- GitHub PR records keep repository/head/target intent only; PR number/URL move to that cache.

Preserve: identity, authority, pending work, accepted artifacts, and branch name/start/target.

## 2. GitHub managed plan comments (2026-10)

Recognize: the actively operated entity has a GitHub tracker record without `planComment`.

Convert: add `planComment: { state: "unpublished" }` to that record. GitHub accepted plans use one managed comment for every issue. No ownership question or source/provenance inference is needed. Preserve the external title and description as they are; do not reconstruct unknown original text or select an arbitrary existing comment. First accepted-plan publication after conversion uses the shared `prepare_tracker_publication` operation.

Preserve: entity identity, authority, Phase, branch contract, relationships, initialization checkpoints, pending work, and accepted artifacts. Convert only the active entity; completed historical entities remain untouched.

## 3. Linear managed plan documents (2026-10)

Recognize: the actively operated entity has a Linear tracker record without `planDocument`.

Convert: add `planDocument: { state: "unpublished" }` to that record. Accepted plans use one document attached to the exact bound Project (Epic) or issue (Task/Gig), preserving current title/name and description. Do not select an arbitrary existing document or reconstruct an overwritten description. Replace an exact legacy `embed Internal ID` pending-operation entry with `confirm requested initialization fields`, keeping initialization pending and retaining every other operation. Linear initialization facts now carry only their artifact mode as system metadata; workflow IDs remain local. GitHub state/IDs are unchanged.

Preserve: identity, authority, Phase, branch, relationships, other initialization work, pending work and accepted artifacts. Strict-read the converted entity. Convert only the active entity; completed historical entities remain untouched.
