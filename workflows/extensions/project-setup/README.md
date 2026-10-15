# Project setup extension

Registers `/project-setup` and the setup-owned `inspect_project_setup`, `prepare_artifacts`, `configure_mcp`, `configure_permissions`, `inspect_linear_workspace`, and `provision_github_project` tools.

The command and read-only inspection tool share `inspectProjectSetup`. Natural-language setup obtains the same setup/Git/binding context and credential-redacted MCP inventory without requiring valid workflow configuration, writing files, or calling providers. The tool returns JSON text and structured details; only the command injects a kickoff message. Provider availability and mutation approval remain separate from configured-registration inspection.

GitHub Project/native Status/Phase field and Kind-label provisioning lives in `github-project.ts`; MCP and permission configuration live in `mcp.ts` and `permissions.ts`, with shared local-settings exclusion in `local-settings.ts`. Linear workspace inspection remains with its provider under `../integrations/tracker/linear.ts`, while shared project configuration remains under `../__lib/`. See [guided setup](../../skills/project-setup/SKILL.md) and the [setup contract](../../references/setup.md).
