-- Why the source checkout agents are cloned from isn't ready, in words.
-- piton checks and updates the source; this only phrases its refusals.

---@alias AgentSourceState
---| { kind: "dirty", checkout: string, status: string[] }
---| { kind: "off-default", checkout: string, branch: string?, default: string }
---| { kind: "unknown-default", checkout: string }

local util = require("piton.util")

local M = {}

---@param state AgentSourceState
---@return string
function M.describe_state(state)
    if state.kind == "dirty" then
        return state.checkout .. " has uncommitted changes:\n" .. table.concat(util.head(state.status, 15), "\n")
    elseif state.kind == "off-default" then
        return state.checkout .. " is on " .. (state.branch or "a detached HEAD") .. ", not " .. state.default
    elseif state.kind == "unknown-default" then
        return "can't tell the default branch of " .. state.checkout .. " (run `git remote set-head origin --auto`)"
    end
    error("unknown source state: " .. vim.inspect(state))
end

return M
