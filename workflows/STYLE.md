# Writing workflow instructions

This guide is for people and agents editing `workflows/skills/` and `workflows/references/`. Skills don't load it.

## Structure

- **Read first.** Only skills have a `## Read first` section, listing what to load before starting. Everything else is conditional: "When <situation>, read <link>." References never chain up-front reads. The size-budget test enforces this.
- **One owner per rule.** Before writing a rule, check whether [core](references/core.md) or another reference already owns it. If one does, link to it; don't restate it.
- **Rare paths live in step files.** Procedures used only in one situation (shipping, recovery, migrations, design artifacts) go in their own file, linked conditionally.
- **Schemas own input shapes.** Don't describe tool argument fields, fact shapes, or pagination details that `describeTool()` returns. Say which tool to call and what it decides.
- **Shared state lives on the tracker or forge.** Anything another clone or developer needs must be recoverable from the tracker or forge. `.project/.local/` is a per-checkout working copy (a worker may link it to its source checkout); never make a check depend on it or on local branches when a shared fact exists.
- **Maintainer notes go in extension READMEs.** Module ownership, file inventories, and naming policy don't belong in agent instructions.

## Sentences

- Use imperative steps, one rule per bullet. Keep a step under about 40 words.
- State the positive rule first, then its exceptions.
- Use tables for state machines and for choices that vary along one axis (kind, provider, entity).
- Don't use slash lists ("create/recover/resubmit"). Write the words out, or split the rule.
- Use "exact" only where it changes behavior, such as an exact SHA or exact arguments.
- Avoid chains of qualifiers ("immutable saved repository/head/target intent"). Name the thing once, then refer to it.
- Prefer one short paragraph over a long one. When a paragraph mixes authorization, procedure, and failure handling, split it into those three parts.

## Changing instructions

- An instruction-only change needs no new test. Tests only check structure (see `.agents/rules/testing.md`).
- Run `npm test`. When the size-budget test fails, cut or move text before raising a budget. Raising a budget is a deliberate change that needs a reason in the commit or PR.
