---
paths:
    - "**/*.ts"
    - "**/*.mts"
    - "**/*.json"
---

# Formatting

The pi package (`pi/`) formats with oxfmt (`pi/.oxfmtrc.json`), never Prettier.

- Format only the files you changed: `mise run pi:format <files>` (paths relative to `pi/`).
- Never run `prettier`, `npx prettier`, or oxfmt over the whole repository.
