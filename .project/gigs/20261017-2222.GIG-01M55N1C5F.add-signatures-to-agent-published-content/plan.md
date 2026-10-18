# Plan

## Overview

Add automatic attribution to AI-assisted human-facing communication published through the workflows' GitHub and Linear MCP tools. Another participant can see that the content was AI-assisted and which harness and model sent it. Exact user-written messages relayed without changes remain unsigned: the agent is only their transport. Repository files, including committed Markdown and workflow artifacts, remain unchanged.

### Plan highlights

- Code appends `Sent via <harness>. Model: <provider>/<model-id>.` to AI-assisted outgoing communication and replaces the previous footer on content edits. The default harness is displayed as `Pi`.
- Exact user-written messages are automatically sent unchanged and unsigned. The user does not need to request an opt-out; reworded or agent-composed messages remain signed.
- GitHub uses `<sub>…</sub>`; Linear uses Markdown italics. The signature has no divider. Existing PR dividers, collapsed details, and closing references stay intact.
- Workflow-owned publication covers initialization, Backlog/Todo intake, accepted plans, PR submission/revisions, and external comments/documents. Separate its transport-independent policy, Pi tool wrapper, and current MCP binding so migration replaces the binding, not the publication layer.
- The generic MCP extension exposes only provider-neutral tool decoration. Without workflow publication, native schemas, descriptions, and arguments stay unchanged, including on official GitHub/Linear registrations.
- The workflow-owned execution wrapper signs transparently after existing workflow/permission gates using current runtime identity. It adds no prompt, preview, review lane, permission dependency, or change to existing confirmation settings.
- Keep publication policy and the Pi wrapper independent of the current MCP backend so a later replacement changes the binding rather than the communication layer. Preserve native tool capabilities and keep backend-specific identity/registration work in that binding. Research evidence stays in local working state; delivered verification uses ordinary repository tests.
- Supported services are the official GitHub and Linear MCP registrations used by workflow setup, independent of their configured server aliases. Unrelated MCP services remain unchanged. Content edits use full text; native patch-only edits require a read and complete replacement through the existing registered tools.

## Existing publication boundary and ownership

`extensions/mcp/index.ts` owns generic server discovery, native tool registration, transport, cancellation, and result conversion. It must not own communication fields, provider-specific recognition, authorship, signatures, or publication guidance. GitHub tracker initialization and queues use `issue_write`; PR submission/revisions use native PR tools; Linear trackers use `save_issue` and `save_project`. Discussion uses registered comment/review tools. These are workflow communication routes, not a reason to put publication policy in the transport.

`workflows/extensions/integrations/publication.ts` owns publication mappings, authorship, schema/guidance preparation, classification, formatting, and native-wire argument preparation. Its operation model contains only a publication provider, original operation name, and input schema. It imports no MCP transport, custom catalog, event, client, or provider SDK types. Inject runtime identity through a lazy reader invoked only for nonempty AI-assisted text, keeping verbatim and metadata operations independent from model/package availability.

`workflows/extensions/integrations/publication-tool.ts` owns the reusable Pi tool-definition wrapper and runtime identity reader. Given a native definition and the publication operation, it decorates schema/guidance and delegates execution once. It knows no custom MCP registration event, catalog, transport, generated naming convention, or settings format. Preserve all other properties by copying the complete native definition, including future SDK metadata.

`workflows/extensions/integrations/publication-mcp.ts` is the current transport binding. It alone translates generic bridge metadata/transport identity into publication operations and attaches the reusable wrapper through the generic decorator contract. Register this binding from the workflow integration extension independently of consuming-project workflow configuration or initialized entities, so queue intake and cross-project workflow reports stay covered. Official-provider recognition stays in workflow code, shared with `workflows/extensions/integrations/mcp.ts` setup inspection. Keep provider identity out of the generic MCP catalog; do not infer it from aliases or generic `body` fields.

`workflows/extensions/integrations/projection.ts` continues to own artifact presentation only. Initialization, queues, and comments do not pass through that renderer. Keep overview/fold/divider/reference behavior unchanged. Existing workflow lanes and permission settings remain the sole owners of confirmations; the permission extension evaluates proposed calls unchanged. Publication has no role in permission presentation or policy.

## Current transport integration

