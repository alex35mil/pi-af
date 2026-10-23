# Project setup configuration contract

This is the operational source of truth for files created or changed by project setup, whether entered through `/project-setup` or natural language. The setup skill owns the interactive sequence, this reference owns the configuration-file contract, and selected provider references own provider behavior.

## General rules

- Every workflow-owned JSON object rejects unlisted properties, contains no credentials, and ends with a newline.
- Workflow-owned JSON stores only operational fields.
- Preserve unrelated keys when merging into shared Pi settings files.
- Omit optional workflow files instead of writing empty, disabled, or placeholder configuration.
- Preview exact file content and exact ignore/exclude additions before writing them.
- Never stage files or alter the Git index.

## Read-only setup context

`/project-setup` and the agent-callable `inspect_project_setup` tool use the same inspector. The command supplies its snapshot in the kickoff prompt; natural-language setup calls the tool when no snapshot was supplied. The tool takes an empty argument object and returns the snapshot as JSON text and structured details without injecting a user message.

The snapshot contains `repositoryIdentity.githubCandidates` plus repository/setup-file contents, global and local workflow settings, exclusion and Git-membership facts, shallow tracker-binding summaries, and credential-redacted MCP registrations. Inspection works before configuration exists or while it is invalid; files remain untouched. Recognized official registrations expose credential environment-variable names, never token values or raw authorization headers. Reuse known references and ask only for genuinely missing information.

Repository candidates contain only validated GitHub `owner`, `repo`, and contributing `remotes` names from configured fetch URLs. Standard GitHub HTTPS, SCP-style SSH, and SSH URL forms are recognized, with optional `.git` suffixes; equivalent identities are deduplicated case-insensitively. Raw URLs, authentication, query strings, fragments, unsupported hosts/aliases, and non-GitHub remote contents never enter the snapshot. One distinct candidate supplies current-repository identity; multiple candidates require explicit selection; when there are no candidates, ask for repository identity. Directory names and push-only destinations do not determine identity. No default-branch inspection is performed.

Inspection performs no provider calls, file/index changes, artifact preparation, or configuration repair. Its inventory establishes configured registrations, not active tools. Registered-provider availability and existing provisioning/file approval gates remain separate; operational `integration_context` validation runs after valid approved configuration is saved.

## Project configuration

`.project/config.json` is required:

```json
{
    "artifacts": "versioned",
    "branches": { "format": "identifier-title" }
}
```

`artifacts` is exactly `versioned` or `unversioned`. The terminology contract in `./artifacts.md` defines artifact policy, Git membership, and local files.

`branches.format` stores one format string that applies to every Epic, Task, and Gig.

Allowed formats are:

- `tracker`
- `username/identifier-title`
- `username/identifier`
- `username-identifier-title`
- `username-identifier`
- `identifier-title`
- `title-identifier`
- `identifier`

Setup may select `tracker` only with a Linear tracker. It applies to every entity: Task/Gig use exact issue branch names, while Epic reconstructs the current Linear workspace template from read-only API data. GitHub and trackerless projects require a static format.

A static format beginning with `username` requires `branches.username` in global `~/<agent-dir>/workflows.json` or repository-local `.project/config.local.json`:

```json
{
    "branches": { "username": "alex" }
}
```

The local value overrides the global value. A username is non-empty and cannot contain `/`, carriage return, or newline. Never put it in committed `.project/config.json` or infer it from Git or provider identity.

To require a user confirmation checkpoint after consecutive blocked reviews, add this optional strict object:

```json
{
    "reviews": { "userConfirmationAfter": 3 }
}
```

`userConfirmationAfter` is a positive integer. Counting is separate for each entity and review phase. The threshold pauses immediately after the blocking review result and before its findings are corrected or verified. Omit the entire `reviews` object to disable this checkpoint; reviews still continue until approved.

## Workflow reporting source

To report workflow problems from any consuming project, set `workflowProject` in the existing private global `workflows.json`, located in Pi's resolved `getAgentDir()` directory:

