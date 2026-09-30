---
name: project-setup
description: "Use to interactively initialize or reconfigure Epic/Task/Gig workflows for a repository, including artifacts, branch naming, optional integrations, and Project Policies."
allowed-tools:
    - "prepare_artifacts"
    - "configure_mcp"
    - "configure_permissions"
    - "inspect_linear_workspace"
    - "provision_github_project"
    - "integration_context"
    - "read(.project/*)"
    - "write(.project/*)"
    - "edit(.project/*)"
    - "read(.gitignore)"
    - "read(.git/info/exclude)"
    - "read(.agents/permission.settings.json)"
    - "read(.agents/permission.settings.local.json)"
---

# Project setup

Interactively configure the repository for Epic/Task/Gig workflows. Setup may inspect Linear read-only through `inspect_linear_workspace`, inspect GitHub, and—only through an exact separately approved `provision_github_project` preview—create or complete GitHub Project configuration. Never initialize an entity, mutate Linear, mutate GitHub work items or pull requests, stage files, alter the Git index, commit, or push.

Read `../../references/setup.md` for the configuration-file contract. When integrations are requested, also read `../../references/integrations/shared.md` and the selected provider behavior from `../../references/integrations/tracker/github.md`, `../../references/integrations/tracker/linear.md`, or `../../references/integrations/forge/github.md`.

## Inspect first

`/project-setup` supplies a deterministic read-only snapshot containing the repository root, exact setup files, global and repository-local workflow settings, `.git/info/exclude` state, `.project` paths in Git or staged, bound entity tracker summaries, and a credential-redacted inventory of global, committed-project, and local MCP registrations. Recognized official registrations may expose their environment-variable name but never its value. Use that snapshot directly. Do not repeat its Git checks through Bash or another shell command. The default branch is irrelevant to setup and must not be inspected.

For a natural-language invocation without the command snapshot, use Pi's project working directory and read only `.project/config.json`, `.project/config.local.json`, `.project/integrations.json`, `.project/policies.md`, `.gitignore`, `.git/info/exclude`, `.agents/permission.settings.json`, and `.agents/permission.settings.local.json` when present. Do not run Git or shell discovery; `prepare_artifacts` owns Git safety validation.

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

After integration providers are selected, call `integration_context` with `operation: inspect` and compare its successfully registered MCP server names with the snapshot's configured server inventory.

For each provider, reuse a suitable active MCP server when one exists; ask the user to select it when multiple names are suitable. A configured but inactive server is not usable: report it and stop for authentication/configuration correction rather than silently replacing it.

When one or more required providers have no configured server, offer to add their official servers. Before asking for any MCP server name, credential variable, or provider-specific configuration, ask one shared persistence question for all new MCP registrations:

1. Local checkout configuration (`local`) — `.agents/mcp.settings.local.json`
2. Committed project configuration (`project`) — `.agents/mcp.settings.json`

Accept the number or exact value, confirm the interpreted selection as muted context, and apply it to every new MCP registration in this setup. Never infer the persistence choice or ask it again per provider. Only then ask for each missing server's name and credential environment-variable name. Both forms contain only an environment-variable reference, never a credential. Default credential variable names are `LINEAR_API_KEY` and `GITHUB_PERSONAL_ACCESS_TOKEN`, but the user may provide another valid environment-variable name.

Before adding registrations, preview the exact server entries, shared target file, and—when local is selected—the exact `/.agents/mcp.settings.local.json` append to `.git/info/exclude`. Obtain explicit approval, then call `configure_mcp`. This tool preserves unrelated settings, rejects conflicting names, never changes the Git index, and enables only `issues,projects` for a GitHub tracker plus `pull_requests` for a GitHub forge.

New MCP registrations are unavailable to the running Pi session. When `configure_mcp` reports `restartRequired`, make no `.project` writes: tell the user which environment variables must be exported, then instruct them to reload or restart Pi and restore this current session. Do not tell them to open an empty session or run `/project-setup` again; the restored conversation contains the approved answers needed to continue. After restoration, continue from the next unanswered setup decision and proceed only when `integration_context` reports the selected servers as active.

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

