# Workflows

Reusable Epic/Task/Gig planning and delivery for pi.

- **Epic**: an initiative and ordered plan of Tasks; accepting it creates a queued tracker issue per Task, so Epic progress reflects the whole plan. It does not implement them.
- **Task**: a Deliverable belonging to exactly one Epic.
- **Gig**: a standalone Deliverable.
- **Deliverable**: the shared Task/Gig lifecycle, with Feature, Bugfix, Refactor, Research, Audit, and Chore strategies.
- **Tracker**: required GitHub or Linear work tracking. The tracker object (`#12`, `ENG-12`, or a Linear Project) is the entity's identity and holds native lifecycle, Phase, and Priority.
- **Forge**: required GitHub pull requests. Every Deliverable ships through a merged PR.
- **Artifacts**: plans, notes, and reviews live under `.project/.local/` and never enter Git.

## Commands

```text
/project-setup [preferences]
/epic <idea or existing Epic>
/task <details & parent Epic, or existing Task>
/gig <details or existing Gig>
/backlog <potential work>
/todo <queued work>
/pr <GitHub PR URL or #NN>
```

New work creates the tracker object first; the local entity is named after it (`12-<slug>`, `ENG-12-<slug>`, or `<YYYYMMDD>-<slug>` for a Linear Epic, dated by the Project's creation). Planned Tasks and queued Backlog/Todo objects get a local entity only when explicitly started. `/todo` and `/backlog` queue only Epics and Gigs; a new Task comes from replanning its Epic.

`/pr` reviews an existing contribution privately. It uses the configured GitHub forge and needs no initialized entity.

- **Before checkout:** you get a 1–5 malicious-code safety score with evidence and limitations. Every score needs your explicit approval before anything is checked out.
- **Checkout:** registered tools manage an independent nested checkout. The agent never reconstructs that Git work in Bash, and the parent repository stays untouched.
- **Separate approvals:** review text and verdict, fixes, commits, pushes, publication, and merging each need their own approval. Existing permission prompts can enforce per-call confirmation.
- **Rebase:** an approved standard rebase moves the contribution onto the observed target and immediately updates the same contributor branch with a SHA-pinned `--force-with-lease`, before any later fixes or testing.
- **Running contributor code:** needs separate command and environment approval. Checks that can't run are reported as not run.
- **Fork heads** keep their own repository identity. The PR title, body, and branches stay intact.
- **Editor:** the agent and editor stay rooted in the parent repository; nested-checkout browsing isn't added to Delta or pi.nvim.

See [incoming PR handling](references/pr/incoming.md).

## Setup

Run `/project-setup`, invoke `/skill:project-setup`, or ask the agent to help set up project workflows. Guided setup previews changes and asks for approval; it never stages files. It supports:

- one branch format for every entity: `identifier-title`, `username/identifier-title`, or Linear's own naming;
- the tracker and forge, with official MCP registration;
- read-only Linear workspace discovery;
- separately approved GitHub Project/field provisioning and recovery;
- optional Project Policies and accepted-artifact diff gates.

See the [configuration reference](references/setup.md) for exact schemas, examples, credential handling, and manual setup. The [artifact reference](references/artifacts.md) owns directory layout, identity, persistence, and authority.

## Report a workflow problem

Say **“Report this workflow issue.”** The Todo skill prepares a minimal sanitized report and, after you approve the exact content, destination, and intake choices, creates ordinary Todo work in the workflow project's tracker. Maintainers pick it up through the existing workflows.

Set the source reference once in private global `workflows.json` in Pi's agent directory (`getAgentDir()`):

```json
{ "workflowProject": "/absolute/path/to/pi-af" }
```

- The agent reads that source checkout's `.project/integrations.json` and `.project/config.json`, not the consuming project's tracker or policy.
- Missing or invalid configuration gives a short error naming what to fix and where; you fix it separately.
- The source tracker's MCP tools must be registered in the current session.
- Nothing is sent without your approval, and unsafe project details stay local.

 See [source configuration](references/setup.md#workflow-reporting-source) and [report preparation](references/queue.md#prepare-a-workflow-report).

## Working lifecycle

```text
Queue:       backlog | todo
Local work:  inProgress/planning → inProgress/execution
Plan loop:   inProgress/planning (draft, review, correct, present, await approval)
Review loop: inProgress/execution ↔ inProgress/selfReview
Submitted:   inReview (external human review; native Phase cleared)
Completed:   done (native Phase cleared)
Canceled:    terminal unsuccessful status for queued or initialized work
```

**Planning:**

- Backlog and Todo are independent queues of unstarted work; either can move straight to In Progress.
- Work is clarified, independently reviewed, and accepted through the plan diff before execution.
- Bugfix investigates its cause before the plan is accepted. Research and Audit produce reports without changing product behavior.
- Kind can change at any time without restarting.

**Phase and Status:**

- Drafting, review, corrections, presentation, and waiting for plan approval stay in Planning. Interim and final reviews, and your review of delivered work, use Self-Review.
- Status stays In Progress through all of these local loops.
- Phase shows as a GitHub Project field or a Linear label group. See [Phase](references/phase.md).

**Submitting and shipping:**

- After final review passes, you review the work and decide whether to submit it. Approving an earlier draft or file write isn't submission approval.
- A Deliverable may have several commits within its accepted scope. When the plan defines commit steps, each step is reviewed and then committed before the next.
- Submitting and shipping are separate. Submission commits the work and opens or updates a PR; work with no repository changes gets one empty commit so the PR can open. An explicit request to ship merges, marks the work Done, and cleans up the local branch.

See [Deliverable guidance](references/deliverable.md) for the full flow and [Epic guidance](skills/epic/SKILL.md) for Epic completion.

## Epic Task delivery strategy

Epic planning recommends a Task delivery strategy and asks for approval before the first Task starts. Independently shippable Tasks can deliver directly to the repository default branch; intermediate work can integrate on the Epic branch. The accepted Epic records the choice and rationale.

- Record the approved routing intent at Epic plan acceptance; it stays local.
- Selecting default doesn't prove delivery: every new or adopted default-target Task requires the planning work to be delivered first.
- Epic planning commits nothing, so an Epic branch with no commits ahead of its target counts as delivered. Otherwise delivery needs a verified merged GitHub PR, which also covers squash merges, along with repository, branch, and revision checks.
- Changing the strategy affects future Tasks only.

 See [Epic delivery](references/epic.md) for both switching directions and exact evidence requirements.

## Readable tracker and PR bodies

**Plan publication:**

- Tracker items keep their original request title and description.
- On GitHub, new and adopted issues publish the accepted plan as one managed comment, updated in place afterward.
- On Linear, the plan is one document attached to the issue or Project.
- Local accepted artifacts stay authoritative.

Accepted plans and completion artifacts start with a concise `## Overview`, followed by the full supporting sections in the same reviewed document.

| Destination | Shown |
| --- | --- |
| GitHub plan comment | `# Plan`, the overview, and `## Highlights` above a folded Full plan |
| Linear plan document | native title Plan, the overview, and `## Highlights` above a native folded Full plan |
| GitHub PR | the delivered outcome or report conclusion, then a divider and one fold per supporting section; Not run stays inside Verification |

GitHub folds use `<details>`; Linear uses native `+++` sections. Nothing is summarized or dropped.

- Published text never points at files under `.project/.local/`, since readers can't open them.
- Older documents are brought into this shape through normal review before publication; reads never rewrite completed artifacts.
- Local tests check the generated Markdown, not live Linear rendering.

 See the [document shape](references/artifacts.md#reviewed-document-shape) and [provider-body contract](references/integrations/shared.md#provider-bodies).

## Contract ownership

Skills own entry routing, workflow sequence, and entity-specific decisions. References own shared operational contracts; [core](references/core.md) owns the rules every workflow shares. When editing guidance, follow the [instruction style guide](STYLE.md). Extension READMEs describe registered interfaces and implementation boundaries. This README is a user guide, not an additional operational specification.

| Contract                                                      | Canonical guidance                                                                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared rules: tools, MCP boundary, recovery, approvals       | [Core](references/core.md)                                                                                                                                                        |
| Artifacts, intake, persistence, authority, policy precedence  | [Artifacts](references/artifacts.md)                                                                                                                                              |
| Workflow activity and native Phase projection                 | [Phase](references/phase.md)                                                                                                                                                      |
| Configuration files and permission gates                      | [Setup](references/setup.md)                                                                                                                                                      |
| Inquiry and plan acceptance                                   | [Planning](references/planning.md)                                                                                                                                                |
| Finding adjudication and optional blocked-review confirmation | [Review](references/review.md)                                                                                                                                                    |
| Task/Gig execution, delivery, cleanup                         | [Deliverable](references/deliverable.md), [submission](references/deliverable/submission.md), [shipping](references/deliverable/shipping.md)                                      |
| Backlog and Todo                                              | [Queue](references/queue.md)                                                                                                                                                      |
| Provider-body and integration rules                           | [Integration roles](references/integrations/shared.md)                                                                                                                            |
| Provider operations                                           | [GitHub tracker](references/integrations/tracker/github.md), [Linear tracker](references/integrations/tracker/linear.md), [GitHub forge](references/integrations/forge/github.md) |
| Human-facing prose                                            | [Communication](references/communication.md)                                                                                                                                      |
