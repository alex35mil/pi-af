-- Editor integration belongs to the caller. Defaults use only Neovim; no dotfiles globals or load-time dependencies.

---@class PitonTabLabel
---@field icon string
---@field name string

---@class PitonOptions
---@field tabs? { new?: fun(), set_label?: fun(label: PitonTabLabel) }
---@field icons? { agent?: string, source?: string }
---@field confirm? fun(message: string): boolean Synchronous yes/no confirmation; true means proceed.

---@class PitonConfig
---@field tabs { new: fun(), set_label: fun(label: PitonTabLabel) }
---@field icons { agent: string, source: string }
---@field confirm fun(message: string): boolean

local M = {}

---@return PitonConfig
local function defaults()
    return {
        tabs = {
            new = function()
                vim.cmd("tabnew")
            end,
            set_label = function(label)
                -- No tabline dependency. A tabline can read this variable or supply its own hook.
                vim.t.piton_label = label
            end,
        },
        icons = { agent = "󰙅", source = "" },
        confirm = function(message)
            return vim.fn.confirm(message, "&Yes\n&No", 2) == 1
        end,
    }
end

local options = defaults()

---@param value table
---@param schema table<string, string>
---@param path string
local function validate(value, schema, path)
    if type(value) ~= "table" then
        error(path .. " must be a table", 3)
    end
    for key, entry in pairs(value) do
        local expected = schema[key]
        if not expected then
            error("unknown option: " .. path .. "." .. tostring(key), 3)
        end
        if type(entry) ~= expected then
            error(path .. "." .. key .. " must be a " .. expected, 3)
        end
    end
end

--- Replaces the previous configuration, filling omitted options from defaults. Validate before changing anything.
---@param opts? PitonOptions
function M.setup(opts)
    if opts == nil then
        opts = {}
    end
    validate(opts, { tabs = "table", icons = "table", confirm = "function" }, "piton")
    if opts.tabs then
        validate(opts.tabs, { new = "function", set_label = "function" }, "piton.tabs")
    end
    if opts.icons then
        validate(opts.icons, { agent = "string", source = "string" }, "piton.icons")
    end
    options = vim.tbl_deep_extend("force", defaults(), opts)
end

---@return PitonConfig
function M.get()
    return options
end

--- Require a boolean result: a mistakenly supplied vim.fn.confirm (which returns a number) must never approve deletion.
---@param message string
---@return boolean
function M.confirm(message)
    local result = options.confirm(message)
    if type(result) ~= "boolean" then
        error("piton.confirm must return a boolean", 2)
    end
    return result
end

return M
