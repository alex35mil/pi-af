# Permission Extension

Controls tool execution with configurable allow/deny/ask rules. Prompts the user for confirmation before executing tools that aren't explicitly allowed.

## Configuration

Settings file: `permission.settings.json` (3-tier loading):

| Tier | Path |
|------|------|
| Global | `~/<agent-dir>/permission.settings.json` |
| Project | `<repo-root>/.agents/permission.settings.json` |
| Local | `<repo-root>/.agents/permission.settings.local.json` |

### Schema

```json
{
  "defaultMode": "ask",
  "allow": ["read", "bash(git *)"],
  "deny": ["bash(rm -rf *)"],
  "ask": ["write", "edit"],
  "keybindings": {
    "autoAcceptEdits": "ctrl+shift+a"
  }
}
```

### Rule Format

- `"read"` — blanket match on tool name
- `"mcp__playwright__*"` — glob match on tool name
- `"bash(git *)"` — match tool `bash` where command matches `git *`
- `"edit(/tmp/*)"` — match tool `edit` where path matches `/tmp/*`

### Argument Matching

| Tool | Matched against |
|------|----------------|
| `bash` | each syntax-visible Bash command node, including commands nested in substitutions |
| `edit`, `write`, `read` | file path |
| `grep`, `find`, `ls` | path argument |
| `fetch` | URL |

### Evaluation Order

Session override > `deny` > `ask` > built-in/configured `allow` > `defaultMode` (default: `"ask"`). The strictest result across Bash command nodes wins.

Session overrides are final for the whole tool call. In particular, session `allow` deliberately skips Bash parsing and redirect checks.

Exact literal `true` and `false` Bash commands are built-in allow rules. Explicit session, deny, or ask rules still take precedence.

### Skill-Derived Rules

Trusted local skills (global + project) can contribute allow rules via YAML frontmatter:

```yaml
---
allowed-tools:
  - "bash(ls *)"
  - "read"
---
```

## Safety Features

- Bash is parsed with tree-sitter; command nodes are checked across newlines, lists, pipelines, compound statements, and nested substitutions
- Runtime indirection such as `eval`, `bash -c`, `source`, aliases, functions, and dynamic command names is checked as the outer invocation only
- Shell-state-only assignments/declarations emit no outer command, while syntax-visible commands nested inside them are still checked
- A leading `cd <dir> &&` is ignored only when `<dir>` resolves to the current directory
- Writable file redirects (`>`, `>|`, `>>`, `&>`, `&>>`, and filename-targeted `>&word`) escalate otherwise-allowed Bash calls to `"ask"`
- Exact `/dev/null` targets, input redirects, fd duplication/closing, and process-substitution targets do not add a redirect prompt; nested process-substitution commands are still checked
- Parser/WASM failures and trees containing `ERROR` or `MISSING` nodes are denied without fallback; this includes valid syntax unsupported by the grammar, such as `<>`
- Bash wildcard rules match across newlines within a command node
- Headless mode (no UI) blocks all `"ask"` calls

## Commands

| Command | Description |
|---------|-------------|
| `/permission-toggle-auto-accept` | Toggle auto-accept for edit/write tools in the current session |
| `/permission-mode` | Set permission mode for a specific tool (session only) |
| `/permission-settings` | Show resolved settings, skill-derived rules, and session overrides |

## Neovim Integration

The extension includes support for pi.nvim: edit/write tool calls present Accept/Reject choices via `ctx.ui.select`, and the nvim plugin can respond with structured JSON containing the user's decision, optional modified file content, and optional review notes.

pi.nvim may return:

```json
{"result":"Accepted","notes":[...]}
{"result":"AcceptModified","content":"...","notes":[...]}
{"result":"Rejected","notes":[...]}
```

Review notes use this shape:

```ts
type ReviewNote = {
    path: string
    side: "current" | "proposed"
    lineStart: number
    lineEnd: number
    lines: string[]
    note: string
}
```

Rejection policy:

- Rejected with notes: file unchanged, agent continues with the review notes and is instructed to address them in a follow-up edit.
- Rejected without notes/cancel: abort the turn.
