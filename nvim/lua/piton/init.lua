-- Agent pickers, tracker queue, and editor integration over `piton worker`.
-- No globals, keymaps, or commands: the caller decides how to expose these actions.

local M = {}

---@param opts? PitonOptions
function M.setup(opts)
    require("piton.config").setup(opts)
end

--- Pick queued work (Todo/Backlog), or type a name, and create an agent.
function M.new()
    require("piton.new").pick()
end

--- Pick an existing agent or its source checkout.
function M.pick()
    require("piton.picker").pick()
end

--- The agent containing `path`, or nil when it isn't inside one.
---@param path string
---@return Agent?
function M.get(path)
    return require("piton.lookup").get(path)
end

--- Offer to close an agent's tab or delete its checkout (through the daemon).
---@param agent Agent
function M.close_tab(agent)
    require("piton.close").close_tab(agent)
end

return M
