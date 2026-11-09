# Parallel sandboxed workers

Work on several issues at once: each gets its own Pi in its own disposable copy of the repository, opened in its own Neovim tab. Pi runs on the macOS host inside a [nono](https://nono.sh) sandbox, so it can change only its copy and the workflow artifacts it shares with you.

pi-af doesn't create or delete workers. Your editor tooling does that, using the contract below; pi-af makes Pi and the workflows behave correctly inside one.

## How a worker is laid out

- **The copy:** `<parent>/<repo>--<name>`, an APFS copy-on-write clone of the source checkout `<parent>/<repo>`. It starts with your dependencies and build output, which take no extra disk space until they change. Clone everything except `.project/.local`, which gets linked anyway: it's often the largest folder, so skipping it makes creating and deleting a worker much faster. Calling `clonefile(2)` per entry is much faster than `cp -c -R`, which copies file by file. The Gig or Task workflow inside it creates its branch.
- **Linked:** workflow artifacts (`.project/.local`) are the only shared state. Provisioning replaces the copy's `.project/.local` with a symlink to the source checkout's, so every worker and the source see one set of Gigs, Tasks, and Epics, and nothing needs copying back. Project setup creates `.project/.local`, so every configured project has one to link. In a worker (`PI_AF_RUNTIME=sandbox`), the workflow refuses to start or resume work, or record incoming-PR evidence, unless `.project/.local` is that link, so artifacts never end up only in a copy you'll delete.
- **Copied:** every other gitignored file, such as `mise.local.toml`, `.env`, dependencies, and build output, is the copy's own, from the clone. A change in one worker, such as a different dev-server port in `.env`, never reaches the source or other workers. Copies don't follow later changes in the source; recreate the worker to pick them up.
- **Launch:** a [pi.nvim workspace descriptor](https://github.com/alex35mil/pi.nvim) in the copy starts Pi ([example](pi.nvim.json)): `mise exec -- nono run -s --profile pi-agent --allow-cwd --allow <source>/.project/.local -- pi --mode rpc`. The one `--allow` grant gives the sandbox the linked artifacts folder. `mise exec` loads the copy's mise environment, such as the GitHub MCP token from its `mise.local.toml`, on the host, and nono passes it to Pi.
- **Close:** stop Pi, check that the copy has no uncommitted changes or unpushed commits (or confirm), delete the copy without following its symlinks, then fast-forward the source checkout's default branch.

Projects using workflows need the `/.project/.local` ignore rule without a trailing slash, so Git also ignores the symlink. Project setup writes it, and replaces the older `/.project/.local/` form.

## The nono profile

[`pi-agent.json`](pi-agent.json) is an example; adjust the placeholder paths and install it as `~/.config/nono/profiles/pi-agent.json`.

- **`extends: mise-dev`:** read-only toolchains managed by mise, and nono's default denies (credentials, keychains, browser data, shell history).
- **`workdir` with `--allow-cwd`:** read-write access to the copy only. Other repositories and the rest of the source checkout stay unreachable.
- **`~/.config/pi/agent` and `~/.config/claude`:** your shared Pi sessions, settings, and auth, and Claude Code's state, so workers behave like Pi on the host and their sessions are listed together.
- **`~/Library/Keychains`:** Claude Code keeps its login in the macOS keychain. This gives the worker the same keychain access Pi has on the host.
- **The `read` paths:** the real locations of your Pi config files and of pi-af. The sandbox checks a symlink's target, not the link, so a symlinked `settings.json` needs its target granted.
- **`open_port: [0]`:** the Claude Code provider runs a small relay on a random localhost port.
- **SSH (`read_file`, `unix_socket`, `bypass_protection`, `network_profile: null`):** `git push` over SSH reads `~/.ssh/config` and `~/.ssh/known_hosts` and talks to your SSH agent; private keys stay unreadable. nono expands `$SSH_AUTH_SOCK` at launch, so a new socket path after a reboot needs no change. The inherited network profile proxies traffic through nono's HTTP proxy, which can't carry SSH, so it's cleared.
- **`PI_AF_RUNTIME=sandbox`:** tells pi-af it runs in a worker, so it loads `permissions.sandbox.json` files ([permissions](../../extensions/permissions/README.md#runtime)). For example, a global `permissions.sandbox.json` can relax shell confirmations for workers only.

## Limitations

- **Shared temp:** nono gives every sandbox the system temp directories (`$TMPDIR`, `/tmp`). Workers and the host share temp files, so one worker can read another's, such as review prompts. Isolation covers checkouts, not temp.
- **Permission files:** a worker can edit its own permission files, as Pi on the host can.
- **macOS only.** No CPU or memory limits: nono enforces them only on Linux.
