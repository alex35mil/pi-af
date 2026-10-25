# Brief

Tighten workflow instructions and cap their context size

Workflow instructions have grown faster than the behavior they describe. `workflows/references` and `workflows/skills` went from ~117 KB in late September to ~283 KB in late October. Starting a GitHub-tracked Gig now loads ~121 KB (~30k tokens) of instructions before any work begins. The text is also getting harder to follow, so agents miss or misread rules.

Rewrite the agent-facing instructions so they are shorter and easier to follow, without changing workflow behavior or weakening safeguards.

- **State each shared rule once.** Uncertain-outcome recovery, clear-success handling, the MCP no-bypass boundary, migrations, and Phase transitions are restated across up to 17 files. Keep one owner for each rule and refer to it by name elsewhere.
- **Load rarely used procedures only when needed.** Split rarely used paths out of `deliverable.md`, `integrations/shared.md`, and `pr/incoming.md`, such as finish, cleanup, publication recovery, design artifacts, kind changes, and migrations. Read them only when that step is reached.
- **Remove text the tools already enforce.** Drop input-field rules, fact shapes, and pagination mechanics that tool schemas and `describeTool()` already provide. Rely on tool errors for rejected inputs.
- **Move maintainer notes out of agent instructions.** Module ownership, naming policy, and file inventories go into the `workflows/extensions/*/README.md` files.
- **Make the writing readable.** Use imperative steps, one rule per bullet, and tables for state machines. State the positive rule before its exceptions. Avoid slash lists, and use "exact" only where it changes behavior. Break up long steps such as `deliverable.md` Implementation steps 11–14.
- **Prevent regrowth.** Add a short style guide for instruction prose, and a test that limits how much instruction text each skill loads up front.

Depends on #13: phrase-matching tests currently make every rewrite expensive. Related to #71, which reduces repeated work; this issue reduces and clarifies the text itself.

Measure each skill's up-front instruction size before and after, and report the results.

Agreed clarification: make tools that consume provider evidence accept one consistent `{ evidence: { tool, arguments, response } }` input (including `cleanup_github_delivery_branch`, which should extract merge facts itself), and state once in the core guidance to call `describeTool` before the first call to any workflow tool.
