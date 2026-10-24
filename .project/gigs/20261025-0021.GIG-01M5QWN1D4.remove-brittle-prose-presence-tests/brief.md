# Brief

Remove brittle prose-presence tests

Audit `tests/workflow-instructions.test.ts` and related workflow tests. Remove tests that only assert documentation contains specific phrases or regex matches without validating behavior. Keep structural/schema tests and executable behavior tests. Replace prose checks only where a real behavior-level assertion exists.
