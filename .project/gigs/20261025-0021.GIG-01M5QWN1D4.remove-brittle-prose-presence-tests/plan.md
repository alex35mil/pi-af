# Remove brittle prose-presence tests

## Overview

Workflow tests currently pin about 380 exact sentences and regex fragments in the workflow Markdown. They don't check what the workflow does. They check that particular wording is still present. As a result, every edit to an instruction means editing matching regexes. That makes rewrites expensive and pushes changes toward appending text instead of revising it. It is the main blocker for #84, which tightens the instructions.

This Gig removes those checks. It keeps every test that verifies code behavior or structure, and adds a small number of structural checks so the guidance still can't silently break.

### Plan highlights

- Delete assertions that only require docs to contain specific wording, in `tests/workflow-instructions.test.ts`, `tests/workflow-incoming-pr-guidance.test.ts`, and two single assertions elsewhere.
- Keep structural checks: Markdown links resolve, each skill reaches its required references, skill tool grants match the registered tools, required skill grants are present, and the guidance names every registered tool or operation it documents.
- Keep the code-structure checks that sit in the instruction test: the `publication.ts` import boundary and the cleanup tool schema keys.
- Add two checks: heading anchors in Markdown links resolve, and the JSON examples in `workflows/references/setup.md` parse.
- Add a path-scoped project rule, `.agents/rules/testing.md`, so future agents writing tests here know what to test and what not to. This keeps prose-presence tests from coming back.
- No workflow Markdown, product code, or runtime behavior changes.

## Classification rule

An assertion is **removed** when it passes or fails only because a particular phrase exists in a workflow `.md` file and no code reads that text.

An assertion is **kept** when it verifies one of these:

- runtime output built by code, such as the reviewer prompts in `workflow-review.test.ts` or thrown error messages that mention `MIGRATIONS`;
- tool schemas, registrations, or module import boundaries;
- skill frontmatter grants, because `extensions/permissions/index.ts` reads them at runtime;
- structural links between documents and code: link and anchor targets, which references a skill can reach, frontmatter grants matching the registry, and tool names in the docs matching the exported operation inventories (`expectedWorkflowTools`, `INCOMING_CHECKOUT_TOOLS`);
- an allowlist or denylist boundary that tooling derives from skill frontmatter. This covers the existing checks that incoming-PR checkout tools and `mcp(github, …)` writes are absent from the `pr` skill's grants.

## Changes by file

### `tests/workflow-instructions.test.ts`

Keep:
- `resolves every concrete Markdown dependency from its owning directory`, extended to also resolve heading anchors (below).
- `keeps shared operational contracts reachable from every work skill`, including the `prepare_<entity>_plan_presentation` frontmatter grant check. Add the Epic and Task reachability of `references/epic.md` from the removed Epic-delivery test.
- **Required skill grants**, gathered from the grant assertions inside removed tests into one table-driven test that parses frontmatter, not text: `epic`/`task`/`gig` grant `prepare_tracker_publication` and `render_provider_body`; `project-setup` grants `inspect_permissions` and `inspect_project_setup`; `todo` grants exactly `inspect_integrations` and `inspect_queue_intake`. The permissions extension reads these grants at runtime, and the existing inventory test only rejects unknown names, so a missing grant would otherwise go unnoticed.
- From `routes natural-language workflow reports…`: only the check that every work skill reaches `queue.md`, as its own small reachability test. The remaining prose checks are removed.
- From `keeps Deliverable cleanup guidance aligned with the one-shot tool schema`: only the `AncestryDeliveryCleanupInputSchema` / `GitHubDeliveryCleanupInputSchema` key assertions.
- From `keeps request-only briefs…`: only the `publication.ts` no-import and `publication-tool.ts` import-list assertions, and the `index.ts` → `publication-mcp.js` import, as a small module-boundary test.

