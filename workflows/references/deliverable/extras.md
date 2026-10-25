# Deliverable situations

Read the matching section only when that situation arises.

## Changing kind

When the user requests or approves a kind change, update `kind` in `metadata.json`.

- Any supported kind can change to any other, at any lifecycle, including `done` and `canceled`.
- Versioned GitHub reconciles the managed Kind label and preserves unrelated labels. Linear and unversioned GitHub keep Kind in workflow metadata only.
- A kind-only update leaves lifecycle, Phase, identity, branch, Task parent, `brief.md`, and existing artifacts unchanged. Future work follows the new kind's strategy.
- Actual scope or behavior changes follow the normal planning and approval rules, separately from the kind change.

## Design artifacts

When the requested output is a UI mockup, layout, or visual concept:

- Create and iterate on a self-contained HTML file under `.local/designs/`. Inline CSS and JS; require no build, server, network, or CDN; make it openable directly from disk.
- Present its repository-relative path alone on its own line, with no label, suffix, or trailing punctuation, so Neovim `gx` can open it. Give the description separately, ask for review, and resolve feedback before final approval.
- Only an explicit user request makes a design durable. In versioned mode, copy the selected file into the Deliverable's root `designs/` and commit only that copy. Keep later experiments under `.local/designs/` until another explicit request.
- In unversioned mode, explain that `.project/` can't be committed under the current policy. A versioned design needs a separately approved project migration.
