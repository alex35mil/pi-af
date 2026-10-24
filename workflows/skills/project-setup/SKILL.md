---
name: project-setup
description: "Use to interactively initialize or reconfigure Epic/Task/Gig workflows for a repository, including artifacts, branch naming, optional integrations, and Project Policies."
allowed-tools:
    - "inspect_project_setup"
    - "prepare_artifacts"
    - "configure_mcp"
    - "inspect_permissions"
    - "configure_permissions"
    - "inspect_linear_workspace"
    - "provision_github_project"
    - "render_incoming_pr_intake"
    - "integration_context"
    - "read(.project/*)"
    - "write(.project/*)"
    - "edit(.project/*)"
    - "read(.gitignore)"
    - "read(.git/info/exclude)"
    - "read(.agents/permissions.json)"
    - "read(.agents/permissions.local.json)"
---

# Project setup

Interactively configure the repository for Epic/Task/Gig workflows. Setup may inspect Linear read-only through `inspect_linear_workspace`, inspect GitHub, and—only through an exact separately approved `provision_github_project` preview—create or complete GitHub Project configuration. Never initialize an entity, mutate Linear, mutate GitHub work items or pull requests, stage files, alter the Git index, commit, or push.

Read `../../references/setup.md` for the configuration-file contract. When integrations are requested, also read `../../references/integrations/shared.md` and the selected provider behavior from `../../references/integrations/tracker/github.md`, `../../references/integrations/tracker/linear.md`, or `../../references/integrations/forge/github.md`.

## Inspect first

`/project-setup` supplies a deterministic read-only snapshot containing the repository root, credential-safe GitHub identities from fetch remotes in `repositoryIdentity.githubCandidates`, exact setup files, global and repository-local workflow settings, `.git/info/exclude` state, `.project` paths in Git or staged, bound entity tracker summaries, and a credential-redacted inventory of global, committed-project, and local MCP registrations. Recognized official registrations may expose their environment-variable name but never its value. Use that snapshot directly. Do not repeat its Git checks through Bash or another shell command. The default branch is irrelevant to setup and must not be inspected.

For a natural-language invocation without the command snapshot, call `inspect_project_setup` before asking setup questions. It returns the same read-only context through the same inspector, including missing or invalid setup files that need reconfiguration. Reuse a supplied snapshot rather than inspecting twice. Use its effective MCP inventory and recognized credential environment references instead of asking for known names. Ask only for genuinely missing information. Do not run Git or shell discovery; the snapshot supplies observed Git facts, while `prepare_artifacts` forces setup's persistence validation and permitted exclusion preparation. Routine workflow tools use the shared operational guard.

Before asking questions:

1. If setup already exists, summarize it and ask which exact parts the user wants changed. Preserve every unmentioned value. When `boundEntityTrackers` contains GitHub work, never replace its configured Project; explain that the user must direct a separate migration.
2. Do not overwrite or silently replace existing setup files.
3. Ask only the current setup decision. Do not mention or preview later optional decisions. Introduce Project Policies only when their final dedicated question is reached, and do not inspect the broader repository for policy ideas unless the user accepts that help.

## Decision tables

### Artifact persistence

| Choice        | Meaning                                        |
| ------------- | ---------------------------------------------- |
| `versioned`   | Durable `.project/` artifacts belong in Git    |
| `unversioned` | Every `.project/` artifact remains outside Git |

Read and follow `../../references/artifacts.md` for exact setup actions and transition blockers. Removal from Git requires separate explicit approval and is outside setup.

### Blocked-review confirmation

| Choice                 | Configuration                                         |
| ---------------------- | ----------------------------------------------------- |
| Disabled               | Omit `reviews`                                        |
| Enabled after N blocks | `reviews.userConfirmationAfter` is positive integer N |

Counting is separate for each entity and review phase. The checkpoint stops immediately after the threshold blocking result and before correcting that round. Reviews continue until approved whether or not this checkpoint is configured.

### Integration roles

