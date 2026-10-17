# Plan

## Overview

Project setup will reuse the current repository’s verified GitHub identity instead of asking users to repeat it. It will explain Project ownership, offer the repository owner, default a new Project’s title to the repository name with an explicit override, and omit unsupported metadata-scope choices for personal repositories.

New empty Projects using Board layout will get a REST-created Board with configured Status columns, no swimlanes, and the requested Priority order. Setup will verify that Board before deleting only the automatically generated initial view identified during creation. Adopted Projects and user-created views remain protected.

### Plan highlights

- Supply credential-safe GitHub repository candidates in both command and tool snapshots; ask only for missing or ambiguous identity.
- Verify repository ownership before offering Project owners and metadata models. Personal repositories use Project-contained Priority and Internal ID without a scope question.
- Include the resolved title, field scopes, Board creation/settings, and narrowly limited default-view deletion in the exact provisioning preview.
- Keep Count, slicing, and default repository manual. Existing/resumed Projects retain selected-view updates and their current manual grouping/sorting steps.

## Root cause

### Symptom

Starting GitHub setup in an existing checkout requires repeating repository identity, interpreting an unexplained Project owner question, naming a Project without a repository-name default, and considering unsupported field scopes. A new Board also requires manual configuration of settings supported by REST view creation.

### Evidence

- `workflows/extensions/project-setup/index.ts`: `inspectProjectSetup` supplies repository root, setup files, MCP registrations, and Git safety facts, but no remote-derived identity. A read-only runtime probe confirmed that the returned snapshot has no repository identity.
- `workflows/skills/project-setup/SKILL.md` prohibits additional shell/Git discovery, then asks for repository/Project owner, exact title, and one of three metadata models without a personal-repository branch.
- `workflows/extensions/project-setup/github-project.ts`: `inspect` requires a Project owner before it can return repository owner type; `getRepository` reads that type through REST. This prevents the existing combined discovery call from resolving repository ownership ahead of the Project-owner question.
- `provisionProjectView` updates the unique initial view through GraphQL, or creates a GraphQL view when none exists. Its update and verification cover name, layout, and visible fields only. `manualStepsFor` always delegates grouping and sorting to the user.
- GitHub REST view creation documents `visible_fields`, `sort_by`, `group_by`, and `vertical_group_by`, including separate organization and numeric-user-ID routes. GraphQL documents `deleteProjectV2View` and readable view grouping, columns, and sorting.
- Baseline: `node --import tsx --test tests/workflow-project-config.test.ts tests/workflow-github-project-setup.test.ts` passed all 55 tests.

### Cause

The shared snapshot lacks repository identity, guided inquiry does not distinguish verified repository capabilities, and provisioning models initial setup as an existing-view update rather than fresh-view creation. The update API’s narrower capabilities are consequently imposed on fresh Projects too.

### Proposed fix and ownership

Fix the shared inspector, staged GitHub setup discovery, provisioning/verification, and their consuming instructions together. Both command and tool use the inspector; the setup skill consumes discovery facts; preview/apply share the provisioning model. Runtime tracker configuration and workflow lifecycle operations do not need new fields or migrations.

## Repository discovery and guided inquiry