```json
{
    "workflowProject": "/absolute/path/to/pi-af"
}
```

It references the workflow source repository root. Existing global `branches.username` may coexist; either field can appear alone. The global file stays outside Git, contains no credentials, and is not a consuming-project setting. `.project/config.local.json` remains branch-only and cannot override this reference.

`integration_context` operations `inspect` and `queueIntake` require `target: "current" | "workflow"`. `current` inspects the current repository and does not require the reference. `workflow` reads the referenced source's `.project/integrations.json` and `.project/config.json` using the existing tracker schema, artifact policy, validation, and read-only artifact-readiness checks. It returns the selected `target` and `projectRoot` alongside context. The path must identify the repository root; filesystem aliases are resolved consistently. Consuming-project setup is not a prerequisite for workflow-target inspection.

A missing reference errors: `Set workflowProject to the absolute workflow source repository root in <resolved-agent-dir>/workflows.json.` Invalid references or source configuration name their corrective location. Stop the attempt without setup questions, automatic repair, artifact preparation, or a fallback destination; the user leads any later configuration fix.

Use only the source tracker’s named MCP tools already registered in the reporting session under normal permissions. A tracker configuration does not prove provider access. Do not load or execute the source project's MCP settings or credentials. See [queue reporting](./queue.md#prepare-a-workflow-report) for the ordinary Todo intake and privacy/approval boundary.

## Integration configuration

`.project/integrations.json` contains independent optional `tracker` and `forge` roles. At least one role must exist when the file exists. Omit the file when both roles are absent.

Every role has a non-empty MCP server name containing only letters, digits, `_`, `.`, or `-`. GitHub repository identity is a non-empty `owner` and `repo`.

### Linear tracker

```json
{
    "tracker": {
        "provider": "linear",
        "mcpServer": "linear",
        "team": "Engineering",
        "phase": {
            "issues": {
                "scope": "workspace",
                "group": "Phase",
                "values": { "planning": "Planning", "execution": "Execution", "selfReview": "Self-Review" }
            },
            "projects": {
                "scope": "workspace",
                "group": "Phase",
                "values": { "planning": "Planning", "execution": "Execution", "selfReview": "Self-Review" }
            }
        },
        "statuses": {
            "issues": {
                "backlog": "Backlog",
                "todo": "Todo",
                "inProgress": "In Progress",
                "inReview": "In Review",
                "done": "Done",
                "canceled": "Canceled"
            },
            "projects": {
                "backlog": "Backlog",
                "todo": "Todo",
                "inProgress": "In Progress",
                "inReview": "In Review",
                "done": "Completed",
                "canceled": "Canceled"
            }
        }
    }
}
```

Issue and Project Status mappings each require all six queue/lifecycle keys and six distinct, non-empty provider option names. `team` is non-empty. Linear Priority is native and is not configured here.

Both Phase label-group mappings are required. Each has `scope: workspace | team`, one exact non-empty group name, and distinct non-empty child names for `planning`, `execution`, and `selfReview`. Team scope means the exact configured team; workspace scope means no team. Through registered Linear label reads, require the active applicable group and all three children, including issue single-select validation and pagination. Project-label groups are mutually exclusive by Linear's documented contract. Setup stays read-only and asks the user to configure missing/incompatible metadata. Follow `./phase.md` for runtime reconciliation and complete-label preservation.

During guided setup, `inspect_linear_workspace` reads the authenticated workspace, authenticated viewer, accessible teams, team issue statuses, Project statuses, and workspace branch template through Linear's public GraphQL API. `viewer.name` is Full Name; `viewer.displayName` is the workspace-unique Username/Nickname and is returned as `viewer.username`. The API performs no mutation. Setup persists only the exact team, status names, and Phase group scopes/names/child mappings the user selects; provider IDs, viewer identity, branch template, and credentials remain outside workflow configuration. A recognized official MCP registration supplies its credential environment-variable name, never its value.

