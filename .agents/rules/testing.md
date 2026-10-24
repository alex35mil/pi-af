---
paths:
    - "tests/**"
---

# Testing in this repository

Test what code does, not what documentation says.

- **Test behavior through code.** Cover tool schemas and registration, domain functions, output that code produces (rendered bodies, reviewer prompts, error messages), and flows that use mocked providers.
- **Never assert workflow Markdown wording.** Skills, references, and READMEs are reviewed, not regex-pinned. If a test breaks only because wording changed, delete the assertion. Don't update the regex.
- **Guidance checks are structural only.** They live in `tests/workflow-instructions.test.ts`:
  - links and heading anchors resolve;
  - skills reach their required references;
  - frontmatter grants match registered tools;
  - names in docs match exported code inventories;
  - examples parse.
- **Match code-generated text minimally.** Use the smallest meaningful token or structure, not whole sentences.
- **Instruction-only fixes need no new test.** A code fix needs a regression test that exercises that code.
- **Stay local.** Use fixtures and mocked MCP evidence. Never call real providers, push, or touch real tracker items.
- **Reuse before adding.** Extend existing suites and fixtures before creating new ones.
