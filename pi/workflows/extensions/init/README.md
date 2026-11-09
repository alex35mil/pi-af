# init

Registers permission-controlled entity initialization tools:

- `preflight_epic` and `preflight_gig` run every local check for approved new work before its tracker object is created, and change nothing. A Task has no preflight: it always adopts the queued issue its parent Epic's Task issue processing created;
- `init_github_epic`, `init_github_task`, and `init_github_gig` initialize work from a GitHub issue, newly created or explicitly selected;
- `init_linear_epic`, `init_linear_task`, and `init_linear_gig` initialize work from a Linear Project or issue, newly created or explicitly selected;
- `restore_epic` recreates a missing local Epic from its tracker read and single published plan; `restore_epic_plan_source` returns an existing Epic's published plan as `epic.md` source without writing. Both live in `restore.ts` and reuse publication recovery's evidence validation and `restoreProviderSource`.

The tracker object is the entity's identity. Initialization names the directory and branch from it (`12-<slug>`, `ENG-12-<slug>`, or `<YYYYMMDD>-<slug>` for a Linear Epic, dated by the Project's creation), and records its Resource IDs. A Task is selected by its issue's marker in the parent's `## Tasks` section, takes that section's Kind, and never rewrites the plan; `../integrations/epic-task-issues.ts` owns tagging. GitHub tracker records start with `planComment: { state: "unpublished" }`; Linear records start with `planDocument: { state: "unpublished" }`. Accepted plans later publish through the shared operation as a GitHub comment or attached Linear document, preserving the object's request content.

Task routing comes from the parent plan's `Task target:` and `Epic branch:` lines. Default-target Tasks run no Epic branch or delivery check; Epic-target Tasks require the Epic branch locally. See [Epic routing and restore](../../references/epic.md).

Entity creation, branch setup, and Task plan and routing selection live in `entity.ts`; the Epic Task format parser lives in `../__lib/epic-tasks.ts`; `resource-ids.ts` builds the object's Resource IDs; `index.ts` registers the operations through the shared native deferred-tool owner in `../__lib/tools.ts`. Model-facing schemas are concrete strict objects. See [tool discovery](../../references/tools.md). Generic entity status and path infrastructure remains in `../__lib/`, and tracker records in `../integrations/records.ts`. See [artifact intake](../../references/artifacts.md) and [integration behavior](../../references/integrations/shared.md) for operational contracts.
