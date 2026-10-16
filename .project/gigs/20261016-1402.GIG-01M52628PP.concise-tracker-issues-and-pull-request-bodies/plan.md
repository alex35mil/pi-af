# Make tracker issues concise while preserving detailed plans

## Overview

Workflow tracker entries and pull requests must be easy to scan without losing the detailed contract or evidence. Tracker entries show the brief plus a few highlights of the accepted plan, with the remaining plan collapsed. Pull requests show a concise account of the delivered outcome, followed by `<hr />` and one collapsed fold per supporting section, including Verification.

### Plan highlights

- Keep the visible overview and all detailed content together in the reviewed source artifact; publication does not generate or approve a second summary.
- Use GitHub `<details>` sections and Linear's documented native `+++` sections, collapsed by default.
- Apply the layout consistently to Epic, Task, and Gig tracker entries and to implementation and Research/Audit pull requests.
- Preserve every substantive source section, existing same-repository closing references, unversioned disclosure restrictions, and provider failure/approval boundaries.

## Scope and reader behavior

After plan acceptance, an initialized tracker entry shows a concise brief explaining the work and why it matters, followed by a few highlights of settled behavior, scope, and important boundaries. This is the user-approved brief-plus-highlights choice. A reader can expand **Full plan** to read the remaining complete plan or Epic contract. The visible portion and collapsed portion together preserve the complete accepted document, apart from its root title and presentation whitespace.

A GitHub pull request shows a concise overview of what was delivered, its material limitations, and why it matters. A literal `<hr />` separates this visible Overview from the folds. Each subsequent level-two section has its own initially collapsed `<details>` block, labeled with that section's heading. The heading becomes the summary label rather than being repeated inside the fold; section content remains unchanged. Not run stays inside Verification and does not receive a separate fold. Research/Audit reports use the same layout: the visible overview states the question or scope, key conclusion, and material uncertainty; each evidence, findings, recommendations, or other supporting section gets its own fold. Tracker bodies retain one Full plan fold without the new divider.

Backlog/Todo creation and initial tracker binding still publish the approved Request under their existing intake rules. There is no accepted plan to fold at that point. This change does not add queue summaries, migrate completed entries, modify tracker lifecycle/Kind/Priority, or introduce live test records.

## One reviewed source document

Define one provider-neutral layout for newly authored or revised accepted `epic.md`, `plan.md`, `result.md`, and `report.md`:

1. The document has its normal root title.
2. Its first content section is a nonempty `## Overview`.
3. One or more subsequent nonempty level-two sections hold the full supporting contract or evidence. Their headings remain subject-specific; there is no generic required list of boilerplate sections.

For tracker sources, Overview carries the concise brief and a `### Plan highlights` list. It preserves the approved Request's meaning and reflects agreed planning decisions; it need not repeat an already-visible tracker title. The immutable request-only `brief.md` remains unchanged. For implementation results, Overview carries the concise delivered behavior and material limitations; Verification stays in the detailed portion. Research/Audit reports carry their concise conclusion and material uncertainty in Overview, with their evidence-rich report sections below it.

The overview is part of the same mutable draft, adversarial review snapshot, accepted plan/result/report, and user diff as the details. It is not generated during provider rendering, stored in metadata, or maintained as a second summary artifact. Plan changes keep highlights synchronized; result/report changes keep their overview synchronized. Review instructions check that the overview accurately represents the detailed content and that critical limitations are visible.

Keep source artifacts ordinary Markdown rather than encoding GitHub or Linear collapse wrappers in them. Replace the result template's provider-specific optional Implementation walkthrough fold with a normal optional detailed section, followed by Verification. Preserve all existing kind-specific sufficiency and completion requirements.

An older accepted document is not rewritten on read or silently summarized. Before publishing it under the new layout, bring that one source document into the current shape through its normal review and user-acceptance gates, preserving its meaning and details. Historical completed artifacts remain untouched. This is a prose presentation change, not an entity-metadata migration.

## Shared rendering boundary

Extend `workflows/extensions/integrations/projection.ts` to separate a reviewed document into its visible Overview and complete detailed remainder, then render the required destination presentation. Use a required discriminated presentation type for GitHub tracker, Linear tracker, or GitHub pull request; do not infer a provider from the presence of a closing issue number or retain the old generic render default.

