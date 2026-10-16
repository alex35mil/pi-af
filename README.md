# pi-af

My [pi](https://pi.dev) setup for coding agent workflows.

> [!IMPORTANT]
> This setup is built for [pi.nvim](https://github.com/alex35mil/pi.nvim). Some extensions (notably [permission](./extensions/permission/)) rely on the Neovim plugin for UI interactions like edit reviews. Using this package with the pi TUI will most likely require adjustments.

## Extensions

- [**context**](extensions/context/) — `/context` command for session introspection
- [**fetch**](extensions/fetch/) — `fetch` tool for retrieving URLs as markdown
- [**mcp**](extensions/mcp/) — MCP server integration
- [**permission**](extensions/permission/) — tool execution control with allow/deny/ask rules
- [**rules**](extensions/rules/) — rule files injected into system prompt
- [**web-search**](extensions/web-search/) — `web_search` tool via Brave Search API

## Skills

- [**commit**](skills/commit/SKILL.md) — `/skill:commit` creates an authorized, focused Git commit while preserving unrelated work. The bundled skill follows the repository's commit style; Conventional Commits are the default only when no style is established.

## Project workflows

[`workflows/`](workflows/) contains reusable workflows for Epics, Tasks, and Gigs:

- `/project-setup` — interactively configure artifacts, branches, optional integrations, and policies;
- `/epic` — plan and maintain an initiative of prospective Tasks;
- `/task` — initialize or resume work belonging to one Epic;
- `/gig` — initialize or resume standalone work;
- `/backlog` — optional integration-only future-work intake;
- `/todo` — optional integration-only ready-work intake.

Say “Report this workflow issue” to prepare ordinary Todo work in the workflow source project's tracker. Set `workflowProject` to that source checkout's absolute path in private global `workflows.settings.json` in Pi's agent directory; its existing tracker configuration stays authoritative. The exact sanitized report and destination require approval, with the named MCP tools available in the reporting session. Missing configuration errors with what to create and where, without starting setup. See [workflow reporting](workflows/README.md#report-a-workflow-problem).

Authoritative `.project/` artifacts use either versioned or unversioned Git policy; unversioned mode excludes them from Git and never projects workflow-system traces. Optional tracker support includes GitHub or Linear; optional forge support currently uses GitHub. Runtime provider operations use Pi-registered MCP tools through the same permission extension as every other agent. Guided setup may additionally inspect Linear and provision an explicitly approved GitHub Project through credential-isolated direct APIs. See the [workflow setup and artifact guide](workflows/README.md).
