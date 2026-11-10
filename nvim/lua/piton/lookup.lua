-- Finding agents and the source they belong to.

---@class Agent
---@field path string Agent checkout (its git root).
---@field source string Checkout the agent was cloned from.
---@field label string Name the agent was created with.
---@field issue string? Identity of the tracker item the agent was created for.

---@class AgentEntry
---@field agent Agent
---@field sessions PitonSession[] The agent's live piton sessions.

local util = require("piton.util")
local cli = require("piton.cli")

local M = {}

--- Whether `worker` is laid out as a worker of `source`: `<parent>/<repo>--<name>` next to `<parent>/<repo>`. The
--- daemon accepts an `agent.source` claim only with this layout (`project::is_worker_layout`); the editor follows it,
--- so a stray config value doesn't make a checkout an agent here when piton wouldn't treat it as one.
---@param worker string
---@param source string
---@return boolean
function M.is_worker_layout(worker, source)
    local prefix = vim.fs.basename(source) .. "--"
    local name = vim.fs.basename(worker)
    return vim.fs.dirname(worker) == vim.fs.dirname(source)
        and #name > #prefix
        and name:sub(1, #prefix) == prefix
end

--- The agent containing `path`, or nil when it isn't inside one.
---@param path string
---@return Agent?
function M.get(path)
    local root = util.git_root(path)
    if not root then
        return nil
    end
    local source = util.git(root, { "config", "--local", "--get", "agent.source" })
    if source.code ~= 0 or not M.is_worker_layout(root, vim.trim(source.stdout)) then
        return nil
    end
    local label = util.git(root, { "config", "--local", "--get", "agent.label" })
    local issue = util.git(root, { "config", "--local", "--get", "agent.issue" })
    return {
        path = root,
        source = vim.trim(source.stdout),
        label = label.code == 0 and vim.trim(label.stdout) or vim.fs.basename(root),
        issue = issue.code == 0 and vim.trim(issue.stdout) or nil,
    }
end

--- The source's agents with their live sessions, from piton, sorted by path.
--- Refuses when piton can't list them.
---@param source string
---@return AgentEntry[]
function M.list(source)
    local entries = {}
    for _, entry in ipairs(cli.list(source)) do
        table.insert(entries, { agent = entry.worker, sessions = entry.sessions })
    end
    return entries
end

--- The checkout agents are created from: the current tab's repository, or
--- the source of the agent the tab is in.
---@return string? source, string? root
function M.current_source()
    local root = util.git_root(vim.fn.getcwd())
    if not root then
        return nil, nil
    end
    local agent = M.get(root)
    return agent and agent.source or root, root
end

return M
