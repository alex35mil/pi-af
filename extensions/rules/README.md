# Rules Extension

Discovers rule files and delivers them to the agent. Rules are Markdown files that guide the agent's behavior for specific files or the entire project.

## Rule Locations

| Scope   | Directory                    |
| ------- | ---------------------------- |
| Global  | `~/<agent-dir>/rules/`       |
| Project | `<repo-root>/.agents/rules/` |

All `.md` files in these directories (including subdirectories) are discovered.

## Rule Types

### Always-on Rules

No frontmatter `paths` field. Body injected into the system prompt on every turn.

```markdown
# coding-style.md

Use 2-space indentation. Prefer const over let.
```

### Path-Scoped Rules

Have a `paths` glob list in YAML frontmatter. Delivered via read tool results when the agent reads a matching file.

```markdown
---
paths:
    - "src/components/**"
    - "*.test.ts"
---

# component-rules.md

Always use functional components with hooks.
```

### Glob Syntax

Supports `*`, `**`, `?`, and brace expansion (`{a,b}`). Paths are matched relative to the repo root.

## How It Works

### System Prompt

- Always-on rules enter the system prompt with their full body.
- Path-scoped rules stay lazy. Guidance tells the model to read relevant files before composing an editing script; unrelated rule bodies are not injected at startup.

### Queued and Model-Visible Rules

A successful matching read appends the complete rule body and patterns and queues delivery. Reading a rule file itself also supplies its complete reminder, including when the requested file range is only its header.

A nested read reaches only its script. When the script returns, missing reminders are added to the branch's model context after the tool batch, even when the script discarded its read result. These messages persist so the rules remain available in later requests.

The extension checks the actual projected model context, then confirms visibility only after a successful assistant response. A failed or aborted model response does not establish visibility. Already-visible scopes receive compact reminders; another file in the same scope needs no additional rule-loading round trip.

### Edit Blocking

Edit/write calls are blocked before editor review or mutation while an applicable rule is unseen. A read earlier in the same pre-authored tool batch or script does not unlock the edit. The script must return to the model, which receives the rules before composing further work.

Rule versions include the source path, patterns, and body. Changed rules require fresh delivery rather than inheriting an older version's visibility.

### Compaction

Compaction clears queued, prepared, and visible rule state and persists the reset. The edit blocker re-engages and the next matching read supplies a full reminder. Pre-compaction read metadata cannot restore visibility, even when its text remains in the retained transcript tail.

### Branches and Session Replay

Confirmed visibility is stored in branch-local `rules-state` entries. Direct-read and reminder-message metadata retain pending delivery without treating it as authorization. Tree navigation and a fresh session runtime restore only the selected branch's current rule versions; abandoned branches do not grant access. `/rules` reports pending delivery separately from active rules.

## Commands

| Command  | Description                                        |
| -------- | -------------------------------------------------- |
| `/rules` | Show discovered rules and current activation state |