Linear `tracker` supports only these exact workspace templates:

- `{username}/{issueIdentifier}-{issueTitle}`
- `{username}/{issueIdentifier}`
- `{username}-{issueIdentifier}-{issueTitle}`
- `{username}-{issueIdentifier}`
- `{issueIdentifier}-{issueTitle}`
- `{issueTitle}-{issueIdentifier}`
- `{issueIdentifier}`

For Task/Gig, use the exact provider-generated issue branch. For Epic, read the current template and viewer again during initialization, then substitute `viewer.username`, the lowercase workflow Epic ID for `{issueIdentifier}`, and the normalized Epic slug for `{issueTitle}`. Linear `tracker` never uses local/global workflow username settings. A null or different template is unsupported and is never normalized or approximated; the user must select a static format or correct Linear.

### GitHub tracker

Never hand-construct GitHub tracker configuration. Use the exact `trackerConfig` returned by the separately previewed and approved `provision_github_project` operation. It contains:

- `provider: "github"`, MCP server, and repository identity;
- Project owner, owner type (`user` or `org`), and positive Project URL number;
- one Project Status field with distinct non-empty mappings for `backlog`, `todo`, `inProgress`, `inReview`, `done`, and `canceled`;
- one Project Phase single-select field with distinct non-empty mappings for `planning`, `execution`, and `selfReview`;
- exact workflow-owned repository Kind label names for Epic and all six Deliverable kinds;
- Priority with `issue` or `project` scope, a non-empty field name, and unique non-empty values that exclude exact lowercase `not set`;
- Internal ID with `issue` or `project` scope and a non-empty field name.

All configured Project-scoped field names must be distinct. Kind label names must be distinct case-insensitively. Status and Phase are always Project-scoped. Phase projects initialized In Progress activity in both artifact modes; Kind classifies versioned GitHub issues through exactly one managed label after initialization. Native GitHub issue Type remains independent and unmanaged. Do not substitute other labels, Custom Properties, or a different field scope.

Example returned configuration for a Project-contained tracker (use actual provisioning output, not these sample identities):

```json
{
    "tracker": {
        "provider": "github",
        "mcpServer": "github",
        "repository": { "owner": "octocat", "repo": "example" },
        "project": { "owner": "octocat", "ownerType": "user", "number": 3 },
        "labels": {
            "kind": {
                "epic": "Kind: Epic",
                "deliverableKinds": {
                    "feature": "Kind: Feature",
                    "bugfix": "Kind: Bugfix",
                    "research": "Kind: Research",
                    "refactor": "Kind: Refactor",
                    "audit": "Kind: Audit",
                    "chore": "Kind: Chore"
                }
            }
        },
        "fields": {
            "status": {
                "field": "Status",
                "values": {
                    "backlog": "Backlog",
                    "todo": "Todo",
                    "inProgress": "In Progress",
                    "inReview": "In Review",
                    "done": "Done",
                    "canceled": "Canceled"
                }
            },
            "phase": {
                "field": "Phase",
                "values": { "planning": "Planning", "execution": "Execution", "selfReview": "Self-Review" }
            },
            "priority": {
                "scope": "project",
                "field": "Priority",
                "values": ["Urgent", "High", "Medium", "Low"]
            },
            "internalId": { "scope": "project", "field": "Internal ID" }
        }
    }
}
```

### GitHub Project presentation

Presentation is a setup-only input to `provision_github_project`, not runtime tracker configuration. `inspectRepository` takes `credentialEnv` and `repository` only, returning canonical repository owner/name, verified owner type, and `suggestedProjectTitle` equal to the repository name. Use this before the Project-owner question; unknown owner types or failed reads stop discovery. Explain that the Project owner contains the Project and controls access, and offer the verified repository owner before requesting another explicit owner. `inspect` then returns owner-level discovery, the title suggestion, and editable defaults. New Projects use that title unless explicitly overridden; the resolved exact title appears in preview before creation. Adopted titles remain unchanged. Personal repositories use Project-contained Priority/Internal ID without a scope question or organization metadata discovery; organization repositories retain explicit Project-contained, organization-native, or custom scope selection independently of Project owner type. Preview enforces repository ownership for issue-scoped inputs. `inspectProject` takes `credentialEnv`, `projectOwner`, and `projectNumber` and returns the selected Project's short description, fields, and views, with complete pagination. View reads include visible fields, grouping, columns, and sorting; default repository, field sum, slicing, and the Status field's default value (`defaultStatus`) are explicitly unavailable through the verified API.

