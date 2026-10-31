---
name: project-setup
description: "Use to interactively initialize or reconfigure Epic/Task/Gig workflows for a repository, including branch naming, tracker and forge integrations, and Project Policies."
allowed-tools:
    - "inspect_project_setup"
    - "prepare_artifacts"
    - "configure_mcp"
    - "inspect_permissions"
    - "configure_permissions"
    - "inspect_linear_workspace"
    - "inspect_github_repository_setup"
    - "inspect_github_project_setup"
    - "inspect_github_project"
    - "preview_github_project_setup"
    - "apply_github_project_setup"
    - "render_incoming_pr_intake"
    - "inspect_integrations"
    - "read(.project/*)"
    - "write(.project/*)"
    - "edit(.project/*)"
    - "read(.gitignore)"
    - "read(.git/info/exclude)"
    - "read(.agents/permissions.json)"
    - "read(.agents/permissions.local.json)"
---

# Project setup

Interactively configure the repository for Epic, Task, and Gig workflows.

**Allowed:**

- inspect Linear read-only, through `inspect_linear_workspace`;
- inspect GitHub;
- create or complete GitHub Project configuration, but only through a separately approved `preview_github_project_setup` result.

**Never:** initialize an entity, mutate Linear, mutate GitHub work items or pull requests, stage files, alter the Git index, commit, or push.

## Read first

- [Core rules](../../references/core.md)
- [Setup configuration contract](../../references/setup.md)

When integrations are requested, read [integration roles](../../references/integrations/shared.md) and the provider reference: [GitHub tracker](../../references/integrations/tracker/github.md), [Linear tracker](../../references/integrations/tracker/linear.md), or [GitHub forge](../../references/integrations/forge/github.md).

## Inspect first

**The snapshot:**

