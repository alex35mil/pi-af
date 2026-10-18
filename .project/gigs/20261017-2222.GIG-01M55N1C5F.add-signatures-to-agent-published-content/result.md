# Result

## Overview

Workflows own automatic attribution for mapped GitHub and Linear communication. AI-assisted content receives `Sent via <harness>. Model: <provider>/<model-id>.`, using the current execution identity and displaying the default harness as `Pi`. GitHub uses subscript text; Linear uses italics. The final footer adds no divider and replaces earlier terminal signatures, including the published bracket format.

Complete user-written messages relayed unchanged automatically use user-verbatim authorship and stay byte-for-byte unchanged and unsigned, without special opt-out wording. The agent identifies intent; code enforces that per-call choice and removes local authorship metadata before native execution. Signing adds no prompt, preview, permission dependency, or confirmation lane. Repository artifacts and noncommunication operations stay unchanged; edits require complete text instead of hidden reads or partial/template publication.

Publication policy and the reusable Pi wrapper are separate from the small current MCP binding. Generic MCP alone preserves native schemas, descriptions, and arguments. Backend-specific identity and registration stay in the binding; ordinary tests cover the publication boundary and preservation of native definitions and results. The running harness and project dependencies were not upgraded.

Live GitHub publication through the reloaded workflow binding is verified. Browser rendering and live Linear publication remain unverified.

## Implementation walkthrough

- `workflows/extensions/integrations/publication.ts` owns plain operation/identity types, mappings, authorship, schema/guidance, formatting, and wire cleanup. It has no imports or transport dependencies; identity is requested only for nonempty AI-assisted text.
- `publication-tool.ts` owns Pi definition wrapping and runtime identity. It delegates once while preserving native IDs, signals, update callbacks, context, results, and unrelated definition fields, including exposure/namespace/output/annotation/rendering metadata.
- `publication-mcp.ts` alone translates current bridge metadata and installs workflow publication. The generic bridge exposes only provider-neutral decoration, keeps original catalog metadata, and applies decorators outside the event emitter before registering tools. Workflow setup and the binding share official-provider recognition.
- Workflow publishing guidance owns attribution documentation. The renderer retains its existing folds, dividers, and closing references; source artifacts remain signature-free. Existing permission semantics and submission policy are unchanged.

## Verification

- Focused MCP, publication, permission, renderer, and workflow integration tests — 127 passed.
- `npm test` — 346 passed, zero failures, against workspace SDK 0.79.6.
- `npx tsc --noEmit` — passed.
- Live GitHub publication through the reloaded workflow binding in harness 0.80.10 — passed. The request contained no manual footer; native body read-back confirmed exactly one `<sub>Sent via Pi. Model: openai-codex/gpt-6.1-sol.</sub>` after the closed fold, without an added divider. This verifies persisted Markdown, not browser rendering.
- Formatting checks cover the 15 changed implementation/documentation/test files and this result. The shared integration guide retains its pre-existing table layout to avoid unrelated formatting changes.
- Working and staged whitespace checks — passed.
- Permission implementation/README, `deliverable.md`, and repository package/dependency files — unchanged from the starting revision.

**Not run:**

- Browser rendering and live Linear publication — no visual check or Linear test posting was performed. Both destination formats are covered by tests and documented provider syntax.
