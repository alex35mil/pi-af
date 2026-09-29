# Plan: Use GitHub issue labels for workflow Kind

## Outcome

Store workflow Kind once in GitHub: as exactly one managed repository issue label for initialized versioned work, and as one explicitly approved Kind label when queued versioned work is classified. GitHub Projects display those labels through their built-in Labels field; no custom Project Kind field or native issue Type carries the same workflow value.

The managed labels are:

| Workflow Kind | Label | Description | Color |
|---|---|---|---|
| Epic | `Kind: Epic` | A multi-deliverable initiative. | `#8250DF` |
| Feature | `Kind: Feature` | New user-visible or system capability. | `#0969DA` |
| Bugfix | `Kind: Bugfix` | Correction of defective behavior. | `#CF222E` |
| Research | `Kind: Research` | Investigation producing evidence and conclusions. | `#1A7F37` |
| Refactor | `Kind: Refactor` | Behavior-preserving structural improvement. | `#BC4C00` |
| Audit | `Kind: Audit` | Evidence-based assessment and recommendations. | `#9A6700` |
| Chore | `Kind: Chore` | Maintenance or operational work. | `#57606A` |

Native GitHub issue Type remains independent and unmanaged. Status, Priority, and other Project planning fields remain unchanged.

## Behavior

### Authority and cardinality

- Before initialization, a Backlog or Todo issue has zero or one managed Kind label. Queue intake treats Kind as a standard choice and applies one only after explicit approval; `not set` leaves the issue without a managed Kind label.
- During Epic initialization, workflow metadata requires `epic`; during Task/Gig initialization it requires the approved Deliverable kind.
- After initialization, versioned workflow metadata is authoritative and the bound issue must contain exactly the corresponding managed Kind label.
- Every initialized Kind reconciliation reads the complete current label set, removes every configured managed Kind label, adds the authoritative one, preserves all unrelated labels, writes the complete intended set, and re-reads it.
- Kind transitions and resume use the same absolute reconciliation. Provider failure preserves workflow state and resumes from read-back; it never restores the retired Project Kind field.
- Unversioned mode retains its privacy boundary: queue intake and initialized work do not apply, validate, or reconcile Kind labels.

### Queue and adoption

- GitHub Backlog/Todo intake always includes Kind in its proposal. When the request states a Kind, reuse it; otherwise infer and recommend the best-supported Kind from Epic, Feature, Bugfix, Research, Refactor, Audit, or Chore. Present the exact recommendation—or `not set` when the user chooses it—with title, description, destination, and Priority for approval. Create the issue with the approved configured Kind label, or without a managed Kind label for `not set`, then verify its labels.
- Queue intake still creates no workflow identity, artifacts, branch, Planning label, Internal ID, or pending workflow record.
- Starting queued work does not trust a queue label as workflow metadata. Normal Epic or Deliverable intake approves the entity Kind, initialization persists it, and the absolute reconciliation replaces a missing or different managed Kind label.
- Linear queue and initialization behavior remain unchanged.

## Configuration and setup

### Runtime configuration

Change the strict GitHub tracker shape in `workflows/extensions/integrations/config.ts` and `.project/integrations.json`:

- retain `labels.planning` until #19;
- add `labels.kind.epic` and `labels.kind.deliverableKinds.{feature,bugfix,research,refactor,audit,chore}` as exact label names;
- remove `fields.type` and its issue/project scope variants;
- require all managed Kind label names to be distinct from each other and from Planning, case-insensitively;
- keep Status, Priority, and Internal ID unchanged.

No legacy runtime configuration union or fallback remains after this repository is migrated.

### GitHub Project setup

Update `workflows/extensions/project-setup/github-project.ts`, setup guidance, and generated tool schema so setup:

- accepts exact name, description, and hex color definitions for all seven Kind labels alongside the existing Planning label;
- uses the approved defaults in this plan;
- rejects duplicate or case-colliding names across Planning and all Kind labels before preview, and enforces the same invariant before generating tracker configuration;
- previews creation of every missing label and blocks on incompatible existing name/color/description without silently rewriting it;
- applies only the approved preview, recovers uncertain creates by exact read-back, and verifies every label exactly;
- provisions no Project Kind field and no native organization issue Types for workflow Kind;
- leaves generic label updates, renames, deletions, and project-defined groups to #8;
- returns tracker configuration containing exact Kind label names and no Type mapping.

Priority and Internal ID may still use their existing Project or organization issue-field scopes. Setup must not inspect, create, or require native issue Types merely because workflow Kind is configured.

## GitHub integration boundary

