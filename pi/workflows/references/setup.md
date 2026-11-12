# Project setup configuration contract

The source of truth for files that project setup creates or changes, whether started with `/project-setup` or in natural language. The setup skill owns the interactive sequence, this file owns the configuration files, and provider references own provider behavior.

Step files, read when the step is reached:

- When provisioning or adopting a GitHub Project, read [GitHub Project setup](./setup/github-project.md).
- When offering fork-only incoming PR intake, read [incoming PR intake](./setup/incoming-pr-intake.md).
- When offering convenience permissions, read [setup permissions](./setup/permissions.md).
- When the tracker is Linear, read [Linear tracker configuration](./setup/linear-tracker.md).
- When configuring where workflow problems are reported, read [workflow reporting source](./setup/reporting-source.md).

## General rules

- Every workflow-owned JSON object rejects unlisted properties, contains no credentials, and ends with a newline.
- Workflow-owned JSON stores only operational fields.
- Preserve unrelated keys when merging into shared Pi settings files.
- Omit optional workflow files instead of writing empty, disabled, or placeholder configuration.
- Preview exact file content and exact ignore or exclude additions before writing them.
- Never stage files or alter the Git index.

## Read-only setup context

`/project-setup` and the `inspect_project_setup` tool use the same inspector. The command puts its snapshot in the kickoff prompt; natural-language setup calls the tool when no snapshot was supplied. The tool takes an empty object and returns the snapshot as JSON text and structured details, without injecting a user message.

**The snapshot contains:**

- `repositoryIdentity.githubCandidates`;
- repository and setup-file contents;
- global and local workflow settings;
- exclusion and Git-membership facts;
- shallow summaries of entities already bound to trackers;
- credential-redacted MCP registrations. Recognized official registrations expose their credential environment-variable names, never token values or authorization headers.

It works before configuration exists or while it's invalid, and touches no files. Reuse known references and ask only for genuinely missing information.

**Repository candidates:**

- Each holds only a validated GitHub `owner`, `repo`, and the contributing `remotes` names from configured fetch URLs.
- Standard GitHub HTTPS, SCP-style SSH, and SSH URLs are recognized, with or without `.git`. Equivalent identities are deduplicated case-insensitively.
- Raw URLs, authentication, query strings, fragments, unsupported hosts or aliases, and non-GitHub remotes never enter the snapshot.
- One distinct candidate is the current repository. Several need an explicit selection. None means asking for the identity.
- Directory names and push-only destinations never decide identity. The default branch isn't inspected.

**Limits:**

- Inspection makes no provider calls or file or index changes, prepares no artifacts, and repairs nothing.
- Its inventory shows configured registrations, not active tools. Provider availability and provisioning or file approvals are separate.
- Operational `inspect_integrations` validation runs only after valid, approved configuration is saved.

## Project configuration

`.project/config.json` is required:

```json
{
    "branches": { "format": "identifier-title" }
}
```