When the selected static format begins with `username`, use the repository-local `.project/config.local.json` username when present, otherwise the global `workflows.settings.json` username. If neither exists, ask for it and propose strict `.project/config.local.json` with `{ "branches": { "username": "<value>" } }`. Never store username in committed `.project/config.json`, infer it from Git/provider identity, or ask for it for `tracker` or a static format without `username`.

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
6. Exact provider configuration, only for selected roles.
7. Whether to enable user confirmation after a positive number of consecutive blocked reviews. Disabled omits `reviews`; never write `false`, zero, or an empty object.
8. Whether the user wants optional Project Policies or accepted-artifact diff permission gates.

For a Linear tracker, obtain the credential environment-variable name from the recognized effective MCP registration when available; otherwise ask only for an environment-variable name, never its value. Call `inspect_linear_workspace` after the MCP server is active and before branch naming. The operation reads only workspace identity, authenticated viewer Full Name and Username, accessible teams, team issue statuses, applicable Project statuses, and the workspace branch template. A missing variable, denied access, or API/GraphQL failure stops automatic discovery: report the exact failure and ask whether the user wants to correct access or explicitly continue with manual status/team values. Never silently fall back. `tracker` branch format additionally requires the configured MCP registration to expose that recognized credential environment reference because every Epic initialization re-reads current branch settings.

Present accessible teams as numbered choices. After the user selects one, present that team's issue statuses and Project statuses scoped to the workspace or that team, including native type and scope. Have the user select six distinct exact issue names and six distinct exact Project names for `backlog`, `todo`, `inProgress`, `inReview`, `done`, and `canceled`; never infer lifecycle semantics from names or native types. Each persisted name must identify one applicable status unambiguously. Use the inspection's exact branch-format result as described above. Native priority needs no configuration.

For GitHub tracker, gather the repository and selected MCP server after that server is active. An environment-backed GitHub token is additionally required for direct setup APIs: reuse the configured credential environment-variable name when known; for a reused registration whose credential source is not available, ask only for an environment-variable name and never its value.

Call `provision_github_project` with `operation: inspect`, the repository, Project owner login/type, credential environment, and `includeOrganizationMetadata: false`. Present existing Projects without preferring organization metadata. If the repository owner is an organization and the user wants to consider organization-native or custom field scope, repeat inspect with `includeOrganizationMetadata: true` and present discovered Issue Fields. Ask whether to adopt an existing Project or create one. For creation, ask exact title, `private`/`public`, and whether to associate the repository.

Ask for one field metadata model:

1. Project-contained — Project fields for Priority and Internal ID.
2. Organization-native — organization Issue Fields for Priority and Internal ID.
3. Custom — choose each field's scope independently.

Status is always a Project field. Setup owns one exact Planning repository label plus the fixed Epic and six Deliverable Kind labels. Planning projects active planning while Status remains In Progress. Kind labels classify versioned GitHub issues; unversioned workflows never apply or validate them. Native GitHub issue Type remains independent and unmanaged. Never use labels for lifecycle or Priority, and never use Custom Properties. A personal Project may use organization issue metadata when its repository belongs to that organization, but availability never selects scope. Project-contained configuration ignores organization metadata even when available. Internal ID metadata and the managed label catalog are still configured in unversioned mode.

Offer the editable `defaults` returned by `inspect`: six queue/lifecycle Status options, exact Planning and Kind label definitions, Priority options, and the Internal ID text field. Every label name/color/description is an exact provisioning input; only names are persisted in tracker configuration. Require Planning and Kind label names to remain distinct case-insensitively. Explain that Project-option colors, descriptions, visual ordering, and extra options are not runtime workflow inputs; exact configured field and option names are. For organization-native/custom scope, ask whether missing Issue Fields should be provisioned or the affected metadata should switch to Project scope. Organization provisioning requires an organization repository and organization-administrator/token permissions.

Construct the exact strict specification and call `provision_github_project` with `operation: preview`. A blocked preview performs no mutation: resolve incompatible existing fields or label metadata without deleting native fields, or select an exact-title Project as `resume-created`. A newly created or confirmed `resume-created` empty Project updates GitHub's native Status field in place with the complete option set while preserving matching option IDs; an ordinary existing Project's incompatible Status is never changed. The preview also creates or validates every exact Planning and Kind repository label. Present every intended provider effect in user-facing terms, including owner, visibility, repository association, native Status update, fields/options, managed labels, Issue Field visibility, and organization-level creation. Require explicit approval of that exact `planHash`, then call `operation: apply` with the unchanged specification/hash. Never call apply from a general approval of the later repository-file proposal.

