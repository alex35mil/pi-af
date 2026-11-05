# Live provider checks

Automated tests stay local: `npm test` and everything under `tests/` use fixtures and mocked providers, as `.agents/rules/testing.md` requires. This rule covers only manual checks run outside the test suite against real providers.

- Run live checks that write (labels, issues, Projects, pull requests, documents) only against these test targets:
  - GitHub: the repository `alex35mil/__sandbox__`, with the token in `GITHUB_PERSONAL_ACCESS_TOKEN`.
  - Linear: the workspace `alex35mil`, team `ALE`, with the key in `LINEAR_API_KEY`.
- Never write to this repository, its Project, or any other real repository or workspace in a check.
- Remove everything a check creates when it finishes, and confirm the target is back to its earlier state.
- Read-only checks may run against real targets.
- Never print or store credential values; refer to the variables by name.
- Team-level Linear Project labels need a plan the test workspace doesn't have; cover them with mocked tests.