The current Pi API supports custom tool registration and mutable `tool_call` inputs, but exposes tool metadata rather than native execute functions through `getAllTools`. Mutating a call in an earlier `tool_call` handler would also change the arguments seen by later permission handlers. Use a small provider-neutral tool-decoration seam in the current generic MCP extension rather than embedding workflow policy there or adding another permission hook.

Define the generic contract in `extensions/__lib/mcp.ts`: a synchronous decorator receives the native tool definition, its native catalog metadata, and credential-free server transport identity, and returns the definition to register. Server transport identity distinguishes stdio from streamable HTTP and includes only the actual HTTP URL, never headers, environment values, tokens, or other connection secrets. A decorator preserves the tool name and native MCP catalog identity; its returned schema, description, and execute wrapper are agent-facing behavior owned by that decorator. The generic bridge knows no publication concepts or provider names.

Collect decorators through a typed `mcp:tool-decorators` registration event during session-start discovery. Its payload exposes `use(decorator)`, which only collects callbacks. The workflow extension installs a synchronous listener during factory loading that immediately registers its decorator, with no await, I/O, policy evaluation, or provider call in that listener. All extension factories finish before session start, making both factory load orders valid. Dispose the workflow listener on session shutdown; keep collections scoped to each discovery, with no process-global registry or saved policy state. Pi loads extension modules with `moduleCache: false`, so do not rely on a module-level singleton shared across extensions.

Apply collected decorators directly outside the event emitter, before publishing the catalog or registering any tool. Pi's event bus catches listener errors and does not await them: it is only the registration notification, never the execution or validation boundary. Schema validation and decorator failures propagate from the direct application path and stop that discovery atomically, closing clients under the existing failure path. Preserve the current native-catalog-before-tool-registration order. With no decorators, register the original native definition unchanged.

The current binding recognizes the actual server URL using workflow-owned recognition and builds the publication operation from the original server tool name and schema. The reusable tool wrapper adds local authorship schema/guidance for mapped operations. At execution, it prepares complete text using current runtime identity, strips local authorship, and delegates once with the same tool-call ID, signal, update callback, and context. Errors stop before delegation. Unmapped tools retain their native definitions. Do not create another provider client, proxy tool, hidden read, retry, or permission decision.

This seam is justified by the current need to attach workflow behavior to registered tools without changing permission inputs or implementing publication in a generic transport. Its cost is one small generic contract, one current binding, and boundary tests—not a framework for hypothetical transports.

## Backend independence and research boundary

Publication policy and the reusable Pi wrapper are independent of the current transport. A later built-in MCP replacement owns native server/operation identity, configuration conversion, and tool registration in its binding. Preserve the core, wrapper, and their behavior tests. Original operation identity comes from the backend, not by splitting normalized or hashed model-facing tool names.

Preserve native exposure, namespace, output schema, annotations, rendering, structured content/errors, and unrelated definition fields. Apply the wrapper to each fresh native definition without stacking it or changing hidden/withdrawn-tool behavior. The native execution path remains responsible for direct, deferred, and codemode calls after existing permission checks, with no extra confirmation. Implementing another backend, configuration/trust/OAuth handling, permission-catalog migration, and upgrading Pi remain separate work.

Temporary compatibility experiments and their evidence belong under ignored `.local/scratch/` and `.local/notes.md`. Shipped verification consists of ordinary tests for publication behavior, Pi definition preservation, and the current MCP binding.

## Signature contract

The visible sentence is exactly:

```text
Sent via <harness>. Model: <provider>/<model-id>.
```

- Resolve the harness through Pi's public `getPackageDir()` and the running package's naming contract: `package.json` `piConfig.name`, otherwise the default Pi harness. Display that default as `Pi`; preserve configured custom harness names. Do not import private package internals.
- Read `ctx.model.provider` and `ctx.model.id` for each outgoing publication. Keep their configured values, including gateway provider names and full model IDs; do not infer an underlying vendor or shorten a version.
- GitHub renders `<sub>Sent via ….</sub>`. Linear renders `*Sent via ….*`. Escape identity values for the destination syntax so their visible text remains literal.
- Place the footer in its own final paragraph, separated by a blank line, outside completed folds and after any eligible `Closes #…` reference. Add no horizontal rule.
- Replace only a standalone terminal footer in this feature's defined signature format. Also recognize the bracket-style footer already published during the live check, so editing that content upgrades its footer rather than duplicating it. Preserve the rest of the approved text, including existing dividers, quoted examples, code samples, and closing references. Repeated preparation with the same identity is byte-for-byte stable; a different current identity replaces the previous footer rather than accumulating another one.
- Keep source artifacts signature-free. Existing remote content receives the applicable attribution treatment on its next content publication; do not perform a bulk rewrite of historical postings.

