# Brief

## Request

Replace the custom GitHub Project `Kind` field with managed issue labels: `Kind: Epic`, `Kind: Feature`, `Kind: Bugfix`, `Kind: Research`, `Kind: Refactor`, `Kind: Audit`, and `Kind: Chore`.

- Make labels visible and filterable in repository Issues and Project Labels.
- Allow queue intake to apply an explicitly approved Kind without initializing work.
- Keep initialized metadata authoritative; project exactly one managed Kind label.
- Preserve unrelated labels during Kind transitions.
- Provision exact label names, descriptions, and colors through setup preview/apply.
- Migrate existing Kind values with read-back verification before stopping field usage.
- Require separate approval to remove the field.
- Keep native GitHub issue Type independent.

## Established decisions

- Adopted https://github.com/alex35mil/pi-af/issues/6 as a Feature Gig with High priority; the user approved the title and Request.
- GitHub Project 2 item `PVTI_lAHOAEDDG84Bk9OMzg9TjeM` is bound. Read-back verified In Progress, High, Internal ID `GIG-01M3NWSVYS`, Kind Feature, and the Planning label.
- The stored branch is checked out and starts from `main`; its target remains `main`.
- Execution has started. The accepted plan is projected exactly to #6, metadata records `workStage: execution`, and read-back verified the Planning label was removed. No Project field removal is approved.
- Retain the unversioned-mode restriction on Kind projection.
- This is the only repository using the current setup. Migrate this repository without adding reusable migration behavior to workflow sources; the migration is repository-specific.
- Gig #6 owns only the fixed workflow Kind label group. Issue https://github.com/alex35mil/pi-af/issues/8 remains responsible for general repository-label catalog management.
- Use one authoritative home for each fact; never mirror the same workflow value between issue labels and Project fields.
- Repository issues are workflow tracker records. Their Project items hold Project-specific planning data. Pull requests remain forge delivery records; Project-only draft issues are outside workflow support.
- Workflow Kind belongs in one managed repository issue-label group. In GitHub, Status, Phase, Priority, iteration, estimates, and dates belong in Project fields. Native GitHub issue Type remains independent and unmanaged by workflow Kind.
- Planning and Execution are Phase sub-statuses of lifecycle Status In Progress. They must not become separate lifecycle Status options.
- Use one domain name, Phase, in workflow metadata and provider projection; do not preserve `workStage` as a second term.
- High-priority Todo https://github.com/alex35mil/pi-af/issues/19 owns the separate cross-provider Phase migration. GitHub replaces Planning with a Project Phase field; Linear uses mutually exclusive Project labels for Epics and issue labels for Tasks/Gigs while preserving unrelated labels. Queue items have no Phase. Initialized In Progress work projects its authoritative `phase`; outside In Progress, clear the provider-native Phase projection. Trackerless workflows keep Phase only in workflow metadata.
- Queue intake treats Kind as a standard choice. Reuse a Kind stated in the request; otherwise infer and recommend the best-supported Kind. The user must approve that Kind or choose `not set` before creation. An approved queue Kind label is authoritative until initialization; afterward workflow metadata is authoritative and projects exactly one managed Kind label while preserving unrelated labels.
- Issue https://github.com/alex35mil/pi-af/issues/7 was canceled because Status-label mirroring contradicts the single-source design. Read-back verified closed as not planned with Project Status Canceled.

## Execution checkpoint

