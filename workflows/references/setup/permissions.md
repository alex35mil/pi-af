# Setup permissions

Read this when offering integration convenience permissions or accepted-artifact diff gates during project setup.

## Integration convenience permissions

Offer these only for selected, active integration providers, replacing `<server>` with the exact MCP server name.

- Deduplicate a server shared by tracker and forge.
- Number the options, include decline-all, and explain each option's access next to it.
- Recommend the frequent tracker writes, which avoid repeated Status, Phase, and plan-publication prompts.

| Role or provider | Recommended allow | Access and use |
| --- | --- | --- |
| Any active integration server | `mcp(<server>, hint: readOnly)` | All tools that server advertises with explicit `readOnlyHint: true`; useful for repeated tracker and PR reads. Trusts the server's annotation; missing or false hints don't match. |
| GitHub tracker | `mcp(<server>, projects_write)` | The entire Project mutation tool, including item and field updates for Status, Phase, and Priority, and its other mutations. |
| GitHub tracker | `mcp(<server>, issue_write)` | The entire issue create and update tool, including body, labels, fields, and state; useful for intake and metadata. |
| GitHub tracker | `mcp(<server>, add_issue_comment)` | The entire comment create and reaction tool; used for the first plan publication and discussion. |
| GitHub tracker | `mcp(<server>, update_issue_comment)` | The entire comment update tool; used to update the managed plan comment. |
| Linear tracker | `mcp(<server>, save_issue)` | The entire issue save tool, including creation, descriptions, labels, lifecycle, Priority, and relationships. |
| Linear tracker | `mcp(<server>, save_project)` | The entire Project save tool for Epics, including creation, description, labels, lifecycle, Priority, and other updates. |
| Linear tracker | `mcp(<server>, save_document)` | The entire document create and update tool, including attachment and reparenting; used for plan documents. Workflow updates omit parent arguments. |

**Limits:**

- A forge-only GitHub server gets read-only access, not tracker write recommendations.
- Omit inactive servers and unavailable tools.
- Never recommend whole-server write wildcards, PR merge allows, or unrelated writes. Never revoke existing allows.

**What an allow grants:**

- These rules aren't restricted by tool arguments, repository, or Project. They cover everything the server's credential can reach.
- They remove prompts, not workflow content, submission, or shipping approval gates.

### Inspect first

Before offering rules, call `inspect_permissions` with the selected providers' candidates, for example `{ "rules": ["mcp(<server>, hint: readOnly)", "mcp(<server>, issue_write)"] }`.

- It's read-only. It uses live advertised metadata and the permission engine's global, project, and local loading and matcher, makes no provider call, and changes no files.
- Required workflow read tools without true annotations stay uncovered. Inspect their exact selectors as needed to report that, without granting those selectors automatically.

Each candidate's result has:

- `status`;
- `coveredBy`: the covering source rules;
- `tools`: the currently matching tools, with existing modes and `blockers`;
- `unverifiedConflicts`: overlaps that lack metadata.

Results reflect persistent settings only; session overrides and skill-derived allows are excluded. Read-only rules cover future tools the server annotates true, but inspection describes only tools advertised today.

| Result | Behavior |
| --- | --- |
| `covered` | An equivalent or broader allow already covers it. Skip the addition; still report ask or deny blockers. |
| `available`, no blockers | Offer the allow for explicit selection. |
| `available`, partial blockers | Offer it with disclosure that the listed tools stay asked or denied; the rule helps the rest. |
| `blocked` | Every matching tool has an ask or deny blocker. Report them and skip the addition. |
| `unavailable` | No advertised tool matches. Skip it and don't claim access, even when a covering rule exists. |

**Coverage:**

- It uses selector containment, including equivalent spacing, server and tool wildcards, and verified annotations for hint-to-exact coverage.
- Exact allows for today's read tools don't cover a future-facing read-only selector. An unverified overlap isn't a proven match.

**Precedence and existing rules:**

- Deny wins over ask, which wins over allow.
- Keep all existing rule strings, order, and ask or deny constraints. Report blockers with their source paths, and never silently weaken them.

### Persist the selection

1. After the user selects rules, ask once whether permissions go in local or project settings, independently of the artifact and MCP choices.
2. Preview the exact `allow` and `ask` additions, skipped rules, conflicts, target, and any local exclusion before approval.
3. Call `configure_permissions` with strict `{ target: "project" | "local", allow: string[], ask: string[] }`:
   - both lists are explicit, and at least one rule is required;
   - only MCP selectors are accepted as new allows;
   - use `[]` for an unselected list.

   Declining every rule calls no writer.

**What the writer does:**

- It rechecks current settings and live metadata, skips covered, blocked, or unavailable allows and exact ask duplicates, and merges only accepted additions.
- It reports the actual `added`, `skipped`, and `inspection` results, and keeps unrelated keys, the default mode, keybindings, deny rules, and existing lists.
- Invalid settings or rules fail before any change. A no-op leaves files and exclusions untouched.
- Read-back validates the result. A skipped rule is not a new grant.

## Accepted-artifact permission gates

Workflow skills allow routine `.project/` bookkeeping. Offer explicit artifact diff gates independently of integration allows. When accepted, merge them through the same `configure_permissions` call, using repository-relative paths so they match consistently. This ask-only example uses an empty allow list:

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

**Targets:**

- The target is committed `.agents/permissions.json` (`project`) or local `.agents/permissions.local.json` (`local`).
- Before changing local settings, the tool checks the file is outside Git and ensures exact `/.agents/permissions.local.json` in `.git/info/exclude`. It never changes the index, and a no-op adds no exclusion.

Artifact persistence and permission-settings persistence are separate user decisions.
