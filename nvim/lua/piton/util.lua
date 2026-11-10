-- Async process helpers shared by the agent modules.

local log = require("piton.notify")

local M = {}

local Refusal = {}

--- Abort the running task with a message for the user.
---@param message string
function M.refuse(message)
    error(setmetatable({ message = message }, Refusal), 0)
end

--- Run `body` as a coroutine, so `M.exec` doesn't block the UI.
---@param body fun()
function M.async(body)
    local co = coroutine.create(function()
        local ok, err = xpcall(body, function(e)
            if getmetatable(e) == Refusal then
                return e
            end
            return debug.traceback(tostring(e), 2)
        end)
        if ok then
            return
        end
        if getmetatable(err) == Refusal then
            log.warn(err.message)
        else
            log.error(err)
        end
    end)
    M.resume(co)
end

---@alias AgentCatchResult
---| { kind: "ok", value: any }
---| { kind: "refused", message: string }
---| { kind: "crashed", message: string }

--- Run `body`, turning a refusal or an error into a value.
---@param body fun(): any
---@return AgentCatchResult
function M.catch(body)
    local ok, result = xpcall(body, function(e)
        if getmetatable(e) == Refusal then
            return e
        end
        return debug.traceback(tostring(e), 2)
    end)
    if ok then
        return { kind = "ok", value = result }
    end
    if getmetatable(result) == Refusal then
        return { kind = "refused", message = result.message }
    end
    return { kind = "crashed", message = result }
end

---@param co thread
function M.resume(co, ...)
    local ok, err = coroutine.resume(co, ...)
    if not ok then
        log.error(debug.traceback(co, tostring(err)))
    end
end

--- Run a command; yields inside `M.async`, blocks otherwise.
---@param cmd string[]
---@param opts? { stdin: string }
---@return vim.SystemCompleted
function M.exec(cmd, opts)
    local system_opts = { text = true, stdin = opts and opts.stdin }
    local co, main = coroutine.running()
    if not co or main then
        return vim.system(cmd, system_opts):wait()
    end
    vim.system(cmd, system_opts, function(result)
        vim.schedule(function()
            M.resume(co, result)
        end)
    end)
    return coroutine.yield()
end

---@param dir string
---@param args string[]
---@return vim.SystemCompleted
function M.git(dir, args)
    return M.exec(vim.list_extend({ "git", "-C", dir }, args))
end

---@param path string
---@return string?
function M.git_root(path)
    local result = M.git(path, { "rev-parse", "--show-toplevel" })
    return result.code == 0 and vim.trim(result.stdout) or nil
end

--- Decoded JSON file, with JSON null as nil.
---@param path string
---@return any
function M.read_json(path)
    local ok, decoded = pcall(function()
        return vim.json.decode(table.concat(vim.fn.readfile(path), "\n"), { luanil = { object = true, array = true } })
    end)
    if not ok then
        M.refuse("Couldn't read " .. path .. ": " .. tostring(decoded))
    end
    return decoded
end

---@param list string[]
---@param n integer
---@return string[]
function M.head(list, n)
    if #list <= n then
        return list
    end
    local result = vim.list_slice(list, 1, n)
    table.insert(result, ("… and %d more"):format(#list - n))
    return result
end

return M