## Authorship and verbatim delivery

Represent authorship as a per-call domain choice: `ai-assisted` or `user-verbatim`. Add the local-only optional parameter `__pi_authorship` to mapped communication tools. Omission retains normal `ai-assisted` signing for existing workflow calls.

The tool's agent-facing description and parameter guidance require automatic `user-verbatim` selection when the user supplies the complete message to publish and the agent relays that text unchanged. The user need not say “verbatim” or “no signature.” Agent composition, rewording, expansion, or a generated message that merely quotes user text is `ai-assisted`. This is a message-specific authorship choice, not a session-wide disable switch.

The agent identifies the user's intent and supplies the mode; code enforces the selected mode and owns all footer formatting. Do not claim code can determine authorship from the message's text alone. `user-verbatim` sends the provided complete text byte-for-byte, including any signature-looking text the user explicitly included; it performs no footer insertion, removal, escaping, or whitespace cleanup and needs no model identity. The same applies when the exact user-authored text replaces an existing AI-assisted message.

The workflow-owned execution wrapper consumes the local authorship choice and removes it immediately before delegating to native execution. Attribution creates no user interaction and does not alter the permission extension, its documentation, or the existing workflow confirmation lanes. Preserve the provider's original input schema in generic catalog metadata; only the workflow-decorated agent-facing schema gains this local field. Never send the field to the provider or expose it on unrelated tools. A conflicting native field/schema is a local integration error, not permission to overwrite provider data.

## Publication decision table

| Operation/input | Signing behavior |
| --- | --- |
| Generic MCP is loaded without workflow publication | Preserve native schemas, descriptions, and arguments; add no authorship field or signature. |
| Workflow publication is loaded and the native tool matches a supported provider/communication mapping | Apply workflow-owned schema guidance and execution wrapping; preserve native catalog metadata and existing confirmation lanes. |
| Complete user-written message is relayed unchanged | Automatically select `user-verbatim`; send exactly the supplied text without an added signature or a special user opt-out instruction. |
| Agent writes or rewords the message, or composes prose around a user quotation | Use `ai-assisted`; preserve the prepared content, replace a previous terminal footer, and append the current destination-formatted footer. |
| Mapped human-facing field contains nonempty complete text and no explicit local mode | Use normal `ai-assisted` signing. |
| The MCP call reaches dispatch after the existing workflow/permission gates | Apply its authorship treatment transparently once before the native request, with no signing-specific prompt or preview. |
| The active model changes between publications | Use the current model on the next publication. |
| A mapped text field explicitly clears content with empty/whitespace-only text | Preserve the native clear operation; do not manufacture a signature-only message. |
| Metadata-only update, reaction-only call, or review/thread control without text | Leave arguments unchanged; do not fetch or rewrite another body. |
| Native Linear `patch` changes a mapped communication field | Stop locally before provider mutation with an actionable request to read the exact object and resubmit the complete edited text through registered tools. The workflows already require whole descriptions for publication. |
| Template-only creation whose remote communication text is not present in the call | Require explicit complete publication text before sending; do not silently publish template text without attribution. |
| AI-assisted nonempty publication has no current model identity | Fail locally before sending; never invent identity or silently send unsigned AI-assisted text. |
| Read, deletion, repository/file operation, or unrelated MCP service/tool | Preserve existing behavior and arguments. |

The signer performs no provider reads, writes, retries, or permission decisions itself. Reads needed to prepare a full replacement stay explicit native tool calls under normal permissions.

## Communication tool mappings

Use explicit service, native tool name, operation, and content-field mappings. Validate mappings against the live advertised schemas during implementation; a missing mapped content contract must be surfaced rather than redirected to another field.

