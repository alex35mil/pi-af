---
paths:
    - "workflows/skills/**"
    - "workflows/references/**"
---

# Editing workflow guidance

Before editing workflow skills or references, read `workflows/STYLE.md` and follow it. Key points:

- Only skills may have a `## Read first` section. Every other link is conditional: "When <situation>, read <link>."
- Link to the rule's owner (usually `references/core.md`) instead of restating it.
- Leave tool input shapes to tool schemas.
- Keep within the per-skill size budget in `tests/workflow-instructions.test.ts`. Cut before raising it.
