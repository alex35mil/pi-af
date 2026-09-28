# Workflows

Reusable Epic/Task/Gig planning and delivery for pi.

- **Epic**: an initiative and ordered plan of prospective Tasks; it does not implement them.
- **Task**: a Deliverable belonging to exactly one Epic.
- **Gig**: a standalone Deliverable.
- **Deliverable**: the shared Task/Gig lifecycle, with Feature, Bugfix, Refactor, Research, Audit, and Chore strategies.
- **Tracker**: optional GitHub or Linear work tracking, including native lifecycle and Priority.
- **Forge**: optional GitHub repository links and pull requests, independent of the tracker.

## Commands

```text
/project-setup [preferences]
/epic <idea or existing Epic>
/task <details & parent Epic, or existing Task>
/gig <details or existing Gig>
/backlog <future work>
```

Only `/backlog` requires a tracker. Prospective Tasks and backlog objects do not receive workflow identity until explicitly initialized.

## Setup

Run `/project-setup`, invoke `/skill:project-setup`, or ask the agent to help set up project workflows. Guided setup previews changes and asks for approval; it never stages files. It supports:

- `versioned` or `unversioned` artifacts;
- one branch format for every entity;
- independent tracker/forge roles and official MCP registration;
- read-only Linear workspace discovery;
- separately approved GitHub Project/field provisioning and recovery;
- optional Project Policies and accepted-artifact diff gates.

See the [configuration reference](references/setup.md) for exact schemas, examples, credential handling, and manual setup. The [artifact reference](references/artifacts.md) owns directory layout, identity, persistence, and authority.

## Working lifecycle

```text
Deliverable: backlog → planning → inProgress → inReview → done
Epic:        backlog → planning → inProgress → done
```

Work is clarified, independently reviewed, and accepted through the plan diff before execution. Bugfix investigates its cause before plan acceptance; Research/Audit produce reports without changing product behavior. [Deliverable guidance](references/deliverable.md) defines kind transitions, verification, completion artifacts, submission, and cleanup.

Accepting the final completion-artifact diff normally authorizes the final commit and, with a forge, push and PR discovery/creation. An explicit commit-only/no-push/no-PR request stops after the commit. Deliverables remain `inReview` until confirmed merged. Branch cleanup requires separate approval. [Epic guidance](skills/epic/SKILL.md) owns early-merge Task targeting and explicit Epic completion.

## Contract ownership

Skills own entry routing, workflow sequence, and entity-specific decisions. References own shared operational contracts. Extension READMEs describe registered interfaces and implementation boundaries. This README is a user guide, not an additional operational specification.

| Contract                                                      | Canonical guidance                                                                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifacts, intake, persistence, authority, policy precedence  | [Artifacts](references/artifacts.md)                                                                                                                                              |
| Configuration files and permission gates                      | [Setup](references/setup.md)                                                                                                                                                      |
| Inquiry and plan acceptance                                   | [Planning](references/planning.md)                                                                                                                                                |
| Finding adjudication and optional blocked-review confirmation | [Review](references/review.md)                                                                                                                                                    |
| Task/Gig execution, delivery, cleanup                         | [Deliverable](references/deliverable.md)                                                                                                                                          |
| Provider-independent integration rules and Links              | [Integration roles](references/integrations/shared.md)                                                                                                                            |
| Provider operations                                           | [GitHub tracker](references/integrations/tracker/github.md), [Linear tracker](references/integrations/tracker/linear.md), [GitHub forge](references/integrations/forge/github.md) |
| Human-facing prose                                            | [Communication](references/communication.md)                                                                                                                                      |

For one explicitly requested older item, use [selective migration](migration/selective-legacy-item.md). An already-active legacy session may instead use the bounded [finish-in-place transition](transition/finish-legacy-work.md); neither is a runtime fallback.
