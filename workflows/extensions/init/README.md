# init

Registers permission-controlled entity initialization tools:

- `init_epic`, `init_task`, and `init_gig` create approved new work;
- `adopt_github_epic`, `adopt_github_task`, and `adopt_github_gig` initialize explicitly selected GitHub work;
- `adopt_linear_epic`, `adopt_linear_task`, and `adopt_linear_gig` initialize explicitly selected Linear work;
- `set_epic_task_target` changes only where future Tasks branch after an Epic merge confirmed by Git in the current clone.

GitHub tracker records start with `planComment: { state: "unpublished" }`; Linear records start with `planDocument: { state: "unpublished" }`, for new and adopted work alike. Tracker creation uses the approved title/Request; accepted plans later publish through the shared operation as a GitHub comment or attached Linear document, preserving request content. Linear initialization does not embed a workflow ID into descriptions.

Entity creation, branch setup, Task parent annotation, and Epic future-Task target changes live in `entity.ts`; `index.ts` registers those operations through the shared native deferred-tool owner in `../__lib/tools.ts`. Model-facing schemas are concrete objects; internal validated initialization unions remain domain contracts. See [tool discovery](../../references/tools.md). Generic entity status/path infrastructure remains in `../__lib/`, while provider records and branch provisioning remain in `../integrations/`. See [artifact intake](../../references/artifacts.md) and [integration behavior](../../references/integrations/shared.md) for operational contracts.
