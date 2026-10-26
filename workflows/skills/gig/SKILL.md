---
name: gig
description: "Use for standalone Deliverable work under <repo>/.project/.local/gigs/. Initializes or resumes a Gig, then follows the shared Deliverable lifecycle."
allowed-tools:
    - "preflight_gig"
    - "init_github_gig"
    - "init_linear_gig"
    - "review_gig"
    - "prepare_gig_plan_presentation"
    - "prepare_artifacts"
    - "set_github_workflow_phase"
    - "set_linear_workflow_phase"
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
    - "cleanup_delivery_branch"
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

Follow the approved intake in [artifacts](../../references/artifacts.md#initialization-inputs), then [initialize from the tracker object](../../references/integrations/shared.md#initialize-from-the-tracker-object):

1. **New work:** call `preflight_gig`, then create the issue as the tracker reference describes.
2. **Adoption:** read the tracker reference ([GitHub](../../references/integrations/tracker/github.md#adopt-selected-queued-work) or [Linear](../../references/integrations/tracker/linear.md#queue-intake-and-explicit-adoption)) and the [discussion rules](../../references/integrations/shared.md#provider-bodies), and complete its Gig preflight; on Linear, the issue must have no Project.
3. **Initialize:** call `init_github_gig` or `init_linear_gig` with the approved values, the Request as `request`, the slug, and the issue as `object`. The Gig starts from and targets the repository default.
4. **Before planning,** finish board setup.

A Gig must never contain parent Epic fields or be converted into a Task.