| Service | Native tools/operations | Human-facing field |
| --- | --- | --- |
| GitHub | `issue_write` create/update | `body` |
| GitHub | `create_pull_request`, `update_pull_request` | `body` |
| GitHub | `add_issue_comment`, `update_issue_comment`, `add_reply_to_pull_request_comment`, `add_comment_to_pending_review` | `body` |
| GitHub | `pull_request_review_write` create/submit_pending with text | `body` |
| GitHub | `projects_write` create_project_status_update | `body` |
| Linear | `save_issue`, `save_project` | `description` |
| Linear | `save_comment`, `save_status_update` | `body` |
| Linear | `save_document`, `save_release_note` | `content` |
| Linear | `save_milestone`, `save_release` | `description` |

Titles, identifiers, labels and label descriptions, statuses, priority, relationship fields, link/attachment metadata, code/file bytes, and Git commit messages are not communication bodies. Do not modify those fields. Mixed calls keep all noncommunication arguments intact. Do not create comments, review bodies, or additional provider calls merely to attach attribution to a metadata/control operation.

## Implementation

1. Add only the generic decoration contract to `extensions/__lib/mcp.ts` and the credential-safe current-transport attachment to `extensions/mcp/index.ts`. Remove the in-progress provider classification and `service` field from generic catalog types/producers. Prepare all decorated tool definitions before catalog publication/registration. Preserve server discovery, catalog metadata, generated names, native execution, signals, response conversion, and shutdown behavior. Keep all publication imports and decisions out of the generic bridge.
2. Complete the move from `extensions/__lib/publication.ts` into three workflow-owned modules: `publication.ts` for transport-independent policy with plain operation/identity types, `publication-tool.ts` for the reusable Pi definition wrapper/runtime identity, and `publication-mcp.ts` for current bridge translation/registration. Remove the old implementation and update imports directly, with no compatibility re-export. Retain exact sentence/styling/replacement behavior, distinct publication outcomes, full-text errors, and automatic verbatim delivery. Core tests must need no MCP catalog, event bus, transport, or Pi execution context.
3. Keep official-provider recognition in `workflows/extensions/integrations/mcp.ts`, shared by setup inspection and the binding. Register the current binding from `workflows/extensions/integrations/index.ts`, without requiring current-project workflow artifacts or configuration. Keep synchronous callback collection separate from direct decoration/execution so errors are not swallowed by the event bus. Preserve original native schemas, caller arguments, and all unrelated native-definition metadata; strip only local authorship from delegated arguments. No publication-specific permission hook is added.
4. Keep `extensions/permission/index.ts`, its README, and `workflows/references/deliverable.md` unchanged. Revert test-fixture `service` additions that are no longer part of generic metadata. Preserve the permission-independence regression: checks/presentation leave proposed arguments unchanged, and existing allow/ask/deny choices alone determine confirmation counts. The separately queued permission-precedence fix and the observed Resource IDs evidence mismatch remain outside this Gig.
5. Move communication-attribution documentation out of `extensions/mcp/README.md` into the workflow integration README and publishing references. The generic MCP README documents only its provider-neutral decoration contract. Update the context tool's attribution/ownership text, `workflows/references/integrations/shared.md`, and queue guidance to name workflow-owned publication. Default artifact publication is AI-assisted; exact complete unchanged user messages automatically select user-verbatim. Keep renderer/source artifacts signature-free and preserve existing approval, privacy, and recovery rules. Correct implementation-path references directly, without retaining superseded ownership wording.
6. Complete the move to `tests/workflow-publication.test.ts`; separate policy/definition-wrapper tests from the current binding harness, which explicitly loads workflow publication. Keep generic MCP isolation/decorator tests in `tests/mcp.test.ts` and preserve mapping, native-wire, current-identity, full-text failure, permission, renderer, factory-order, failure, and shutdown coverage. Keep ordinary native-definition fixtures covering exposure/namespace/output/result fields and fresh registration. Tests use repository dependencies.
7. Synchronize `result.md` with the actual implementation and ordinary verification before final review. Distinguish workspace SDK 0.79.6 from running harness 0.80.10. Prior live GitHub evidence verifies the sentence/presentation, not the corrected binding. Use approved publication opportunities after reloading for runtime checks and record unperformed checks honestly. Preserve partial staging and existing forge intent. Repeat final review/user approval before submission; approval of the superseded implementation does not authorize this submission.

