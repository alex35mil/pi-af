# piton

My coding agents setup.

- [`pi/`](pi/): the pi package: extensions, skills, and the Epic/Task/Gig workflows.
- [`daemon/`](daemon/): owns pi processes on the Mac so sessions outlive their clients; creates and deletes worker
  clones. [pi.nvim](https://github.com/alex35mil/pi.nvim) attaches through `piton attach`. See
  [docs/daemon.md](docs/daemon.md).
- [`apps/`](apps/): Piton for iOS, iPadOS, and macOS: read and steer sessions over Tailscale.
- [`nvim/`](nvim/README.md): Neovim plugin: agent pickers, tabs, and the tracker queue, over `piton worker`.

Design and development: [docs/design.md](docs/design.md), [docs/development.md](docs/development.md),
[docs/pi-findings.md](docs/pi-findings.md).
