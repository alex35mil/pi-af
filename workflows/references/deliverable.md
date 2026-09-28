# Deliverable

Task and Gig are concrete Deliverable variants. Follow this lifecycle exactly for both; variant skills add only initialization and Task parent synchronization.

Read and follow `./artifacts.md` for authoritative paths and file ownership, `./communication.md` for human-facing communication and prose artifacts, `./review.md` for finding adjudication in every review phase, and `./planning.md` for adaptive inquiry, kind-specific investigation progression, planning review rounds, and user diff presentation.

## Authoritative state

Start with the preparation and explicit entity-selection gates in `./artifacts.md`.

At every resume, read the Deliverable's `brief.md`, `metadata.json`, authoritative `plan.md`, any existing `result.md`/`report.md`, and relevant local review round when present. Read `.local/status.md` only when `metadata.authority.kind` is `workflow`; tracker authority requires that file to be absent and a fresh provider lifecycle/Priority read. Read `<repo>/.project/policies.md` when present and apply it throughout planning, implementation, verification, and review.

Before planning work, require `metadata.branch.state: ready`, switch to its exact `name`, and verify its stored `start`/`target`. For a pending Linear Task/Gig, finish tracker binding and call `finalize_linear_branch` first. A ready branch contract is immutable; the sole pending→provisioning→ready transition uses Linear's exact generated name. Never invent a branch name/base override. Push, PR creation, merge, branch deletion, and worktree operations require approval of the exact operation or set; Submission below defines the operation set authorized by final-artifact acceptance.

## Integration boundary

After initialization and on every resume, call `integration_context` with `initialize` or `resume` and the Deliverable directory.

- `disabled`: continue silently; authoritative `integrations` remains empty.
- `enabled`: first follow `./integrations/shared.md`; then dispatch enabled roles by exact provider to `./integrations/tracker/github.md`, `./integrations/tracker/linear.md`, or `./integrations/forge/github.md`; report an unavailable role without blocking the other.
- unavailable roles, permission denial, invalid configuration, or provider failure: follow the failure boundary in `./integrations/shared.md`. Preserve work; never bypass MCP permissions or substitute workflow authority for an unavailable tracker.

After every accepted `plan.md` change, call tracker-only `artifactProjection` and follow `./integrations/shared.md` for lossless projection, approval, and verification. In versioned mode, check repository history after acceptance and again on resume/final verification. With a forge and a containing commit, separately call `artifactLinks` for the accepted plan and current completion artifact, render the destination-specific Links, and present permanent and target-branch links. Use the shared `available after merge` label until the target resolves. Unversioned mode exposes no artifact links; never manufacture a SHA or claim an unresolved target link works.

## Kind strategy

Every Deliverable has exactly one current kind: `feature`, `bugfix`, `refactor`, `research`, `audit`, or `chore`. Match `metadata.json` exactly and follow only that branch; there is no generic fallback.

### `feature`

Follow the shared planning protocol. The plan covers intended behavior and interfaces, implementation ownership, affected files, documentation, and verification. Execute the accepted plan in product code and supporting artifacts. Final review checks delivered behavior, integration, regressions, and verification.

### `bugfix`

1. Use the shared adaptive inquiry mechanics before and during investigation. Ask only for material context that inspection cannot recover and that changes reproduction, expected behavior, scope, evidence, or access.
2. When enough information exists to investigate, proceed directly into investigation.
3. Investigate the symptom and evidence before editing product code. If investigation exposes an unresolved product/domain decision, stop and ask before selecting a cause or fix.
4. Once the cause is evidenced, write `.local/draft.md` with Root cause, Symptom, Evidence, Cause, Proposed fix, and Verify.
5. Use the shared plan review, immutable snapshot, `present_plan`, and user-diff acceptance flow. Do not edit product code before the root-cause-shaped plan is accepted.
6. Apply only the accepted fix and run its verification.
7. Final review checks that the evidenced cause is fixed without regressions.

### `refactor`

Follow the shared planning protocol. The plan defines the structural goal, behavior and interfaces that must remain unchanged, invariants, migration boundary, implementation, and verification. Execute only behavior-preserving structural work. Final review checks the stated invariants and absence of unintended behavior changes.

### `research`

Follow the shared planning protocol. The plan defines the question, evidence required, investigation method, boundaries, and intended output. Investigation may read the repository and external sources and may create temporary probes under `.local/scratch/`, but does not modify product behavior. Write durable `report.md` with the question, evidence, findings, conclusion, uncertainty, and next steps. Final review checks that evidence supports the conclusions and uncertainty is explicit.

