# Expose project setup inspection as an agent tool

## Root cause

### Symptom

Natural-language project setup cannot obtain the setup context available to `/project-setup`. An agent handling an ordinary request to update GitHub setup lacks the configured credential-reference inventory and asks the user for information already stored locally, requires a slash-command invocation, or attempts shell discovery that the setup workflow prohibits.

### Evidence

- `workflows/skills/project-setup/SKILL.md` explicitly supports natural-language setup but its fallback reads only selected setup files; it cannot obtain the effective MCP registration inventory. The same skill expects `integration_context` to report active registrations, although that tool returns configured workflow roles and does not provide that inventory.
- `workflows/extensions/project-setup/index.ts` registers `/project-setup`, which directly calls `inspectProjectSetup(ctx.cwd)` and injects the snapshot into the command prompt. No registered tool exposes that inspector.
- The local probe `.local/scratch/reproduce-setup-gap.ts` executes the real extension registration and slash-command handler in an isolated Git repository containing an official GitHub registration with a credential environment reference. It confirms `setupSnapshotToolRegistered: false`, `slashCommandSuppliesCredentialReference: true`, and `workflowArtifactsCreated: false`.
- The existing `inspectProjectSetup` already assembles setup-file contents, Git safety facts, shallow tracker-binding summaries, and the credential-redacted `inspectProjectMcp` inventory. It does not require valid workflow configuration and does not mutate files or provider state.

### Cause

The intended setup contract was implemented only for a user-invoked command. Its reusable inspection abstraction has no agent-callable entry point, and the natural-language guidance points at an operational context tool with a different responsibility. The failure occurs directly during supported natural-language setup; no concurrency or unusual failure timing is involved.

## Proposed fix

### Owning boundary and consumers

Expose the same existing inspector through one registered read-only setup tool. Preserve the inspector as the single owner of snapshot construction; do not duplicate file discovery or extend runtime integration context with setup concerns.

- In `workflows/extensions/project-setup/index.ts`, register `inspect_project_setup` with a strict empty parameter object. Validate arguments, call `inspectProjectSetup(ctx.cwd)` once, and return its snapshot as JSON text and structured details using the existing tool-result convention.
- Keep `/project-setup` using that same inspector and its existing kickoff prompt. The inspection tool returns context only: no user-message injection, session operation, provider call, artifact preparation, configuration mutation, staging, commit, or push.
- Inspection remains available before setup exists and while setup files need reconfiguration, including syntactically malformed workflow configuration. Snapshot raw workflow files and shallow binding facts without requiring strict operational configuration/entity loads.
- Reuse the existing credential-redacted MCP inventory. Recognized official registrations expose environment-variable names, not token values or raw authorization headers. A configured registration is not proof that its provider tools are currently available.

### Workflow guidance

Update `workflows/skills/project-setup/SKILL.md`, `workflows/references/setup.md`, and `workflows/extensions/project-setup/README.md`:

- Add the tool to setup's allowed tools and documented interfaces.
- Reuse a command-supplied setup snapshot. For a natural-language invocation without one, call `inspect_project_setup` before asking setup questions; use the same context and decision flow in both cases.
- Reuse recognized credential environment references from the snapshot rather than asking the user for known names. Ask only for genuinely missing information.
- Use the configured registration inventory to select existing servers, and the registered provider tools to establish availability under normal permissions. Remove instructions that expect `integration_context` to enumerate active MCP servers, including the post-reload version of that expectation. Keep operational integration validation after approved valid configuration is saved.
- Preserve the existing no-shell-discovery rule, exact provider provisioning preview/hash approval, separate repository-file approval, credential privacy, role independence, and prohibition on using another transport after a denied provider call.

## Verify

Extend `tests/workflow-project-config.test.ts` and relevant setup instruction coverage:

1. Verify registration and the strict empty argument schema through the actual extension tool boundary.
2. Execute the tool and `/project-setup` in the same isolated repository and compare complete snapshot contents. Both entry points must carry the same setup files, Git safety information, binding summaries, and MCP inventory.
3. Verify recognized GitHub/Linear credential environment references remain available and literal authorization tokens remain absent from JSON text and structured details. The tool must not inject a user message.
4. Exercise missing, incompatible, and malformed workflow configuration without making setup valid first. Inspection must return the actual snapshot without rewriting those files or preparing artifacts.
5. Verify no file contents, exclusions, Git index, or repository status change during inspection, and verify the natural-language instructions route through the new tool while keeping existing approval boundaries.
6. Run focused setup/instruction tests, `npm test`, `npx tsc --noEmit`, formatting checks on changed files, and `git diff --check`. Record actual results in `result.md` before final review.

## Boundaries

This Gig fixes the project setup design oversight only. It does not change the shipped Phase model, provider configuration, existing work items, credential resolution semantics, migration behavior, or unrelated files. New MCP registrations still require the existing reload flow; adding an inspection entry point does not make inactive providers active. Live provider mutations are unnecessary to verify this fix.
