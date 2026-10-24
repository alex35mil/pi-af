# Brief

1. Fix compatibility with Claude Code and GLM by replacing union-based model-facing tool APIs with separate operation-specific tools. Use concrete object schemas and string enums, not catch-all objects full of optional or nullable fields.
2. Preserve internal domain unions, strict validation, lifecycle behavior, approval gates, and safety rules.
3. Update skills, workflow instructions, references, and tests to use the new interfaces without compatibility aliases.
4. Make reviewer loading provider-aware: load the Claude Code provider extension when the selected reviewer model requires it, preserving read-only restrictions and extension isolation.
5. Add schema compatibility and reviewer-loading tests, then run typechecking and the test suite.
6. Include #70, “Reduce initial context overhead from workflow tools,” in this Gig: evaluate on-demand discovery and workflow-stage exposure using Pi 1.3.0’s tool-loading capabilities, prioritizing project-setup tools and large repeated schema structures. Measure tool-definition context before and after the changes. Preserve discoverability, validation, approval gates, permissions, workflow transitions, and session resume. Design an explicit inventory of meaningful operations rather than mechanically expanding every schema combination, and test per-stage tool count and context cost.

Exclude installation, default-model changes, mid-conversation switching, and MCP migration or optimization of the superseded MCP extension. Keep #70 open until this combined work is delivered.
