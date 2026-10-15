# Plan

## Outcome

Commits and workflow-driven GitHub squash merges follow the current repository's commit policy using an available applicable commit skill under the harness's configured resolution. Without a repository-specific skill available, the bundled skill provides safe Git procedures while respecting the repository's existing style; Conventional Commits are its default only when no style is established.

Squash merges explicitly supply the new Git commit's title through `commit_title`. Use the approved item title (`metadata.title`) as the summary, formatted under the selected policy. Under the Conventional Commit default, lowercase the summary and add the appropriate type and optional scope. Keep the readable item and PR titles unchanged.

## Policy selection

Apply the same selection for standalone commits, workflow submission, and squash merge messages:

| Repository situation | Procedure and message style |
| --- | --- |
| Repository-specific commit skill is available under the harness's configured resolution | Load and follow that skill. Do not replace it with the bundled skill or impose the bundled message style. |
| No repository commit skill; explicit commit conventions exist | Use the bundled skill's Git procedure and the repository's conventions, including non-Conventional styles. |
| No repository commit skill or explicit conventions; recent substantive commits establish a clear style | Use the bundled procedure and that established style. |
| No repository commit skill or established style | Use the bundled procedure and its Conventional Commit default. |
| Applicable instructions or history leave the policy genuinely ambiguous | Ask the user before committing or merging. |

Use the available commit skill applicable to the current repository. Honor the harness's configured resolution. When multiple candidates are exposed, prefer the repository-specific skill using their supplied scope or location; ask when selection is unclear. Do not repeat filesystem discovery or hardcode a bundled path. Keep shared operational guidance harness-neutral; Pi-specific loader behavior belongs only in its integration tests.

## Implementation

1. **`skills/commit/SKILL.md`:** complete and include the existing untracked default skill. It runs when selected under the harness's resolution and follows repository conventions, then clearly established history, then the Conventional Commit default. Keep the skill focused on safe authorized commits and message-style selection; keep squash provider operations in the forge procedure.
2. Preserve inspection, selective staging, existing partial staging, and unrelated staged/unstaged/untracked work. Use ordinary `git commit` or the existing `git commit --only` procedure only when it isolates all approved changes. Ask when approved and unrelated changes cannot be separated safely. Keep the existing Conventional Commit type/scope/summary/body rules as defaults, not universal requirements.
3. **`workflows/references/deliverable.md`:** use the available commit skill applicable to the repository under the harness-neutral selection above for the reviewed submission commit. Do not hardcode a skill path or repeat discovery. Preserve the existing direct-Git/repository-conventions route when no commit skill is enabled, and preserve all approval boundaries.
4. **`workflows/references/integrations/forge/github.md`:** apply the same skill/style selection to merge-message preparation. For a merge-needed result, preserve every returned repository, PR, squash-method, and verified `expectedHeadSha` argument and add explicit `commit_title`. Derive the message summary from `metadata.title`, applying the selected project's formatting; the default is the lowercase item title with Conventional Commit type/scope and no trailing period. Do not use a GitHub default, independently rewrite the summary, change the PR title, or add a title-approval gate.
5. Reconcile shared integration wording and the integration README where needed: the agent owns commit-message selection and direct provider calls; the runtime owns delivery-evidence checks. Document the default skill and standalone `/skill:commit` use in **`README.md`**, including project-policy precedence and authorization.

`package.json` already registers `./skills`; no manifest change is needed. No integration schema or `finishReadDecision` change is needed: those own delivery safety, not semantic message policy.

## Finish behavior

| Existing finish result | Action |
| --- | --- |
| Merge needed after exact evidence checks | Call the registered merge tool with unchanged returned safety arguments and explicit `commit_title` in the selected repository style. |
| Already merged with complete matching proof | Reuse that proof; do not merge again or rewrite the existing commit. |
| Missing IDs, identity/head mismatch, incomplete proof, or another blocked result | Use the existing stop/investigation path; do not merge. |

This applies to Task and Gig finishes with GitHub forge, independently of tracker provider and artifact persistence mode. No-forge and Epic completion are unchanged. Final-artifact acceptance authorizes submission only; an explicit finish request still authorizes merging, Done, and local branch cleanup.

## Verification

- Exercise Pi's actual resource-resolution pipeline, including precedence sorting before same-name collision handling, using temporary fixtures and the existing package manifest. Verify that the bundled `commit` skill is discoverable with valid frontmatter, and that a project-local `commit` skill overrides it. Do not test the collision helper alone or add a replacement selector. Check that submission and forge guidance use the available applicable commit skill without Pi-specific precedence assumptions or a hardcoded bundled path.
- Keep instruction checks limited to essential operational fields and policy ownership, not exact paragraphs. Manually walk every policy-selection row, including a repository-owned skill, no-skill/non-Conventional repository, no-style default, and ambiguous history, for both ordinary and squash commits. Walk merge-needed/already-merged/blocked paths and mixed-staging safety. Structural checks and walkthroughs do not prove model compliance.
- Run focused instruction, integration, Resource IDs operation, and real-Git cleanup tests, then `npm test`; run affected TypeScript/formatting checks and `git diff --check`.
- Verify unchanged integration schemas, runtime finish checks, readable PR-title source, immutable branch contract, approval gates, unrelated files, and historical Gigs. Record actual results and unrun checks in `result.md` before final review.
- Do not perform live commits, pushes, PR creation, merges, or branch cleanup as implementation tests.

## Boundaries

This is an agent-procedure change, not a runtime title validator. Add no tool parameters, persisted message fields, migrations, provider wrappers, preflight reads, hooks, temporary-index machinery, or permission changes. Preserve unrelated `package-lock.json` changes, `WRITING.md`, `workflows/migration/`, `workflows/transition/`, and historical workflow artifacts. Only the existing untracked commit skill is included from that unrelated-work inventory.
