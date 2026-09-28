# Project setup extension

Registers `/project-setup` and the setup-owned `prepare_artifacts`, `configure_mcp`, `configure_permissions`, `inspect_linear_workspace`, and `provision_github_project` tools.

GitHub Project/native Status and Planning-label provisioning lives in `github-project.ts`; MCP and permission configuration live in `mcp.ts` and `permissions.ts`, with shared local-settings exclusion in `local-settings.ts`. Linear workspace inspection remains with its provider under `../integrations/tracker/linear.ts`, while shared project configuration remains under `../__lib/`. See [guided setup](../../skills/project-setup/SKILL.md) and the [setup contract](../../references/setup.md).
