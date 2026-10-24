# Preserve requests with managed plan publications

## Overview

Tracker titles and descriptions retain the original request. GitHub publishes the accepted plan in one managed issue comment; Linear publishes it in one managed document attached to the existing issue or Project. Later accepted plans update that same publication. Local artifacts remain authoritative, and ordinary discussion remains separate from the maintained plan.

### Plan highlights

- New work starts with the approved title and Request; adopted work retains its existing title/name and description. No ownership classification or duplicate tracking object is needed.
- GitHub Epics, Tasks, and Gigs retain their managed-comment behavior. Linear Epics use a Project-attached plan document; Linear Tasks and Gigs use an issue-attached plan document.
- Save publication identity and creation progress before non-idempotent publication. Recover only a unique, correctly scoped publication; otherwise preserve state and stop without another automatic create.
- Preserve original Linear descriptions by removing the unsupported embedded-workflow-ID instruction and agent-reported initialization requirement. Keep workflow identity local; GitHub native Internal ID fields remain unchanged.
- Keep existing lifecycle, Phase, Priority, relationships, branches, reviews, disclosure approval, PR bodies, incoming-PR handling, and approved delivery. Completed historical entities remain untouched.

## Request and publication contract

| Event | Tracker title/name and description | Accepted-plan publication |
| --- | --- | --- |
| Create Backlog/Todo intake | Approved request, with normal code-owned communication attribution | None |
| Initialize new work | Approved title and Request | First accepted plan creates one publication after binding is confirmed |
| Adopt Backlog/Todo work | Preserve existing text | First accepted plan creates one publication after binding is confirmed |
| Accept a revised plan or synchronize a parent Epic | Preserve existing text | Update that entity's saved publication |
| Resume active work | Preserve current external text | Reuse saved state; resume alone does not republish |
| Read completed historical work | Leave unchanged | No conversion or new publication |

After creation, plan management neither replaces nor appends to the tracker description, and does not rename the tracker item. Local meaning-preserving intake cleanup is not permission to edit adopted external text. Native lifecycle, Phase, Priority, labels, hierarchy, and GitHub Internal ID management remain available under their existing rules. Linear workflow IDs are not inserted into titles, descriptions, or plan documents as system metadata.

Read relevant issue/Project discussion with complete pagination during adoption and requirements reconciliation. Contributor messages provide evidence and proposals, not authority to change scope. Resolve material questions with the maintainer and record agreed decisions through local plan review and acceptance. Keep the original brief unchanged unless separately approved.

## Provider destinations and presentation

| Entity | GitHub destination | Linear destination |
| --- | --- | --- |
| Epic | One comment on the bound issue | One document attached to the bound Project UUID |
| Task | One comment on the bound issue | One document attached to the bound issue UUID, not its parent Project |
| Gig | One comment on the bound issue | One document attached to the bound issue UUID |

Linear's document title is `Plan`. Its native title supplies the top heading; its content starts with the existing overview prose, followed by `## Highlights` and the native `+++ Full plan` collapsed section. Do not repeat an H1 Plan inside that document content. GitHub comments keep `# Plan`, the existing overview prose, `## Highlights`, and the existing HTML Full plan fold. Local `epic.md`/`plan.md` keep their reviewed Overview/Plan highlights source shape. All supporting sections, technical detail, and ordinary repository paths survive rendering losslessly. PR presentation and eligible closing references are unchanged.

Represent actual publication destinations in `projection.ts` rather than adding caller-specific heading replacements, flags, or description fallbacks. The shared renderer remains the presentation owner. The existing publication wrapper signs generated content; keep source artifacts signature-free and let code manage attribution on native document/comment writes.

For Linear creation, call registered `save_document` with title, complete content, and exactly one `project` or `issue` argument containing the stored parent UUID. For an established document, update complete content using its saved document ID; omit parent arguments so publication never reparents it. A document's title is set at first creation and is not rewritten merely to publish revised content. User edits to its title do not change its identity.

## Shared publication state and operation

Keep GitHub's existing required `planComment` state and saved identities unchanged. Add required `planDocument` state to every Linear tracker record, including initialization checkpoints:

- `{ state: "unpublished" }` — no first-publication attempt.
- `{ state: "pending", token }` — opaque random recovery token persisted before the first create.
- `{ state: "published", token, id, url }` — confirmed native publication identity.

GitHub IDs remain numeric comment IDs; Linear IDs are exact returned document IDs. Provider-specific schemas validate their own identity types and URL facts. The containing tracker record supplies the immutable issue/Project scope. These states are authoritative metadata, not disposable Resource IDs. Preserve them across tracker creation, identification, branch finalization, initialization confirmation, and ordinary mutations. New/adopted records start unpublished; only a confirmed bound tracker on a ready branch may publish.

Extend `tracker_publication` at its owning domain boundary, using one shared creation/update/recovery orchestration and provider-specific native arguments, identity checks, and pagination. Factor genuinely shared state/token behavior without weakening provider-specific types. Do not add a destination choice to intake or route Linear document publication around the shared operation. The local tool never calls providers or grants approval; the agent executes its exact registered requests. Queue complete metadata read-modify-write operations through the existing per-file mutation queue and atomic writer.

