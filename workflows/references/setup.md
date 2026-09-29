# Project setup configuration contract

This is the operational source of truth for files created or changed by `/project-setup`. The setup skill owns the interactive sequence, this reference owns the configuration-file contract, and selected provider references own provider behavior.

## General rules

- Every workflow-owned JSON object rejects unlisted properties, contains no credentials, and ends with a newline.
- Workflow-owned JSON stores only operational fields.
- Preserve unrelated keys when merging into shared Pi settings files.
- Omit optional workflow files instead of writing empty, disabled, or placeholder configuration.
- Preview exact file content and exact ignore/exclude additions before writing them.
- Never stage files or alter the Git index.

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

A static format beginning with `username` requires this strict object in global `~/<agent-dir>/workflows.settings.json` or repository-local `.project/config.local.json`:

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

Issue and Project mappings each require all six queue/lifecycle keys and six distinct, non-empty provider option names. A previous mapping containing `planning` instead of `todo` is invalid and requires explicit configuration migration; setup never rewrites it implicitly. `team` is non-empty. Linear Priority is native and is not configured here.

During guided setup, `inspect_linear_workspace` reads the authenticated workspace, authenticated viewer, accessible teams, team issue statuses, Project statuses, and workspace branch template through Linear's public GraphQL API. `viewer.name` is Full Name; `viewer.displayName` is the workspace-unique Username/Nickname and is returned as `viewer.username`. The API performs no mutation. Setup persists only the exact team and status names the user selects; provider IDs, viewer identity, branch template, and credentials remain outside workflow configuration. A recognized official MCP registration supplies its credential environment-variable name, never its value.

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
- one exact workflow-owned repository Planning label name;
- exact workflow-owned repository Kind label names for Epic and all six Deliverable kinds;
- Priority with `issue` or `project` scope, a non-empty field name, and unique non-empty values that exclude exact lowercase `not set`;
- Internal ID with `issue` or `project` scope and a non-empty field name.

All configured Project-scoped field names must be distinct. Planning and Kind label names must be distinct case-insensitively. Status is always Project-scoped. Planning projects active workflow planning; Kind classifies versioned GitHub issues through exactly one managed label after initialization. Native GitHub issue Type remains independent and unmanaged. Do not substitute other labels, Custom Properties, or a different field scope.

Example returned configuration for a Project-contained tracker (use actual provisioning output, not these sample identities):

```json
{
    "tracker": {
        "provider": "github",
        "mcpServer": "github",
        "repository": { "owner": "octocat", "repo": "example" },
        "project": { "owner": "octocat", "ownerType": "user", "number": 3 },
        "labels": {
            "planning": "Planning",
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

## Artifact persistence

Read and follow `./artifacts.md` for the canonical persistence and authority contract, including exact ignore/exclude rules, Git-membership checks, and both mode transitions. For manual setup, create the configuration above, apply that contract's setup rule, then call `prepare_artifacts`. Call preparation again after configuration changes.

## MCP registrations

MCP settings are shared Pi configuration, not workflow JSON. Use `configure_mcp`; do not compose server transport entries manually. It preserves unrelated settings and writes only environment-variable references.

- Local target: `.agents/mcp.settings.local.json`; add exact `/.agents/mcp.settings.local.json` to `.git/info/exclude`.
- Project target: `.agents/mcp.settings.json`.
- Linear default credential variable: `LINEAR_API_KEY`.
- GitHub default credential variable: `GITHUB_PERSONAL_ACCESS_TOKEN`.
- GitHub tracker enables `issues,projects`; GitHub forge enables `pull_requests`; selecting both enables all three.

A new registration requires Pi restart or reload before setup validates capabilities and writes workflow configuration. The setup snapshot may report provider and credential environment-variable names for recognized official registrations; it never reports authorization header values or credential values.

Example registrations produced by `configure_mcp` for Linear plus both GitHub roles:

```json
{
    "servers": {
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

## Accepted-artifact permission gates

Workflow skills allow routine `.project/` bookkeeping. When the user accepts explicit diff gates, call `configure_permissions` with the selected target and exact rules. The tool validates and merges them into `ask` without replacing unrelated settings. Use repository-relative workflow write/edit paths so the gates match consistently:

```json
{
    "target": "local",
    "rules": [
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

The target is either committed `.agents/permission.settings.json` (`project`) or local `.agents/permission.settings.local.json` (`local`). For local settings, the tool verifies that the file is outside Git and adds exact `/.agents/permission.settings.local.json` to `.git/info/exclude`. Artifact persistence and permission-settings persistence are separate user decisions.
