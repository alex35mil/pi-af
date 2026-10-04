# Brief

Optimize remote calls across GitHub and Linear queue intake, initialization, resume, artifact projection, pull-request delivery, and cleanup. Each operation must issue only the reads, searches, and validations needed for that exact operation.

Prefer atomic provider validation and mutation results over speculative preflight reads. Keep required post-write verification. In particular, GitHub queue creation must not fetch Planning or managed Kind labels before creating an approved item: submit the selected label directly, let GitHub reject a missing label atomically, then verify the created issue's labels. Do not enumerate or validate unrelated configured labels, fields, options, or resources.

Inventory provider resource IDs, URLs, and checkpoints currently stored in versioned entity metadata. Keep semantic bindings and non-idempotent recovery state durable. Move only uniquely rediscoverable provider handles to strict `.local/metadata.json`. Resolve resources lazily through validated local cache entries, native provider relationships, then deterministic exact lookup; invalidate stale entries and memoize within one operation.

Remote discovery is reserved for explicit adoption, uncertain mutation outcomes, stale or absent cache entries, provider state that a mutation response cannot establish, and exact post-write verification. Avoid blanket resume searches, repeated configuration validation, and commits caused only by cache changes.

Update every consumer, including Deliverable cleanup, so verified merged pull-request evidence can be resolved without a committed forge handle. Add behavioral coverage that asserts minimal provider call sets for each workflow operation.
