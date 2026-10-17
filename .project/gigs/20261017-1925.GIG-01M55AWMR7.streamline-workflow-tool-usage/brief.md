# Brief

Audit workflow tool usage and streamline multi-step operations

Review tool usage across the workflows. Identify multi-step Markdown instructions worth moving into dedicated Pi tools for deterministic batching and permission gating, and migrate suitable operations.

Reassess the purpose, cost, ownership, and invocation cadence of `prepare_artifacts`. Preserve required safety while avoiding broad or redundant checks before routine operations when relevant state has not changed.

Check for deterministic behavior already implemented in tools or scripts that is repeated in Markdown instructions. Keep invocation, required-input, and approval/safety contracts in Markdown; do not restate code-owned algorithms or output-formatting mechanics. Include provider-body rendering as a concrete audit case.

The `/submit` and `/done` commands and their dedicated submission/completion tools are tracked separately.