Setup sets `ProjectV2.shortDescription` to `Repository: https://github.com/<owner>/<repo>` using the resolved setup repository, independently of the Project owner, layout, and repository-association/default-repository choices. The value is derived, not another specification input. Preview includes the exact text for new Projects and both current and replacement text for existing/resumed Projects; changes to that replacement invalidate prior hash approval. Apply writes only differing descriptions through `updateProjectV2`, then verifies exact read-back before reporting API success. Preserve the Project README (`readme`) and unrelated settings. Description URL clickability is not verified.

Every preview/apply specification includes:

```json
{
    "defaultRepository": "setup-repository",
    "presentation": {
        "target": { "mode": "initial" },
        "name": "Board",
        "layout": "board",
        "visibleFields": [
            { "kind": "field", "name": "Title" },
            { "kind": "field", "name": "Assignees" },
            { "kind": "workflow", "field": "status" },
            { "kind": "field", "name": "Linked pull requests" },
            { "kind": "field", "name": "Sub-issues progress" },
            { "kind": "field", "name": "Labels" },
            { "kind": "workflow", "field": "priority" },
            { "kind": "workflow", "field": "phase" }
        ]
    }
}
```

A new Project uses `initial`. For Board layout, create a new Board through REST, verify all configured settings, then delete only the captured, unchanged automatically generated default view. Capture its ID from the successful Project-create response and readable settings before subsequent provisioning; never identify it by title/number alone. No initial view requires no deletion; multiple initial views require explicit inspection and selection. Preserve user-created views. New table/roadmap layouts retain unique-initial-view configuration or creation when absent. Existing/resumed Projects require `target: { "mode": "selected", "viewId": "<exact selected ID>" }` from inspection. Layout supports `board`, `table`, or `roadmap`; roadmap requires an empty visible-field list. Board visible fields are an exact distinct selection: provider-returned permutations are equivalent in preview/hash approval, verification, recovery, and captured-default fingerprints. Missing, extra, or duplicate fields fail validation. GitHub's documented Board API/UI supports visibility, not a controllable card-field sequence; setup makes no Board field-order promise. Table views retain ordered-field matching. Semantic field references resolve configured names; missing or ambiguous fields block instead of being silently dropped. Internal ID stays provisioned but hidden; Kind is represented by repository labels. Fresh Board sorting requires the configured Priority field to be exposed on the Project even when not visible; hiding it is not a substitute for attaching issue-scoped Priority.