1. Extend `inspectProjectSetup` with repository-identity facts derived from configured fetch remotes. Recognize standard GitHub HTTPS, SCP-style SSH, and SSH URL forms, with an optional `.git` suffix. Return only remote names and validated `owner`/`repo` identities, not raw URLs, authentication, query strings, fragments, or unrecognized remote contents. Do not inspect the default branch or contact a provider.
2. Deduplicate equivalent GitHub identities across remotes. One distinct identity supplies the current-repository candidate. Multiple distinct identities require explicit selection; no GitHub identity requires user input. Do not infer identity from a directory name, choose between fork/upstream repositories, or guess SSH host aliases.
3. Add a read-only `inspectRepository` operation to the existing provisioning tool, taking only credential environment and repository identity. Return canonical repository owner/name and verified owner type from GitHub, plus the repository-name title default. Retain `inspect` for owner-scoped Project discovery and `inspectProject` for selected-Project/view inspection. These are separate discovery stages, not fallback paths.
4. Explain that the Project owner is the GitHub account or organization that contains the Project and controls its access. Offer reuse of the verified repository owner and allow another explicit owner. Ask for only the missing owner details; never infer user-versus-organization type from a login string.
5. For new Projects, offer the verified repository name as the title default and allow an explicit override; continue asking visibility. Put the resolved exact title in the provisioning specification and preview before creation. Preserve existing titles during adoption.
6. For a verified personal repository, explain that organization Issue Fields are unavailable and use Project-contained Priority/Internal ID. Do not ask a scope question or enumerate organization metadata. Include both resolved scopes in the approval preview. For organization repositories, retain the three existing metadata-model choices and opt-in Issue Field discovery regardless of Project owner type.
7. Reuse the same repository/server for the forge when selected, without asking for known identity again. Keep the existing small, numbered inquiry batches, provider approval, and file-writing gates.

## Provisioning decision table

| Case | View operation | Deletion | Manual settings |
| --- | --- | --- | --- |
| Freshly created empty Project, Board layout | Create configured Board through REST; verify full settings | Only the captured, unchanged automatically generated default view, after Board verification | Count, slicing, and selected default repository |
| Fresh Project with no initial view | Create and verify Board through REST | None | Same as above |
| Initial-view identity is ambiguous, Project is no longer empty, or captured default view was edited | Stop automatic cleanup and report exact state; preserve views | None | Continue only after explicit inspection and renewed approval where needed |
| Existing or `resume-created` Project | Update only the explicitly selected view’s name/layout/visible fields through the existing GraphQL path; preserve filter/grouping/sorting and all other views | None | Existing grouping/columns/sorting steps, Count, slicing, selected default repository |
| New Project with table or roadmap layout | Retain current initial-view configuration path and visible-field constraints | None | Existing applicable manual steps |
| Personal repository with issue-scoped metadata supplied directly | Block preview using verified repository type | None | Resolve input; never silently change scope |
| Organization repository | Preserve existing explicit Project-contained/organization-native/custom choice | As above by Project/view mode | As above |

## Fresh Board creation and verification

- Represent fresh Board creation separately from selected-view update in the internal provisioning actions. Preview/hash approval explicitly describes REST creation, configured Status columns, empty horizontal grouping, sole Priority sort and requested option sequence, and deletion restricted to the initial default view of the newly created Project. Preserve all existing field/label/association/visibility effects in the preview.
- Capture initial view identity as part of the successful Project-creation response, before subsequent provisioning work. A unique initial view from that creation is the only deletion candidate; do not classify views by title or number alone. Capture its complete readable settings before work and preserve it when those settings change. Multiple initial views require explicit inspection rather than choosing one.
- Obtain numeric field IDs through documented provider fields, never by decoding opaque GraphQL node IDs. Resolve the user-owned REST route with the owner’s documented numeric user ID; use the organization login for organization-owned Projects. Missing required identifiers stop before Board creation/deletion with a precise error.
- Resolve configured Status and Priority by exact name and Project/issue origin, including hidden Priority fields. Continue blocking missing, ambiguous, or incompatible metadata. Use native option order (Project option sequence or organization Issue Field numeric priorities) to select ascending or descending sorting that produces the configured Priority sequence. Preserve unrelated options and never reorder existing fields implicitly.
- POST the approved name/layout/visible field IDs, Status `vertical_group_by`, empty `group_by`, and sole Priority `sort_by` to the documented REST route. Read back by the exact returned view identity and verify all of those settings and Project membership.
- Before deleting the captured default, confirm the Project remains empty and that the deletion candidate remains unchanged. Delete only that ID through `deleteProjectV2View`, then verify absence and the continued existence/correctness of the configured Board. Preserve unrelated views added during provisioning.
- On a lost REST-create response, compare with the pre-create view IDs and accept only one newly appeared, fully matching Board. Never blindly retry creation or treat the default as a created Board. Uncertain deletion is reconciled by exact view-state reads. Verification failure preserves the default view and partial Project.
- When Project creation itself has an uncertain response and default-view provenance cannot be established, retain the existing exact-title Project recovery boundary but stop fresh-Board cleanup. Report the confirmed Project and require inspected `resume-created` selection; do not infer a deletable default on a later invocation.
- Return only genuinely remaining manual steps for the executed path. A fresh Board verified through the API no longer asks users to configure columns, swimlanes, or sorting. Count, slicing, and default repository still require user confirmation; `state: provisioned` never means manual completion.