| Role    | Choices              | Owns                                                                                      |
| ------- | -------------------- | ----------------------------------------------------------------------------------------- |
| tracker | none, GitHub, Linear | backlog/work objects, lifecycle, priority, hierarchy, accepted task-definition projection |
| forge   | none, GitHub         | pull requests                                                                             |

Either role may be configured alone. Omit `.project/integrations.json` when both are none. Never create placeholder, disabled, or secret-bearing configuration. Select the tracker provider before asking about branch naming; forge selection does not affect branch options.

### MCP registration

After integration providers are selected, use the snapshot's effective MCP inventory to select configured servers and reuse their recognized credential environment-variable names. That inventory describes configuration, not active tool availability. Establish selected-provider availability through its registered provider tools under normal permissions. Operational `integration_context` validation belongs after approved, valid workflow configuration is saved.

For each provider, reuse a suitable active MCP server when one exists; ask the user to select it when multiple names are suitable. A configured but inactive server is not usable: report it and stop for authentication/configuration correction rather than silently replacing it.

When one or more required providers have no configured server, offer to add their official servers. Before asking for any MCP server name, credential variable, or provider-specific configuration, ask one shared persistence question for all new MCP registrations:

1. Private local checkout configuration (`local`) — `.agents/mcp.local.json`, using `mcpServers`
2. Committed project configuration (`project`) — `.agents/mcp.json`, using `mcpServers`

The adapter merges global, project, then local entries by exact name and registers every effective server through `pi.registerMcpServer()`. Later entries replace earlier entries; normalized-name conflicts are errors. Keep private registrations project-scoped; never move them into global configuration. Project trust is required before reading or configuring either project tier.

Accept the number or exact value, confirm the interpreted selection as muted context, and apply it to every new MCP registration in this setup. Never infer the persistence choice or ask it again per provider. Only then ask for each missing server's name and credential environment-variable name. Both forms contain only an environment-variable reference, never a credential. Default credential variable names are `LINEAR_API_KEY` and `GITHUB_PERSONAL_ACCESS_TOKEN`, but the user may provide another valid environment-variable name.

Before adding registrations, preview the exact server entries, shared target file, and—when local is selected—the exact `/.agents/mcp.local.json` append to `.git/info/exclude`. Obtain explicit approval, then call `configure_mcp`. This tool preserves unrelated settings, rejects conflicting names, never changes the Git index, and enables only `issues,projects` for a GitHub tracker plus `pull_requests` for a GitHub forge.

New MCP registrations are unavailable to the running Pi session. When `configure_mcp` reports `restartRequired`, make no `.project` writes: tell the user which environment variables must be exported, then instruct them to reload or restart Pi and restore this current session. Do not tell them to open an empty session or run `/project-setup` again; the restored conversation contains the approved answers needed to continue. After restoration, refresh the configured inventory with `inspect_project_setup`, continue from the next unanswered setup decision, and proceed only when the selected registered provider tools are available under normal permissions.

### Branch naming

| Selected tracker and choice | Project-wide format                                 |
| --------------------------- | --------------------------------------------------- |
| none                        | user-selected static format                         |
| GitHub                      | user-selected static format                         |
| Linear, use Linear naming   | `tracker` for Epic, Task, and Gig                   |
| Linear, use workflow naming | user-selected static format for Epic, Task, and Gig |

For no tracker or GitHub, offer `identifier-title` as the neutral default and ask for one static format.

For Linear, ask whether all workflow branches should use Linear's naming:

1. Use Linear branch naming (`tracker`)
2. Use one static workflow format (`static`)

When `tracker` is selected, require the prior `inspect_linear_workspace` result to have a supported template and a recognized credential environment reference on the configured Linear MCP registration. Persist exactly `"branches": { "format": "tracker" }`. Explain that Task/Gig use exact issue `gitBranchName`; Epic initialization reads current Linear branch settings again and reconstructs that template using the current `viewer.username`, lowercase workflow Epic ID, and normalized Epic slug. Do not ask for or read local/global workflow username settings. For an unsupported template or unavailable credential reference, require the user to select a static format, correct Linear/MCP configuration, or rerun inspection; never normalize or approximate the template.

