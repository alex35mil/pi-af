# Deliverable situations

Read the matching section only when that situation arises.

## Changing kind

When the user requests or approves a kind change, update `kind` in `metadata.json`.

- Any supported kind can change to any other, at any lifecycle, including `done` and `canceled`.
- Kind stays in workflow metadata only; trackers get no Kind label.
- A kind-only update leaves lifecycle, Phase, identity, branch, Task parent, `brief.md`, and existing artifacts unchanged. Future work follows the new kind's strategy.
- Actual scope or behavior changes follow the normal planning and approval rules, separately from the kind change.

## Design artifacts

When the requested output is a UI mockup, layout, or visual concept:

- Create and iterate on a self-contained HTML file under `designs/`. Inline CSS and JS; require no build, server, network, or CDN; make it openable directly from disk.
- Present its repository-relative path alone on its own line, with no label, suffix, or trailing punctuation, so Neovim `gx` can open it. Give the description separately, ask for review, and resolve feedback before final approval.
- Designs stay local with the entity. When the user wants one in the repository, they choose where it belongs outside `.project/`, as a normal approved change.