Remove only the leading root H1 and its following blank line as today. Recognize the first `## Overview` and each following top-level level-two section boundary outside fenced code. Preserve subsection headings, code samples, tables, lists, ordinary repository paths, and all detailed text. Backtick and tilde fenced samples containing headings are supported and must not become document boundaries. Keep retained content unchanged; normalize only blank separation needed to join portions and wrappers. PR section titles move into their summary labels, with HTML-sensitive characters escaped so technical headings display as text. Nested subsections and bold Not run labels remain within their owning level-two section.

Require the current explicit source layout. Empty Overview, missing supporting content, or an incompatible document produces a clear local error naming the expected shape before any provider write. Do not guess which paragraphs are a summary, hide everything under an empty overview, or publish the old expanded layout as an alternate path.

Render the visible Overview, then:

- **GitHub tracker:** `<details>` with `<summary>Full plan</summary>`, blank separation around the complete detailed remainder, and `</details>`. Omit `open` so it starts collapsed.
- **Linear tracker:** `+++ Full plan`, blank separation, the same complete detailed remainder, then a standalone closing `+++`.
- **GitHub pull request:** visible Overview, blank separation, a literal `<hr />`, then one initially collapsed `<details>` block for each subsequent level-two section in source order. Each `<summary>` uses that section's title; its `<details>` block encloses only that section's content. No aggregate Supporting details fold, and no new top-level Not run section. GitHub and Linear tracker output remains unchanged, with a single Full plan fold and no new divider.

A bound GitHub tracker issue in the forge's exact repository still adds the existing horizontal rule and `Closes #<number>` block after the last closed PR fold. A Linear tracker, different-repository tracker, or forge-only entity still adds no closing reference. Both GitHub PR rendering and its collapse layout depend on the forge destination, not on the tracker provider.

`render_provider_body` keeps its entity directory, destination, and complete source inputs. `renderEntityProviderBody` derives the required presentation from the selected configured role and existing semantic relationships, then delegates to the shared renderer. A tracker destination requires its configured tracker role; a PR destination requires its configured forge role. Rendering remains local/read-only and makes no provider calls, source rewrites, or index changes.

## Approval, disclosure, and publication

Update runtime integration context and shared/provider guidance together so they describe the same positive contract: the complete accepted source is retained, its reviewed overview is visible, and the remaining text is folded by the destination renderer. Lossless preservation refers to content, not unchanged provider markup.

Root-title removal, wrapper/separator insertion, PR section-heading placement in summary labels, and the existing same-repository closing block are deterministic presentation operations authorized by the accepted layout. They do not require a second content-approval round. Any substantive omission, rewrite, new summary, or changed source still follows the existing exact-candidate/diff approval rules. Keep discussion in comments and requirements in the authoritative source.

Unversioned mode still requires the agent to remove or minimally rewrite forbidden content and obtain explicit approval of the complete sanitized candidate before rendering. This applies to both overview and detailed content; folding is not a privacy boundary. Preserve the existing allowed/forbidden content policy and ordinary-path allowance, with no disclosure bypass for hidden text. The sanitized candidate retains the same Overview/details shape and removes forbidden workflow-system headings or content under that approval gate.

Publish the complete rendered body through the same configured native MCP mutation as today. Trust established clear success. After uncertain/partial success, read the exact object and reconcile before retrying; never replace providers, invent another client, or repeat uncertain creation. Body formatting does not change PR identity, branch contracts, approval of submission/finish, or lifecycle transitions.

## Decision table

| Source/destination or condition | Result |
| --- | --- |
| Initial Request or unstarted Backlog/Todo entry | Existing approved intake body; no plan folding. |
| Accepted Epic/Task/Gig definition, GitHub tracker | Brief plus reviewed highlights visible; all remaining plan sections in Full plan `<details>`. |
| Accepted Epic/Task/Gig definition, Linear tracker | Same content layout using native `+++ Full plan` syntax. |
| Result or report, GitHub forge | Outcome/conclusion overview visible, then `<hr />`, then one `<details>` fold per level-two section; Not run stays inside Verification. |
| GitHub forge with a Linear tracker or another repository's GitHub tracker | GitHub PR fold; no closing reference. |
| Same-repository bound GitHub issue and GitHub forge | Existing closing block after all PR folds. |
| Unversioned source contains forbidden material | Sanitize both portions and obtain exact approval before rendering or publication. |
| Source does not meet the explicit layout | Clear local error; revise and approve that source through the existing gates before publication. |
| Old or completed artifact merely read/resumed | No automatic source rewrite or retrospective provider update. |
| Provider mutation denied, fails, or has uncertain outcome | Existing role-local failure and exact-object recovery rules; formatting adds no remote operation. |

