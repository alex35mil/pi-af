-- Local, dependency-free tests: real headless Neovim, fake pi/Snacks/daemon/tracker boundaries.
-- Run from the repository root through `mise run nvim:test`.

local plugin = vim.fs.joinpath(vim.fn.getcwd(), "nvim")
vim.opt.runtimepath:prepend(plugin)

local tests = {}
local restores = {}
local scratch = vim.fn.tempname()
vim.fn.mkdir(scratch, "p")

local function test(name, run)
    tests[#tests + 1] = { name = name, run = run }
end

local function equal(expected, actual)
    assert(vim.deep_equal(expected, actual), "expected " .. vim.inspect(expected) .. ", got " .. vim.inspect(actual))
end

local function replace(object, key, value)
    local before = object[key]
    restores[#restores + 1] = function()
        object[key] = before
    end
    object[key] = value
end

local function fails(pattern, run)
    local ok, err = pcall(run)
    assert(not ok, "expected an error")
    assert(tostring(err):find(pattern, 1, true), tostring(err))
end

-- A test must explicitly fake these boundaries: never call the installed daemon or real trackers.
vim.system = function()
    error("unexpected subprocess in nvim tests")
end

local before_globals = {}
for key in pairs(_G) do
    before_globals[key] = true
end
local before_maps = {}
for _, mode in ipairs({ "n", "i", "v", "t" }) do
    before_maps[mode] = vim.api.nvim_get_keymap(mode)
end

local piton = require("piton")
local config = require("piton.config")
local tabs = require("piton.tabs")
local close = require("piton.close")
local lookup = require("piton.lookup")
local cli = require("piton.cli")
local util = require("piton.util")

local function directory(name)
    local path = vim.fs.joinpath(scratch, name)
    vim.fn.mkdir(path, "p")
    return vim.uv.fs_realpath(path)
end

local function fake_pi(show)
    replace(package.loaded, "pi", { show = show })
end

local function fake_picker(open)
    replace(package.loaded, "snacks", { picker = open })
end

test("every module loads without dependencies, globals, or mappings", function()
    local files = vim.fn.globpath(plugin .. "/lua", "**/*.lua", false, true)
    assert(#files > 0)
    for _, file in ipairs(files) do
        local module = file:sub(#plugin + #"/lua/" + 1):gsub("%.lua$", ""):gsub("/init$", ""):gsub("/", ".")
        assert(type(require(module)) == "table", module)
    end
    piton.setup()
    assert(package.loaded.pi == nil and package.loaded.snacks == nil)
    for key in pairs(_G) do
        assert(before_globals[key], "plugin created global " .. key)
    end
    for mode, maps in pairs(before_maps) do
        equal(maps, vim.api.nvim_get_keymap(mode))
    end
    local exports = vim.tbl_keys(piton)
    table.sort(exports)
    equal({ "close_tab", "get", "new", "pick", "setup" }, exports)
end)

test("configuration merges defaults, resets, and rejects invalid options atomically", function()
    local initial = config.get()
    local new_tab = function() end
    piton.setup({ tabs = { new = new_tab }, icons = { source = "S" } })
    equal(new_tab, config.get().tabs.new)
    equal("S", config.get().icons.source)
    equal(initial.icons.agent, config.get().icons.agent)
    local configured = config.get()
    for _, invalid in ipairs({
        false,
        "bad",
        { surprise = true },
        { tabs = { new = true } },
        { tabs = { unknown = function() end } },
        { icons = { agent = 3 } },
        { icons = { worker = "W" } },
        { confirm = true },
    }) do
        local ok = pcall(piton.setup, invalid)
        assert(not ok, vim.inspect(invalid))
        equal(configured, config.get())
    end
    piton.setup()
    equal(initial.icons, config.get().icons)
    assert(config.get().tabs.new ~= new_tab)
end)

test("default confirmation is no by default; custom confirmation must return boolean", function()
    replace(vim.fn, "confirm", function(message, choices, default)
        equal("Really?", message)
        equal("&Yes\n&No", choices)
        equal(2, default)
        return 2
    end)
    equal(false, config.confirm("Really?"))
    replace(vim.fn, "confirm", function() return 1 end)
    equal(true, config.confirm("Really?"))
    piton.setup({ confirm = function() return true end })
    equal(true, config.confirm("Really?"))
    piton.setup({ confirm = function() return 1 end })
    fails("must return a boolean", function() config.confirm("Really?") end)
end)

test("default tab opens the relative file and calls pi.show after setting cwd and label", function()
    local path = directory("default agent")
    vim.fn.writefile({ "hello" }, path .. "/file.txt")
    local shown = 0
    fake_pi(function(opts)
        shown = shown + 1
        equal({ layout = "float", draft = "/gig test " }, opts)
        equal(path, vim.fn.getcwd())
        equal(path .. "/file.txt", vim.api.nvim_buf_get_name(0))
        equal({ icon = config.get().icons.agent, name = "Fix login" }, vim.t.piton_label)
    end)
    local count = #vim.api.nvim_list_tabpages()
    tabs.open({ path = path, label = "Fix login" }, "file.txt", "/gig test ")
    equal(count + 1, #vim.api.nvim_list_tabpages())
    equal(1, shown)
    equal(vim.api.nvim_get_current_tabpage(), tabs.find(path))
end)

test("tab hooks run in order and already-loaded modules see new options", function()
    local path = directory("custom agent")
    local source = directory("custom source")
    local calls = {}
    local old_cwd = vim.fn.getcwd()
    piton.setup({
        icons = { agent = "A", source = "S" },
        tabs = {
            new = function()
                calls[#calls + 1] = "new"
                -- A caller can dismiss its welcome screen here, before creating a tab.
                equal(old_cwd, vim.fn.getcwd())
                vim.cmd("tabnew")
            end,
            set_label = function(label)
                calls[#calls + 1] = label
                equal(#calls == 2 and path or source, vim.fn.getcwd())
            end,
        },
    })
    fake_pi(function(opts)
        calls[#calls + 1] = "chat"
        equal("float", opts.layout)
        equal(nil, opts.draft)
    end)
    tabs.open({ path = path, label = "Agent" })
    equal({ "new", { icon = "A", name = "Agent" }, "chat" }, calls)
    old_cwd = path
    tabs.switch_to_source(source)
    equal({ "new", { icon = "A", name = "Agent" }, "chat", "new", { icon = "S", name = "custom source" } }, calls)
    local count = #vim.api.nvim_list_tabpages()
    tabs.switch_to({ path = path, label = "Agent" })
    equal(path, vim.fn.getcwd())
    tabs.switch_to_source(source)
    equal(source, vim.fn.getcwd())
    equal(count, #vim.api.nvim_list_tabpages())
    equal(5, #calls)
end)

test("tab labels truncate Unicode at a word and source tabs don't open chat", function()
    equal("Short", tabs.tab_label("Short"))
    local long = ("猫 "):rep(30)
    assert(vim.fn.strchars(tabs.tab_label(long)) <= 41)
    assert(vim.endswith(tabs.tab_label(long), "…"))
    fake_pi(function() error("source must not open chat") end)
    local source = directory("source only")
    tabs.switch_to_source(source, "missing.txt")
    equal({ icon = config.get().icons.source, name = "source only" }, vim.t.piton_label)
end)

test("picker uses configured icons, explicit Snacks module, and current worker activity", function()
    local source = directory("picker source")
    local agent = { path = directory("picker worker"), source = source, label = "Worker" }
    piton.setup({ icons = { agent = "A", source = "S" } })
    replace(lookup, "current_source", function() return source, source end)
    replace(lookup, "list", function()
        return { { agent = agent, sessions = { { key = 1, status = "working" } } } }
    end)
    local opened = false
    fake_picker(function(opts)
        opened = true
        equal("Agents", opts.title)
        equal("S ", opts.format(opts.items[1])[1][1])
        local parts = opts.format(opts.items[2])
        equal("A ", parts[1][1])
        equal(" · working", parts[3][1])
    end)
    piton.pick()
    assert(opened)
end)

test("new-agent picker loads mocked queue without credentials or real providers", function()
    local source = directory("queue source")
    replace(lookup, "current_source", function() return source, source end)
    replace(lookup, "list", function() return {} end)
    local queue = require("piton.queue")
    replace(queue, "load", function() return {} end)
    local picker = { closed = false, update_titles = function() end, find = function() end }
    fake_picker(function(opts)
        assert(opts.title:find("loading", 1, true))
        equal("named", opts.finder()[1].entry.kind)
        return picker
    end)
    piton.new()
    assert(picker.title:find("0 Todo", 1, true))
end)

test("close_tab dispatches close or delete through the public API", function()
    local agent = { path = directory("close worker"), label = "Close" }
    local opts
    fake_picker(function(value) opts = value end)
    piton.close_tab(agent)
    equal("Close: Close", opts.title)
    local deleted
    replace(close, "delete", function(value) deleted = value end)
    local picker = { close = function() end }
    opts.confirm(picker, { action = "delete" })
    equal(agent, deleted)
    vim.cmd("tabnew")
    local count = #vim.api.nvim_list_tabpages()
    opts.confirm(picker, { action = "close-tab" })
    equal(count - 1, #vim.api.nvim_list_tabpages())
end)

test("refused worker deletion uses configured confirmation and doesn't force on no", function()
    local agent = { path = directory("kept worker"), label = "Kept" }
    local forced = {}
    replace(cli, "delete", function(path, force)
        equal(agent.path, path)
        forced[#forced + 1] = force
        return { kind = "refused", refusal = { kind = "leftovers", path = path, lines = { "unpushed commit" } } }
    end)
    local asked = false
    piton.setup({ confirm = function(message)
        asked = true
        assert(message:find("unpushed commit", 1, true))
        return false
    end })
    close.delete(agent)
    assert(asked)
    equal({ false }, forced)
end)

test("approved worker deletion retries with force through the daemon", function()
    local agent = { path = directory("deleted worker"), label = "Delete" }
    local forced = {}
    replace(cli, "delete", function(path, force)
        equal(agent.path, path)
        forced[#forced + 1] = force
        if force then return { kind = "deleted", stopped = 1 } end
        return { kind = "refused", refusal = { kind = "leftovers", path = path, lines = { "dirty" } } }
    end)
    piton.setup({ confirm = function() return true end })
    close.delete(agent)
    equal({ false, true }, forced)
end)

test("unsaved buffers require confirmation before any daemon deletion", function()
    local agent = { path = directory("unsaved worker"), label = "Unsaved" }
    local buf = vim.api.nvim_create_buf(true, false)
    vim.api.nvim_buf_set_name(buf, agent.path .. "/unsaved.txt")
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "unsaved" })
    replace(cli, "delete", function() error("must not call daemon after no") end)
    local asked = false
    piton.setup({ confirm = function(message)
        asked = true
        assert(message:find("unsaved.txt", 1, true))
        return false
    end })
    close.delete(agent)
    assert(asked)
    assert(vim.api.nvim_buf_is_valid(buf) and vim.bo[buf].modified)
    vim.api.nvim_buf_delete(buf, { force = true })
end)

test("an agent.source claim counts only with the worker layout", function()
    local function git(results)
        replace(util, "git_root", function(path) return path end)
        replace(util, "git", function(_, args)
            local value = results[args[#args]]
            return value and { code = 0, stdout = value .. "\n" } or { code = 1, stdout = "" }
        end)
    end
    git({ ["agent.source"] = "/p/repo", ["agent.label"] = "Fix" })
    equal({ path = "/p/repo--fix", source = "/p/repo", label = "Fix" }, lookup.get("/p/repo--fix"))
    equal(nil, lookup.get("/q/repo--fix"))
    equal(nil, lookup.get("/p/elsewhere"))
    equal(nil, lookup.get("/p/repo--"))
end)

test("get delegates lookup and notifications use vim.notify", function()
    replace(lookup, "get", function(path)
        equal("/test/path", path)
        return { path = path, source = "/test", label = "Test" }
    end)
    equal("Test", piton.get("/test/path").label)
    local calls = {}
    replace(vim, "notify", function(message, level, opts)
        calls[#calls + 1] = { message, level, opts.title }
    end)
    require("piton.notify").info("info")
    util.async(function() util.refuse("no") end)
    equal({ { "info", vim.log.levels.INFO, "piton" }, { "no", vim.log.levels.WARN, "piton" } }, calls)
end)

local failed = 0
local original_notify = vim.notify
for _, case in ipairs(tests) do
    config.setup()
    -- Unexpected coroutine errors must fail the test, not disappear in a UI notification.
    vim.notify = function(message, level)
        if level == vim.log.levels.ERROR then error(message) end
    end
    local ok, err = xpcall(case.run, debug.traceback)
    for i = #restores, 1, -1 do restores[i]() end
    restores = {}
    vim.notify = original_notify
    vim.cmd("silent! tabonly!")
    if ok then
        print("ok   " .. case.name)
    else
        failed = failed + 1
        print("FAIL " .. case.name .. "\n" .. err)
    end
end
vim.fn.delete(scratch, "rf")
print(("%d tests, %d failed"):format(#tests, failed))
if failed > 0 then vim.cmd("cquit 1") else vim.cmd("qa!") end
