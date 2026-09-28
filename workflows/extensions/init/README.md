# init

Registers permission-controlled entity initialization tools:

- `init` creates an approved Epic, Task, or Gig;
- `set_epic_task_target` changes only where future Tasks branch after an Epic merge confirmed by Git in the current clone.

Entity creation, branch setup, Task parent annotation, and Epic future-Task target changes live in `entity.ts`; `index.ts` registers those operations with Pi. Generic entity status/path infrastructure remains in `../__lib/`, while provider records and branch provisioning remain in `../integrations/`. See [artifact intake](../../references/artifacts.md) and [integration behavior](../../references/integrations/shared.md) for operational contracts.
