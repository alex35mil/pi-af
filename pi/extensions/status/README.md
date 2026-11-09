# Status Extension

Publishes Pi status entries (`ctx.ui.setStatus`) that editor integrations such as pi.nvim read. In RPC mode they arrive as `extension_ui_request` messages with method `setStatus`.

## Status keys

- **`status:runtime`** is `host` or `sandbox`, set on `session_start` from `PITON_RUNTIME` (see the [permissions runtime](../permissions/README.md#runtime)). It's cleared when the value is invalid; the permissions extension reports that error.
- **`status:limits`** is the current model provider's rate-limit usage as flat JSON, for example `{"h5":26,"h5Reset":1793359800,"wk":61,"wkReset":1793588400}`. It's cleared while the current provider has reported nothing.
  - `h5` and `wk` are the 5-hour and weekly usage in whole percent.
  - `h5Reset` and `wkReset` are each window's reset timestamp, exactly as the provider reports it.
  - Only the fields the provider last reported are included, such as `{"wk":61}`. A reset time appears only with its window's percentage.

## Rate-limit sources

- **`claude-code`:** on `message_end`, the assistant message's latest `claude-code.rate-limit` diagnostic. Usage is `unifiedWindows.five_hour` / `seven_day` `utilization` × 100, and resets are their `resetsAt` (Unix seconds).
- **`openai-codex`:** on `provider_stream_event`, the `codex.rate_limits` event. Usage is `rate_limits.primary` / `secondary` `used_percent`, and resets are their `reset_at`. This event shape, including the reset unit, hasn't been confirmed against a live session yet.

## Updates

- Each window is read on its own. One whose percentage is missing or not a number is left out, and so is a reset time that's missing or not a number.
- Each provider keeps its latest payload in memory. They survive model and session switches and reset when extensions reload.
- A payload with at least one window replaces the stored values. A window or reset time the provider stops reporting disappears, so an old value never looks current. A payload with neither window is ignored.
- After every update and on `model_select`, the current provider's values are published.

## Configuration

None.