When `static` is selected, offer `identifier-title` as the neutral default and ask for one format used by Epic, Task, and Gig. Persist the selected format once at `branches.format`.

Present all seven static formats from `../../references/setup.md` as numbered choices.

When the selected static format begins with `username`, use the repository-local `.project/config.local.json` username when present, otherwise the global `workflows.json` username. If neither exists, ask for it and propose strict `.project/config.local.json` with `{ "branches": { "username": "<value>" } }`. Never store username in committed `.project/config.json`, infer it from Git/provider identity, or ask for it for `tracker` or a static format without `username`.

## Guided inquiry

Ask small coherent question batches and explain consequences before asking for a choice. For every finite choice:

- present selectable options as a numbered list, never an unordered bullet list;
- accept either the displayed number or the exact displayed label/config value;
- state each interpreted selection as muted context before continuing, using a Markdown blockquote such as `> ✓ Tracker: Linear (\`linear\`)`;
- leave a blank line between that blockquote and the next question;
- ask separate questions when reusing numbers in one message could make the reply ambiguous.

For example:

1. Versioned (`versioned`)
2. Unversioned (`unversioned`)

Ask the setup decisions in this order:

1. Artifact persistence.
2. Tracker and forge roles plus provider choices.
3. Reuse or bootstrap required MCP registrations; restart and resume when new registrations are added.
4. For Linear, run the read-only public API inspection below.
5. Branch naming, filtered by the selected tracker provider and informed by Linear inspection when applicable.
6. Exact provider configuration, only for selected roles; once GitHub forge and Project are known, offer optional fork-only incoming PR intake.
7. Whether to enable user confirmation after a positive number of consecutive blocked reviews. Disabled omits `reviews`; never write `false`, zero, or an empty object.
8. Optional Project Policies, then integration convenience permissions and independently selectable accepted-artifact diff gates.

For a Linear tracker, obtain the credential environment-variable name from the recognized effective MCP registration when available; otherwise ask only for an environment-variable name, never its value. Call `inspect_linear_workspace` after the MCP server is active and before branch naming. The operation reads only workspace identity, authenticated viewer Full Name and Username, accessible teams, team issue statuses, applicable Project statuses, and the workspace branch template. A missing variable, denied access, or API/GraphQL failure stops automatic discovery: report the exact failure and ask whether the user wants to correct access or explicitly continue with manual status/team values. Never silently fall back. `tracker` branch format additionally requires the configured MCP registration to expose that recognized credential environment reference because every Epic initialization re-reads current branch settings.

Present accessible teams as numbered choices. After the user selects one, present that team's issue statuses and Project statuses scoped to the workspace or that team, including native type and scope. Have the user select six distinct exact issue names and six distinct exact Project names for `backlog`, `todo`, `inProgress`, `inReview`, `done`, and `canceled`; never infer lifecycle semantics from names or native types. Each persisted name must identify one applicable status unambiguously. Use the inspection's exact branch-format result as described above. Native priority needs no configuration.

For Linear Phase, follow `../../references/phase.md` and the exact shape in `../../references/setup.md`. Read applicable Project and issue labels through the registered MCP tools, including groups and complete pagination. Have the user select one exact workspace/team group for Projects and one for issues, with active Planning, Execution, and Self-Review children. Verify child membership and issue single-select; Project groups are mutually exclusive by provider contract. Missing/incompatible groups require user configuration before proceeding; setup does not mutate Linear. Persist the selected scopes/names/child mappings, not provider IDs.

For GitHub tracker, reuse the selected active MCP server and existing repository configuration. For new configuration, use the snapshot’s `repositoryIdentity.githubCandidates`: one distinct identity supplies the current repository; multiple candidates require a numbered selection; when there are no candidates, ask for repository identity. State the reused identity rather than asking users to repeat it. Do not choose between fork/upstream remotes, infer identity from the directory name, or guess SSH aliases. The snapshot contains only validated owner/repo identities and contributing remote names, never raw remote URLs or credentials.