Update `workflows/extensions/integrations/tracker/github.ts`, `workflows/extensions/integrations/records.ts`, and `workflows/references/integrations/tracker/github.md` so:

- required MCP capability validation includes issue-label reads and full-label updates;
- versioned remote validation checks every configured Kind label exactly and no longer requires a Project Kind field or native issue Types;
- unversioned validation skips Kind labels;
- pending initialization operations say `apply configured Kind label and Internal ID` rather than Type;
- initialization, resume, and approved Kind transitions use the absolute managed-group reconciliation;
- Planning-label behavior remains unchanged for #19;
- native issue Type is neither read nor written as workflow Kind.

Update `workflows/references/queue.md`, `workflows/references/deliverable.md`, and `workflows/skills/epic/SKILL.md` where they currently prescribe Type projection or exclude all queue Kind assignment. Keep the provider-independent Kind domain model unchanged.

## Repository migration

Migrate this repository through provider read-back, not reusable migration code:

1. Build a temporary, uncommitted setup-only transition: extend setup preview/apply with the seven Kind label definitions and collision validation while retaining the currently loaded Type-based runtime schema and generated tracker configuration. Do not stage, commit, or deliver this intermediate shape.
2. Restart Pi to load that setup-only tool. Keep `.project/integrations.json` unchanged and verify `integration_context` still resolves the configured tracker and approved MCP tools.
3. Run the transitional GitHub setup preview for Project 2. Present and obtain separate approval for its exact label-creation plan, apply it once, and verify all seven labels.
4. Re-read every Project item with its Kind value and current issue labels. The current inventory has two non-empty values: #6 Feature and #10 Feature; all empty Kind values remain unlabeled.
5. For each non-empty value, map the old configured semantic value to its new managed label, preserve unrelated labels, update once, and verify exactly one expected Kind label. Re-read the complete Project inventory to ensure every non-empty old Kind was migrated and no empty value gained a label.
6. After all label writes verify, clear each populated old Project Kind value without deleting the field definition. Re-read every changed item and the complete Project inventory; require all old Kind values to be empty while #6 and #10 retain `Kind: Feature`.
7. Only after successful provider verification, finish the source to its final label-only shape: remove Type setup/runtime behavior, generate the final tracker configuration, change `.project/integrations.json` to the Kind label mappings, and remove `fields.type`. No legacy schema, fallback, or transitional setup output remains in the delivered source.
8. Run source tests, then restart Pi again to load the final runtime. Re-run artifact preparation and `integration_context`; require successful exact label/configuration validation before continuing the Gig.
9. From that point, workflow sources stop reading or writing the Project Kind field. Leave the empty field definition intact. Its deletion requires a later explicit approval and is not part of implementation or automatic setup.

The migration must not modify #19 Phase behavior, native issue Types, Status, Priority, Internal ID, Planning labels, unrelated repository labels, or empty queued Kind values.

## Files and tests

Update the owning implementation and guidance, including:

- `workflows/extensions/integrations/config.ts`
- `workflows/extensions/integrations/tracker/github.ts`
- `workflows/extensions/integrations/records.ts`
- `workflows/extensions/project-setup/github-project.ts`
- `workflows/references/setup.md`
- `workflows/references/queue.md`
- `workflows/references/deliverable.md`
- `workflows/references/integrations/tracker/github.md`
- `workflows/skills/project-setup/SKILL.md`
- `workflows/skills/epic/SKILL.md`
- `.project/integrations.json` after successful live migration
- affected integration, domain, setup, and instruction tests under `tests/`

Test the owning boundaries:

- strict configuration accepts the complete label group and rejects the retired Type shape, missing kinds, duplicate/case-colliding labels, and Planning collisions;
- capability and remote-validation output requires exact Kind labels only in versioned mode and no issue-Type capability;
- initialization records and instructions project authoritative Kind labels while preserving unrelated labels;
- queue instructions reuse an explicit request Kind or infer and recommend one, require approval or `not set`, and preserve the unversioned restriction;
- setup rejects duplicate and case-colliding Planning/Kind names before preview, creates and verifies all labels, recovers an uncertain create, blocks incompatible metadata, omits the Project Kind field/native Types, and emits the new tracker configuration;
- kind-transition, resume, versioned/unversioned, and setup documentation tests reflect the single-source contract;
- live migration read-back proves #6 and #10 receive `Kind: Feature`, empty Kind items remain unlabeled, every old Kind value is cleared, and the empty field definition remains present but unused.

Run:

- `npm test`
- `npx tsc --noEmit`
- focused live GitHub read-backs for setup and migration

Do not claim provider migration or field non-use until those checks complete.