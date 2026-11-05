# Project Policies

## Labels (intake and label corrections)

Adds Area and Provider selection rules to the label step of Epic, Task, Gig, Backlog, and Todo intake.

- Area: pick every area whose code or guidance the work changes.
  - `workflows`: `workflows/`, `examples/workers/`, and tests or instruction budgets that cover workflow code or guidance.
  - `context`, `fetch`, `mcp`, `permissions`, `rules`, `status`, `web-search`: the matching `extensions/<name>/`.
  - `tooling`: dependencies, Pi upgrades, repository-wide config and schema or tooling migrations, the test harness itself, and `skills/commit`. A repository-wide migration is `tooling` only, even when it touches workflow code.
- Provider: add `github` or `linear` only when the behavior exists only for that provider (its tracker, forge, Project, or API). Leave it empty when the behavior is provider-neutral, even if the report's example used one provider.
