# Upgrading

## Pi 1.5.2

The package now requires Pi 1.5.2. Upgrade Pi before reloading the package; older Pi isn't supported.

- Validation runs on `@earendil-works/pi-schema`, the validator Pi uses for tool arguments, instead of `typebox/value`. The package installs it as its own dependency, pinned to Pi's version. Tool schemas are still built with TypeBox, which Pi supplies.
- Validation stays strict: unknown properties are rejected and values aren't converted, as before.
- Error details for invalid configuration and workflow files use pi-schema's wording, for example `invalid .project/config.json: /extra: unknown field` instead of `must not have additional properties`. Update anything that matches the old wording.

No `.project` artifact or settings migration is needed.

## GitHub MCP registrations get every workflow toolset

`configure_mcp` now gives every GitHub registration `context,issues,projects,pull_requests`, whichever roles it serves. A registration used only for the forge previously got just `pull_requests`, so workflow reports to a GitHub-tracked workflow source couldn't create issues or set Project fields through it.

- In each GitHub registration in `.agents/mcp.json`, `.agents/mcp.local.json`, or the global `mcp.json`, set `X-MCP-Toolsets` to `context,issues,projects,pull_requests`, then reload Pi.
- `configure_mcp` no longer accepts `roles` for GitHub registrations; drop it from scripts that call the tool.

No `.project` artifact migration is needed.

## Label groups

Labels in `.project/integrations.json` are now label groups under `tracker.labels.groups`. Each label stores its name, color, and description. Kind is the group with the reserved key `kind`. A configuration in the old shape fails validation, which stops every workflow command until it's migrated.

**GitHub Kind labels.** Replace `tracker.labels.kind`:

```json
"labels": {
    "kind": {
        "epic": "Kind: Epic",
        "deliverableKinds": { "feature": "Kind: Feature", "bugfix": "Kind: Bugfix" }
    }
}
```

with the `kind` group:

```json
"labels": {
    "groups": {
        "kind": {
            "appliesTo": ["epic", "deliverable"],
            "cardinality": "exactlyOne",
            "values": {
                "epic": { "name": "Kind: Epic", "color": "#8250DF", "description": "A multi-deliverable initiative." },
                "feature": { "name": "Kind: Feature", "color": "#0969DA", "description": "New user-visible or system capability." },
                "bugfix": { "name": "Kind: Bugfix", "color": "#CF222E", "description": "Correction of defective behavior." }
            }
        }
    }
}
```

- Keep each label name exactly as it was. `epic` becomes a value key next to the six Deliverable kinds (`feature`, `bugfix`, `research`, `refactor`, `audit`, `chore`), and all seven are required when `appliesTo` lists both item types. The examples above are shortened.
- Copy each label's current color and description from the repository's label settings, so the next setup run proposes no changes.
- Without Kind labels, leave `labels` out.

**Linear Phase groups.** In `tracker.phase.issues` and `tracker.phase.projects`, `group` and each Phase value change from a name to a label definition. `"group": "Phase"` becomes `"group": { "name": "Phase", "color": "#…", "description": "…" }`, and the same applies to `planning`, `execution`, and `selfReview`. Use the existing names and the current colors and descriptions from Linear's label settings.

After editing, run `/project-setup` once. It checks the configured labels against the tracker and lists every label outside the configuration, and you decide whether to keep or remove each one. Your answers are saved, so later runs ask only about labels added since.

No `.project` artifact migration is needed.

## Assigning work to the user who starts it

Starting an Epic, Task, or Gig now assigns its tracker item to the authenticated user. On GitHub this uses `get_me` from the `context` toolset. Add `context` to `X-MCP-Toolsets` in each GitHub tracker registration (for example `context,issues,projects,pull_requests`) by rerunning `/project-setup` or editing the MCP registration, then reload Pi. Until then, work starts without an assignee. Linear needs no change.

No `.project` artifact migration is needed.

## Shipping terminology and evidence inputs

Deliverable merge, Done, and cleanup is now called **shipping**, matching incoming-PR shipping. Names for an activity use nouns ("shipping", "cancellation"). There are no aliases; update custom permission selectors and scripts that use the old names.

| Old name | New name |
| --- | --- |
| `prepare_integration_finish` | `prepare_integration_shipping` |
| result field `roles.forge.finish` | `roles.forge.shipping` |
| `plan_incoming_pr_ship` | `plan_incoming_pr_shipping` |
| `plan_incoming_pr_cancel` | `plan_incoming_pr_cancellation` |
| incoming Project `action` values `"ship"` and `"cancel"` | `"shipping"` and `"cancellation"` |

- `cleanup_github_delivery_branch` takes the merged PR's exact `pull_request_read` get as `evidence` instead of pre-extracted `merge` facts.
- A Deliverable may have several commits within its accepted scope. Forge PR intent is saved before staging the last commit and committed with the work.

No `.project` artifact migration is needed.

## Workflow tool discovery and names

Workflow operations now use concrete, operation-specific tools discovered through the existing permission-aware Codemode. Keep Codemode enabled for workflows; explicit tool allowlists and exclusions remain authoritative. See the [current operation catalog](workflows/references/tools.md). Ordinary coding tools remain direct.

Update custom scripts, instructions, and explicit workflow-tool permission selectors to the current names. Replaced dispatch interfaces have no aliases. Incoming-PR checkout actions each have their own selector and remain outside skill-derived allows; review the [complete ask example](workflows/references/pr/incoming.md#existing-permission-prompts) before approving settings changes. Package upgrades do not rewrite private permission settings.

This interface change requires no `.project` artifact migration. Domain schemas, persisted state, approval gates, and provider-side records retain their existing contracts. Reviewer model overrides remain explicit; otherwise the configured startup default is used, not the parent conversation model. Claude Code reviewers require the installed/enabled provider, loaded alone alongside rules and permissions; no provider installation or credential/default-model change occurs.

## Pi 1.3.0

pi-af now uses native MCP and tool execution APIs. Configuration names change without compatibility readers:

| Family           | Previous filenames                                           | Current filenames                            |
| ---------------- | ------------------------------------------------------------ | -------------------------------------------- |
| MCP              | `mcp.settings.json`, `mcp.settings.local.json`               | `mcp.json`, `mcp.local.json`                 |
| Permissions      | `permission.settings.json`, `permission.settings.local.json` | `permissions.json`, `permissions.local.json` |
| Web search       | `web-search.settings.json`, `web-search.settings.local.json` | `web-search.json`, `web-search.local.json`   |
| Global workflows | `workflows.settings.json`                                    | `workflows.json`                             |

Rename files in place, preserving their values and global/project/local scopes. Project settings stay under `.agents`; every MCP tier uses `mcpServers` instead of `servers`. Pi's own `settings.json` and `.project/config.json` / `config.local.json` are unchanged.

Verify that private local files remain outside Git before renaming them. A global `**/.agents/*.local.json` ignore rule covers both the old and new local filenames; existing repository-local exclusions can instead be updated to the new names. Private project-local MCP registrations stay project-local.

The permissions extension is now `extensions/permissions/`. Update explicit extension paths and custom command references from `/permission-*` to `/permissions-*`, including `/permissions-toggle-auto-accept`, `/permissions-mode`, and `/permissions-settings`.

Coordinate live private/global settings renames with activation of Pi 1.3.0. Do not reload the changed extensions into an older running harness. Repeat the configuration migration explicitly in each consuming checkout; upgrading this package does not rename other projects' files automatically.