- Exact setup preview `f7c2b2f1c21cf33aa198124623c466cc6e33ba95ac68e2f7035cd31654ed013c` was separately approved, applied once, and read-back verified all seven label names, descriptions, and colors.
- Full Project inventory confirmed only #6 and #10 had populated old Kind values. Both now have exactly `Kind: Feature`; every old Project Kind value is empty; no previously empty item gained a Kind label; the Kind field definition remains present and was not deleted.
- Final source/configuration removes Type-based workflow Kind, generates and validates the managed label group, keeps native issue Type independent, reconciles initialized Kind absolutely, and makes versioned queue Kind an inferred/reused explicit approval choice with `not set`.
- `npm test` passed all 146 tests; `npx tsc --noEmit` passed; `git diff --check` passed.
- After the final Pi restart, artifact preparation and the label-only integration context passed. Remote validation confirmed every configured field/option and exact managed label; #6 retained High priority and only `Kind: Feature`; every old Project Kind value remained empty; no existing branch PR was found. #6 is now In Review, and final review round 001 approved the synchronized implementation and `result.md` with no findings.
- During final user review, the user identified the pre-existing omission of a Linear planning marker. Issue #19 was broadened to require provider-native Phase projection for GitHub and Linear and read-back verified as Todo/High. This does not change Gig #6's accepted Kind scope or reviewed implementation.
- The user accepted the result. Commits `2658e4e` and `be1f9c9` are pushed on the stored branch; PR https://github.com/alex35mil/pi-af/pull/20 is open against `main`, persisted in metadata, and natively linked to close issue #6 after merge. Tracker projection with artifact and PR links verifies exactly. Keep lifecycle In Review until the PR is merged.

## Repository findings

- `workflows/extensions/integrations/config.ts` owns strict tracker configuration. Final workflow Kind configuration is the fixed managed label group under `labels.kind`; `fields.type` is rejected.
- `workflows/extensions/integrations/tracker/github.ts` owns required MCP capabilities and remote-validation instructions. GitHub mutation sequences are agent-guided in `workflows/references/integrations/tracker/github.md`.
- `workflows/extensions/project-setup/github-project.ts` owns setup schema, defaults, provider preview/apply, exact Planning/Kind label provisioning, and generated tracker configuration. It no longer inspects or provisions native issue Types or a Project Kind field.
- `workflows/references/queue.md` now requires versioned GitHub Kind intake to reuse an explicit value or infer and recommend one for approval, with `not set` available.
- `workflows/extensions/integrations/policy.ts` and `workflows/references/integrations/shared.md` prohibit system-metadata projection, including Kind labels/types, in unversioned mode. That restriction remains; setup may define the catalog, but queue/initialized mutations must not apply Kind labels in unversioned mode.
- `workflows/extensions/integrations/records.ts` renders pending initialization operations and must say Kind label rather than configured Type in versioned mode.
- Setup provisions one Planning label and the seven fixed Kind labels through one exact preview/apply/read-back boundary. Generic label updates, renames, and deletions remain outside this Gig.
- Provider migration is complete: #6 and #10 carry `Kind: Feature`, all Project Kind values are empty, and other items remain without managed Kind labels.
- The stored Gig branch was fast-forwarded to current `main` commit `59f95be77e65b571eccb9770759923d24aa4a2df` before planning.
- There is no `.project/policies.md`. Verification entry point: `npm test`; TypeScript is available for type checking.
- Unrelated working-tree paths present during intake: `WRITING.md`, `workflows/migration/`, and `workflows/transition/`. `.agents/permission.settings.json` also changed during initialization/tool approvals. Preserve these independently of Gig changes.

## Discussion evidence

- GitHub Projects can contain repository issues, pull requests, and project-only draft issues. Drafts cannot have labels until converted: https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-items-in-your-project/adding-items-to-your-project
- GitHub recommends a single source of truth; issue labels are reflected in Projects automatically. Custom fields support project-specific planning such as priority, dates, estimates, and iterations: https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/best-practices-for-projects
- Native issue Types classify issues across an organization: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-types-in-an-organization
- Organization issue fields are distinct from project custom fields and carry consistent issue metadata across repositories/Projects: https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-issue-fields
- Issue forms can apply existing triage labels; Project auto-add supports label-based admission filters: https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms and https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically

## Open questions

- Triage states, labels, admission rules, and automation are deferred to Todo issue https://github.com/alex35mil/pi-af/issues/11; that issue intentionally contains no proposed solution.
