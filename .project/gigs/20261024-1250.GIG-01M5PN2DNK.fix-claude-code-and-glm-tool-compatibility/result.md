# Result

## Overview

Workflow tools now expose meaningful, operation-specific object schemas and load through native Codemode discovery instead of declaring the entire catalog on every request. This combines provider-compatible invocation contracts with on-demand loading.

- All 81 workflow operations have concrete object roots, explicit string enums, and operation-specific required inputs. Replaced dispatch tools have no compatibility aliases.
- Shared domain unions, validation, resource checkpoints, lifecycle rules, approval gates, and contributor safety remain authoritative. Genuine empty observations map from omitted input leaves to existing domain nulls; stored artifacts need no migration.
- Reviewer subprocesses load the installed/enabled Claude Code provider only when the reviewer selects it, retaining read-only tools and extension isolation.
- Native tool-definition bytes fall from 94,354 to 5,393 (about 94%). Authenticated Claude Code/GLM generation and Neovim end-to-end checks remain unverified; the automated compatibility evidence is described below.

## Implementation

`workflows/extensions/__lib/tools.ts` owns native deferred exposure, concise namespaces, and activation of the existing permission-aware Codemode when tool selection permits it. It preserves explicit restrictions, reports unavailable discovery, and adds no alternate executor, full-catalog fallback, or lifecycle-specific activation state.

Initialization/adoption, integration contexts, resource IDs, publication, Phase/binding confirmation, setup, incoming-PR actions, review/presentation, and cleanup have separate named entry points. New work uses `init_epic`, `init_task`, and `init_gig`; adoption tools and `initialize_integration` retain their names. Their adapters supply fixed discriminators to existing shared operations. Structured configuration batches, Project specifications, membership evidence, and cleanup proofs retain their complete nested alternatives. PR selection supplies its fixed resource internally.

`review/model.ts` resolves explicit overrides through Pi's public model resolver. Otherwise reviewers use the configured startup default, not the parent conversation model. Native command provenance locates the already-loaded Claude Code entry point, respecting native package resolution, resource filters, and trust. Both review paths use the shared launcher. The child retains `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-session`, and only `read,grep,find,ls`; it gains no write, Bash, Codemode, workflow, or MCP executor.

Skills, allowed-tool lists, active references, generated guidance, extension READMEs, and upgrade instructions use the new names. Explicit private permission selectors require user-reviewed updates; no private settings or credentials were changed automatically. See `workflows/references/tools.md` and `UPGRADING.md`.

## Context measurements

The controlled Pi 1.3.0 fixture captures actual native request declarations, including Codemode's complete generated description. A fresh read-only export of committed baseline source reproduces the original baseline exactly.

| Measurement | Baseline | Implemented |
| --- | ---: | ---: |
| Declared tools | 32 | 7 |
| Definition bytes, UTF-8 | 94,354 | 5,393 |
| Estimated definition tokens | 23,589 | 1,349 |

The implemented values remain unchanged across ordinary coding, discovery, setup, actual Gig initialization, Planning, Execution, Self-Review, submission-context preparation, reload, and session reopen/resume. Workflow schemas do not accumulate in later declarations. The submission-context probe uses a synthetic configured forge and makes no remote calls; it is not a real submission or final-review generation.

One native search plus typed description adds 2,262 bytes of tool-result content, approximately 566 estimated tokens, on demand. Those response bytes are separate from repeated tool-definition cost. Estimates use `ceil(JSON characters / 4)`; neither figure represents total context or billed tokens. Budgets concern the controlled package fixture, not arbitrary extra user packages. MCP coexistence is separately tested through an in-memory native transport.

## Verification

- `npm run typecheck` — passed.
- `npm test` — **641 passed, 0 failed**, 51 suites, approximately 200 seconds. Reverified with the `init_*` names. Includes heavy incoming-PR checkout/rebase, publication, cleanup, and review scenarios. The original baseline guidance mismatch now asserts the concrete current merge-argument contract.
- Registered inventory — 81 workflow operations, 86 package tools total; unique names within 50 characters; concrete object roots; recursive string-enum checks; required fields and strict alternatives retained.
- Pinned Claude Code bridge normalization — all 81 actual parameter schemas preserved byte-for-byte as JSON. Representative old schemas still reproduce the empty-root failure in the test-only fixture.
- GLM's OpenAI-compatible request conversion — exercised before network transport with the actual projected loadout; tested declarations remain below the 128-tool limit. This is not authenticated GLM generation.
- Native discovery/execution — typed descriptions, MCP coexistence, permission refusal and cancellation, explicit tool restrictions, real temporary initialization/Phase transitions, reload, and session reopen passed.
- Reviewer loading — override/default/pattern selection, provider availability/filtering/trust, local/npm/git-style provenance, and a real Pi subprocess with a fake provider passed. The subprocess allows reads and rejects unavailable write/Bash/Codemode tools.
- Targeted TypeScript formatting and `git diff --check` — passed.
- Private native-context probe — reproduced the baseline and measured real working-tree operations, discovery response overhead, and constant declaration budgets through reload/resume.

**Not run:**

- Authenticated Claude Code and GLM generation, including target-provider reviewer runs: no configured target models were available in the evaluation session. No provider installation, credential change, or default-model change was made.
- Neovim end-to-end workflow/edit-review checks: no interactive target-provider Neovim verification was performed. Native permission/file-review tests do not establish that UI result.
