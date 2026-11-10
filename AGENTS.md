# AGENTS.md

piton: the user's setup for running pi coding agents on macOS.

## Areas

- `pi/`: the pi package (TypeScript): extensions, skills, and the Epic/Task/Gig workflows. Rules for it are in
  `.agents/rules/` and load by path.
- `daemon/`: the Rust crate (daemon + CLI). Owns `pi --mode rpc` processes so sessions outlive their clients, creates
  and deletes worker clones, and serves the apps. pi.nvim (public) attaches through `piton attach`.
- `apps/`: the Swift side (iOS, iPadOS, macOS). All code lives in Swift packages under `apps/packages/`; app targets
  (`apps/ios`, `apps/macos`) stay thin.
- `nvim/`: the Neovim plugin (Lua) over `piton worker`: agent pickers, tabs, the tracker queue. Public API and
  integration hooks are in `nvim/README.md`; no globals or built-in keymaps. Snacks and pi.nvim are dependencies,
  not the user's dotfiles. `mise run nvim:test` loads every module and tests the UI boundaries in clean Neovim.

## Docs

- `docs/design.md`: problem, principles, architecture, scope, and what piton relies on from pi.nvim. Read before
  changing architecture or protocols.
- `docs/pi-findings.md`: pi RPC behavior piton relies on, verified against real pi. Re-verify before relying on
  anything not listed.
- `docs/development.md`: layout, tasks, sandbox, signing.
- `docs/daemon.md`: running the daemon and CLI, configuration.
- `docs/logging.md`: local logging controls, bounded files, collector setup, and sandbox log access.

## Rules

- Run project tasks through mise from the repository root: `mise run <task>` (`pi:test`, `pi:typecheck`,
  `daemon:build`, `daemon:test`, `daemon:lint`, `apps:build`, `apps:test`, `nvim:test`, `build`, `test`, `lint`, `format`).
  `mise tasks` lists them.
- `apps/Piton.xcodeproj` and `apps/*/Info.plist` are generated from `apps/project.yml` by XcodeGen. Never edit or
  commit them; Info.plist keys go in the target's `info.properties`.
- piton must not change how pi works: the daemon runs `pi --mode rpc` as the user would and never touches pi's
  settings, agent directory, session files, or extensions.
- Domain modeling: sum types matched exhaustively, no wildcard arms over domain enums (enforced by clippy lints in
  `daemon/Cargo.toml`), typed errors.
- Installing or launching (`daemon:install`, running an app) and device-log collection (`logs:install`,
  `piton logging collect`) are host-only; in a sandboxed worker, build and test. Agents read the dedicated
  `~/.local/state/piton/logs/` directory, never its parent or the daemon socket.
- When a change alters documented behavior, update the docs in the same change.
