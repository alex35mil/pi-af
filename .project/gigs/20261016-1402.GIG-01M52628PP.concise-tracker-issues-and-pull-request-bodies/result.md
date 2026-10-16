# Result

## Overview

- Tracker entries keep the reviewed brief and Plan highlights visible, with every remaining plan section collapsed under Full plan. GitHub uses `<details>`; Linear uses native `+++` sections.
- GitHub PRs keep the delivered outcome or report conclusion visible, followed by `<hr />` and one collapsed fold per supporting section, labeled with that section's heading. Not run stays inside Verification. Eligible issue-closing references remain after all folds. Tracker folding and its lack of a divider are unchanged.
- Plans, Epic documents, results, and reports carry their overview and complete details in one reviewed Markdown source. Rendering preserves the text rather than generating another summary; unversioned disclosure approval still covers both visible and hidden content.

Existing source documents need the reviewed Overview layout before their next publication; historical artifacts are not rewritten. Existing Pi sessions need `/reload` to activate the updated renderer. Live Linear issue and Project rendering remains unverified.

## Implementation details

The shared renderer requires an explicit GitHub-tracker, Linear-tracker, or GitHub-PR presentation and validates a nonempty `## Overview` followed by nonempty level-two detail sections. Its structural split respects backtick and tilde code fences and preserves source text, paths, Markdown formatting, and line endings, apart from root-title removal, PR section headings becoming HTML-safe summary labels, and section-boundary separation. Invalid layouts fail locally before publication.

Destination selection comes from the configured tracker or forge, independently of their provider combination. Authoring guidance, runtime projection policy, provider handoffs, result/report templates, and reviewer prompts use the same contract. Reviewers check that the overview accurately reflects the full source and keeps material limitations visible. No dependency, provider client, or remote operation was added.

## Verification

- `npm test` — all 209 tests passed.
- `npx tsc --noEmit` — passed.
- `npx oxfmt --check` on changed TypeScript files — passed.
- `git diff --check` — passed.
- Local previews from the accepted plan and actual result — GitHub tracker, Linear tracker, and GitHub PR layout assertions passed; inspected the generated overview/fold boundaries and PR verification/closing-reference placement.
- Renderer/integration tests cover exact GitHub and Linear bodies, unchanged tracker bodies, PR-only divider and per-section folds, Not run inside Verification, closing references, escaped section labels, fenced examples, LF/CRLF, invalid layouts, Epic/Gig sources, both artifact modes, independent roles, and read-only rendering.
- Instruction and reviewer-prompt tests cover overview/detail consistency, provider syntax, deterministic presentation approval, unversioned disclosure, and existing recovery rules.

**Not run:**

- Live Linear issue/Project rendering — no approved scratch entries; native syntax is documented, but generated Markdown tests do not prove the provider UI's rendering.
