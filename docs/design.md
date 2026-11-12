# piton: design

Status: draft. Decisions below were settled in discussion; open questions are listed at the end.

## Problem

A pi RPC process lives exactly as long as the client that started it: Pi 1.3.0 RPC has one client per process, the
client owns pi's stdin, and closing stdin shuts pi down (still true on 1.5.2). Today that client is pi.nvim inside Neovide, so every session
dies with the editor and is unreachable away from the laptop.

piton separates where pi runs from who is looking at it:

- pi processes run under a daemon on the laptop and outlive any client;
- pi.nvim becomes a client that connects and disconnects without interrupting a session;
- an iOS/iPadOS app (and a macOS menu bar app) connects over Tailscale to read and steer sessions;
- the user is notified by push when an agent needs them.

piton is personal tooling for one user on one MacBook Pro. pi.nvim is a public, provider-neutral library; piton is one
implementation of its generic connector contract and gets no special treatment there.

## Use cases

From the phone, in priority order:

1. Get told when an agent needs attention: a run finished (it stopped its loop), it asks a question (extension
   dialog), it failed, or pi exited.
2. Read a session live, including the reply that is still streaming.
3. Steer a drifting run, answer a finished one with a follow-up, answer a dialog, abort.
4. Start a new session in a workspace, or continue a saved one.
5. Later: review what the agent changed (diffs).

From the laptop: keep working in pi.nvim exactly as today, and pick up a session that was driven from the phone.

## Principles

- **Transparent to pi.** piton runs `pi --mode rpc` in the workspace with the environment the user's shell would give
  it. It never changes pi's settings, agent directory, session files, or extensions, and never computes pi's session
  folder itself. Per-folder agent directories (set through mise) keep working because piton makes no assumption about
  them.
- **Build on pi's protocol, don't replace it.** pi.nvim gets raw pi RPC. piton types only the fields it acts on
  (command ids and types, event types, extension UI requests); everything else passes through as JSON.
- **One live pi per session file.** pi doesn't lock session files; two processes appending to one file corrupt its
  tree. piton enforces the rule for every pi it owns. A pi started outside piton (a terminal) is out of scope.
- **Single writer, many readers.** The last client to send a prompt, steer, follow-up, abort, or dialog answer becomes
  the session's writer. Everyone sees everything. No locks, no take-control step.
- **Exhaustive domain types.** Session lifecycle, connection, attention, and writer state are Rust enums matched
  exhaustively.

## Architecture

```
Neovide/pi.nvim ── stdio, raw pi RPC ── piton attach ──┐
                                                     ├─ Unix socket ──────────┐
Piton.app (macOS menu bar) ────────────────────────────┘                        ├─ piton daemon ── pi --mode rpc (× N)
iPhone / iPad ─────────── WebSocket over the tailnet ─────────────────────────┘        │
                                                                                       ├─ APNs (direct)
                                                                                       ├─ Telegram (optional)
                                                                                       └─ piton-sleepd (XPC)
```

### Components

- **`piton` (Rust, one binary):** the daemon (`piton daemon`) and the CLI (`piton attach`, `piton stop`, `piton ls`,
  `piton service install|uninstall`).
- **`Piton.app` (SwiftUI, one codebase for iOS, iPadOS, macOS):** session list, session view, steering, dialogs,
  notifications. On macOS it is a menu bar app that also bundles and registers the daemon and the sleep helper.
- **`piton-sleepd`:** privileged helper with exactly two operations (prevent sleep, restore sleep). Language decided
  during implementation (Swift is simplest for XPC).

### Packaging

One signed `Piton.app`, distributed outside the App Store (a sandboxed app can't spawn processes or install a helper):

```
Piton.app/Contents/
  MacOS/Piton                          SwiftUI app
  MacOS/piton                          Rust daemon + CLI
  MacOS/piton-sleepd                   privileged helper
  Library/LaunchAgents/…piton.plist    daemon, user login agent
  Library/LaunchDaemons/…sleepd.plist
```

The app registers both through `SMAppService` and offers a "Start at login" toggle. launchd restarts a crashed
daemon. Quitting the app leaves the daemon and sessions running. `piton service install|uninstall` writes the same
LaunchAgent for development without the app. The CLI is symlinked onto `PATH`.

### Launching pi

For every pi it starts, piton:

1. builds the environment: the user's login-shell environment captured at daemon start (launchd's environment is
   minimal), plus `mise env -C <workspace> --json`, computed once per launch;
2. reports an untrusted or failing mise config instead of launching;
3. runs pi in the workspace, in the launch's mode (below).

