# Permissions Extension

Controls tool execution with configurable allow/deny/ask rules. Prompts the user for confirmation before executing tools that aren't explicitly allowed.

## Configuration

Settings file: `permissions.json` (3 tiers, each with a runtime-specific file):

| Tier    | Shared                                       | Runtime                                                |
| ------- | -------------------------------------------- | ------------------------------------------------------ |
| Global  | `~/<agent-dir>/permissions.json`             | `~/<agent-dir>/permissions.<runtime>.json`             |
| Project | `<repo-root>/.agents/permissions.json`       | `<repo-root>/.agents/permissions.<runtime>.json`       |
| Local   | `<repo-root>/.agents/permissions.local.json` | `<repo-root>/.agents/permissions.<runtime>.local.json` |

### Runtime

`PI_AF_RUNTIME` says where Pi runs: unset (or empty) means `host`, `sandbox` means a sandboxed worker such as a [nono worker](../../examples/workers/). Any other value is invalid: tools are blocked until it's fixed, like invalid settings.

Only the current runtime's files load. They merge in this order, the more specific location winning: global, global runtime, project, project runtime, local, local runtime. `allow`, `ask`, and `deny` lists from every loaded file are combined, and deny or ask beats allow wherever it comes from. Only `defaultMode` and keybindings take the last value set.

For example, a global `permissions.sandbox.json` with `"defaultMode": "allow"` relaxes confirmations in every worker, unless a project's `permissions.json` sets its own `defaultMode`. Keep `.agents/permissions.<runtime>.local.json` out of Git, like `.agents/permissions.local.json`. Project setup's `configure_permissions` writes only the shared project or local file; runtime files are edited by hand.

`/permissions-settings` shows the runtime and the files that were loaded.

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

- `"read"` — blanket match on a tool name
- `"bash(git *)"` — match tool `bash` where command matches `git *`
- `"edit(/tmp/*)"` — match tool `edit` where path matches `/tmp/*`
- `"mcp(playwright, *)"` — match every tool from the `playwright` MCP server
- `"mcp(github, get_issue)"` — match one server-advertised MCP tool
- `"mcp(github, hint: readOnly)"` — match tools from `github` with `readOnlyHint: true`
- `"mcp(*, hint: readOnly)"` — match read-only-annotated tools from every MCP server

MCP selectors work in `allow`, `ask`, and `deny`. Server and tool selectors support either an exact name or the whole `*` wildcard. Names may contain only ASCII letters, digits, `_`, `.`, or `-`.

Only an explicit MCP `readOnlyHint: true` matches `hint: readOnly`; missing or false values do not. **Servers tell Pi whether tools are read-only; Pi cannot verify that claim. A hint rule can therefore change a tool from the default `deny` mode to `ask`. Only use hint rules with servers you trust.**

### Argument Matching

| Tool                    | Matched against                                                                   |
| ----------------------- | --------------------------------------------------------------------------------- |
| `bash`                  | each syntax-visible Bash command node, including commands nested in substitutions |
| `edit`, `write`, `read` | file path                                                                         |
| `grep`, `find`, `ls`    | path argument                                                                     |
| `fetch`                 | URL                                                                               |

### Evaluation Order

Without a session mode: `deny` > `ask` > built-in/configured `allow` > `defaultMode` (default: `"ask"`). The strictest result across Bash command nodes wins.

Session modes (`/permissions-mode` and auto-accept) never weaken explicit `deny` or `ask` rules. With a session mode, the result is the stricter of the session mode and any matching explicit `deny`/`ask` rule. When no explicit rule matches, the session mode replaces allow rules and `defaultMode`. So a session `deny` always blocks, an explicit `deny` always blocks, and an explicit `ask` still prompts under a session `allow`.

- **Bash:** when no `deny`/`ask` rule targets `bash`, a session mode skips Bash parsing and redirect checks. Otherwise every command node is checked against those rules, and a command that can't be parsed is denied. The redirect check is not an explicit rule, so a session `allow` still skips it.
- **MCP:** a tool without live catalog metadata can't be matched against rules. Under a session `allow` or `ask` it is denied when any `deny`/`ask` rule is `*` or an `mcp(...)` rule; otherwise the session mode applies. Without a session mode it is always denied.

Exact literal `true` and `false` Bash commands are built-in allow rules. Session modes and explicit deny or ask rules still take precedence.

**What a block does:**

- A `deny` blocks only that call and returns the cause to the model without ending the turn, so the model can recover. The reason names the matched rule, plus the command node for Bash, or the session mode, `defaultMode`, an unparseable command, or missing MCP metadata.
- Rejecting an `ask` prompt ends the turn: it's a deliberate stop. A file-review rejection with notes returns the notes and keeps the turn.

### Skill-Derived Rules

Trusted local skills (global + project) can contribute allow rules via YAML frontmatter:

```yaml
---
allowed-tools:
    - "bash(ls *)"
    - "read"
    - "mcp(github, get_issue)"
---
```

### Persistent MCP inspection

Project setup's `inspect_permissions` tool reuses this extension's persistent settings loader, MCP parser, and matcher to report covered rules, current matching tools, and ask/deny blockers with source paths. Inspection excludes session overrides and skill-derived allows; those temporary grants are not durable coverage. Equivalent and broader selectors cover narrower rules, but exact allows for today's read tools do not cover future annotated tools under a read-only selector. Unknown annotations never prove a read-only match.

Setup's `configure_permissions` merges approved MCP `allow` and `ask` lists into the selected project/local file, preserving existing constraints and unrelated settings. It skips covered, fully blocked, or unavailable allows and reports partial blockers without removing them. An MCP write allow grants every operation exposed by that tool across its credential scope, not just the workflow's current repository or operation. See [setup permissions](../../workflows/references/setup/permissions.md#integration-convenience-permissions) for recommendations and approval behavior.

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
- A deny blocks the call and returns its matched rule or cause to the model without ending the turn; rejecting an ask prompt ends the turn
- Invalid JSON, malformed MCP rules, unknown hints, invalid MCP names, and legacy MCP rules fail closed
- With invalid settings, ordinary prompts and all agent tools are blocked; slash commands and user-entered `!` shell commands remain available for recovery
- Interactive sessions show a persistent error widget above the editor until valid settings are loaded

## Commands

| Command                           | Description                                                        |
| --------------------------------- | ------------------------------------------------------------------ |
| `/permissions-toggle-auto-accept` | Toggle auto-accept for edit/write tools in the current session     |
| `/permissions-mode`               | Set permission mode for a specific tool (session only)             |
| `/permissions-settings`           | Show resolved settings, skill-derived rules, and session overrides |

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

Native edit/write execution wrappers return success for editor-applied Accepted/AcceptModified outcomes without applying the change again. Ordinary acceptance delegates to native execution once. Permission and scoped-rule gates run before editor review or mutation.

Review notes from nested calls stop only the codemode script, preserve the child's outcome, and reach the model in full even when the script discards its result. Already completed effects are not rolled back. The model must quote each note completely and respond before further tool calls.

Rejection policy:

- Rejected with notes: file unchanged; the model continues to address the notes.
- Rejected without notes/cancel: abort the turn.
