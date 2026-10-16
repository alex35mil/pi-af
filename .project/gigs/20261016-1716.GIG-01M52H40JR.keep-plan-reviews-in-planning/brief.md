# Brief

Keep plan reviews in Planning

Plan drafting, review, corrections, presentation, and waiting for plan approval must remain in Planning. Self-Review is reserved for reviewing actual implementation; implementation corrections use Execution.

Currently, both `review` and `present_plan` call `assertSelfReview` in `workflows/extensions/review/index.ts`. The guard rejects Planning, while shared guidance explicitly instructs agents to switch plan reviews to Self-Review.

**Reproduction**
1. Initialize work and draft a plan in Planning.
2. Request a plan review.
3. The guard requires Self-Review before implementation has begun, causing incorrect local and tracker Phase values.

**Fix**
- Make the shared guard category-aware: Planning for plan review/presentation; Self-Review for implementation review.
- Align phase, planning, review, Epic, and Deliverable guidance.
- Update regression tests while preserving lifecycle and approval gates.

Source inspected: `9d11efd`. No implementation changes made.