An environment-backed GitHub token is additionally required for direct setup APIs: reuse the configured credential environment-variable name when known; for a reused registration whose credential source is not available, ask only for an environment-variable name and never its value. Call `provision_github_project` with `operation: inspectRepository`, credential environment, and repository to verify canonical owner/name and owner type before asking about Project ownership or field scopes. Stop on inspection failure; do not guess ownership.

Explain that the Project owner is the GitHub account or organization that contains the Project and controls its access. Offer numbered choices to reuse the verified repository owner (show its login/type) or use another explicit owner. Ask only for missing login/type; never infer account type from a name.

Call `provision_github_project` with `operation: inspect`, the verified repository, selected Project owner login/type, credential environment, and `includeOrganizationMetadata: false`. Present existing Projects without preferring organization metadata. If the repository owner is an organization and the user wants to consider organization-native or custom field scope, repeat inspect with `includeOrganizationMetadata: true` and present discovered Issue Fields. Ask whether to adopt an existing Project or create one. For creation, offer `suggestedProjectTitle` (the verified repository name) as the default with an explicit override, and ask `private`/`public`. Resolve the exact title into the specification and provisioning preview before creation; preserve adopted Project titles. Offer repository association and default-repository configuration as separate choices, both enabled for the setup repository by default. `defaultRepository: unmanaged` skips configuration without clearing an existing value. Setting the default requires association; resolve a contradictory choice before preview. Before removing an existing association, have the user inspect the Project's default repository in Settings and resolve a default pointing to that repository before approving removal. Stop when its state cannot be established.

For an existing or `resume-created` Project, call `operation: inspectProject` with the credential environment, Project owner, and `projectNumber`. Present the returned views and require explicit selection of one exact view ID. Use `presentation.target: { mode: selected, viewId }`; only a new Project uses `{ mode: initial }`. For a freshly created empty Project using Board layout, the initial target creates the configured Board through REST, verifies its settings, then deletes only the captured, unchanged automatically generated default view. Preserve all unrelated views. No initial view means no deletion; multiple initial views require explicit selection and renewed preview. New table/roadmap layouts retain initial-view configuration. Existing and `resume-created` Projects only update the explicitly selected view; they never replace or delete views.

For a verified personal repository, explain that organization Issue Fields are unavailable and use Project-contained Priority and Internal ID without asking a scope question. Include those resolved scopes in the approval preview. Only for organization-owned repositories, ask for one field metadata model:

1. Project-contained — Project fields for Priority and Internal ID.
2. Organization-native — organization Issue Fields for Priority and Internal ID.
3. Custom — choose each field's scope independently.

Status and Phase are always Project fields. Phase has Planning, Execution, and Self-Review options and projects initialized In Progress activity in both artifact modes. Setup owns the fixed Epic and six Deliverable Kind labels. Kind labels classify versioned GitHub issues; unversioned workflows never apply or validate them. Native GitHub issue Type remains independent and unmanaged. Never use labels for lifecycle or Priority, and never use Custom Properties. A personal Project may use organization issue metadata when its repository belongs to that organization, but availability never selects scope. Project-contained configuration ignores organization metadata even when available. Internal ID metadata and the managed label catalog are still configured in unversioned mode.

Offer the editable `defaults` returned by `inspect`: six queue/lifecycle Status options, the Phase field and three options, exact Kind label definitions, Priority options, and the Internal ID text field. Every label name/color/description is an exact provisioning input; only names are persisted in tracker configuration. Require Kind label names to remain distinct case-insensitively and all Project field names, including Phase, to be distinct. Explain that Project-option colors, descriptions, visual ordering, and extra options are not runtime workflow inputs; exact configured field and option names are. For organization-native/custom scope, ask whether missing Issue Fields should be provisioned or the affected metadata should switch to Project scope. Organization provisioning requires an organization repository and organization-administrator/token permissions.

