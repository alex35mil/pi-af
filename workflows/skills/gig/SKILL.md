---
name: gig
description: "Use for standalone Deliverable work under <repo>/.project/gigs/. Initializes or resumes a Gig, then follows the shared Deliverable lifecycle."
allowed-tools:
    - "init_gig"
    - "adopt_github_gig"
    - "adopt_linear_gig"
    - "review_gig"
    - "prepare_gig_plan_presentation"
    - "prepare_artifacts"
    - "set_local_workflow_phase"
    - "set_github_workflow_phase"
    - "set_linear_workflow_phase"
    - "confirm_versioned_github_tracker"
    - "confirm_unversioned_github_tracker"
    - "confirm_linear_tracker"
    - "render_provider_body"
    - "prepare_tracker_publication"
    - "prepare_tracker_publication_update"
    - "record_tracker_publication"
    - "recover_tracker_publication"
    - "verify_artifact_projection"
    - "inspect_integrations"
    - "inspect_adoption"
    - "initialize_integration"
    - "resume_integration"
    - "prepare_integration_projection"
    - "prepare_integration_pull_request"
    - "prepare_integration_finish"
    - "prepare_integration_merge"
    - "prepare_tracker_mutation"
    - "prepare_github_phase_mutation"
    - "prepare_linear_phase_mutation"
    - "begin_resource_creation"
    - "record_resource_creation"
    - "resolve_resource_ids"
    - "record_resource_ids"
    - "invalidate_resource_ids"
    - "select_pull_request_resource"
    - "finalize_linear_branch"
    - "cleanup_ancestry_delivery_branch"
    - "cleanup_github_delivery_branch"
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

Follow approved intake in `../../references/artifacts.md` and the selected provider's Gig preflight when adopting Backlog or Todo work; Linear requires a projectless issue. Then call `init_gig` for new work, `adopt_github_gig` for the selected GitHub issue, or `adopt_linear_gig` for the selected projectless Linear issue, with approved values, the approved Request as `request`, slug, and verified adoption `source` facts when applicable.

The tool creates identity, artifacts, and the configured branch with repository-default start/target. Continue through the shared integration boundary, including tracker binding and `finalize_linear_branch` for a pending Linear branch, before planning.

A Gig must never contain parent Epic fields or be converted into a Task.