Sessions started from nvim and from the phone get identical environments, and each worker clone gets its own mise
environment (today a `:tcd` worker inherits the Neovide launch folder's environment).

### Launch mode: sandbox or host

The mode is chosen per launch, not per workspace. nono is the only sandbox.

- **Sandbox (default):** `nono run -s <profile args> --allow-cwd [--allow <source>/.project/.local] [--allow <extra>]...
  -- pi --mode rpc [...]`, with piton's environment passed through. The profile args are `--profile <source>/.nono.json
  --extends <base>` when the source checkout has a `.nono.json` overlay, else `--profile <base>` (base from piton's
  config, default `piton`). See "Workers" for what "source" means.
- **Host:** `pi --mode rpc [...]` directly. Only chosen explicitly: `piton start --host`, or the host toggle in the app.
- `piton attach` (pi.nvim) always launches in sandbox mode. Choosing host from pi.nvim is out of scope for now.
- A session's mode is recorded; resuming a saved session from the app or CLI defaults to its last mode; an attach to a
  live session keeps whatever mode it runs in.
- No workspace file decides the mode, so an agent can't change how its own pi is launched.

### Workers

A worker is an APFS copy-on-write clone of a source checkout, `<parent>/<repo>--<name>` next to `<parent>/<repo>`,
with `.project/.local` linked to the source's.

- **Relation:** a workspace is a worker when its local git config has `agent.source` and the folder layout matches;
  otherwise it's a source. A claim without the layout is refused, so a stray config value can't point a sandbox
  elsewhere.
- **Source-only settings:** the nono overlay (`.nono.json`, plus the gitignored `.nono.local.json` for this machine's
  grants, which can only add to it), the shared artifacts folder, and the project config
  (`.piton.toml`) are read from the source, never from the worker, so an agent can't widen its own sandbox or change
  what new workers copy by editing its clone. (An agent running in the source checkout itself can still edit them.)
  A workspace inside a checkout (pi started in a subfolder) belongs to that checkout: its settings come from the
  checkout's source, and deleting a worker stops the sessions in its subfolders too.
- **`.piton.toml`:** per-project piton settings. `[workers] skip = [...]` lists paths not copied into new workers, such
  as editor indexes that break tooling in a clone (`apps/.build/index-build` here). It only removes things from the
  copy.
- **`piton worker create <name> [--from <checkout>] [--label] [--issue]`:** the source must be clean on its default
  branch; piton fast-forwards it, clones everything except the skip list and `.project/.local` (one `clonefile(2)` per
  entry), links `.project/.local`, and sets `agent.source`, `agent.label`, `agent.issue`. When mise trusts the
  source's own config, piton trusts the worker's too (`mise trust <worker>`): its config files are the source's,
  cloned, so this grants nothing the user hasn't. An untrusted source gives an untrusted worker, and a launch there
  reports it (see "Launching pi"). It writes no pi.nvim
  descriptor: pi.nvim's global spec attaches through piton, and a workspace descriptor would override that and bypass
  piton (no phone access, no keep-awake). The worker's sandbox comes from piton at launch (see "Launch mode").
- **`piton worker ls`:** the source's workers with their live sessions.
- **`piton worker delete <path> [--force]`:** refuses with the uncommitted changes and unpushed commits unless forced;
  stops the worker's sessions, drops mise's trust in the folder, unlinks `.project/.local`, deletes the folder, and
  fast-forwards the source.
- **`--json`:** every `piton worker` command prints the daemon's response; refusals are typed (`kind`: `exists`,
  `source_dirty`, `source_off_default`, `unknown_default`, `invalid_name`, `not_a_repository`, `not_a_worker`,
  `leftovers`, `failed`) with what a caller needs to explain or force them, and exit 4.

The editor keeps its UI (tabs, picker, tracker queue, dialogs) and calls `piton worker` for the rest.

### pi version

piton targets pi 1.5.2. pi is pinned in the user's global mise config and bumped centrally across tools, so this
repository doesn't pin pi itself (piton launches whatever `pi` the workspace's environment resolves); the pi package's
minimum is in `pi/README.md`. The RPC protocol docs (`rpc-commands.md`, `json.md`, `rpc-extension-ui.md`) are
identical on 1.3.0, 1.5.0, 1.5.2, and `main` (checked 2026-11-07, 1.5.2 on 2026-11-11). Differences between
versions that shaped piton:

- **Stopping pi.** On 1.3.0, a signal that arrives while pi is shutting down after stdin EOF cuts its cleanup short
  (for example a pending OAuth token save). So piton stops a pi by closing its stdin only, waiting the grace period, and
  only then sending SIGTERM, and SIGKILL after a further short wait. The default grace is longer than pi.nvim's 5 s
  (proposed 15 s) because pi waits for pending work. This sequence is also correct on newer pi, where SIGTERM starts an
  orderly shutdown too.
- **Unrequested exits.** Newer pi exits at once when an extension calls `ctx.shutdown()` while idle (1.3.0 waits for
  the next command). Either way piton must treat an exit it didn't request with code 0 as "pi ended" (connections exit
  3), not as a crash, in status and notifications.
- **Session writes.** 1.5.0 fixed failed session writes leaving entries in memory that never reached disk. On 1.3.0 a
  failed write can still make the live pi and its file disagree; piton doesn't depend on the file matching the live pi
  except when resuming after a daemon restart.
- **Prompts sent together.** From 1.5, pi drops a `prompt` that arrives while the previous one is still being
  prepared, after answering it `"started"` (docs/pi-findings.md, "Queued prompts"). So the session task writes one
  `prompt` at a time, from every source (rpc clients, the apps, `start --prompt`), and holds the next until pi
  answered the previous one. Held prompts reach pi even if their client left.

### Workspace roots

piton's config lists workspace roots (`roots`; `daemon/src/workspaces.rs`). There are none by default: until the owner
lists some, `workspaces.browse` and `session.start` from a `view` client refuse with "no workspace roots configured",
and the apps say so. A root is a tree of grouping folders with repositories at varying depth, e.g. `~/Projects/personal/apps/app` and its worker clone `~/Projects/personal/apps/app--fix-login`
next to it. A **workspace** is a folder under a root that
contains `.git`; piton doesn't descend into a workspace, so subfolders of a repository aren't shown. Hidden folders are
skipped.

- `workspaces.browse {path?}` returns one level as `{entries}`: the direct children of `path` (the roots when
  omitted), each either `{kind: "group", name, path}` (a folder without `.git`, browsable further) or
  `{kind: "workspace", name, path, source?}` (`source` for a worker). Groups first, by name. The phone loads a level
  when you open it, so there is no depth limit and no full scan. Paths outside the roots are refused (canonicalized
  first, so `..` can't climb out).
- Not yet: `workspaces.recent` (workspaces piton launched pi in, newest first), `workspaces.search {query}`, and live
  session counts per workspace.
- Worker clones are ordinary workspaces in that tree. Grouping them under their main repository is a later refinement.
- `session.start` from a `view` client rejects a path that isn't a git checkout under a root.
- `piton attach` and `piton start` are not limited by roots: they run locally, in a workspace you chose yourself.

### Session registry

piton keeps one record per live pi: workspace, pi process, session id and file (from `get_state`, refreshed after
`switch_session`, `new_session`, `fork`, `clone`), status, connected clients, writer, pending dialogs, and the session
view (below).

Saved sessions that aren't running are listed from the session folder pi reports. Finding that folder for a workspace
with no live pi is part of the session creation redesign (#208).

### Attaching from pi.nvim

pi.nvim knows nothing about piton: it supports any attached connector (its README, "Attached pi"), and piton is one.
piton relies on that generic contract:

- **Restore:** after connecting, after an automatic reconnect, and after every successful `switch_session` and
  `new_session`, pi.nvim rebuilds the chat from `get_state` and `get_entries`, holding back records that arrive before
  the `get_entries` response and dropping the ones the snapshot already has. piton's replay (below) fills in what
  those two don't contain.
- **Reconnect:** a connector exit other than 3, when pi.nvim didn't ask for it, is a lost connection, retried with the
  same command. When the reached conversation is empty and idle and the previous one had messages, pi.nvim sends
  `switch_session` back to it. Every new `piton attach` reaches a fresh, empty pi, so this is what returns a tab to its
  live session.
- **Exit code 3:** the pi behind the connector ended; no reconnect.

The global launch spec:

```lua
process = {
    kind = "attached",
    cmd = { "piton", "attach" },
    terminate = { "piton", "stop", "--session", "${{SESSION_ID}}" },
}
```

`piton attach` runs in the tab's workspace (its working directory, symlinks resolved), connects to the daemon's Unix
socket, sends a hello, and then relays pi RPC records in both directions. Its stdout carries protocol records only;
diagnostics go to stderr. The connector's environment is not passed to pi; piton builds pi's environment itself.

| pi.nvim action | What pi.nvim sends | What piton does |
| --- | --- | --- |
| `:Pi` | runs the connector | launches a new pi in the workspace |
| `:PiContinue`, `:PiResume` | `switch_session <path>` | see "Commands piton intercepts" |
| `:PiNewSession` | `new_session` (no `abort`) | see "Commands piton intercepts" |
| `:PiAbort` | `abort` | passes through, even on a shared pi |
| `:PiDetach`, tab close, Neovim exit | closes the connector's stdin | drops the client, exits 0; pi keeps running |
| `:PiStop` | confirms, runs `terminate` | `piton stop --session <id>`: see below |
| automatic reconnect | runs the connector, then `switch_session <previous file>` | new pi, then the move rule brings it back |

#### Commands piton intercepts

A pi is **shared** when more than one client is connected to it.

- **`switch_session <path>`, another live pi has that file:** don't forward. Move the connection to that pi (the move
  sequence below). This is what makes `:PiContinue`/`:PiResume` attach to a running session and what makes reconnect
  land back on the live pi.
- **`switch_session <path>`, no live pi has it, this pi shared:** launch a new pi on that file for this client and move
  the connection there, so the other clients keep their conversation.
- **`switch_session <path>`, no live pi has it, this pi not shared:** forward; the pi loads it (today's behavior).
- **`new_session`, this pi shared:** launch a fresh pi in the workspace for this client and move the connection there.
  Not shared: forward.
- **`fork`, `clone`, this pi shared:** reject with `success: false` and a clear error. Not shared: forward.

Move sequence, on the client's connection, in order:

1. a `success: false` response (`"connection moved to another session"`) for each of this client's commands still in
   flight on the old pi;
2. the success response to the intercepted command;
3. the target pi's replay (below);
4. the target pi's live records.

Nothing from the old pi is delivered after step 2. pi.nvim runs its restore after every successful `switch_session`
and `new_session`, so it rebuilds the chat from whatever pi it now talks to. Limitation: the old pi's
`session_before_switch` hook doesn't run on a move, because that pi isn't switching.

Not interceptable: an extension's `switch_session` or pi's own `/new` and `/resume` handled inside pi. piton doesn't
detect a resulting collision today; whether it can is open question 1 (#210).

#### Ending connections

| `piton attach` exit | When |
| --- | --- |
| 0 | its stdin closed (detach); within a second or two |
| 3 | this session's pi ended (terminated or crashed); pi's last stderr lines are written to stderr first |
| other non-zero | connection lost: the daemon stopped or restarted, the socket dropped, or the daemon isn't running (fails fast) |

pi.nvim reconnects on anything but 3 when it didn't ask to detach or terminate. A daemon shutdown or restart must
therefore never use 3, so pi.nvim reconnects and resumes the session from its file.

`piton stop --session <id>` stops that pi as described in "pi version" (stdin close, grace period, then signals; a
forced stop is reported on stderr). It exits 0 only once pi has stopped; every connection on that pi exits 3. Daemon
shutdown stops every pi the same way, in parallel.

#### Empty pis

When the last client leaves a pi that has no messages, no run, and no pending dialog, piton stops it after about 10 s
(so a quick reconnect lands on it). This covers `:Pi` then closing the tab, a cancelled `:PiResume` in a fresh tab,
the pi left behind by a move, and the same cases from Swift clients.

### Multiple clients on one session

Pi has one stdin, so the daemon multiplexes:

- **Command ids:** each client's ids are rewritten to unique ids on the way to pi and restored on the way back, so
  responses reach only the client that asked. Events go to everyone.
- **Writer:** updated on every steering command from any client.
- **Dialogs:** piton tracks every pending `extension_ui_request` (dialog methods) until a client answers, its timeout
  passes, or pi exits. Answers after the first are dropped by piton (pi ignores them anyway). A dialog answered on
  another client stays open in pi.nvim until dismissed, since pi sends nothing when a dialog resolves.
- **Order:** each pi's stdout has one reader; every connection gets records in pi's order. Responses to other clients'
  commands are filtered out, never reordered.

#### Replay

piton keeps the temporary state that neither `get_state` nor `get_entries` contains, and sends it to an `rpc` client as
pi's original records, unchanged, as the first records on the connector's stdout (or right after the success response
of a move), before any live record. Taking the snapshot and switching to live relaying is one step in the session's
task, so no live record is skipped or sent twice. Order:

1. `compaction_start`, if a compaction is running;
2. the in-progress assistant message: its `message_start` and `message_update` records so far;
3. tools still running: each `tool_execution_start` and its `tool_execution_update` records so far;
4. the latest `queue_update`;
5. pending dialogs, each `extension_ui_request` with its original `id`;
6. the latest `setStatus` and `setWidget` per key.

pi.nvim holds these back until its `get_entries` response and deduplicates them against the snapshot, so with piton
there is no "response in progress" placeholder and no invisible dialog.

### Session view (Swift clients)

Swift clients don't get raw RPC. The daemon keeps a structured model of each live session (`daemon/src/view.rs`) and
sends a snapshot plus numbered changes. It's built from pi's entries (`get_entries`, active branch) at launch and after
`switch_session`/`new_session`/`fork`/`clone` and successful compactions, and kept current from the event stream.

- **Items** (flat list, conversation order, each with a daemon-assigned `id`):
  - `user {content}`: pi's content (string or blocks).
  - `assistant {content, streaming, stop_reason, error, model}`: pi's content blocks (`text`, `thinking`, `toolCall`).
  - `tool {call_id, message, name, args, status, preview, truncated}`: one per tool call, `message` = the assistant
    item that made it. `status`: `pending`, `running`, `done`, `error`. `preview` is the output's text tail (40 lines,
    4 KB); the full result via `session.tool_output`. `truncated` is also set when the output has images.
  - `summary {kind: compaction|branch, text}`, `notice {level, text}` (retries, failures, aborts, extension errors),
    `other {role, message}` (roles the view doesn't model, passed through).
  - System messages aren't shown.
- **Images:** no image data travels in items, changes, or `session.tool_output`. Each pi image block, at any depth,
  becomes `{type: "image", image: <id>, mime_type}`, and `session.image` returns one image's data. A pasted screenshot
  is about 1 MB of base64 (pi keeps prompt images up to about 4.5 MB): inline, a few of them would make every snapshot
  that large. Ids are per session and live until the next reset. The apps accept messages up to 16 MiB; URLSession's
  default, 1 MiB, failed the whole connection on one large `session.image` reply (2026-11-10).
- **Changes:** `append {item}`, `replace {item}`, `delta {item, index, field: text|thinking, text}` (streaming),
  `state {state}`, `reset` (conversation replaced; a new snapshot follows).
- **State:** `status` (`idle`, `working`, `needs_input`, `stopping`), workspace, mode, session id/file/name, `title`
  (name, else the first line of the first user message), model, thinking level, queue (`steering`, `follow_up`),
  pending dialogs (pi's `extension_ui_request` records).
- **Window:** the newest `limit` items (default 50, max 200); `session.history` pages back.
- **Resume:** every change has a `seq`. `session.watch {from}` sends the missed changes, or a snapshot when they aren't
  kept (5000 per session) or a reset happened since.

The same model drives the session list's titles and status; notifications next.

### The `view` protocol

One JSON object per line after the hello `{"protocol":"view","version":1,"client":"<name>"}`. Requests carry an
`id` and get exactly one `{"type":"reply","id","ok":true,"data"}` or `{"type":"reply","id","ok":false,"error"}`.
Pushed lines have no id: `sessions {sessions}` (after `sessions.subscribe`, then on every change),
`snapshot {session, seq, items, has_more, state}`, `change {session, seq, change}`.

Requests are taken in the order they arrive: what one does to a session (a message queued for pi, a watch) happens
before the next is read, so a client's messages reach pi in the order it sent them. Replies come when each request's
outcome is known, so a slow one (a stop waiting for pi to exit) doesn't hold up the others; replies can therefore
arrive out of request order.

| Request | Data |
| --- | --- |
| `sessions.list` | `{sessions}`: live sessions (key, id, file, workspace, checkout, mode, status, clients, pid, title) |
| `sessions.subscribe` | `{}`; then pushes `sessions` and `daemon {state}` lines on change |
| `daemon.state` | `{state}`: `keep_awake` (enabled), `awake` (held now), `sessions` (live count), `logging` (`policy`, `default`) |
| `daemon.keep_awake {on}` | `{state}`; until the daemon restarts |
| `daemon.logging {policy}` | `{state}`; until it expires or the daemon restarts |
| `workspaces.browse {path?}` | `{entries}`; see "Workspace roots" |
| `session.start {workspace, mode?, prompt?}` | `{session}`; mode defaults to `sandbox`; `workspace` must be a checkout under a root |
| `session.stop {session}` | `{forced}` |
| `session.watch {session, from?, limit?}` | `{}`; then a `snapshot` (or the changes since `from`) and every change |
| `session.unwatch {session}` | `{}` |
| `session.history {session, before, limit?}` | `{items, has_more}`: items before item id `before` |
| `session.tool_output {session, call_id}` | pi's full tool result, images as references |
| `session.image {session, image}` | `{mime_type, data}`: one image's base64 data, by the id in its reference |
| `session.send {session, message_id, text, mode?}` | pi's response data. Always pi's `prompt` with a `streamingBehavior`, so pi, not the daemon's view of its status, decides whether a run is active: `prompt` (default) and `follow_up` start a run when idle and queue a follow-up during one; `steer` steers a run. pi gets one prompt at a time (see "pi version"). `message_id` is the client's id for the message: a repeat with the same id reaches pi once and gets the first reply (see "Lost replies") |
| `session.abort {session}` | `{}` |
| `session.answer {session, request_id, answer}` | `{}`; `answer` has pi's `value`, `confirmed`, or `cancelled`. Refused when already answered |

A session's `checkout` is `{kind: "source"}` (the workspace is the project) or `{kind: "worker", source, name}` for a
worker `<repo>--<name>` of the project at `source`. The daemon decides it the way it does for the sandbox (the worker's
`agent.source` git config, accepted only for the `<repo>--<name>` layout next to `<repo>`), so clients never parse
folder names: a repository whose own name contains `--` stays a project. The apps group the session list by project:
projects ordered by their most urgent session, the project's own checkout first, then its workers by name. Cards share
one alignment and spacing, with `origin` or the worker slug at top left and status at top right; there are no separate
worker headers. Selection changes only the card border to cyan, without the native Mac row highlight.

#### Lost replies

A connection can drop after the daemon passed a message to pi but before the reply arrived (a phone losing signal),
so the client can't tell whether it was delivered. The apps keep every message in an outbox until it's confirmed and,
after reconnecting, send it again with the same `message_id`. The session remembers its last 256 message ids: a repeat
of one pi is still answering waits for that answer, a repeat of an accepted one gets the same reply without reaching
pi again, and a refused one is forgotten so a retry tries again. Abort and dialog answers need no id: aborting twice
is harmless and a second answer is already refused.

A view client counts as a session client (writer rule, empty-pi cleanup). Not yet: saved sessions in `sessions.list`,
`session.open`, workspaces, devices/presence, images in `send`.

### Remote access (tailnet WebSocket)

The `view` protocol also runs over WebSocket on this Mac's tailnet addresses (`[tailnet] port`, default 7357), one
text frame per message, plain `ws://` (Tailscale encrypts the traffic). `daemon/src/tailnet.rs`,
`daemon/src/websocket.rs`.

- **Client transport:** the apps use the system proxy settings, as any app does (diagnostics log which proxy iOS
  picks; see `docs/logging.md`). Traffic still uses Tailscale's VPN routing/encryption; it isn't ordinary public web
  traffic. Every terminal path
  invalidates its URLSession (failure, deadline, cancellation, remote close, or explicit close), releasing the delegate
  before another reconnect can accumulate retained sessions.
- **Who gets in:** before the WebSocket handshake, `tailscale whois --json <peer>` identifies the device. Accepted only
  when it belongs to the same Tailscale user as this Mac, isn't tagged, isn't shared in from another tailnet, and
  isn't this Mac itself. Refusals are logged with the reason; the peer sees the connection close.
- **Why not this Mac:** sandboxed agents can open network connections, and through the tailnet address they'd look
  like the owner. Local clients use the Unix socket (`0600`, outside the `piton` sandbox). Never add a localhost or
  token path to the WebSocket: the identity check is the only way in.
- **Only `view`:** an `rpc` or `control` hello over the WebSocket is closed (no remote `piton attach`).
- **Dead connections:** a phone that loses its network sends no close, and its TCP connection would linger for many
  minutes. The daemon pings every client (`[tailnet] heartbeat_ms`, default 10 s) and drops one that answers none of
  three pings in a row. The apps ping too (every 15 s) and reconnect when a pong doesn't arrive within 10 s.
- **Unnoticed drops:** a connection can die while the phone is suspended in the background or when its network changes,
  and through a local proxy the phone's side stays open: writes seem to succeed and requests wait for the next pong
  timeout (up to 25 s). So the iPhone app checks the connection when it becomes active and when the network path
  changes: a ping with a 2 s deadline, reconnecting at once when it isn't answered. A store waiting to retry retries
  immediately.
- Without Tailscale (not installed, not running) the daemon logs it once and serves local clients only, trying again
  every `[tailnet] retry_ms` (default 10 s): at login launchd can start it before Tailscale is up. Once listening, it
  checks every minute whether this Mac's tailnet addresses changed and listens on the new ones.
- Tests use a fake `tailscale` CLI (`daemon/tests/fixtures/fake-tailscale.sh`) that puts the listener on loopback.
- macOS firewalls (Little Snitch) hold incoming connections until allowed. `mise run daemon:install` signs
  `~/.cargo/bin/piton` with the team's Apple Development certificate (identifier `com.alex35mil.piton.daemon`), so its
  code identity stays the same across rebuilds and a rule for that path keeps matching. Allow incoming TCP on port
  7357 from the tailnet ranges (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`); the identity check (Tailscale `whois`) is
  piton's own, the firewall rule only lets the connection reach it. Debug builds (`daemon/target/debug/piton`, tests)
  aren't signed and don't need the rule (tests listen on loopback).

### Protocols

Both run over the Unix socket (local, `0600`); `view` also over the tailnet WebSocket (see "Remote access"). Framing
is one JSON object per message (JSONL on the socket, one per frame on the WebSocket).

Every connection starts with a hello declaring its protocol:

```json
{"type": "hello", "protocol": "rpc", "version": 1, "workspace": "/abs/path", "client": {"name": "nvim"}}
{"type": "hello", "protocol": "view", "version": 1, "client": {"name": "iPhone", "device": "…"}}
```

- **`rpc`:** after the hello, raw pi RPC for one session. Used by `piton attach`. Possible later over the tailnet.
- **`view`:** piton's control and view protocol. Draft operations:
  - `sessions.list` (live and saved, with status), `sessions.subscribe` (list changes);
  - `session.start {workspace}`, `session.open {sessionPath}` (attach if live, else launch pi on it),
    `session.stop {id}`;
  - `session.watch {id, from?}` → snapshot + changes, `session.unwatch`, `session.history {id, before, limit}`;
  - `session.send {id, message_id, text, images?, mode: prompt|steer|follow_up}`, `session.abort {id}`,
    `session.answer {id, requestId, value|confirmed|cancelled}`;
  - `workspaces.browse {path?}`, `workspaces.recent`, `workspaces.search {query}`, `devices.register {apnsToken}`, `presence {id?, foreground}`.

  Commands map to pi RPC commands, so pi sees the same thing whichever client sent it.

Versioned from the start; schemas are defined in Rust and mirrored by hand in Swift. The daemon test `fixtures` writes
real protocol messages that PitonKit must decode, and fails when they're stale, so drift between the two shows up in
tests (see `docs/development.md`).

### Notifications

Attention is derived from the event stream:

| Trigger | Notification |
| --- | --- |
| `agent_settled` | finished, with the first line of the last reply |
| dialog `extension_ui_request` | needs input, with the dialog title |
| run failure, retries exhausted | failed |
| pi exited unexpectedly | exited |

- Channels are pluggable: APNs first (direct from the Mac, no relay; needs an Apple developer account), Telegram
  optional.
- iOS notifications offer an inline reply that sends a follow-up or answers a dialog without opening the app.
- A notification is skipped when the session has an active client: a `piton attach` connection that sent recently, or a
  Swift client in the foreground on that session.

### Keep-awake

- While keep-awake is on and any session is live (working or idle), the daemon holds a prevent-idle-sleep power
  assertion (`caffeinate -i`), so the phone can reach sessions it might want to steer; released when the last
  session ends. Idle sessions count: a Mac that slept with only idle sessions made the phone lose access
  (2026-11-08). The display may still sleep and the screen lock; the daemon and Tailscale keep running.
- On/off: config `keep_awake` (default on) is the default; the apps toggle it at runtime (`daemon.keep_awake`,
  the macOS menu bar item and Settings > General on both platforms). Not persisted: a daemon restart goes back to
  the config.
- Lid closed on battery without an external display sleeps regardless. For that, `piton-sleepd` toggles
  `pmset disablesleep` while agents work: it accepts XPC only from the signed daemon, restores normal sleep when the
  connection drops, and enforces a maximum duration and a low-battery/thermal cutoff.
- The helper needs the app bundle; the bare daemon gets only the assertion.

### Logging and agent access

The Info level records essential events; opt-in Debug adds detailed traces and expires after an hour by default unless
explicitly kept on. The apps retain bounded files alongside Apple's unified logger. Host logging (the
Mac app, the daemon, and a separate paired-iPhone collector) follows the daemon: `[logging] mode` in `config.toml` is
the default, and `daemon.logging` (the Mac app) or `piton logging` switches it until it expires or the daemon restarts,
like keep-awake. The policy is part of the pushed daemon state. The phone's capture setting is a device setting, local
to the phone, and works offline. No logging control changes pi's settings, uses its RPC channel, or restarts sessions.

Settings ownership: each setting lives in exactly one place. Mac-wide settings are in the daemon's `config.toml` (the
user's file, in their dotfiles), and app controls are temporary runtime switches on top of it, never a second stored
value. Device settings (the phone's Mac address and capture) live on the device.

Settings UI: one view per section, shared by both apps; only the container differs. The Mac has a Settings window (⌘,,
also in the menu bar item) with a sidebar: General (keep-awake, daemon version), Appearance, Logging (host level). It
follows System Settings' geometry: a fixed width (715 pt, sidebar 215 pt) and resizable height, and Esc closes it, after
anything inside that uses Esc first (a search field, an open picker). The phone has a Settings tab next to Sessions:
General, Connection (the Mac's address), Appearance, Logging (the phone's capture). Before an address is set, the phone
opens on Connection. The tab bar shows only at the top level, not inside a conversation. The iPad, when its window is
wide enough for two columns, has no tab bar: one split view whose sidebar switches between the sessions and the
settings sections (the phone's) with a Sessions | Settings switcher at its bottom, and whose content is the selected
session or section. Each keeps its selection while the other is shown, and the session stays watched. A narrow iPad
window (Slide Over, a narrow Split View) gets the phone's tabs. Settings use the system's
type, and each row carries its description under its title, as System Settings does, instead of section footers.

Conversation: an assistant message shows its text, never its thinking. While the newest block of a streaming message
is thinking, an `ellipsis.bubble` in the dim color sits next to the model name; while it streams text or a tool call,
a spinner does; nothing once it finishes. The composer is a multi-line field: on a hardware keyboard (Mac, iPad),
Return sends (steers while the session works) and Shift+Return or Option+Return breaks the line; the on-screen
keyboard's Return breaks the line and the send button sends. Images show as thumbnails under a count
(`photo.on.rectangle.angled`, "N images"); pi's notes for the model about resizing or converting an image (`[Image:
original WxH, displayed at …]`) are hidden. A clicked image opens at its natural size in points (pixels over the
screen's scale), fitted to 80% of the screen's visible area on the Mac and to the whole screen on the phone. Both show
it the same way: one viewer over a dimmed backdrop, holding the message's images, with a counter ("2 / 3") and a close
button on top. On the Mac the viewer covers the whole screen in a borderless window above everything, so stepping
swaps the image in place; the image is centered across and a little above center vertically, but never higher than a
full-size (80%) image, which sits exactly centered. ← and →, or the arrow buttons at the screen's edges (shown for more
than one image), step through the images; Esc, the close button, or a click
outside the image closes. On the phone the viewer covers the app: swipe across to page, pinch or double-tap to zoom,
tap to hide or show the controls (counter, close button, status bar), swipe down to close, as in Photos: the image follows
the finger and shrinks a little while the backdrop and controls fade in place; released far or fast enough, they vanish
where they are and the image carries on off the bottom. Images are shown as pi stored them: pi shrinks an image
larger than 2000 × 2000 px or 4.5 MB (base64) before the model sees it and keeps only that copy (`images.autoResize`,
a model's `inputLimits.images.resize`), so a Retina full-screen screenshot opens at about 40% of the Mac's screen.

Look: one built-in theme (`PitonUI/Sources/Shared/Theme.swift`), no theme switch. A dark gray canvas (#272B30) with a faint grid, panels a step lighter (#2D3238; #34393F for the user's messages and
dialogs) with
hairline borders and chamfered corners, neon cyan as the only accent (green for done, red for errors and stopping,
yellow for needs-input and host mode), and three type voices: small uppercase letter-spaced labels and data in the code
font, content in the text font. Views take colors, fonts, and shapes only from the theme. The text font as default and
the roomier reading line spacing apply to the session list and conversations, not to Settings. Liquid Glass stays on
system chrome (bars, alerts, menus): iOS 27 has no opt-out.

Fonts are a device setting (Settings > Appearance): a text font and a code font, each the system font or any family
available to the app, scaled with Dynamic Type. The Mac lists its installed fonts. On the phone, fonts the user owns
(a paid one like Berkeley Mono can't be bundled) are imported from .otf/.ttf files: copied into the app's Application
Support and registered for the process at launch. Fonts installed system-wide through configuration-profile apps need
the "Use Installed Fonts" entitlement, which the app doesn't have.

The independent collector uses Apple's paired-device file service, not Piton's WebSocket: it can retrieve logs of a
failed Piton connection when CoreDevice can still reach the phone. At Info it makes no device calls. It
preserves the last good snapshot with explicit freshness metadata, and agents get read-only access to the log-only
directory, never the control socket or device tooling. See [logging.md](logging.md) for limits and setup.

### Deploying from a sandbox

Status: planned. Today installs are host-only (`mise run daemon:install`, `apps:mac`, `apps:phone`, `apps:ipad`).

An agent in a sandboxed session may deploy what it built: the daemon, the Mac app, or the iOS app on the iPhone or
iPad. This doesn't widen what the agent can do: the code it wrote runs on the host once deployed, whoever runs the
deploy, so a person approving each one adds no safety. What deploying must not do is disrupt work in progress, and
that's what gates it: the daemon decides when a deploy may take effect, and an agent can't skip that check.

The sandbox keeps every restriction it has. A deploy is a request, and the host does the work:

- **Deploy socket.** The daemon listens on a second Unix socket (`~/.local/state/piton/deploy.sock`, `0600`), the
  only piton path the `piton` nono profile allows. It speaks one request, `{deploy: daemon | mac | iphone | ipad,
  checkout}`, and nothing else: no session control, no host-mode launches, no paths or arguments to run. The control
  socket stays out of the sandbox.
- **Checkout.** The daemon builds from the checkout the request names, accepted only when it's a source or a worker
  that resolves under a known project (as for launches, "Workers"). It runs the existing `mise` task there, on the
  host, with the user's environment: signing, `/Applications`, `launchctl`, and `devicectl` happen in the daemon's
  context.
- **One at a time.** Deploys run in order: they share build folders and devices. Build output goes to
  `logs/deploy/`, which the sandbox can read.
- **CLI.** `piton deploy daemon|mac|iphone|ipad [--from <checkout>]` sends the request (over the deploy socket in a
  sandbox, over the control socket on the host) and prints the outcome; `piton deploy status` shows a pending one.
  Refusals are typed and exit 4, like `piton worker`.

#### Gates

A deploy builds and installs at once when that disrupts nothing, and otherwise waits for a safe moment or is refused,
per target:

- **Daemon.** Replacing the daemon restarts it, and a restart ends every pi (see "Deferred": sessions don't survive
  restarts; they continue from their files, and an in-progress turn is lost). So the daemon is swapped only when no
  session is busy: `working` (a run or a compaction), `needs_input` (a pending dialog), or `stopping`. Idle sessions
  don't hold it back; their clients reconnect (pi.nvim reattaches, the apps resume from their sessions' files).
  - The request builds and signs the new binary right away and stages it next to the installed one. A build failure
    is reported and nothing changes.
  - The swap then waits until every session is idle. That includes the requesting agent's own session: its turn ends
    before the restart, so the agent never cuts itself off mid-turn. The reply says the daemon is staged and which
    sessions it waits for.
  - While a swap waits, the daemon state carries it (`deploy: {target, from, waiting_for: [sessions]}`), the apps
    show it, and the user can restart now (Mac app, or `piton deploy daemon --now` on the host). `--now` isn't
    accepted on the deploy socket. A newer request replaces a staged one.
  - Swap: the old daemon stops every pi as on shutdown, moves the staged binary into place, keeps the previous one,
    and asks launchd to restart it. Before exiting it starts the previous binary as a watchdog: if the new daemon
    doesn't answer on its socket within 30 s, the watchdog restores the previous binary and restarts it, and the
    failure is logged. A broken daemon can't be fixed by a deploy through itself, so it must never stay installed.
- **Mac app.** Replacing it quits and relaunches Piton.app. That ends no session: the app reconnects and resumes
  every watched session from its last `seq`. Not gated by sessions. Gated by the app's outbox: a message not yet
  confirmed lives only in the app's memory, so the app is replaced only when its outbox is empty (it reports this in
  its hello and on change; an app that doesn't report it is replaced at once).
- **iPhone, iPad.** Installing relaunches the app on the device, which ends nothing on the Mac. The device must be
  paired and reachable; otherwise the request is refused (`device_unavailable`). Gated like the Mac app when that
  device is connected to the daemon.

The gates apply to every deploy, the user's included: on the host, `mise run daemon:install` goes through the same
request while a daemon is running (and installs directly when none is). `--now` is the user's override, never an
agent's.

## Scope

### v1

1. Daemon: launching pi with the mise environment, registry, Unix socket, `piton attach` relay with its exit codes, id
   multiplexing, command interception and the move sequence, replay, empty-pi cleanup, writer, `piton stop`, `piton ls`.
2. Keep-awake assertion.
3. Session view model and the `view` protocol over the tailnet WebSocket.
4. Piton.app: session list, session view, send/steer/follow-up/abort, dialogs, start/open sessions.
5. APNs notifications with inline reply.
6. LaunchAgent registration, sleep helper.
7. Deploying from a sandbox, with its gates.

Order: 1–2 first, verified with a scripted client against real pi and then with pi.nvim; 3–6 after. Progress is
tracked in the tracker, not here.

### Deferred

- Sessions surviving daemon restarts (a shim process per session owning pi's stdio). v1 keeps per-session state
  self-contained so moving it into a shim is mechanical. Until then, restarting piton ends all sessions; they continue
  from their files (an in-progress turn is lost).
- A "dialog resolved" record so other clients close a dialog answered elsewhere.
- Diff review on the phone (needs workspace file access, cf. pi.nvim #29).
- Choosing host mode from pi.nvim.

## Upstream watch

Upstream pi has been building multi-client support: a "server mode" (badlogic in pi#4737) and PR pi#7409 (merged
2026-07-31, `packages/client`/`packages/server` with shared/exclusive session leases; those packages are no longer on
`main`). None of it is in pi 1.5.2. Keep piton's pi-facing side behind one adapter so a future server mode replaces it
rather than the daemon.

`pi-durable` (experimental, in the same repository) is not an alternative: it's a library for building your own agent
harness in your own process, with its own storage, and it doesn't use the pi coding agent's sessions, settings,
extensions, or RPC. Using it would mean replacing pi. It is only a design reference: its `watch()` (windowed snapshot
plus changes) has the session view's shape.

## Open questions

1. A collision caused by a `switch_session` piton can't see (extension, pi's `/resume`): can piton detect it, and
   should it report only or also stop one side? Researched in #210.
