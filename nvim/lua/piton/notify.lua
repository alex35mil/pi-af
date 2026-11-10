-- Notifications go through Neovim's public UI entry point, not a user-config global.

local M = {}

function M.info(message)
    vim.notify(message, vim.log.levels.INFO, { title = "piton" })
end

function M.warn(message)
    vim.notify(message, vim.log.levels.WARN, { title = "piton" })
end

function M.error(message)
    vim.notify(message, vim.log.levels.ERROR, { title = "piton" })
end

return M
