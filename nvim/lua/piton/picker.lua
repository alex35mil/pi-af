-- The agent picker: the source and its agents, listed by piton with their live
-- Pi sessions.

---@alias AgentPickerEntry
---| { kind: "source", path: string }
---| { kind: "agent", agent: Agent, sessions: PitonSession[] }

local util = require("piton.util")
local config = require("piton.config")
local log = require("piton.notify")
local lookup = require("piton.lookup")
local tabs = require("piton.tabs")
local create = require("piton.create")

local M = {}

--- What the agent's Pi is doing, the most urgent first; nil when it has no
--- live session.
---@param sessions PitonSession[]
---@return { text: string, hl: string }?
local function activity(sessions)
    local working, idle = false, false
    for _, session in ipairs(sessions) do
        local status = session.status
        if status == "needs_input" then
            return { text = "needs input", hl = "DiagnosticWarn" }
        elseif status == "working" then
            working = true
        elseif status == "idle" or status == "stopping" then
            idle = true
        end
    end
    if working then
        return { text = "working", hl = "DiagnosticInfo" }
    elseif idle then
        return { text = "idle", hl = "Comment" }
    end
    return nil
end

function M.pick()
    local source, root = lookup.current_source()
    if not source then
        log.error("Not in a git repository")
        return
    end
    ---@cast root string
    local relative_file = tabs.relative_file(root)
    local current_cwd = vim.fn.getcwd(-1, 0)

    util.async(function()
        local entries = lookup.list(source)

        ---@type AgentPickerEntry
        local source_entry = { kind = "source", path = source }
        -- `pinned` keeps the source first, above any score.
        local items = { { text = vim.fs.basename(source), entry = source_entry, pinned = true } }
        local current_idx = 1
        for _, listed in ipairs(entries) do
            ---@type AgentPickerEntry
            local entry = { kind = "agent", agent = listed.agent, sessions = listed.sessions }
            table.insert(items, { text = listed.agent.label, entry = entry, pinned = false })
            if listed.agent.path == current_cwd then
                current_idx = #items
            end
        end

        require("snacks").picker({
            title = "Agents",
            items = items,
            matcher = { fuzzy = false, regex = true },
            sort = { fields = { "pinned", "score:desc", "#text", "idx" } },
            on_show = function(picker)
                if current_idx > 1 then
                    picker.list:move(current_idx, true)
                end
            end,
            format = function(item)
                local entry = item.entry ---@type AgentPickerEntry
                local icon, path, state
                if entry.kind == "source" then
                    icon, path = config.get().icons.source, entry.path
                elseif entry.kind == "agent" then
                    icon, path, state = config.get().icons.agent, entry.agent.path, activity(entry.sessions)
                end
                local tab = tabs.find(path)
                local parts = { { icon .. " ", tab and "SnacksPickerIcon" or "Comment" }, { item.text } }
                if state then
                    table.insert(parts, { " · " .. state.text, state.hl })
                end
                return parts
            end,
            confirm = function(picker, item)
                if item then
                    picker:close()
                    local entry = item.entry ---@type AgentPickerEntry
                    if entry.kind == "source" then
                        tabs.switch_to_source(entry.path, relative_file)
                    elseif entry.kind == "agent" then
                        tabs.switch_to(entry.agent, relative_file)
                    end
                else
                    local filter = picker.input:get()
                    if filter and filter ~= "" then
                        picker:close()
                        create.create({ kind = "named", name = filter })
                    end
                end
            end,
            preview = function(ctx)
                local entry = ctx.item.entry ---@type AgentPickerEntry
                if entry.kind == "source" then
                    ctx.preview:set_lines({ "Path: " .. entry.path, "Source repository" })
                elseif entry.kind == "agent" then
                    local state = activity(entry.sessions)
                    ctx.preview:set_lines({
                        "Path: " .. entry.agent.path,
                        "Source: " .. entry.agent.source,
                        "Pi: " .. (state and state.text or "not running"),
                    })
                end
            end,
        })
    end)
end

return M