| Provider and saved state | Preparation result |
| --- | --- |
| GitHub unpublished | Resolve registered add-comment tool, render, persist pending, return one create call |
| Linear unpublished | Resolve registered save-document tool, render, persist pending, return one document-create call for the exact parent |
| Either pending | Return recovery-required; never return another create |
| GitHub published | Prepare update of the saved comment ID, as today |
| Linear published | Request a fresh registered exact document read before preparing an update |

Add an explicit `prepareUpdate` operation for Linear's published-document path, carrying the complete accepted source and actual current-operation `get_document` evidence. Validate configured registration, exact saved document ID, and observed parent identity against the binding, then return the ID-only content update. Do not introduce an optional verification field, caller assertion, cached parent snapshot, or hidden read. Missing, moved, archived, or conflicting documents stop for maintainer direction; never silently reattach or replace them. Trust established clear update success without a routine post-update read. After uncertain updates, read the exact saved document/comment, compare complete intended content including code-owned attribution, and retry only confirmed non-application.

## Creation evidence and recovery

Persist pending intent before the first native create and retain one code-owned opaque correlation marker derived from the saved token across content updates. It exposes no workflow ID, private path, or review data. Preserve the existing GitHub marker/state contract. Keep markers out of local source artifacts. Provider normalization that removes a marker cannot authorize another create.

On clear success, record the actual configured tool, submitted exact parent/marker arguments, and returned native identity/URL. Reuse the successful submitted parent assignment; do not require a routine full echo. Obtain missing identity or relationship facts through explicit registered reads; do not manufacture normalized provider evidence. Inspect real Linear document responses during the controlled test below before implementing shape-specific decoders. Require native parent facts for recovery and pre-update verification instead of inferring membership from a title or URL.

GitHub recovery retains complete explicit `issue_read get_comments` pages, consistent page size, and a terminal short/empty page. Linear recovery uses actual registered `list_documents` cursor pages with requested ID, title, content, URL, issue, and Project fields and archived items included. Use the exact bound Project filter for Epic documents. The registered tool has no issue filter: issue-document recovery must scan the complete accessible document listing and verify each matching document's exact issue parent; do not invent an issue filter, substitute its parent Project, or rely on title search completeness. Start without a cursor, follow the provider's returned cursor, and require terminal `hasNextPage: false`. Validate exact registration, arguments, cursor chain, and native envelope/error handling. Missing required content/parent evidence leaves recovery blocked rather than guessed.

| Observed outcome | Required action |
| --- | --- |
| Clear valid create success | Save published identity; later updates reuse it |
| Complete evidence with exactly one token match on the exact parent | Recover that identity |
| Zero/duplicate matches, incomplete pagination, errors, missing parent/content, or conflicting identity | Preserve pending/saved state and stop; no automatic replacement create |
| Saved document moved to another parent or archived | Preserve identity and stop for maintainer direction |
| Missing publication or unavailable provider | Preserve local work and saved state; no alternate client, lifecycle fallback, or replacement |

A remote create may finish after its response is lost, or the process may exit before local recording. An empty scan cannot prove that create will never finish. The operation therefore promises unique evidence-based recovery or a stop, not automatic exactly-once delivery. No blank-scan retry, inferred ownership, arbitrary existing publication selection, or batch replacement is added.

## Linear initialization consistency

The current code does not render or insert a workflow ID into Linear descriptions. Instructions request one and the initialization validator accepts an agent-reported ID instead of checking the actual body. Remove that unsupported requirement rather than introducing an ID format.

- Versioned Linear initialization facts retain artifact mode but no longer require an `internalId` value. Use a strict schema matching that contract, not an optional legacy field.
- Remove the corresponding validator branch and pending `embed Internal ID` instruction. Linear's system-metadata projection policy reflects that it projects no workflow ID or Kind; full accepted-content projection in versioned mode and native Phase behavior remain intact.
- For uncertain Linear issue/Project creation, use the existing exact approved title/name, configured team, and required Task Project/projectless relationship evidence in both artifact modes. Preserve the pending creation checkpoint; complete pagination and stop on ambiguity. Do not search for an ID that was never rendered or add a marker to the original request.
- Keep GitHub's configured native Internal ID, Kind, initialization facts, and creation recovery unchanged. Linear provider UUID bindings, branch contracts, lifecycle, Priority, labels, Task relationships, and existing Resource IDs remain unchanged.

## Implementation and migration