## Credible failure cases and cost

The ordinary setup flow currently withholds existing facts and delegates supported operations to users, so these failures are deterministic rather than timing-dependent. Shared discovery and creation-mode separation directly remove that friction without changing runtime configuration.

Remote URLs can contain credentials during normal Git setup. Adding them verbatim to a model-visible snapshot would expose secrets immediately; extracting only validated GitHub identity avoids that leak at low implementation cost.

A provider write can succeed and its response can be lost through a network/API failure; the existing code and tests already model this supported failure boundary. Creation followed by a blind retry could produce duplicate Boards, and deletion before verification could remove the only usable view. Captured identities, full read-back, and create-before-delete ordering handle those concrete outcomes without persistent checkpoints or speculative retry machinery. Existing/adopted Project preservation takes precedence over automatic cleanup when provenance is absent.

## Affected files

- `workflows/extensions/project-setup/index.ts`: shared safe remote identity and updated tool-facing descriptions where needed.
- `workflows/extensions/project-setup/github-project.ts`: staged repository inspection, strict ownership facts, explicit fresh-Board action, documented REST creation/numeric identity, GraphQL deletion, full verification/recovery, path-specific manual steps.
- `workflows/skills/project-setup/SKILL.md`: verified-fact reuse, explained owner choice, repository-name title default, ownership-filtered inquiry, new-Board versus selected-view behavior.
- `workflows/references/setup.md`: snapshot/discovery and presentation contracts, supported automation, deletion safety, recovery and manual boundaries.
- `workflows/extensions/project-setup/README.md`: accurate extension overview.
- `tests/workflow-project-config.test.ts`: command/tool snapshot identity, remote formats, ambiguous/missing identity, credential safety, unchanged files/index.
- `tests/workflow-github-project-setup.test.ts`: staged ownership discovery, title/default inputs, personal-scope rejection, REST routes and payloads, numeric IDs, complete settings verification, deletion ordering and protection, lost-response recovery, preserved selected-view/table/roadmap behavior, remaining manual steps.
- Update directly affected assertions in `tests/workflow-instructions.test.ts` only as necessary for changed contracts; do not add broad prose-presence tests or rewrite completed artifacts.

## Verify

- Run the focused setup suites and instruction tests with `node --import tsx --test tests/workflow-project-config.test.ts tests/workflow-github-project-setup.test.ts tests/workflow-instructions.test.ts`.
- Run `npm test`, `npx tsc --noEmit`, and formatting checks on changed source/test/docs files; report baseline failures separately from regressions.
- Check snapshots and errors for credential exclusion and confirm the command/tool share identical read-only context without changing files/index.
- Exercise fake-provider integration tests for personal and organization routes, forward/reversed/custom Priority options, renamed fields, hidden Priority, creation/read-back/deletion failures, and preservation of unrelated/adopted views. Fake responses must match documented REST wrappers, numeric IDs, and GraphQL fields rather than decoding invented node IDs.
- Manually walk the skill’s decision branches: one known repository, missing/ambiguous identity, personal versus organization ownership, default versus overridden title, fresh Board versus adopted view, and remaining manual confirmation. Match instructions to executable discovery and preview output.
- Do not create/delete a real GitHub Project or view as part of verification without separate exact provider approval. Report live create/verify/delete as not run when that approval has not been given.
