---
name: gig
description: "Use for standalone Deliverable work under <repo>/.project/.local/gigs/. Initializes or resumes a Gig, then follows the shared Deliverable lifecycle."
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
    - "confirm_github_tracker"
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
    - "prepare_integration_shipping"
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

## Read first

- [Core rules](../../references/core.md)
- [Deliverable lifecycle](../../references/deliverable.md)
- [Artifacts](../../references/artifacts.md)

The Deliverable lifecycle owns planning, root cause, review, implementation, verification, integration, and final approval. This file owns only Gig identification and initialization.

## Resume

Follow the Deliverable resume steps for a Gig under `.project/.local/gigs/`. Verify `entity: "gig"` and that it isn't inside an Epic, then continue the lifecycle.

## Initialize

1. **Adoption preflight:** when adopting Backlog or Todo work, first read the tracker reference ([GitHub](../../references/integrations/tracker/github.md#adopt-selected-queued-work) or [Linear](../../references/integrations/tracker/linear.md#queue-intake-and-explicit-adoption)) and the [discussion rules](../../references/integrations/shared.md#provider-bodies). Complete its Gig preflight; on Linear, the issue must have no Project.
2. **Create:** follow the approved intake in [artifacts](../../references/artifacts.md#initialization-inputs). Call `init_gig` for new work, `adopt_github_gig` for a GitHub issue, or `adopt_linear_gig` for a projectless Linear issue, passing:
   - the approved values;
   - the Request as `request`;
   - the slug;
   - the adoption `source` facts, when adopting.

   The tool creates identity, artifacts, and the configured branch, starting from and targeting the repository default.
3. **Before planning,** complete the Deliverable integration boundary, including tracker binding and, for a pending Linear branch, `finalize_linear_branch`.

A Gig must never contain parent Epic fields or be converted into a Task.
