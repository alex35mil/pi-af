# Result

## Overview

GitHub setup now offers the confirmed Board defaults: eight visible fields, Status columns, no swimlanes, Priority sorted Urgent → High → Medium → Low, Count only, and no slicing. Repository linking and default-repository configuration remain separate choices with opt-outs.

The shared setup tool inspects views, previews approved changes, applies supported name/layout/field updates, and verifies provider state for new, existing, and resumed Projects. It preserves unrelated settings, validates field scopes, and reconciles uncertain view writes without blind duplication. Incompatible saved Priority orders block before setup writes, including organization-field preflight before new Project creation. Unverifiable organization ordering also blocks; corrections need explicit approval and preserve option values.

Settings without supported update APIs have precise guided UI steps and explicit confirmation requirements. They are not claimed as automated. Runtime tracker configuration is unchanged. Verification used provider fakes and read-only Project inspection, not live provisioning experiments.

## Verification

- Focused setup/instruction tests — 46 passed.
- `npm test` — 232 passed.
- `npx tsc --noEmit` — passed.
- `npx oxfmt --check` on the seven changed source/documentation/test files — passed.
- `git diff --check` — passed.
