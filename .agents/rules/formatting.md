---
paths:
    - "**/*.ts"
    - "**/*.mts"
    - "**/*.json"
---

# Formatting

This repository formats with oxfmt (`.oxfmtrc.json`), never Prettier.

- Format only the files you changed: `npm run fmt -- <files>`.
- Never run `prettier`, `npx prettier`, or oxfmt over the whole repository.