## Verification

Verify the delivered publication behavior and current registration boundary using the repository's installed dependencies. The workspace SDK is 0.79.6; live verification in the running 0.80.10 harness requires reloading its registrations.

Run the following after implementation:

- Focused publication tests: exact GitHub/Linear output, current identity, gateway IDs, literal escaping, final placement, stable repeat preparation, and replacement after a model change. Preserve examples and source text outside the terminal footer. Verify verbatim content stays byte-for-byte unchanged, including whitespace and signature-looking text, without model identity, while subsequent AI-assisted messages remain signed.
- Table-driven mapping tests for every listed operation. Verify metadata-only, empty clears, reaction-only, control, deletion, unknown-service, and repository/file operations remain unchanged. Exercise patch/template-only and missing-identity failures, proving no provider mutation occurs.
- Core tests importing publication policy without any MCP/transport/Pi execution types, and Pi wrapper tests using ordinary native definitions. Preserve unrelated native fields, structured results/errors, exact delegation arguments/context, zero or one identity-reader invocation as appropriate, fresh-registration behavior, and unmapped-definition identity.
- Generic MCP tests proving official GitHub/Linear tools retain exact native schemas, descriptions, and arguments without workflow publication. Exercise an unrelated generic decorator, zero-decorator identity, preserved catalog metadata/tool names, credential-free transport identity, and propagation of decoration errors before any tool/catalog registration, with clients closed.
- Workflow-enabled fake-client integration tests proving signed wire arguments for initialization/queue and artifact publication, comments/reviews/documents, aliases, and execution without the permission extension or consuming-project workflow configuration. Verify only mapped agent-facing schemas gain local authorship, native schemas/proposed arguments remain intact, verbatim sends unchanged text, and neither authorship value reaches the provider. Use the actual current Pi event bus to exercise synchronous collection with direct outward decorator-error propagation. Test both factory load orders, shutdown disposal, and new discovery without duplicate wrappers. Preserve tool-call IDs, signal, update callback, context, response conversion, and one native call per publication.
- Permission-independence regression: existing permission checks leave proposed arguments unchanged; allow adds no confirmation, ask retains its existing confirmation only, and deny/rejection prevents dispatch. Signing itself prompts zero times, including without the permission extension. Verify the MCP tool's descriptions/guidance select user-verbatim automatically for complete unchanged user messages without special opt-out wording.
- Workflow consumer coverage proving a rendered PR retains its current dividers, folds, and closing reference with the signature after them, while the renderer source and repository artifacts stay unsigned. Preserve cross-project workflow-report intake through the registered service boundary without requiring consuming-project workflow artifacts.
- `npx tsx --test tests/mcp.test.ts tests/permission-mcp.test.ts tests/workflow-provider-body.test.ts tests/workflow-integration.test.ts tests/workflow-publication.test.ts tests/workflow-publication-mcp.test.ts`.
- `npm test`, `npx tsc --noEmit`, `npx oxfmt --check <changed TypeScript/Markdown paths>`, and `git diff --check`.

GitHub's official basic-formatting documentation establishes `<sub>` support; Linear's official editor documentation establishes Markdown italics. No synthetic remote test postings are authorized by this plan. Use existing approved publication opportunities for a remote smoke check when available, and distinguish provider body evidence from live UI rendering. Record any unperformed live rendering check in the completion artifact rather than claiming it passed.

## Documentation evidence

- GitHub text styling: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#styling-text
- Linear text styling: https://linear.app/docs/editor#text-styling
- Installed Pi 0.80.10 extension documentation and `dynamic-tools.ts`, `event-bus.ts`, and `model-status.ts` examples: factories finish before session start; native execution context supplies the current model; `getAllTools` exposes metadata, not execute functions. `tool_call` mutations affect later handlers and execution.
- Workspace SDK 0.79.6 `core/event-bus.js` and `core/extensions/loader.js`: listener errors are caught and asynchronous listeners are not awaited by emit; extension imports use `moduleCache: false`. The registration probe used this workspace SDK, not the running global 0.80.10 harness.
- Upstream public MCP registration APIs informed the separation between reusable publication and backend-specific binding. Investigation details and temporary experiments remain in ignored local working state.