Apply preserves a partially created Project on failure. Resume by reading GitHub state: continue from one confirmed exact Project, retry only after confirmed absence, and report ambiguous or inconsistent state; never blindly recreate it. On success use only returned `trackerConfig` in `.project/integrations.json`. If initialized entities are already bound to another GitHub Project, stop; Project replacement requires a separate user-directed migration.

For GitHub forge, gather the MCP server and repository. When tracker and forge use the same repository/server, confirm reuse rather than asking twice.

Briefly explain the Project Policy boundary from `../../references/setup.md` and precedence from `../../references/artifacts.md`, then ask whether the user wants help creating them. If not, omit `.project/policies.md` without inspecting the broader repository. If yes, ask which workflow behavior they want to add to or override, then inspect only the relevant workflow and repository guidance. Keep generic repository instructions in their existing harness-owned location. Propose evidence-backed policies naming the affected workflow stage or behavior and the specific addition or override; present each for acceptance.

Offer the accepted-artifact diff gates defined in `../../references/setup.md`. If the user declines, write nothing. If the user accepts, ask where the permission configuration should be stored before preparing the final file proposal:

1. Local checkout configuration (`local`) — `.agents/permission.settings.local.json`
2. Committed project configuration (`project`) — `.agents/permission.settings.json`

Accept the number or exact value and confirm it as muted context. Never infer this choice from artifact or MCP persistence. Include the selected target and exact gates in the final proposal; `configure_permissions` owns validated merging, unrelated-setting preservation, and local exclusion.

## Preview and approval

GitHub provider provisioning has its own exact preview/hash approval above and must complete before this repository-file proposal. Except for the separately approved MCP bootstrap and GitHub provider provisioning, before any write show one bounded proposal containing:

- exact `.project/config.json`, which never contains username;
- exact `.project/config.local.json` when a repository-local username is needed, or the existing global username source/no local file;
- exact `.project/integrations.json`, or that it will be absent;
- exact `.project/policies.md`, or that it will be absent;
- exact missing `.gitignore` lines for versioned mode;
- for unversioned mode, either an explicit `info/exclude` no-op when `/.project/` already exists or this exact managed append:

    ```gitignore
    # unversioned workflow artifacts
    /.project/
    ```

- for versioned mode, mention `.git/info/exclude` for `.project/config.local.json` only when that local file already exists or is proposed: either report the existing exact exclusion as a no-op or propose the exact `/.project/config.local.json` append; when no local file exists or is proposed, omit this exclusion entirely;
- the selected permission-settings target and exact ask rules when permission gates are selected;
- for local permission settings, that `configure_permissions` will keep `.agents/permission.settings.local.json` outside Git and ensure exact `/.agents/permission.settings.local.json` in `.git/info/exclude`.

Require explicit approval of that proposal. Workflow-owned JSON must satisfy the current documented shapes, contain no credentials, and end with a newline. Do not infer missing product rules, lifecycle mappings, field scopes, provider identities, or policy text.

## Write and validate

After approval:

1. Create or edit only the approved workflow files, preserving unrelated content. Create `.project/` when absent.
2. In versioned mode, add only missing local-file rules to `.gitignore`. In unversioned mode, do not add any `.project/` ignore rule there.
3. When permission gates are selected, call `configure_permissions` once with the approved target and exact rules. Do not write or merge permission settings manually.
4. Call `prepare_artifacts`. Stop on any Git-membership/exclusion conflict; never repair it by changing the index.
5. If integrations are configured, call `integration_context` with `operation: inspect`. Validate each role independently and run only its returned read-only validation steps. Report unavailable roles without removing or changing another valid role.
6. Re-read every created/edited file and confirm strict configuration loads. Trust returned tool results for Git safety; do not run shell-based Git verification.
7. Report artifact mode using exact `versioned` or `unversioned` wording, branch formats and username source, configured roles, policy status, permission-settings scope, files changed, and validation results. Do not label commands as `Next` or imply another action is required. End with `Available workflow commands when you want to start work:` and briefly define `/epic <initiative>`, `/task <request and parent Epic>`, `/gig <standalone request>`, and—only when a tracker is configured—`/backlog <potential work>` plus `/todo <queued work>`.

Never claim setup succeeded until these checks pass. If a check fails, preserve approved files and any partially provisioned GitHub Project unless reverting/deleting them is separately approved, explain the exact correction needed, and perform no unapproved provider mutation.
