/**
 * Every test file imports this first, so tests run in the host runtime no matter where the
 * runner was launched. A sandboxed worker exports PITON_RUNTIME=sandbox, and inheriting it
 * would make fixture repositories fail the sandbox artifact guard. Tests that exercise the
 * sandbox runtime set PITON_RUNTIME themselves and restore it afterward.
 */

import { RUNTIME_ENV } from "../extensions/__lib/runtime.ts"

delete process.env[RUNTIME_ENV]
