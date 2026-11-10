# Daemon and CLI

## Running it

```sh
mise run daemon:build
daemon/target/debug/piton daemon                # foreground; ctrl-c stops every pi
daemon/target/debug/piton start ~/Projects/foo  # new session in the nono sandbox (profile piton)
daemon/target/debug/piton start ~/Projects/foo --host --prompt "hello"
daemon/target/debug/piton ls
daemon/target/debug/piton stop --session <pi session id | session file | piton key>

mise run daemon:install                         # stable binary in ~/.cargo/bin + launchd agent (host only)
piton service status | piton service uninstall
piton --version                                 # package version and the git commit it was built from
tail -f ~/.local/state/piton/logs/daemon/current.log  # bounded daemon log
```

## Workers

Copy-on-write clones for agents; see "Workers" in [design.md](design.md).

```sh
piton worker create "Fix login" --issue KID-5   # from the current checkout: ../<repo>--fix-login
piton worker ls
piton worker delete ../<repo>--fix-login [--force]
```

Per-project settings live in `.piton.toml` in the source checkout (read only from there, never from a worker).

## pi.nvim

```lua
process = {
    kind = "attached",
    cmd = { "piton", "attach" },
    terminate = { "piton", "stop", "--session", "${{SESSION_ID}}" },
}
```

`piton attach` launches a fresh pi in the tab's workspace (sandboxed), relays pi RPC, and exits 0 on detach, 3 when pi
ended, 1 when the connection was lost. `:PiContinue` / `:PiResume` onto a session that's live in piton attach to it.

## Configuration

Optional, in `~/.config/piton/config.toml`; every key has the default shown. Unknown keys are refused, so a typo stops
the daemon from starting. The daemon reads the file at startup: run `piton service install` after changing it.

```toml
socket = "~/.local/state/piton/piton.sock"  # for tests and development only: the Mac app always uses this default
log = "~/.local/state/piton/logs/daemon/current.log" # five files, 2 MiB each
attach_mode = "sandbox"   # mode for `piton attach`
empty_grace_ms = 10000    # stop a pi with no messages this long after its last client leaves
keep_awake = true         # caffeinate -i while sessions are live (idle too); toggle in the apps
roots = []                # where the apps may browse and start sessions; none until you list some,
                          # e.g. ["~/Projects"]; piton attach and the CLI aren't limited

[tailnet]
enabled = true            # the apps' WebSocket on this Mac's Tailscale addresses
port = 7357
cli = "tailscale"
heartbeat_ms = 10000      # ping each app this often; drop it after three unanswered pings
retry_ms = 10000          # while Tailscale isn't up, try again this often

[logging]
mode = "info"             # host logging level ("info" or "debug"); `piton logging` and the Mac app switch it
                          # until it expires or the daemon restarts

[pi]
command = ["pi"]
args = []                 # added after `--mode rpc`

[sandbox]
command = ["nono"]
profile = "piton"         # base; a source checkout's .nono.json extends it, its .project/.local is allowed.
                          # Grants every sandboxed pi needs go in this profile.

[env]
login_shell = true        # base environment from `$SHELL -l`
mise = true               # plus `mise env -C <workspace>`

[stop]
grace_ms = 15000          # after closing stdin, before SIGTERM
term_grace_ms = 3000      # after SIGTERM, before SIGKILL
```

## Logging

`piton logging status`, `piton logging debug [--until-disabled]`, and `piton logging info` switch host logging through
the daemon without restarting sessions, until the switch expires or the daemon restarts. `[logging] mode` is the
default; debug expires after one hour unless kept on. The independent phone collector is installed with
`mise run logs:install` (host only) and removed with `piton logging uninstall`. App settings, collection, paths, and limits: [logging.md](logging.md).

## Tests

```sh
mise run daemon:test                                 # unit tests + e2e against real pi (faux model, host mode)
cd daemon && node tests/probe/probe.mjs <scenario>   # pi RPC probes, see pi-findings.md
```

The e2e tests use pi's faux provider through `daemon/tests/fixtures/faux-extension.ts`, so they need no credentials.
They run in host mode because nono can't start inside a nono sandbox.
