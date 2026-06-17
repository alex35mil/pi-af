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
| `bash` | command string (each segment in pipelines checked independently) |
| `edit`, `write`, `read` | file path |
| `grep`, `find`, `ls` | path argument |
| `fetch` | URL |

### Evaluation Order

`deny` > `ask` > `allow` > `defaultMode` (default: `"ask"`)

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

- Bash commands are split on `|`, `||`, `&&`, `;` — the strictest mode across all segments wins
- Shell output redirections (`>`, `>>`, `&>`) escalate otherwise-allowed bash commands to `"ask"` (redirections to `/dev/null` are exempt)
- `cd <dir> && <cmd>` prefixes are normalized before matching
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
    line: number
    lineText: string
    note: string
}
```

Rejection policy:

- Rejected with notes: file unchanged, agent continues with the review notes and is instructed to address them in a follow-up edit.
- Rejected without notes/cancel: abort the turn.
