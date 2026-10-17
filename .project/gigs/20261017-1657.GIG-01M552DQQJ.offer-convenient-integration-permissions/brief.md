# Brief

Offer convenient integration permissions during project setup

During project setup, optionally suggest convenient MCP allow rules only for active integration providers, including read-only access and selected write tools.

Examples for GitHub:

- `mcp(github, hint: readOnly)`
- `mcp(github, projects_write)`
- `mcp(github, issue_write)`

Explain the access each suggested rule grants, including that write-tool allows cover mutations rather than read-only operations. Let the user select which rules to accept.

Require user approval and merge accepted rules through `configure_permissions`, preserving unrelated settings. Define how to handle existing matching rules before implementation.

Recommend the best allow options for frequently called tools to avoid repeatedly prompting the user.