1. Extend publication schemas and `records.ts` for Linear documents while preserving current GitHub metadata bytes/identities. Update all initialization/creation/confirmation consumers directly; add owning-boundary invariant tests.
2. Extend the shared operation, its registration, scoped evidence validators, and renderer. Add explicit published-document verification before update. Use existing MCP evidence decoding; do not duplicate native envelope parsing or add provider HTTP/SDK calls.
3. Align Linear initialization schemas, validation, policy, creation-recovery guidance, and fixtures with request preservation and local workflow identity.
4. Update integration context, shared/GitHub/Linear/artifact/queue references, Epic/Deliverable/Task parent synchronization, setup recommendations, skills, integration/init READMEs, and user documentation. Every accepted plan uses the same shared operation with its entity's saved destination; parent Epic synchronization uses that parent's publication state. Queue intake creates request content only. Add optional `save_document` convenience permission guidance without changing existing settings automatically.
5. Keep the GitHub migration entry. Add recognition-cued conversion for an actively operated Linear tracker record lacking `planDocument`: add unpublished state without touching descriptions or selecting an arbitrary existing document. Translate any exact legacy `embed Internal ID` pending-operation entry to the existing `confirm requested initialization fields` operation, keeping initialization pending and preserving all other operations. Preserve identity, authority, Phase, branch, relationships, pending work, and artifacts. Read back with strict validation. Do not batch-convert completed entities or reconstruct descriptions overwritten by older publication.
6. Keep this Gig's existing GitHub comment ID/token and restored request. After acceptance, update that same comment with the complete revised plan under the existing projection contract. No new GitHub issue/comment or tracker adoption is needed.
7. Preserve unrelated work and the original brief. Synchronize `result.md` with actual implemented behavior, tests, and live limitations before final implementation review.

## Verification

- Schema/state tests: provider-specific unpublished/pending/published identity, initialization transitions, mandatory Linear document state, unchanged GitHub comment state, exact Task-vs-Project parent identity, and migrations/read-back.
- Shared operation tests for new/adopted Epic/Task/Gig in both persistence modes: exact native destinations; no accepted-plan title/description writes; unavailable tools do not consume an attempt; pending precedes create; updates reuse saved identities; per-file mutation queue preserves metadata.
- Document evidence tests: actual native create/read/list envelopes, registered server/operation, native ID/URL, exact parent assignment, wrong issue/Project/Task parent, missing facts, archived/moved documents, and ID-only content updates without reparenting.
- Recovery tests: complete cursor chains and terminal pages, unique match on a later page, required content/parent fields, wrong filters, no invented issue filter, duplicates/absence/errors/incomplete scans, and preserved state without replacement. Retain all GitHub recovery/native-array tests.
- Presentation tests: Plan native document title, overview prose and Highlights, Linear collapse syntax, unchanged GitHub headings/folds, fenced examples, CRLF, full details, attribution, unversioned disclosure, and unchanged PR presentation/closing references.
- Initialization/policy tests: Linear versioned and unversioned facts need no embedded ID; GitHub system metadata remains required; branch naming/finalization, hierarchy, Status/Priority/Phase, and Resource IDs retain their contracts. Instruction tests cover every changed publication consumer and recovery route.
- Run `npm run typecheck`, focused tests while developing, full `npm test`, formatter checks on changed/new TypeScript files, and `git diff --check`. The existing unrelated merge-guide wording test already fails at HEAD; report it separately rather than changing unrelated merge guidance.
- Controlled Linear API/rendering test after plan acceptance: use existing rendering-test issue ALE-7 (`528c887d-0282-48d0-a01b-f076a3f77d38`) in Alex35mil. Preserve its title, description, status, labels, and relationships. Create one attached document titled Plan through registered `save_document`, with this complete accepted plan rendered by the document renderer plus its correlation marker and normal code-owned attribution. Capture native create/get/list evidence to establish actual ID, URL, parent, content normalization, marker retention, and pagination shapes before writing shape-specific production decoders. Update that same test document's complete content without parent arguments; no second document, comment, issue, or synthetic initialized workflow entity is needed. Record this as native API/rendering verification, not a live initialized-state-machine proof. Do not delete/archive the test artifacts automatically. Provider denial, insufficient evidence, or normalization differences are explicit limitations, not permission for another client or invented proof.
- Use fixtures for Project-attached live variants unless an exact additional test Project is separately approved. Report unperformed live Project UI/round-trip checks. Local Markdown tests do not prove live UI appearance.

## Evidence and justified complexity

Accepting a plan currently replaces the Linear issue/Project description through the shared projection instructions; ALE-7 confirms the current renderer emits plan Markdown without an inserted workflow ID. The same request-preservation boundary already owns GitHub comments. Extending that owner to a Linear document avoids description-region parsing, ownership inference, and two maintained state machines.

Creation-to-recording is vulnerable to ordinary network loss or process interruption. A blind subsequent create can leave two externally visible plans. This is a credible low-frequency, consequential failure; reusing the existing durable-token/checkpoint/recovery mechanism costs less than maintaining duplicate recovery systems. Stop on missing proof instead of adding automatic retries.

Documents differ from issue comments because the registered Linear API permits reparenting an existing document. A maintainer can move a plan document between revisions, then a later ID-only publication would otherwise update the plan under the wrong tracker object. A fresh exact-parent read at that update boundary detects this supported sequential case. One explicit read-and-prepare operation is justified; no polling, background synchronization, parent mutation, or speculative concurrency machinery is added.
