# Context Extension

Provides a `/context` command that shows session introspection: model info, context usage breakdown, tools, skills, and session stats.

## Usage

```
/context
```

Opens an editor view with:

- **Context Usage** — current occupancy, percentage, and free space; unknown values stay unknown, including after compaction
- **Saved Context Components** — estimates for the current system prompt, saved tool declarations in disjoint built-in/extension/MCP categories, and projected message content
- **Tools** — registered tools, active selections, script-callable tools, exposure, and per-tool saved-schema estimates
- **Skills** — discovered skills and their file paths
- **Session Billing** — message counts and complete input/output/cache tokens and cost across all session branches, including tool, standalone, compaction, and branch-summary usage

Saved transcript declarations are not the final provider loadout: codemode and other loadout transformations can change the declarations a request sends. Component estimates are not an exact sum of occupancy. Deferred or hidden registration alone does not contribute a saved tool declaration. Billed tokens are cumulative request usage, not the size of messages currently in context.

## Configuration

None. The extension works out of the box.