### `audit`

Follow the shared planning protocol. The plan defines scope, criteria, evidence sources, boundaries, and report expectations. Inspect without remediating findings in product code. Write durable `report.md` with scope/criteria, evidence, findings, recommendations, and limitations. Final review checks that findings are evidenced, complete against scope, and actionable. Remediation requires an explicit kind transition or separately initialized work.

### `chore`

Follow the shared planning protocol. The plan defines the concrete maintenance outcome, affected configuration/docs/tooling/code, operational constraints, and verification. Execute only that maintenance scope. Final review checks the requested outcome and practical verification without imposing feature boilerplate.

Use only relevant report sections. A report is a durable result, not a conversation transcript or substitute for the accepted plan.

## Kind transitions

Kind is current workflow strategy, not identity. The qualified ID, directory, ready branch, and Task parent remain unchanged. Linear branch provisioning is the sole pre-planning branch transition. Only the kind transitions below are supported, and each requires explicit user approval.

### Planning correction before execution

The user may approve any target kind while lifecycle remains `planning` and execution has not started.

1. Update kind while keeping lifecycle `planning`.
2. Update `brief.md`, remove any stale candidate, and project Type only through a tracker/provider that supports the configured Type.
3. Continue by target:
    - `bugfix`: use adaptive inquiry and investigation, then the shared review/acceptance flow with a root-cause-shaped `.local/draft.md`.
    - `feature`, `refactor`, `research`, `audit`, or `chore`: replace `.local/draft.md` with the target kind's candidate and run shared planning review/acceptance.

### Research/Audit implementation continuation

After `report.md` passes final review, the user may approve one bounded continuation to `bugfix`, `feature`, `refactor`, or `chore`.

1. Preserve `report.md` and the accepted root plan.
2. Update kind in `metadata.json` and lifecycle to `planning` together.
3. Update `brief.md`; project Type only when supported and use native tracker Status when configured.
4. Continue by target:
    - `bugfix`: remove the previous candidate, validate the report's causal evidence, investigate remaining gaps, then use shared review/acceptance with a root-cause-shaped `.local/draft.md`.
    - `feature`, `refactor`, or `chore`: write a new `.local/draft.md` and repeat shared planning review/acceptance.

### Unsupported reclassification

Do not reclassify any other started kind or any `done` Deliverable. Ask whether to revise the current approved scope or initialize separate follow-up work.

Never infer a transition from findings or initialize replacement work automatically. Before accepting a transitioned Task's new plan, synchronize any resulting parent Epic contract change. Reuse the Deliverable only for one bounded continuation with the same identity and ownership; independently schedulable findings, different priorities, or work outside the accepted parent contract become separate user-approved Tasks/Gigs.

## Review handling

Follow `./review.md` for every plan, interim, and final review. The review agent is critique-only and read-only; the main agent owns changes; the user owns product decisions and approval. Ask before review unless review is the already-approved next gate; never start review while user concerns still require discussion.

## Completion artifacts

Research and Audit complete their evidence-rich root `report.md` before final subagent review because the report is their reviewed output. For Feature, Bugfix, Refactor, and Chore, create root `result.md` before final subagent review so the reviewer receives the actual outcome and verification evidence:

```markdown
# Result

## What changed

- A concise walkthrough of the actual delivered behavior and material implementation or integration changes.
- Material limitations or intentionally unchanged boundaries.

<details>
<summary>Implementation walkthrough</summary>

Optional deeper code and architecture explanation when it materially helps reviewers.

</details>

## Verification

- `<command or manual check>` — `<actual result>`

**Not run:**

- `<planned check>` — `<specific reason>`
```

A Research/Audit continued into implementation keeps `report.md` unchanged as prior evidence and adds `result.md` before final subagent review of the implementation.

Write actual outcomes, not planned work or a chronological transcript. Keep the primary walkthrough concise and understandable without the conversation. Include the collapsible implementation walkthrough only when deeper code or architecture detail materially helps review. List verification that ran with its observed result. When a planned check did not run, add the compact `**Not run:**` list with its specific reason; omit that list when every planned check ran. Once `result.md` exists, update it after every user-review change, implementation revision, or verification rerun so it always describes the current result. A material implementation change requires another final subagent review; include the synchronized `result.md` in that rerun. Present the current completion artifact with every final user-review iteration and include it in final user approval. Keep links out of the artifact; provider bodies append the shared deterministic `## Links` section.

## Implementation and verification