## Evidence and verification limits

GitHub documents collapsed Markdown in `<details>` with a `<summary>` label and blank separation: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections .

Linear's API documentation explicitly specifies `+++ Section title` and closing `+++` for collapsed Markdown in issues, comments, and documents: https://linear.app/developers/graphql#adding-collapsible-sections-in-markdown . Its editor and changelog describe collapsible sections in descriptions generally: https://linear.app/docs/editor and https://linear.app/changelog/2025-03-19-collapsible-sections . The API passage does not separately name Project descriptions; use the documented native syntax consistently, while reporting that live issue/Project rendering has not been tested. Do not claim fixture output proves provider UI rendering or create a scratch Project without separate approval.

The real failure risk is publishing accepted long plans or results while losing text or splitting at a heading inside a code sample. The supported execution path passes these Markdown documents directly to provider bodies, and existing plans contain fenced configuration/API examples. A small fence-aware structural split and exact output/content tests address that risk at the shared boundary. No new remote race handling, automatic summary service, Markdown reserialization pipeline, or dependency is needed.

## Implementation ownership

- `workflows/extensions/integrations/projection.ts`: own source-layout validation, lossless splitting, required destination presentation, collapse wrappers, and closing-block composition.
- `workflows/extensions/integrations/index.ts`: select presentation from the actual configured destination, update tool description and runtime projection policy, preserve independence of tracker and forge roles.
- `workflows/references/planning.md` and `workflows/skills/epic/SKILL.md`: author and review tracker Overview/Plan highlights within the accepted source while preserving Epic structure, task markers, and kind-specific planning criteria.
- `workflows/references/deliverable.md`: update result/report overview guidance, normal detailed-section template, and rendering/publication handoff.
- `workflows/references/integrations/shared.md`, tracker GitHub/Linear guides, and forge GitHub guide: centralize and consume the complete-body layout, deterministic presentation approval, disclosure, and recovery contract without caller-specific wrapper logic.
- `workflows/references/artifacts.md`, `workflows/extensions/integrations/README.md`, and `workflows/README.md`: document the new source shape and presentation behavior at their existing ownership boundaries. Update additional directly affected wording only where it contradicts this contract.
- `tests/workflow-provider-body.test.ts`, `tests/workflow-integration.test.ts`, and `tests/workflow-instructions.test.ts`: verify the owning renderer, destination selection/policy, and authoring/publication instructions. Update any directly affected fixtures, not unrelated historical artifacts.

## Verification

- Unit tests: exact unchanged GitHub/Linear tracker bodies with one Full plan fold and no new divider; GitHub PR Overview followed by one literal `<hr />` and one fold per level-two section, in source order and labeled with its heading; nested subsections stay with their parent; Verification includes Not run without an extra fold; section titles and content are retained; closing reference appears once after all folds only for its supported relationship.
- Structural tests: root-title removal, source without root H1 after approved sanitization, LF/CRLF, code fences with heading-like lines, nested subsections, tables/lists/paths, and clear failure on missing/empty Overview or supporting content. Fixtures use realistic plan/result/report examples, including snippets of the collapse syntax itself.
- Integration tests: Epic and Deliverable sources, both tracker providers, GitHub forge with GitHub/Linear/no tracker, same/different repository, absent requested role, both artifact modes, read-only rendering, and updated policy text. No new provider calls are introduced.
- Instruction checks: current source shape, brief-plus-highlights choice, report/result overview and hidden verification, provider-specific syntax, complete-content preservation, unversioned approval/disclosure, deterministic presentation approval, and unchanged uncertainty recovery.
- Run focused renderer/integration/instruction tests, full `npm test`, `npx tsc --noEmit`, changed-TypeScript formatting checks, and `git diff --check`. Baseline: 197 tests, type checking, and diff check passed before implementation.
- Inspect rendered sample bodies locally. No live Linear scratch entries or unrelated GitHub test entries are authorized. Record live-rendering limitations explicitly in `result.md`; existing user-approved publication of this Gig's own issue/PR remains under normal workflow gates.