- Workflow work is always local; [artifacts](./artifacts.md#terminology) defines Git membership and local files.
- `branches.format` is one format string for every Epic, Task, and Gig:
  - `identifier-title`: the entity's name in lowercase, the tracker's identifier then the slug, such as `12-fix-login`, `eng-12-fix-login`, or `20261026-billing-revamp` for a Linear Epic;
  - `username/identifier-title`: the same with a `<username>/` prefix;
  - `tracker`: Linear's own issue branch names.
- `tracker` is allowed only with a Linear tracker. Task and Gig then use the exact issue branch names, and an Epic uses its dated name, `<YYYYMMDD>-<slug>`. GitHub-tracked projects need a static format.

### Username

`username/identifier-title` needs `branches.username` in the global `~/<agent-dir>/workflows.json` or the local `.project/config.local.json`:

```json
{
    "branches": { "username": "alex" }
}
```

- The local value overrides the global one.
- A username is non-empty and can't contain `/`, carriage return, or newline.
- Never put it in committed `.project/config.json` or infer it from Git or provider identity.

## Integration configuration

`.project/integrations.json` is required and holds both roles: `tracker` (GitHub or Linear) and `forge` (GitHub).

- Every role has a non-empty MCP server name made of letters, digits, `_`, `.`, or `-`.
- A GitHub repository identity is a non-empty `owner` and `repo`.

### Linear tracker

The `tracker` object, status setup, and `tracker` branch names are in [Linear tracker configuration](./setup/linear-tracker.md).

### GitHub tracker

Never hand-build GitHub tracker configuration. Use the exact `trackerConfig` returned by the previewed and approved `apply_github_project_setup` ([GitHub Project setup](./setup/github-project.md)). It contains:

- `provider: "github"`, the MCP server, and the repository identity;
- the Project owner, owner type (`user` or `org`), and the Project's URL number;
- one Project Status field mapping `backlog`, `todo`, `inProgress`, `inReview`, `done`, and `canceled` to distinct names;
- one Project Phase single-select field mapping `planning`, `execution`, and `selfReview` to distinct names;
- Priority, with `issue` or `project` scope, a field name, and unique non-empty values that exclude lowercase `not set`.

It contains no `labels`; add the section the label setup tools return ([label groups](#label-groups)).

**Constraints:**

- All Project-scoped field names are distinct.
- Status and Phase are always Project-scoped.
- Phase projects In Progress activity.
- Native GitHub issue Type stays independent and unmanaged. Never substitute labels, Custom Properties, or another field scope.

Example returned configuration for a Project-contained tracker (use the actual output, not these sample identities):

```json
{
    "tracker": {
        "provider": "github",
        "mcpServer": "github",
        "repository": { "owner": "octocat", "repo": "example" },
        "project": { "owner": "octocat", "ownerType": "user", "number": 3 },
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
            }
        }
    }
}
```

### Label groups

`tracker.labels` is optional on both trackers. Never hand-build it: use the `configuration` that the approved `apply_label_setup` returns.

```json
{
    "labels": {
        "groups": {
            "area": {
                "appliesTo": ["epic", "deliverable"],
                "cardinality": "zeroOrMore",
                "values": {
                    "frontend": { "name": "Area: Frontend", "color": "#1D76DB", "description": "" }
                }
            }
        },
        "unmanaged": { "keep": [{ "name": "good first issue" }] },
        "retired": [{ "name": "Area: Legacy" }]
    }
}
```

- **Groups:** each has `appliesTo` (`epic`, `deliverable`, or both), a `cardinality` (`exactlyOne`, `zeroOrOne`, `oneOrMore`, or `zeroOrMore`), and values keyed by stable lowercase keys. Each value is a label definition: `name`, `color` (`#RRGGBB`), and `description`.
- **`kind`:** the reserved group for Kind. It must be `exactlyOne`, its values must be exactly `epic` and the six Deliverable kinds its `appliesTo` covers, and its value comes from the item's Kind.
- **`gate`:** the reserved group whose values mark a Task or Gig with points where the workflow stops for approval. It applies only to `deliverable` and is `zeroOrMore`. Its values may be only the gates the workflow knows: today `plan`, which makes the plan [wait for approval](./planning.md#plan-approval). The user applies them; runtime only reads them.
- **Linear groups** add `scope` (`workspace` or `team`) and an optional `nativeGroup` label definition. With it, the values are children of a native group: single-select for at most one value, multi-select otherwise.
- **`unmanaged.keep`** and **`retired`** record the user's answers about labels outside the configuration. Linear entries also name the `catalog` (`issue` or `project`) and `scope`.
- **Names:** managed label names are distinct case-insensitively per GitHub repository, and per Linear catalog across workspace and team. Linear's reserved names are rejected.

**Setup:**

- `inspect_label_setup` reads the catalog, with usage, and the managed set setup last applied. `preview_label_setup` plans the changes and reports every decision the user must answer. `apply_label_setup` takes the approved `planHash`.
- These tools take the tracker identity and the credential variable as input, like GitHub Project setup.
- Labels outside the configuration are always the user's decision: remove or keep, and for a label retired outside setup, leave retired, restore and keep, or delete. Setup suggests no default.
- A removal deletes an unused label and retires one items carry (archives it on GitHub). Present every removal with its usage before approval.
- **Misplaced labels:** on first setup, a label with a configured name but in the wrong group, or a group of the wrong type, is a decision. Adopt moves it into place and keeps its items. Replace deletes it and creates the configured label, and is offered only when nothing carries it and, for a group, it has no child labels.
- **Remap:** to make existing labels configured values, pass them as `remap`. Setup renames, moves, and restyles each in place, so items keep it. Each value takes at most one label; setup never merges labels. Remaps aren't saved.
- **Single-select moves:** Linear keeps one label of a single-select group per item. When adopt or remap moves used labels into one, setup asks before planning it; present the warning and its alternatives.
- **Name clashes:** removing an unused label clears a clash with its name. A retired label keeps its name taken. Every conflict that no answer clears carries a `resolution`; follow it, then preview again.
- Setup changes only the catalog. Runtime applies labels to items ([labels](./integrations/shared.md#labels)).

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

Put both the tracker and forge role objects in the same integration object. Their servers and repositories follow the user's choices.

## Artifact persistence

The persistence and authority contract is in [artifacts](./artifacts.md#persistence-and-authority), including the ignore and exclude rules and Git-membership checks. For manual setup, create the configuration above, apply that contract's setup rule, then call `prepare_artifacts`. Call it again after configuration changes.

## MCP registrations

MCP settings are shared Pi configuration, not workflow JSON. Use `configure_mcp`; never compose transport entries by hand. It preserves unrelated settings, writes only environment-variable references, rejects conflicting names, never changes the Git index, and enables only the toolsets listed below.

| Target | File | Notes |
| --- | --- | --- |
| Local | `.agents/mcp.local.json`, with `mcpServers` | add exact `/.agents/mcp.local.json` to `.git/info/exclude` |
| Project | `.agents/mcp.json`, with `mcpServers` | committed |
| Global | `<agent-dir>/mcp.json`, with `mcpServers` | never the target for a private project registration |

**Credentials and toolsets:**

- Default credential variables: `LINEAR_API_KEY` for Linear, `GITHUB_PERSONAL_ACCESS_TOKEN` for GitHub.
- Every GitHub registration enables `context,issues,projects,pull_requests`, whichever roles it serves, so one server also files workflow reports to a GitHub-tracked workflow source. `context` provides `get_me`, which starting work uses to assign the authenticated user.

**Merging and registration:**

- The adapter merges global, committed project, then local entries by exact name; later entries replace earlier ones. Names differing only by `-` and `_` conflict.
- Both project tiers require trust; untrusted-project inspection doesn't read project MCP files.
- Every effective server is registered with `pi.registerMcpServer()`, and native Pi owns its transport. Native `/mcp` enable or exposure changes last for the session.
- Keep private project scope; never move a local registration into global settings.
- Inspection uses the same merge without running credential commands or opening provider connections.
- A new registration needs a Pi restart or reload before setup validates capabilities and writes workflow configuration.

Example project registrations produced by `configure_mcp`:

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
                "X-MCP-Toolsets": "context,issues,projects,pull_requests"
            }
        }
    }
}
```

## Project Policies

`.project/policies.md` is optional Markdown with user-approved additions or overrides to these workflows for this repository.

- Each policy names the stage or behavior it affects and says what it adds or replaces.
- Generic repository instructions belong in `AGENTS.md` or the harness equivalent; provider configuration belongs in the setup JSON files.
- Omit the file when the user declines. Precedence, overrides, and persistence are in [artifacts](./artifacts.md#project-policy-precedence).

Example:

```markdown
# Project Policies

- During Epic plan review, additionally check that every planned Task identifies its rollout stage.
- During Deliverable final review, additionally check the completion artifact against the repository's release checklist.
- Override Deliverable submission: on a submit request, commit locally, then wait for a separate explicit user request before pushing or creating a PR.
```