1. Change lifecycle from `planning` to `inProgress` when approved implementation begins: update authoritative `.local/status.md` without a tracker; with a tracker, set the absolute provider values and re-read them for confirmation. The verified provider values remain authoritative.
2. Implement the complete approved change at its owning abstraction. Keep unrelated working-tree changes untouched.
3. Run focused verification while developing and all plan/Project Policy verification before final review.
4. For a Task, run the parent-synchronization flow in its skill. A Gig has no parent-synchronization step.
5. Create or synchronize the applicable `result.md` or `report.md` with the actual implementation and verification evidence. Do not claim unrun verification.
6. Change lifecycle to `inReview`: without a tracker, update local `.local/status.md`; with a tracker, set the provider's native Status to the configured `inReview` value. Then call `review` with `phase: "final"`.
7. Follow `./review.md`, synchronize the completion artifact after every implementation or verification change, and repeat final subagent review until approved.
8. Present the implementation and reviewed completion artifact together for final user review.
9. When user review causes a change, update the implementation and verification evidence, synchronize `result.md` or `report.md`, and rerun final subagent review for every material implementation or report change. Repeat the user-review presentation with the synchronized artifact.
10. Continue through Submission below. Keep lifecycle `inReview` through submission, pull-request review, and any required revisions.
11. Change lifecycle to `done` only after the exact approved result is confirmed merged into the stored target. Without a tracker, update `.local/status.md`; with a tracker, update and re-read native Status/Priority. This lifecycle update never creates a repository commit.
12. After `done`, ask whether to delete the local Deliverable branch. State the branch and target, and that no remote branch will be deleted. Do not show Git commands, commits, merge evidence, or internal validation details. Wait for explicit approval.
13. After approval, call `cleanup_delivery_branch` once. For a stored GitHub PR, supply the exact merged `pull_request_read(method: "get")` result: PR number, `head.ref`, `head.sha`, `base.ref`, `merged_at`, and `merge_commit_sha`; the tool fast-forwards the local target and verifies the provider merge commit before deletion. Without a stored PR, use Git ancestry evidence; the tool performs no remote Git operation and verifies source ancestry against the existing local target before deletion. The tool validates lifecycle, branch contract, merge evidence, and worktree safety itself. Any failure preserves the Deliverable branch; never stash, reset, clean, force checkout, delete the remote branch, or revert `done`.

## Submission

Submission starts only after final subagent approval, synchronized `result.md` or `report.md`, and final user review.

1. Acceptance of the final `result.md` or `report.md` diff starts submission by default: final commit and—when a forge is configured—push of the stored branch plus creation or recovery of the exact stored-head/stored-target PR. Do not ask for another delivery choice, title approval, or body approval. When the user explicitly requests commit-only, no push, or no PR, stop after the commit.
2. When a repository `commit` skill is available, use it for the commit. Otherwise create one focused commit containing only the exact reviewed implementation and durable artifacts, following repository commit conventions. Preserve every unrelated staged change and every unrelated path in Git or outside Git; never amend another commit unless explicitly requested.
3. For an explicit commit-only/no-push/no-PR request, report the commit and stop.
4. When a forge is configured, use the containing commit to render the shared PR-destination `## Links` section. The exact approved entity title, without an internal or tracker identifier, is the PR title; the complete synchronized completion artifact plus rendered Links is the body. Put tracker identity only in Links. The stored branch `name` is the head and stored `target` is the base; approval never changes this contract.
5. With a configured forge, push only the stored entity branch and follow its reference to discover an existing exact head/base PR, recover an unknown prior outcome, or create it once when absent. Verify and persist only the confirmed PR reference. Without a forge, perform no Git remote or PR operation.
6. Render the tracker-destination Links section when a tracker exists and verify the resulting provider content. A failure stops at its current confirmed state and resumes from remote evidence; never repeat uncertain PR creation blindly.

## Design artifacts

When the requested output is a UI mockup, layout, or visual concept, create and iterate on a self-contained HTML file under `.local/designs/` by default. Include CSS/JS inline, require no build/server/network/CDN, and make it directly openable from disk. Present the exact repository-relative path as a standalone path token on its own line so Neovim `gx` can recognize it through `<cfile>`; do not add a label, line suffix, or trailing punctuation to that line. Give the concise description separately, then ask the user to review it and provide feedback. Resolve that feedback before requesting final approval.

Only an explicit user request makes a design durable. In versioned mode, copy the exact selected file into the Deliverable's root `designs/` and include only that copy in the approved commit. Continue later experiments under `.local/designs/`; update the durable copy only on another explicit request. In unversioned mode, explain that `.project/` cannot be committed under the current policy and require a separately approved project migration before creating a versioned design artifact.
