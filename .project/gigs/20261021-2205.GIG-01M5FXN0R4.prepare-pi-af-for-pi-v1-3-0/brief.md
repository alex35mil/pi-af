# Brief

Prepare pi-af for Pi v1.3.0 before upgrading the running harness. pi.nvim has already been updated.

- Replace the permission bridge’s accepted-edit blocking and `message_end` error repair with edit/write execution wrappers that return success for editor-applied changes without applying them again. Preserve the permission evaluator, rules checks, rejection behavior, and review-note response policy.
- Migrate test execution contexts to v1.3.0’s `ExtensionToolContext`, including `tools` and `executeTool`. Investigate runtime compatibility beyond type-checking.
- Correct `/context` to distinguish complete session billing from current context usage, represent unknown context accurately, and avoid overlapping tool-category counts.
- Refresh development dependency resolution and the lockfile so verification targets Pi v1.3.0 rather than 0.79.6.
- Include migration to Pi’s built-in MCP support. Reuse the existing publication policy and reusable wrapper, adapting the backend binding, configuration, permission metadata, and affected workflow integrations.
- Ensure applicable path-scoped rules reach the model before it composes a codemode script using those files.
- Investigate and address other evidenced compatibility requirements before the upgrade. Close #38 as addressed upon completion; leave workflow-context optimization to #70.