Offer the returned presentation defaults: **Board** name/layout; visible Title, Assignees, configured Status, Linked pull requests, Sub-issues progress, Labels, configured Priority, and configured Phase. For Boards, these are a visible-field selection, not a promised card-field order; GitHub controls their returned/display sequence. Table views retain ordered fields. Internal ID stays provisioned but hidden. Visible fields use `{ kind: field, name }` or `{ kind: workflow, field: status | priority | phase }`; keep semantic references so custom metadata names resolve correctly. A requested issue-scoped field not exposed on the Project requires explicit user correction or a changed visible-field selection, never silent omission or a duplicate custom field. Kind remains repository labels; provision only configured workflow fields, with no automatic field deletion. A fresh Board also requires its configured Priority to be exposed on the Project for sorting, even when hidden from visible fields; resolve missing exposure explicitly rather than omitting the sort.

Set the Project's short description to `Repository: https://github.com/<owner>/<repo>` using the resolved setup repository, not the Project owner. The API reads and writes `shortDescription`, preserving the Project README. Include the exact existing description and replacement in preview/hash approval for existing and resumed Projects; matching text needs no write. Description read-back must match before API provisioning is verified.

The [presentation contract](../../references/setup.md#github-project-presentation) owns supported API changes and precise manual steps for Status columns, no swimlanes, Priority sorting with Urgent first (Urgent → High → Medium → Low), Count, no slicing, and default repository. Read it before presenting the complete proposal. Layout/name/visible fields are editable; roadmap requires an empty visible-field selection. Preserve unrelated views and saved filters/settings during API writes. A saved Priority order must produce the requested sequence in either native sort direction. Resolve blocked option-order mismatches before approval: inspect the named field settings and separately approve aligning existing options or changing the requested order. Reordering is field-wide; preserve all option values.

Construct the exact strict specification and call `provision_github_project` with `operation: preview`. A blocked preview performs no mutation: resolve incompatible existing fields or label metadata without deleting native fields, or select an exact-title Project as `resume-created`. A newly created or confirmed `resume-created` empty Project updates GitHub's native Status field in place with the complete option set while preserving matching option IDs; an ordinary existing Project's incompatible Status is never changed. The preview also creates or validates the exact Phase single-select field/options and every Kind repository label. Present every intended provider effect in user-facing terms, including owner, resolved title, visibility, short-description replacement, repository association, native Status update, fields/options and resolved scopes, managed labels, Issue Field visibility, organization-level creation, exact view changes, and every returned manual step. For a fresh Board, explicitly include REST creation with configured Status columns, no swimlanes, sole configured Priority sort/order, and deletion limited to the captured unchanged default view after successful verification. Disclose that setting the default repository also links it; omit that step after default-repository opt-out. Require explicit approval of that exact `planHash`, then call `operation: apply` with the unchanged specification/hash. Never call apply from a general approval of the later repository-file proposal.

Apply preserves a partially created Project on failure. Report the tool’s safe request method/path, failed setup stage, and specific failed verification checks; keep credentials, authorization headers, and request bodies out of diagnostics. Fresh Board creation uses numeric provider field IDs and the encoded owner login in the personal or organization REST route. Verify name/layout/visible fields, Status columns, no swimlanes, and the sole Priority sort before default-view deletion. An edited default or nonempty Project stops cleanup. Unexpected or lost Board-create responses require exact-state reconciliation with exactly one newly appeared matching Board; zero or multiple matches stop without another create. Lost delete responses require exact absence confirmation. After an interrupted or failed apply, inspect the confirmed Project, explicitly select the existing Board as `resume-created`, and approve a fresh preview/hash; this changes only that selected view and preserves the default and unrelated views. Never infer deletion permission or default-view provenance across invocations. When the Project-create response was uncertain, inspect and explicitly select the confirmed Project as `resume-created`; do not infer a deletable default later. Resume by reading GitHub state: continue from one confirmed exact Project, retry only after confirmed absence, and report ambiguous or inconsistent state; never blindly recreate it. `state: provisioned` verifies API configuration only. A verified fresh Board leaves Count, no slicing, the opted-in default repository, and the Status field's default value as manual steps; adopted/resumed views retain the additional applicable column/group/sort steps. Always present the `defaultStatus` manual follow-up note: available MCP tools and documented public APIs do not expose a setter, so this default was not applied automatically. The note names the configured Status field and Backlog option and directs the user to Project Settings → that field → Default value → configured Backlog, then save and reload. Require user confirmation or a screenshot of the saved Status-field default before full setup completion, including with default-repository opt-out. Leave built-in automations and existing item values unchanged. Present the returned manual steps and exact Project/view links, guide the user through saving them, and verify readable settings through `inspectProject`; unreadable settings require user confirmation or a screenshot of saved state. Do not claim full setup complete while required manual work remains unconfirmed. Default-repository opt-out adds no manual completion requirement. Use only returned `trackerConfig` in `.project/integrations.json`; presentation and manual confirmation stay outside runtime configuration. If initialized entities are already bound to another GitHub Project, stop; Project replacement requires a separate user-directed migration.

For GitHub forge, reuse the known repository and selected MCP server. With forge-only setup, use the same snapshot candidate selection rules; ask only for missing or ambiguous identity. When tracker and forge use the same repository/server, state reuse rather than asking twice.

When both GitHub forge and GitHub Project configuration are known, offer the [fork-only intake option](../../references/setup.md#fork-only-incoming-pr-intake) as a numbered enable/decline choice. Same-repository PRs, including Deliverables, are excluded. The metadata-only Action adds membership and relies on the existing native Backlog default; it never updates an existing item's Status. Declining changes no file or setting. Enabling requires only a GitHub-valid Actions secret name with Project API access, never its value or copied MCP credentials. Call `render_incoming_pr_intake` with the selected `forge`, `tracker` and `tokenSecret`; include its exact file candidate and all returned prerequisites in the repository-file approval. Inspect the managed path from the setup snapshot and preserve unrelated files; existing content requires its exact reviewed diff, not silent replacement. Do not create secrets, weaken event policies, change native automation, deploy or run a probe. The reference distinguishes rendered/prepared files from confirmed active automation.

Briefly explain the Project Policy boundary from `../../references/setup.md` and precedence from `../../references/artifacts.md`, then ask whether the user wants help creating them. If not, omit `.project/policies.md` without inspecting the broader repository. If yes, ask which workflow behavior they want to add to or override, then inspect only the relevant workflow and repository guidance. Keep generic repository instructions in their existing harness-owned location. Propose evidence-backed policies naming the affected workflow stage or behavior and the specific addition or override; present each for acceptance.

### Optional permissions

Offer convenience permissions only for selected active integration providers, using the recommendation matrix in `../../references/setup.md`. Use each selected server's exact name and deduplicate a server shared by tracker and forge. Recommend provider-scoped read-only access plus the available frequent tracker writes defined by that matrix. A forge-only GitHub server gets the read-only option, not tracker writes. With no integrations, omit convenience options and still offer accepted-artifact diff gates independently.

Call read-only `inspect_permissions` with candidate MCP rules before presenting the choices. It uses the live MCP catalog and persistent global/project/local settings. Omit unavailable, fully blocked, and already-covered candidates from new additions; report their status and existing blockers. For partial read-only conflicts, show the blocked tools and rules and let the user select the rule for its remaining access. Preserve existing `ask` and `deny` rules; never remove or weaken them to make an allow work. Unverified conflicts are not proven matches. Session overrides and skill-derived allows are temporary and do not prove persistent coverage. Report required workflow read tools missing true annotations by inspecting their exact selectors as needed; do not claim the hint covers them or automatically add those diagnostic selectors.

Present numbered, independently selectable options, including decline-all. Explain beside each rule what it grants and why it avoids frequent prompts. `hint: readOnly` trusts the server's explicit `readOnlyHint: true`; missing/false hints do not match. Each write-tool allow grants the entire tool, including mutations beyond the workflow examples, across the server credential's accessible resources—not just this repository or Project. Workflow content, submission, and finish approvals still apply. Do not recommend whole-server write wildcards, PR merge allows, or unrelated write tools. Do not revoke any existing allows.

Offer the accepted-artifact diff gates defined in `../../references/setup.md` independently of integration allows. Declining every new permission changes no permission file or exclusion. Once new rules are selected, ask once where the combined permission configuration should be stored before preparing the final file proposal:

1. Local checkout configuration (`local`) — `.agents/permissions.local.json`
2. Committed project configuration (`project`) — `.agents/permissions.json`

Accept the number or exact value and confirm it as muted context. Never infer this choice from artifact or MCP persistence. Include the selected target, exact `allow` and `ask` additions, skipped rules, and conflicts in the final proposal. `configure_permissions` owns validated merging, rechecking current coverage/conflicts, unrelated-setting preservation, and local exclusion; do not edit permission settings manually.

## Preview and approval

GitHub provider provisioning has its own exact preview/hash approval above and must complete before this repository-file proposal. Except for the separately approved MCP bootstrap and GitHub provider provisioning, before any write show one bounded proposal containing:

- exact `.project/config.json`, which never contains username;
- exact `.project/config.local.json` when a repository-local username is needed, or the existing global username source/no local file;
- exact `.project/integrations.json`, or that it will be absent;
- exact `.project/policies.md`, or that it will be absent;
- for opted-in fork-only intake, the exact rendered `.github/workflows/incoming-pr-project.yml` diff, selected Project/repository, Actions secret name and activation prerequisites; otherwise preserve that path unchanged;
- exact missing `.gitignore` lines for versioned mode;
- for unversioned mode, either an explicit `info/exclude` no-op when `/.project/` already exists or this exact managed append:

    ```gitignore
    # unversioned workflow artifacts
    /.project/
    ```

- for versioned mode, mention `.git/info/exclude` for `.project/config.local.json` only when that local file already exists or is proposed: either report the existing exact exclusion as a no-op or propose the exact `/.project/config.local.json` append; when no local file exists or is proposed, omit this exclusion entirely;
- the selected permission-settings target, exact `allow` and `ask` additions, skipped rules, and conflicts when new permissions are selected;
- for local permission additions, that `configure_permissions` will keep `.agents/permissions.local.json` outside Git and ensure exact `/.agents/permissions.local.json` in `.git/info/exclude`; an unchanged permission configuration adds no exclusion.

Require explicit approval of that proposal. Workflow-owned JSON must satisfy the current documented shapes, contain no credentials, and end with a newline. Do not infer missing product rules, lifecycle mappings, field scopes, provider identities, or policy text.

## Write and validate

After approval:

1. Create or edit only the approved workflow files, preserving unrelated content. Create `.project/` when absent.
2. In versioned mode, add only missing local-file rules to `.gitignore`. In unversioned mode, do not add any `.project/` ignore rule there.
3. When new permissions are selected, call `configure_permissions` once with the approved `target` and exact `allow` and `ask` arrays (use `[]` for an unselected list). Report actual additions, skipped rules, and conflicts; a skipped rule is not newly granted access. Do not write or merge permission settings manually. A changed conflict requiring a different grant needs renewed approval; never weaken existing rules.
4. Call `prepare_artifacts`. Stop on any Git-membership/exclusion conflict; never repair it by changing the index.
5. If integrations are configured, call `integration_context` with `operation: inspect` and `target: "current"` to confirm operational configuration and roles. Validate each role independently, reusing native metadata facts already verified during setup/provisioning and obtaining only missing facts through registered read-only provider tools. Configured roles do not establish provider availability. Report unavailable roles without removing or changing another valid role.
6. Re-read every created/edited file and confirm strict configuration loads. Trust returned tool results for Git safety; do not run shell-based Git verification.
7. Report artifact mode using exact `versioned` or `unversioned` wording, branch formats and username source, configured roles, policy status, permission-settings scope, files changed, and validation results. Do not label commands as `Next` or imply another action is required. End with `Available workflow commands when you want to start work:` and briefly define `/epic <initiative>`, `/task <request and parent Epic>`, `/gig <standalone request>`, and—only when a tracker is configured—`/backlog <potential work>` plus `/todo <queued work>`.

Never claim setup succeeded until these checks pass. If a check fails, preserve approved files and any partially provisioned GitHub Project unless reverting/deleting them is separately approved, explain the exact correction needed, and perform no unapproved provider mutation.
