-- Closing an agent's tab, or deleting the agent. piton deletes the checkout
-- (`piton worker delete`), stopping its Pi sessions first.

local util = require("piton.util")
local config = require("piton.config")
local log = require("piton.notify")
local cli = require("piton.cli")
local tabs = require("piton.tabs")

local M = {}

---@param agent Agent
function M.close_tab(agent)
    require("snacks").picker({
        title = "Close: " .. agent.label,
        items = {
            { text = "Delete agent", action = "delete" },
            { text = "Close tab", action = "close-tab" },
        },
        format = function(item)
            return { { " ", "SnacksPickerIcon" }, { item.text } }
        end,
        confirm = function(picker, item)
            picker:close()
            if not item then
                return
            end
            if item.action == "close-tab" then
                vim.cmd("tabclose")
            elseif item.action == "delete" then
                M.delete(agent)
            end
        end,
        layout = { preset = "select" },
    })
end

---@param agent Agent
function M.delete(agent)
    local tab = tabs.find(agent.path)
    if tab then
        vim.cmd("tabclose " .. vim.api.nvim_tabpage_get_number(tab))
    end

    util.async(function()
        local unsaved = vim.tbl_filter(function(buffer)
            return buffer.modified
        end, M.agent_buffers(agent.path))
        if #unsaved > 0 then
            local names = vim.tbl_map(function(buffer)
                return buffer.name
            end, unsaved)
            local message = "Unsaved changes in agent "
                .. agent.label
                .. ":\n"
                .. table.concat(util.head(names, 15), "\n")
            if not config.confirm(message .. "\n\nDiscard and delete?") then
                log.info("Kept agent: " .. agent.path)
                return
            end
        end

        local result = cli.delete(agent.path, false)
        if result.kind == "refused" and result.refusal.kind == "leftovers" then
            local message = "Agent " .. agent.label .. " isn't clean:\n" .. table.concat(result.refusal.lines, "\n")
            if not config.confirm(message .. "\n\nDelete anyway?") then
                log.info("Kept agent: " .. agent.path)
                return
            end
            result = cli.delete(agent.path, true)
        end

        if result.kind == "refused" then
            util.refuse("Can't delete agent " .. agent.label .. ": " .. cli.describe(result.refusal))
        elseif result.kind == "deleted" then
            -- Its files are gone; buffers left open would point at nothing.
            for _, buffer in ipairs(M.agent_buffers(agent.path)) do
                pcall(vim.api.nvim_buf_delete, buffer.buf, { force = true })
            end
            log.info("Deleted agent: " .. agent.path)
            if result.warning then
                log.warn("Source not updated: " .. result.warning)
            end
        end
    end)
end

---@class AgentBuffer
---@field buf integer
---@field name string Path relative to the agent.
---@field modified boolean

--- Buffers whose file is inside the agent.
---@param path string
---@return AgentBuffer[]
function M.agent_buffers(path)
    local prefix = path .. "/"
    local buffers = {}
    for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        local name = vim.api.nvim_buf_get_name(buf)
        if vim.startswith(name, prefix) then
            table.insert(buffers, { buf = buf, name = name:sub(#prefix + 1), modified = vim.bo[buf].modified })
        end
    end
    return buffers
end

return M