For an existing Priority field, its saved requested-option sequence must match the desired sequence forward or reversed. Other orders block preview before any setup writes. Organization Priority is checked before creating a new Project, using the [Issue Field API](https://docs.github.com/en/rest/orgs/issue-fields)'s numeric option priorities rather than response-array order. Missing or ambiguous priorities block as unverifiable; no array-order fallback is used. The conflict names the saved/desired order and the owning field settings: Project Settings → configured Priority for a Project field, or organization Issue Field settings for issue-backed Priority. Separately approve reordering existing options or changing the requested sequence, preserve every option value, then inspect and preview again. This is a field-wide change affecting other views; setup never performs it implicitly.

Repository association (`project.associateRepository`) and default repository are separate choices, both offered enabled for the setup repository. Association lists the Project in the repository's **Projects** tab; the default routes new issues created from the Project. `defaultRepository: unmanaged` skips changing that setting, without clearing it. Setting a default also links the repository, so `setup-repository` with `associateRepository: false` is blocked. Both opt-outs are valid. Before removing an existing association, inspect the default in the UI and resolve a default pointing to that repository; stop when its state cannot be confirmed.

Preview/hash approval covers exact view changes, resolved title/scopes, repository effects, and manual steps. A fresh Board preview explicitly includes REST creation with configured Status columns, no swimlanes, sole configured Priority sort/order, and deletion restricted to the captured unchanged default after verification. Existing/resumed Projects change only the selected view’s name/layout/visible fields, preserving its filter, grouping, sorting, and every other view; no view replacement/deletion occurs.

REST creation uses `/orgs/{org}/projectsV2/{project_number}/views` or `/users/{user_id}/projectsV2/{project_number}/views`, with the encoded owner login in both routes. The personal route’s `user_id` parameter takes the login, as verified by live Board creation. Send numeric provider field IDs, never decoded GraphQL node IDs: `visible_fields`, Status `vertical_group_by`, empty `group_by`, and sole Priority `sort_by` in the direction producing the configured option sequence. The personal endpoint does not support fine-grained or GitHub App tokens; permission/authentication errors stop provisioning rather than selecting another API. Missing numeric field identity or exposed sort fields also stops before view creation/deletion.

Setup failures identify the safe request method/path and current setup or provisioning stage, retaining HTTP status and useful provider error details. Board response-shape errors include the create request context. Verification identifies the missing/unexpected view or failed name, layout, field selection, column, grouping, or sort checks; field mismatches list missing, extra, or duplicate IDs. Unsuccessful create recovery reports candidate identities and mismatches alongside the original create failure. GraphQL requests identify `POST /graphql`; stage context locates the operation. Recovery-read failures retain the original failed-write context. Diagnostics exclude credentials, authorization headers, and request bodies; configured token text is redacted from provider messages. Preserve partial resources and investigate exact provider state instead of blindly retrying creation.

Verify the exact created view’s Project, name/layout/visible fields, columns, grouping, and sorting before cleanup. Confirm the Project is empty and the captured default unchanged, delete only that ID through `deleteProjectV2View`, and verify its absence and the Board’s continued correctness. An edited default, nonempty Project, or failed Board verification preserves views and requires inspection. Preserve unrelated views added during setup.

After an unexpected or lost Board-create response, recover only one newly appeared view matching the approved Board; zero or multiple matches stop without another create or deletion. Reconcile uncertain deletion through exact view-state reads. After a failed or interrupted apply, inspect the confirmed Project and explicitly select its existing Board using `resume-created`, then approve a fresh preview/hash. This route only updates that selected view, preserves its other settings and all other views, and never infers default-view provenance or deletion permission from an earlier invocation. A lost Project-create response cannot establish default-view provenance: report the confirmed Project and require explicit `resume-created` inspection/selection, without deleting any view. Preserve partial work after failures. Apply returns `state: provisioned` for verified API configuration only, with a separate manual-confirmation requirement. Use only `trackerConfig` in `.project/integrations.json`.

#### Guided UI steps

The documented GraphQL view update supports name, layout, filter, and visible fields. Current MCP has the same update boundary. REST view creation additionally configures grouping/sorting for fresh Boards; adopted/resumed views retain their update path rather than being replaced. The setup tool returns these manual steps with the Project/view links. Steps 1–3 apply only to existing/resumed views and the applicable new table/roadmap path; a verified fresh Board requires only steps 4–7:

1. Open the selected view → **View** → **Column by** (also called **Column field**) → configured Status. For Board layout only.
2. **View** → **Swimlanes** (also called **Group by**) → **No grouping**.
3. **View** → **Sort by** → configured Priority only. Choose the direction placing **Urgent → High → Medium → Low**; custom Priority options follow the selected metadata order. Save and verify the actual order, not just the icon.
4. **View** → **Field sum** → **Count** only.
5. **View** → **Slice by** → **No slicing**.
6. Only with `defaultRepository: setup-repository`: Project menu → **Settings** → **Default repository** → setup repository → **Save changes**. This also links it.
7. For every Project mode/layout: Project menu → **Settings** → configured Status field → **Default value** → configured Backlog option → save. The `defaultStatus` manual follow-up note explains that available MCP tools and documented public APIs do not expose a setter, so this default was not applied automatically. Use the returned Project link, not a view option. Leave built-in automations and existing item values unchanged.

Save the view and reopen its options to confirm steps 1–5; reload Settings to confirm steps 6–7. Re-read API-visible settings after manual changes; field sum, slicing, default repository, and the saved Status-field default require user confirmation or a screenshot of saved state. Do not claim full setup complete while required manual work remains unconfirmed. Opting out omits step 6 and its completion requirement; step 7 remains required.

Capability sources: [native field defaults](https://github.blog/changelog/2026-04-09-release-info-in-issue-sidebar-and-project-defaults/), [GraphQL Projects](https://docs.github.com/en/graphql/reference/projects), [REST view creation](https://docs.github.com/en/rest/projects/views), [Board customization](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout), and [default repository](https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/adding-your-project-to-a-repository). Use only documented APIs; repository association is not proof of the default repository.

### GitHub forge

```json
{
    "forge": {
        "provider": "github",
        "mcpServer": "github",
        "repository": {
            "owner": "octocat",
            "repo": "example"
        }
    }
}
```

When tracker and forge are both configured, place both role objects in the same integration object. Their servers and repositories follow the user's selections.

### Fork-only incoming PR intake

With a configured GitHub forge and GitHub Project, offer an explicit opt-in for [fork-only automatic intake](./pr/automation.md). Use `render_incoming_pr_intake` with the selected exact `forge`, `tracker` and `tokenSecret` name. It makes no provider or filesystem changes and returns one canonical `.github/workflows/incoming-pr-project.yml` candidate plus activation prerequisites. Include that exact file/diff in the bounded setup proposal; preserve other workflows and unmentioned configuration. Decline preserves existing files rather than enabling, deleting or disabling automation. For an existing setup, change only the requested automation scope, without reprovisioning unrelated Project fields/views.

The workflow uses trusted default-branch metadata handling for fork PR opened/reopened events. It excludes same-repository PRs, including Deliverables, and adds only the actual PR's membership to the selected Project. The Project's already-required native Status default supplies the configured Backlog option to new items. No Status writer is generated; reruns return the existing item and cannot requeue In Review/terminal work. No checkout, contributor-code execution, installs, caches, private .project paths, workflow IDs or credential values belong in the file.

The only credential input is a GitHub-valid Actions secret name with Project API and required repository PR-read access. The token value is supplied by the operator through GitHub, not by setup; never inspect/copy an MCP token, commit credentials, create secrets or silently reuse GITHUB_TOKEN/Git SSH authorization. Use the renderer's full-commit-pinned trusted action and safe static script; do not reconstruct executable code from PR text.

Before declaring automation active, require confirmation of the native Backlog field default, selected secret/access, applicable pull_request_target event policy, and deployment through the repository's normal default-branch process. Inspect existing broad auto-add/Status rules with the user; changing them or event policies requires its own explicit scope. No automatic secret/policy changes, workflow runs or PR/Project-item probes are setup actions. Rendering or approving/writing a local file is prepared/pending, not active deployment. Same-repository or older PRs can still use explicit /pr intake; no automatic bulk backfill is included.

## Artifact persistence

Read and follow `./artifacts.md` for the canonical persistence and authority contract, including exact ignore/exclude rules, Git-membership checks, and both mode transitions. For manual setup, create the configuration above, apply that contract's setup rule, then call `prepare_artifacts`. Call preparation again after configuration changes.

## MCP registrations

MCP settings are shared Pi configuration, not workflow JSON. Use `configure_mcp`; do not compose server transport entries manually. It preserves unrelated settings and writes only environment-variable references.

- Local target: `.agents/mcp.local.json`, with `mcpServers`; add exact `/.agents/mcp.local.json` to `.git/info/exclude`.
- Project target: `.agents/mcp.json`, with `mcpServers`.
- Linear default credential variable: `LINEAR_API_KEY`.
- GitHub default credential variable: `GITHUB_PERSONAL_ACCESS_TOKEN`.
- GitHub tracker enables `issues,projects`; GitHub forge enables `pull_requests`; selecting both enables all three.

Global configuration is `<agent-dir>/mcp.json`, also with `mcpServers`. The adapter merges global, committed project, then local entries by exact name; later entries replace earlier entries. Both project tiers require trust. Every effective server is registered through `pi.registerMcpServer()` and native Pi owns its transport. Names differing only by `-` and `_` conflict. Preserve private project scope; never move a local registration into global settings. Inspection uses the same merge without executing credential commands or opening provider connections. Native `/mcp` enabled/exposure changes to these registrations last for the session.

A new registration requires Pi restart or reload before setup validates capabilities and writes workflow configuration. The setup snapshot may report provider and credential environment-variable names for recognized official registrations; it never reports authorization header values or credential values. Untrusted-project inspection does not read project MCP files.

Example project registrations produced by `configure_mcp` for the supported providers:

```json
{
    "mcpServers": {
        "linear": {
            "url": "https://mcp.linear.app/mcp",
            "headers": { "Authorization": "Bearer ${LINEAR_API_KEY}" }
        },
        "github": {
            "url": "https://api.githubcopilot.com/mcp/",
            "headers": {
                "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}",
                "X-MCP-Toolsets": "issues,projects,pull_requests"
            }
        }
    }
}
```

## Project Policies

`.project/policies.md` is optional Markdown containing user-approved repository-specific additions or overrides to these Epic/Task/Gig workflows. Each policy names the workflow stage or behavior it affects and states what it adds or replaces. Generic repository instructions belong in `AGENTS.md` or the harness-equivalent instruction file; provider configuration belongs in the setup JSON files. Omit policies when the user declines them. Follow `./artifacts.md` for policy precedence, overrides, and persistence.

Example:

```markdown
# Project Policies

- During Epic plan review, additionally check that every prospective Task identifies its rollout stage.
- During Deliverable final review, additionally check the completion artifact against the repository's release checklist.
- Override automatic submission after final-artifact acceptance: commit locally, then wait for a separate explicit user request before pushing or creating a PR.
```

## Integration convenience permissions

Offer these independently selectable options only for selected active integration providers, replacing `<server>` with the exact selected MCP server name. Deduplicate shared tracker/forge servers. Number choices, include decline-all, explain access beside each choice, and recommend the frequent tracker writes to avoid repeated Status/Phase and plan-publication prompts.

| Selected role/provider        | Recommended allow               | Access and frequent use                                                                                                                                                         |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any active integration server | `mcp(<server>, hint: readOnly)` | All tools advertised by that server with explicit `readOnlyHint: true`; useful for repeated tracker/PR reads. Trusts the server's annotation; missing/false hints do not match. |
| GitHub tracker                | `mcp(<server>, projects_write)` | Entire Project mutation tool, including item/field updates for Status/Phase/Internal ID and its other supported mutations.                                                      |
| GitHub tracker                | `mcp(<server>, issue_write)`    | Entire issue create/update tool, including body, labels, fields, and state; useful for intake and plan publication.                                                             |
| Linear tracker                | `mcp(<server>, save_issue)`     | Entire issue save tool, including creation, descriptions, labels, lifecycle, priority, and relationships.                                                                       |
| Linear tracker                | `mcp(<server>, save_project)`   | Entire Project save tool for Epics, including creation, description, labels, lifecycle, priority, and other supported updates.                                                  |

A forge-only GitHub server gets read-only access, not tracker write recommendations. Omit inactive servers and unavailable tools. Do not recommend whole-server write wildcards, PR merge allows, or unrelated writes. These rules are not restricted by tool arguments, repository, or Project: they cover the server credential's accessible resources. Tool permissions remove prompts, not workflow content, submission, or finish approval gates. Existing permissions are not revoked.

Before offering new rules, call `inspect_permissions` with `{ "rules": ["mcp(<server>, hint: readOnly)", "mcp(<server>, issue_write)"] }`, using only the selected providers' candidates. This read-only tool uses live advertised metadata and the permission engine's global/project/local loading and matcher; it makes no provider call and changes no files. Required workflow read tools lacking true annotations remain uncovered: inspect their exact selectors as needed to report that limitation, without automatically granting those diagnostic selectors.

Results contain each candidate's `status`, `coveredBy` source rules, currently matching `tools` with existing modes and `blockers`, and `unverifiedConflicts` where overlap lacks metadata. These are persistent settings only; session overrides and skill-derived allows are excluded. Read-only rules cover future tools that the server annotates true; inspection describes only currently advertised tools and does not promise future annotations.

| Result                        | Setup/merge behavior                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `covered`                     | An equivalent or broader existing allow proves selector coverage. Skip the addition; still report ask/deny blockers. |
| `available`, no blockers      | Offer the new allow for explicit user selection.                                                                     |
| `available`, partial blockers | Offer only with disclosure that listed tools remain asked/denied; the broad rule benefits the remaining tools.       |
| `blocked`                     | All currently matching tools have ask/deny blockers. Report them and skip the ineffective addition.                  |
| `unavailable`                 | No advertised tool matches. Skip; do not claim access, even when a covering persistent rule exists.                  |

Coverage uses selector containment, including equivalent internal spacing, server/tool wildcards, and verified annotations for hint-to-exact coverage. Exact allows for all today's read tools do not cover a future-facing read-only selector. Deny wins over ask, which wins over allow. Preserve all existing rule strings, order, and ask/deny constraints; report blockers with their source paths and never silently weaken them. Unverified overlap is not a proven match.

After user selection, ask once for local or project permission persistence independently of artifact/MCP persistence. Preview exact `allow`/`ask` additions, skipped rules, conflicts, target, and local exclusion before approval. Then call `configure_permissions` with strict `{ target: "project" | "local", allow: string[], ask: string[] }`; both lists are explicit and at least one requested rule is required. Only MCP selectors are accepted as new allows. Use `[]` for an unselected list. Declining all new rules calls no permission writer.

The writer rechecks current persistent settings and live metadata, skips covered/blocked/unavailable allows and exact target-file ask duplicates, and merges only accepted additions. It reports actual `added`, `skipped`, and `inspection` results, preserving unrelated keys, default mode, keybindings, deny rules, and existing lists. Invalid settings/rules fail before mutation. A no-op leaves files and permission exclusions untouched. Read-back validates the result; a skipped rule is not a new grant.

## Accepted-artifact permission gates

Workflow skills allow routine `.project/` bookkeeping. Offer explicit artifact diff gates independently of integration allows. When accepted, merge the exact gates through the same `configure_permissions` call; use repository-relative workflow paths so the gates match consistently. This ask-only example uses an empty allow list:

```json
{
    "target": "local",
    "allow": [],
    "ask": [
        "write(.project/*/epic.md)",
        "edit(.project/*/epic.md)",
        "write(.project/*/plan.md)",
        "edit(.project/*/plan.md)",
        "write(.project/*/result.md)",
        "edit(.project/*/result.md)",
        "write(.project/*/report.md)",
        "edit(.project/*/report.md)"
    ]
}
```

The target is either committed `.agents/permissions.json` (`project`) or local `.agents/permissions.local.json` (`local`). Before changing local settings, the tool verifies that the file is outside Git and ensures exact `/.agents/permissions.local.json` in `.git/info/exclude`; it never changes the index. A no-op adds no exclusion. Artifact persistence and permission-settings persistence are separate user decisions.
