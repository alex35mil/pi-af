-- Creating an agent next to its source, as `<parent>/<repo>--<name>`. piton
-- creates the checkout (`piton worker create`); this plans it and opens its tab.

---@alias AgentRequest
---| { kind: "named", name: string } A plain agent with a typed name.
---| { kind: "queued", item: QueueItem } An agent that adopts queued tracker work.

local util = require("piton.util")
local log = require("piton.notify")
local lookup = require("piton.lookup")
local cli = require("piton.cli")
local tabs = require("piton.tabs")
local queue = require("piton.queue")

local M = {}

---@class AgentPlan
---@field name string Directory suffix; piton normalizes it.
---@field label string
---@field issue string?
---@field draft string? Kickoff command pre-filled in the Pi prompt.

---@param request AgentRequest
---@return AgentPlan
function M.plan(request)
    if request.kind == "named" then
        return { name = request.name, label = request.name }
    elseif request.kind == "queued" then
        local item = request.item
        return {
            name = queue.agent_name(item),
            label = queue.agent_label(item),
            issue = item.id,
            draft = queue.command(item),
        }
    end
    error("unknown agent request: " .. vim.inspect(request))
end

---@param request AgentRequest
function M.create(request)
    local source, root = lookup.current_source()
    local relative_file = root and tabs.relative_file(root)
    local plan = M.plan(request)

    util.async(function()
        if not source then
            util.refuse("Not in a git repository")
        end
        ---@cast source string

        log.info("Updating " .. source .. " and creating agent…")
        local result = cli.create({ from = source, name = plan.name, label = plan.label, issue = plan.issue })
        local path
        if result.kind == "created" then
            path = result.worker.path
        elseif result.kind == "refused" then
            util.refuse(M.refusal_message(result.refusal))
        end

        if request.kind == "queued" and request.item.kind.kind == "unclassified" then
            log.warn(
                ("Couldn't classify %s as an Epic, Task, or Gig: the tracker has no Epic Kind label configured. Opening Pi without a prompt."):format(
                    queue.agent_label(request.item)
                )
            )
        end
        tabs.open({ path = path, label = plan.label }, relative_file, plan.draft)
    end)
end

--- What the user sees when piton won't create the agent.
---@param refusal PitonWorkerRefusal
---@return string
function M.refusal_message(refusal)
    local kind = refusal.kind
    if kind == "source_dirty" or kind == "source_off_default" or kind == "unknown_default" then
        return "Can't create an agent: " .. cli.describe(refusal)
    elseif
        kind == "invalid_name"
        or kind == "exists"
        or kind == "not_a_repository"
        or kind == "not_a_worker"
        or kind == "leftovers"
        or kind == "failed"
    then
        return cli.describe(refusal)
    end
    error("unknown piton refusal: " .. vim.inspect(refusal))
end

return M