Remove all other `it` blocks and assertions: Epic Task delivery wording, GitHub presentation setup wording, queued-selection approval wording, queue/Phase wording, kind change, briefs/provider-body wording, overview/folding wording, commit-skill routing wording, finish handoff, ship intent, permission offer wording, and setup configuration literals.

Add:
- **Anchor resolution.** For each relative `file.md#anchor` link, the target file contains a heading whose GitHub-style slug equals the anchor.
- **Setup examples parse.** Every ```` ```json ```` block in `workflows/references/setup.md` is valid JSON. All ten blocks parse today, so no exclusions are needed.

Rename the suite from `workflow instruction ownership` to `workflow guidance structure`.

### `tests/workflow-incoming-pr-guidance.test.ts`

Keep:
- `resolves the skill entry point and scoped PR reference links`.
- From `uses independent nested Git state…`: the `INCOMING_CHECKOUT_TOOLS` loop. Each tool stays out of the skill frontmatter, appears in the procedure's ask example, and is named in `checkout.md`.
- From `keeps publication private-first…`: the check that the `mcp(github, <write tool>)` rules appear in the procedure's permission example and do not appear in the skill grants.

Remove all other prose assertions. Merge what's left into two or three focused tests.

### Other files

- `tests/workflow-project-config.test.ts`, `loads operational Markdown dependencies…`: keep the dependency-prefix checks; drop the two `setup.md` phrase matches.
- `tests/workflow-linear-publication.test.ts`: drop the single `MIGRATIONS.md` phrase match. The schema migration behavior assertions in that test stay.

### `.agents/rules/testing.md` (new)

A short project rule with frontmatter `paths: ["tests/**"]`. The rules extension delivers it only when an agent reads or edits a test file, so ordinary sessions pay no context cost. Reviewer subprocesses load rules too, so reviews apply it as well. Content, at most ~25 lines:

- Test behavior through code: tool schemas and registration, domain functions, runtime output produced by code (rendered bodies, prompts, errors), and mocked-provider flows.
- Never assert that workflow Markdown (skills, references, READMEs) contains particular wording. Guidance wording is checked by plan and final review, not tests. When a test breaks only because wording changed, delete the assertion; do not update the regex.
- Guidance checks are structural only, and go in `tests/workflow-instructions.test.ts`: links and anchors resolve, skills reach their references, frontmatter grants match registered tools, names in docs match exported code inventories, and examples parse.
- When matching code-generated text, match the smallest meaningful token or structure, not whole sentences.
- An instruction-only fix needs no new test. A code fix needs a regression test that exercises the code.
- Use local fixtures and mocked MCP evidence; never call real providers. Extend existing suites and fixtures before creating new ones.

### Unchanged

All other suites: behavior, schemas, runtime output, and error messages. This includes `workflow-tool-contracts.test.ts`, which already checks that `tools.md` names every registered tool and that skill grants are known tools.

## Risks and boundaries

- Wording-level guarantees, such as "the docs say X requires approval", are no longer tested. That is intentional. Plan, interim, and final reviews already check workflow-guidance edits, and #84 will add a size budget and style guide. Behavior that code enforces stays covered by the code tests.
- If a removed assertion turns out to back a runtime contract that code reads, it is kept instead and recorded in `result.md`.
- The prose-only asserts are not rewritten into fuzzier concept checks. Doing so would just bring back the same coupling.

## Verification

- `npm test`: all suites pass. Record the before and after test counts and the removed assertion count. Baseline: 685 tests pass.
- `npm run typecheck` passes.
- Reading a file under `tests/` delivers the testing rule. Check this with the rules extension's path matching: the new rule's `paths` glob matches `tests/workflow-instructions.test.ts`.
- Remove a word from a guidance sentence: only anchor or link checks should be able to fail, and only if a heading or link changes.
- Break a link anchor in a scratch copy and confirm the new anchor check fails. Make one setup JSON example invalid and confirm the parse check fails. Revert both.