- `/project-setup` supplies a read-only snapshot ([setup context](../../references/setup.md#read-only-setup-context)). Use it directly.
- For a natural-language request without one, call `inspect_project_setup` before asking anything. It returns the same context, including missing or invalid setup files. Reuse a supplied snapshot rather than inspecting twice.

**Using it:**

- Take MCP servers and recognized credential variable names from its inventory instead of asking. Ask only for genuinely missing information.
- Don't run Git or shell discovery at all: the snapshot supplies the Git facts setup needs, and `prepare_artifacts` validates that workflow work stays outside Git. In particular, don't repeat its Git checks with Bash, and don't inspect the default branch; it's irrelevant to setup.
- `prepare_artifacts` performs setup's persistence validation and permitted exclusions. Routine workflow tools use the shared guard.

**Before asking questions:**

1. **Existing setup:** summarize it and ask which parts to change. Keep every unmentioned value. When `boundEntityTrackers` lists GitHub work, never replace its configured Project; explain that the user must direct a separate migration.
2. **Files:** never overwrite or silently replace existing setup files.
3. **One decision at a time:** ask only the current decision, and don't preview later optional ones. Bring up Project Policies only at their own final question, and don't inspect the repository for policy ideas unless the user accepts that help.

## Asking questions

Ask small, coherent batches, and explain consequences before asking for a choice. For every finite choice:

- show options as a numbered list, never bullets;
- accept the number or the exact label or config value;
- confirm the interpreted choice as muted context, as a blockquote such as `> ✓ Tracker: Linear (\`linear\`)`, followed by a blank line before the next question;
- ask separately when reusing numbers in one message could make a reply ambiguous.

For example:

1. GitHub (`github`)
2. Linear (`linear`)

**Order of decisions:**

1. Tracker and forge roles, and their providers.
2. Reuse or add MCP registrations; restart and resume when new ones are added.
3. For Linear, the read-only workspace inspection.
4. Branch naming, filtered by tracker.
5. Provider configuration for the selected roles. Once GitHub forge and Project are both known, offer fork-only incoming PR intake.
6. Blocked-review confirmation.
7. Project Policies, then convenience permissions and artifact diff gates.

Workflow work always stays local under `.project/.local/`; there's no persistence choice. When applying the ignore rule, read [artifacts](../../references/artifacts.md#persistence-and-authority). Removing files from Git needs separate approval and is outside setup.

## Decisions

### 1. Integration roles

| Role | Choices | Owns |
| --- | --- | --- |
| tracker | GitHub, Linear | work items, Backlog and Todo, lifecycle, Priority, hierarchy, plan publication |
| forge | GitHub | pull requests |

- Configure both roles. Workflows need a tracker and a GitHub forge.
- Never create placeholder, disabled, or secret-bearing configuration.
- Choose the tracker before branch naming; the forge doesn't affect branch options.

### 2. MCP registrations

**Choosing servers:**

- Use the snapshot's MCP inventory to pick servers and reuse their credential variable names. The inventory describes configuration, not active tools; confirm availability through the provider's registered tools.
- Reuse a suitable active server for each provider; ask when several fit.
- A configured but inactive server isn't usable. Report it and stop for the user to fix authentication or configuration; never silently replace it.

**Adding missing servers:**

1. Offer to add the official servers. First ask one shared persistence question for every new registration in this setup:
   1. Private local checkout configuration (`local`) — `.agents/mcp.local.json`
   2. Committed project configuration (`project`) — `.agents/mcp.json`

   Never infer this choice or ask it per provider. Project trust is required for either.
2. Then ask for each missing server's name and credential variable name, never the value. Defaults are `LINEAR_API_KEY` and `GITHUB_PERSONAL_ACCESS_TOKEN`.
3. Preview the exact server entries, the target file, and, for local, the `/.agents/mcp.local.json` exclude append. Get approval, then call `configure_mcp`. Merge order, name conflicts, and toolsets are in [MCP registrations](../../references/setup.md#mcp-registrations).

**Restarting:**

- New registrations aren't available to the running session. When `configure_mcp` reports `restartRequired`:
  - make no `.project` writes;
  - tell the user which variables to export;
  - ask them to reload or restart Pi and restore this session. Not an empty session, and not `/project-setup` again; the restored conversation holds the approved answers.
- After restoring, refresh with `inspect_project_setup`, continue from the next unanswered decision, and proceed only once the provider's registered tools are available.

### 3. Linear workspace inspection

1. **Call `inspect_linear_workspace`** after the MCP server is active and before branch naming. Use the credential variable from the recognized registration, or ask for the variable's name only.
2. **On a missing variable, denied access, or API failure,** report the exact error and ask whether to fix access or continue with manual team and status values. Never fall back silently.
3. **Team and statuses:**
   - Show teams as numbered choices. For the selected team, show its issue statuses and the workspace or team Project statuses, with native type and scope.
   - The user picks six distinct issue names and six distinct Project names for `backlog`, `todo`, `inProgress`, `inReview`, `done`, and `canceled`.
   - Never infer lifecycle meaning from names or types. Each saved name must identify one status unambiguously. Native Priority needs no configuration.
4. **Phase groups:** read [Phase](../../references/phase.md#setup) and the [Linear tracker shape](../../references/setup.md#linear-tracker).
   - Read Project and issue labels through registered tools, with pagination.
   - The user picks one workspace or team group for Projects and one for issues, each with active Planning, Execution, and Self-Review children. Verify membership and issue single-select.
   - Missing or incompatible groups need user fixes first; setup never mutates Linear.
   - Save scopes, names, and child mappings, not provider IDs.

### 4. Branch naming

| Tracker and choice | Format |
| --- | --- |
| GitHub | one static format the user selects |
| Linear, Linear naming | `tracker` for Epic, Task, and Gig |
| Linear, workflow naming | one static format the user selects |

**Static formats:**

- Offer `identifier-title` as the default, with `username/identifier-title` as the alternative ([setup contract](../../references/setup.md#project-configuration)). Save the choice once as `branches.format`.
- For Linear, first ask: 1. Use Linear branch naming (`tracker`), or 2. Use one static workflow format (`static`).

**`tracker`:**

- Save exactly `"branches": { "format": "tracker" }`.
- Explain that a Task or Gig uses the issue's `gitBranchName`, and an Epic uses `<YYYYMMDD>-<slug>`, dated by the Linear Project's creation.
- Don't ask for or read username settings.

**Username (`username/identifier-title`):**

- Use `.project/config.local.json` when it has one, otherwise the global `workflows.json`.
- When neither has one, ask and propose `.project/config.local.json` with `{ "branches": { "username": "<value>" } }`.
- Never store it in `.project/config.json`, infer it from Git or provider identity, or ask for it otherwise.

### 5. Provider configuration

#### GitHub tracker

**Repository and credential:**

- Reuse the selected active MCP server and existing repository configuration.
- For new configuration, take the identity from `repositoryIdentity.githubCandidates`: one candidate is used directly, several need a numbered choice, and none means asking. State the reused identity rather than asking again. Never choose between fork and upstream remotes, infer from the directory name, or guess SSH aliases.
- Direct setup APIs also need an environment-backed GitHub token. Reuse the known credential variable name, or ask for the name only.

**Discovery and choices:** read [GitHub Project setup](../../references/setup/github-project.md) before discovery, then:

1. **Repository.** Call `inspect_github_repository_setup` to verify the canonical repository and owner type. Stop on failure; never guess ownership.
2. **Project owner.** Explain that the Project owner contains the Project and controls access. Offer the verified repository owner, showing its login and type, or another explicit owner. Ask only for a missing login or type, and never infer the type from a name.
3. **Owner-level discovery.** Call `inspect_github_project_setup` with `includeOrganizationMetadata: false` and show existing Projects, without preferring ones that have organization metadata. For an organization repository, when the user wants organization-native or custom scope, call it again with `includeOrganizationMetadata: true` and show the Issue Fields.
4. **Adopt or create.**
   - For creation, offer `suggestedProjectTitle` with an override, and ask `private` or `public`.
   - Offer repository association and default repository as separate choices, both enabled by default.
   - Before removing an existing association, the user checks the default repository in Settings first.
5. **Existing or `resume-created` Project.** Call `inspect_github_project`, show its views, and require selection of one exact view ID.
6. **Field scope.**
   - Personal repositories: explain that organization Issue Fields are unavailable, and use Project-contained Priority without asking.
   - Organization repositories: ask one of: 1. Project-contained, 2. Organization-native, 3. Custom (each field separately).
   - For organization-native or custom scope, ask whether missing Issue Fields should be created (this needs an organization repository and admin token permissions) or switched to Project scope.
7. **Defaults.** Offer the editable `defaults`: six Status options, the Phase field and its options, and Priority options.
   - Ask whether to use Kind labels: 1. Yes (`labels`), 2. No. With yes, offer the default Epic and six Deliverable Kind labels and include them in the specification; with no, omit `labels`.
   - Label names, colors, and descriptions are exact inputs; only names are saved.
   - Kind label names stay distinct case-insensitively, and all Project field names, Phase included, stay distinct.
   - Option colors, descriptions, visual order, and extra options aren't runtime inputs; configured names are.
8. **Presentation.** Offer the Board defaults ([presentation](../../references/setup/github-project.md#presentation)).
   - Name, layout, and visible fields are editable.
   - For a Board, visible fields are a selection, not a card order.
   - List Status, Priority, and Phase as semantic `{ kind: workflow, field }` references, never by literal name, so custom-named fields resolve.
   - A requested issue-scoped field not exposed on the Project needs explicit correction or a changed selection, never silent omission or a duplicate field.

**Field rules:**

- Status and Phase are always Project fields. Phase has Planning, Execution, and Self-Review and projects In Progress activity.
- Kind labels are optional. When configured, setup owns the Epic and six Deliverable Kind labels, and initialization and queue intake apply exactly one.
- Native issue Type stays unmanaged. Never use labels for lifecycle or Priority, or Custom Properties for anything.
- A personal Project may use organization issue metadata when its repository belongs to that organization, but availability never selects the scope. Project-contained configuration ignores organization metadata.

**Preview, apply, and confirm:**

1. **Preview.** Build the strict specification and call `preview_github_project_setup`.
   - A blocked preview changes nothing. Resolve incompatible fields or labels without deleting native fields, or select an exact-title Project as `resume-created`. Resolve Priority order mismatches as [described](../../references/setup/github-project.md#priority-order).
   - A new or confirmed `resume-created` empty Project updates the native Status field in place, keeping matching option IDs. An ordinary existing Project's incompatible Status is never changed.
2. **Present every effect** in plain terms:
   - owner, resolved title, visibility, and the short-description replacement;
   - repository association and default repository (setting the default also links it);
   - the native Status update, fields, options, and scopes;
   - managed labels, Issue Field visibility, and organization-level creation;
   - exact view changes (for a fresh Board, everything listed in [preview and approval](../../references/setup/github-project.md#preview-and-approval));
   - every returned manual step.
3. **Approve and apply.** Require explicit approval of that exact `planHash`, then call `apply_github_project_setup` with the unchanged specification and hash. A general approval of the later file proposal never counts.
4. **Failures and recovery** follow [diagnostics](../../references/setup/github-project.md#diagnostics) and [recovery](../../references/setup/github-project.md#recovery). Resume from GitHub state: continue from one confirmed Project, retry only after confirmed absence, and never blindly recreate.
5. **Manual steps.** `state: provisioned` verifies API configuration only.
   - Present the returned [manual steps](../../references/setup/github-project.md#guided-ui-steps) and links, guide the user through them, and verify readable settings with `inspect_github_project`.
   - Always present the `defaultStatus` note: available MCP tools and public APIs don't expose a setter, so the user sets Project Settings → the Status field → Default value → the configured Backlog option, then saves and reloads.
   - Require confirmation or a screenshot of that saved default, and of any other unreadable setting, before claiming full setup. That applies with or without a default repository; opting out of the default repository adds no requirement.
   - Leave built-in automations and existing item values unchanged.
6. **Configuration.** Use only the returned `trackerConfig` in `.project/integrations.json`. Presentation and manual confirmation stay out of runtime configuration.

When initialized entities are already bound to another GitHub Project, stop. Replacing the Project needs a separate, user-directed migration.

#### GitHub forge

Reuse the known repository and selected server; the forge is always configured alongside the tracker. Use the same candidate rules and ask only for missing or ambiguous identity. When tracker and forge share a repository and server, say so rather than asking twice.

#### Fork-only incoming PR intake

When GitHub forge and Project configuration are both known, read [incoming PR intake](../../references/setup/incoming-pr-intake.md) and offer it as a numbered enable or decline choice.

### 6. Blocked-review confirmation

| Choice | Configuration |
| --- | --- |
| Disabled | Omit `reviews`; never write `false`, zero, or an empty object |
| Enabled after N blocks | `reviews.userConfirmationAfter` is a positive integer N |

Counting is per entity and review category. The checkpoint stops right after the threshold result, before that round is corrected. Reviews continue until approved either way.

### 7. Project Policies and permissions

**Project Policies:**

- Briefly explain the boundary ([setup](../../references/setup.md#project-policies)) and precedence ([artifacts](../../references/artifacts.md#project-policy-precedence)), then ask whether the user wants help.
- If not, omit `.project/policies.md` without inspecting the repository.
- If yes, ask which behavior to add or override, inspect only the relevant workflow and repository guidance, and propose evidence-backed policies naming the stage or behavior, each for acceptance. Generic repository instructions stay where the harness keeps them.

**Permissions:** read [setup permissions](../../references/setup/permissions.md).

- Offer convenience permissions only for selected active integration providers, deduplicating shared servers.
- Call `inspect_permissions` before presenting choices, and follow its result table.
- Never remove or weaken existing `ask` and `deny` rules, and never revoke existing allows. Never recommend whole-server write wildcards, PR merge allows, or unrelated writes.
- Present numbered, independently selectable options, including decline-all. Explain each grant: a write-tool allow covers the entire tool across the credential's resources, and workflow content, submission, and shipping approvals still apply.
- Declining everything changes no permission file or exclusion.
- Once rules are selected, ask once where to store them, `local` (`.agents/permissions.local.json`) or `project` (`.agents/permissions.json`). Never infer this from the artifact or MCP choice.
- `configure_permissions` does the merging; never edit permission settings by hand.

## Preview and approval

GitHub provisioning has its own preview and hash approval and must finish first. Apart from that and the MCP bootstrap, show one bounded proposal before any write:

- **`.project/config.json`**, exactly; it never contains a username.
- **`.project/config.local.json`**, exactly, when a local username is needed; otherwise the existing global username source, or no local file.
- **`.project/integrations.json`**, exactly, or that it will be absent.
- **`.project/policies.md`**, exactly, or that it will be absent.
- **Fork-only intake**, when opted in: the rendered `.github/workflows/incoming-pr-project.yml` diff, the Project and repository, the secret name, and the prerequisites. Otherwise the path stays unchanged.
- **`.gitignore`:** follow the setup context's `projectLocalIgnore`: an explicit no-op for `present`, the exact line replacement for `replace`, or this exact append for `append`:

    ```gitignore
    /.project/.local
    ```

  Mention the `/.project/config.local.json` exclusion only when that local file exists or is proposed, either as an existing no-op or as the exact append.

- **Permissions**, when selected: the target, the exact `allow` and `ask` additions, skipped rules, and conflicts. For local additions, note that `configure_permissions` keeps `.agents/permissions.local.json` outside Git and ensures its exclude entry; unchanged permissions add no exclusion.

Require explicit approval. Workflow JSON must match the documented shapes, contain no credentials, and end with a newline. Never infer missing product rules, lifecycle mappings, field scopes, provider identities, or policy text.

## Write and validate

After approval:

1. Create or edit only the approved files, preserving unrelated content. Create `.project/` when absent.
2. Apply the approved `.gitignore` change: replace the old `/.project/.local/` line, or append `/.project/.local` when neither is present.
3. When permissions are selected, call `configure_permissions` once with the approved `target`, `allow`, and `ask` (use `[]` for an unselected list). Report actual additions, skips, and conflicts; a skipped rule grants nothing. A changed conflict needing a different grant needs approval again.
4. Call `prepare_artifacts`. Stop on any Git-membership or exclusion conflict; never fix it by changing the index.
5. With integrations, call `inspect_integrations` with `target: "current"`.
   - Validate each role independently, reusing facts already verified during setup and reading only missing ones through read-only tools.
   - Configured roles don't prove availability. Report an unavailable role without changing another valid one.
6. Re-read every created or edited file and confirm strict configuration loads. Trust tool results for Git safety; no shell Git checks.
7. Report:
   - branch formats and the username source;
   - roles, policy status, and permission scope;
   - changed files and validation results.

   Don't label anything `Next` or imply another action is required. End with `Available workflow commands when you want to start work:` and briefly define `/epic <initiative>`, `/task <request and parent Epic>`, `/gig <standalone request>`, `/backlog <potential work>`, and `/todo <queued work>`.

Never claim success until these checks pass. When one fails, keep approved files and any partially provisioned GitHub Project unless reverting is separately approved, explain the exact fix, and make no unapproved provider change.
