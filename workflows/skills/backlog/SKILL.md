---
name: backlog
description: "Use to create future work in a configured external Backlog without initializing an Epic, Task, or Gig."
allowed-tools:
    - "integration_context"
    - "reconcile_linear_backlog"
---

# Backlog

Backlog intake records future work through the configured tracker. It is not workflow initialization and creates nothing under `.project/`.

Read and follow `../../references/communication.md` for user-facing discussion and provider issue text.

## Intake

1. Call `integration_context` with `operation: "backlog"`. A missing or invalid tracker is a loud error.
2. Read `../../references/integrations/shared.md`, then follow the exact returned tracker provider: `../../references/integrations/tracker/github.md` or `../../references/integrations/tracker/linear.md`.
3. Draft and obtain explicit user approval for title, description, configured Backlog state/status, and exact Priority or `not set`.
4. For Linear, also require `epic | task | gig`; a Task requires one initialized Linear-bound parent Epic before creation.
5. Validate returned capabilities and remote mappings before mutation, then call only returned tracker MCP tools.

GitHub creates an ordinary issue, adds it to the configured Project, and sets Backlog/Priority. Linear creates a native Project for Epic, a parent-Project issue for Task, or a projectless issue for Gig. Never set a workflow ID. GitHub Type and Linear labels/kind are omitted. Create no workflow artifact, branch, pending record, Epic, Task, or Gig.

## Failure recovery

Follow the provider reference's entity-specific recovery. A known object keeps its identity and retries only incomplete updates. For an unknown Linear create outcome, list recent candidates, then call `reconcile_linear_backlog` with exact entity/title/team and Task parent Project. Every returned `none`/`one`/`multiple` outcome requires user confirmation before selection or recreation because backlog has no workflow ID or durable queue. GitHub applies its equivalent exact-title confirmation flow.

Always report the durable object URL and incomplete updates. Never bypass denied or failed MCP tools with another client.

## Starting later

When the user explicitly starts approved backlog work through `/epic`, `/task`, or `/gig`, that workflow reuses the exact provider object, creates the typed workflow identity/artifacts and provider-appropriate branch contract, uses the copied Priority for initialization, and projects Planning. Versioned mode may apply configured GitHub Type; unversioned mode keeps entity/kind metadata in workflow artifacts. Linear preserves native Project/issue mapping and always keeps kind in workflow artifacts only.
