---
name: gig
description: "Use for standalone Deliverable work under <repo>/.project/gigs/. Initializes or resumes a Gig, then follows the shared Deliverable lifecycle."
allowed-tools:
    - "init"
    - "review"
    - "present_plan"
    - "prepare_artifacts"
    - "render_provider_body"
    - "verify_artifact_projection"
    - "integration_context"
    - "finalize_linear_branch"
    - "cleanup_delivery_branch"
    - "read(.project/*)"
    - "write(.project/*)"
    - "edit(.project/*)"
---

# Gig

A Gig is a standalone Deliverable with no parent Epic.

First read and follow `../../references/deliverable.md` relative to this skill directory. That file owns planning, root-cause, review, implementation, verification, integration, and final-approval behavior. This file owns only Gig identification and initialization.

## Resume

Use the shared Deliverable preparation, entity-selection, and artifact-read flow for a Gig under `.project/gigs/`. Verify `entity: "gig"` with no Task containment relationship, then continue the shared lifecycle.

## Initialize

Follow approved intake in `../../references/artifacts.md` and the selected provider's Gig preflight when adopting Backlog or Todo work; Linear requires a projectless issue. Then call `init` with `entity: "gig"`, approved values, the approved Request as `request`, slug, and matching `source` variant.

The tool creates identity, artifacts, and the configured branch with repository-default start/target. Continue through the shared integration boundary, including tracker binding and `finalize_linear_branch` for a pending Linear branch, before planning.

A Gig must never contain parent Epic fields or be converted into a Task.
