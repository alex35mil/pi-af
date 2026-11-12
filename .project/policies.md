# Project Policies

## Labels (intake and label corrections)

Adds Area and Provider selection rules to the label step of Epic, Task, Gig, Backlog, and Todo intake.

- Area: pick every area whose code or guidance the work changes.
  - `pi-workflows`: `pi/workflows/` and tests or instruction budgets that cover workflow code or guidance.
  - `pi-context`, `pi-fetch`, `pi-mcp`, `pi-permissions`, `pi-rules`, `pi-status`, `pi-web-search`: the matching `pi/extensions/<name>/`.
  - `pi-package`: pi package plumbing: `pi/package.json` and its lockfile, Pi upgrades, `pi/tsconfig.json`, `pi/extensions/__lib/`, the `pi/tests` harness itself, and `pi/skills/commit`.
  - `daemon`: `daemon/` and `docs/daemon.md`.
  - `apps-kit`: `apps/packages/PitonKit/`.
  - `apps-ui`: `apps/packages/PitonUI/`.
  - `apps-ios`, `apps-macos`: the matching app target (`apps/ios/`, `apps/macos/`, its target in `apps/project.yml`) and platform-specific behavior in the shared packages, such as `#if os(...)` branches. iPadOS is `apps-ios`.
  - `nvim`: `nvim/`.
  - `tooling`: repository-wide tooling: `mise.toml`, the nono sandbox profile, signing, the log collector install, `.agents/` configuration, shared `apps/project.yml` settings, and repository-wide schema or tooling migrations. A repository-wide migration is `tooling` only, even when it touches area code.
  - Cross-cutting: a change to the daemon↔app wire protocol takes `daemon` and `apps-kit`. A change to the `piton` CLI contract that the Neovim plugin uses takes `daemon` and `nvim`. A doc under `docs/` takes the areas whose behavior it describes.
- Provider: add `github` or `linear` only when the behavior exists only for that provider (its tracker, forge, Project, or API). Leave it empty when the behavior is provider-neutral, even if the report's example used one provider.
