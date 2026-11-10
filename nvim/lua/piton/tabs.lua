-- Tabs for agents and their source.

local config = require("piton.config")
local log = require("piton.notify")

local M = {}

-- Longest agent label shown in a tab; the picker shows it in full.
local TAB_LABEL_MAX = 40

--- `label` cut at a word to fit a tab.
---@param label string
---@return string
function M.tab_label(label)
    if vim.fn.strchars(label) <= TAB_LABEL_MAX then
        return label
    end
    local cut = vim.fn.strcharpart(label, 0, TAB_LABEL_MAX):gsub("%s+%S*$", "")
    return cut .. "…"
end

--- The current buffer's path relative to `root`, when it's inside it.
---@param root string
---@return string?
function M.relative_file(root)
    local file = vim.fn.expand("%:p")
    if file ~= "" and vim.startswith(file, root .. "/") then
        return file:sub(#root + 2)
    end
    return nil
end

---@param agent {path: string, label: string}
---@param relative_file string?
---@param draft string? Text to pre-fill in the Pi prompt.
function M.open(agent, relative_file, draft)
    local opts = config.get()
    opts.tabs.new()
    vim.cmd("tcd " .. vim.fn.fnameescape(agent.path))
    opts.tabs.set_label({ icon = opts.icons.agent, name = M.tab_label(agent.label) })

    if relative_file then
        local file = vim.fs.joinpath(agent.path, relative_file)
        if vim.fn.filereadable(file) == 1 then
            vim.cmd("edit " .. vim.fn.fnameescape(file))
        end
    end

    log.info("Agent: " .. agent.path)
    require("pi").show({ layout = "float", draft = draft })
end

---@param path string
---@return integer?
function M.find(path)
    for _, tab in ipairs(vim.api.nvim_list_tabpages()) do
        if vim.fn.getcwd(-1, vim.api.nvim_tabpage_get_number(tab)) == path then
            return tab
        end
    end
    return nil
end

---@param agent Agent
---@param relative_file string?
function M.switch_to(agent, relative_file)
    local tab = M.find(agent.path)
    if tab then
        vim.api.nvim_set_current_tabpage(tab)
    else
        M.open(agent, relative_file)
    end
end

--- Focus the source's tab, or open one when none is on it.
---@param source string
---@param relative_file string?
function M.switch_to_source(source, relative_file)
    local tab = M.find(source)
    if tab then
        vim.api.nvim_set_current_tabpage(tab)
        return
    end
    local opts = config.get()
    opts.tabs.new()
    vim.cmd("tcd " .. vim.fn.fnameescape(source))
    opts.tabs.set_label({ icon = opts.icons.source, name = vim.fs.basename(source) })
    if relative_file then
        local file = vim.fs.joinpath(source, relative_file)
        if vim.fn.filereadable(file) == 1 then
            vim.cmd("edit " .. vim.fn.fnameescape(file))
        end
    end
end

return M
