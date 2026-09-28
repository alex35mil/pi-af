# Review extension

Registers `review`, `record_review_response`, and `present_plan`. Strict schemas admit Epic planning reviews and Task/Gig plan, interim, and final reviews.

The review subsystem owns prompt assembly, round discovery, signoff validation, optional configured blocked-review confirmation, and reviewed-snapshot selection. `findings.ts` owns finding fields, report parsing, and canonical rendering; `agent.ts` owns fresh read-only subprocess execution with shared rules and permissions.

Operational contracts: [planning](../../references/planning.md), [adjudication](../../references/review.md), and [artifact layout](../../references/artifacts.md). Entity/kind review criteria remain explicit in the prompts.
