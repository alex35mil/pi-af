# piton for Neovim

Agent workers, a tracker queue, and source/worker tabs over `piton worker`. The daemon owns cloning, source updates,
sandbox settings, pi processes, and deletion. This plugin owns the editor UI, not a second implementation of that work.

## Requirements

- Neovim 0.12 (the tested version).
- `piton` on Neovim's PATH and the daemon running.
- [snacks.nvim](https://github.com/folke/snacks.nvim), with its picker enabled.
- [pi.nvim](https://github.com/alex35mil/pi.nvim), configured to attach through piton (see
  [daemon setup](../docs/daemon.md#pinvim)).
- For the queue: the source's `.project/integrations.json` with a GitHub or Linear tracker. Its MCP registration must
  specify `Authorization: Bearer ${ENV_VAR}`; the credential is resolved through `mise exec -C <source>`, never read
  into Neovim. Without tracker configuration, named agents still work and the queue shows as unavailable.

## Setup

The plugin root is `nvim/` in this repository, **not** the repository root. For example, with lazy.nvim:

```lua
{
    name = "piton",
    dir = vim.fn.expand("~/Projects/personal/tooling/piton/nvim"),
    dependencies = { "folke/snacks.nvim", "alex35mil/pi.nvim" },
    config = function()
        require("piton").setup()
    end,
}
```

Reuse your existing pi.nvim configuration if you already have one. Piton does not configure pi.nvim's process,
settings, or keybindings.

No keymaps, commands, or globals are installed. Map the actions yourself, for example:

```lua
local piton = require("piton")
vim.keymap.set({ "n", "i", "v", "t" }, "<C-S-n>", piton.new, { desc = "New agent" })
vim.keymap.set({ "n", "i", "v", "t" }, "<C-S-t>", piton.pick, { desc = "Agent picker" })
```

Loading modules and calling `setup()` do not load pi.nvim or Snacks. Those dependencies are used when an action needs
them. All notifications use `vim.notify` with title `piton`.

## Public API

- **`setup(opts?)`** configures editor integration. Omitted options use defaults; another call replaces the previous
  configuration, rather than retaining old hooks. Unknown options and wrong types are rejected before changing it.
- **`new()`** opens the new-agent picker: Todo before Backlog, with a named agent always available. Queued work already
  assigned to a worker is excluded. Creation opens its tab and pre-fills the appropriate workflow command; it never
  sends the prompt automatically.
- **`pick()`** lists the current repository's source and workers, with live pi status. Selecting an existing tab focuses
  it; otherwise it opens a tab. With no selection, typed text can create a named worker.
- **`get(path)`** returns the agent containing a path, or nil. The record has `path`, `source`, `label`, and optional
  `issue`. Use this from your own tab-close action to distinguish workers from ordinary tabs.
- **`close_tab(agent)`** offers “Close tab” or “Delete agent”. Closing only closes the editor tab: the daemon's pi keeps
  running. Deleting uses the daemon and confirms discarding modified buffers or a dirty/unpushed checkout before
  forcing deletion. Deleted workers' buffers are removed.

## Editor integration

All configuration is optional:

```lua
require("piton").setup({
    tabs = {
        new = function()
            vim.cmd("tabnew")
        end,
        set_label = function(label)
            vim.t.piton_label = label
        end,
    },
    icons = { agent = "󰙅", source = "" },
    confirm = function(message)
        return vim.fn.confirm(message, "&Yes\n&No", 2) == 1
    end,
})
```

- **`tabs.new()`** must synchronously create and enter a new tab. This is where a caller dismisses a dashboard or
  welcome screen **before** `tabnew`. Piton then sets the tab-local cwd to the worker/source path.
- **`tabs.set_label({icon, name})`** runs in that tab after its cwd is set, before opening a corresponding file and chat.
  Agent names are shortened to 40 characters at a word boundary, with an ellipsis. A custom hook can rename a tabline
  tab and/or store its own metadata. The default just sets `vim.t.piton_label`; it installs no tabline.
- **`icons`** are shared by tab labels and the agent picker; either can be overridden independently.
- **`confirm(message)`** synchronously returns **true** to proceed or **false** to keep the worker. Adapt a dialog
  wrapper here. Do not pass `vim.fn.confirm` directly: its numeric result is rejected, not treated as truthy.

After opening a worker and its corresponding file (when present), piton calls pi.nvim's existing public API:
`require("pi").show({ layout = "float", draft = draft })`. Opening a source tab doesn't open chat. Reusing an existing
tab doesn't rename it or reopen chat. No hooks for copying or recreating pi.nvim, tabline, or dialog implementations
are needed.

## Checks

From the repository root:

```sh
mise run nvim:test
```

This starts clean headless Neovim, loads every module without the user's configuration or installed plugin
dependencies, and tests the configuration/API, tab and file handling, picker integration, notifications, and deletion
confirmations. pi.nvim, Snacks, daemon calls, and tracker requests are mocked. Tests never contact the installed
daemon or real providers. The task is also included in `mise run test`.
