# Upgrading

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
