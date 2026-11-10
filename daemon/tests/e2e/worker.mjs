// End-to-end tests of `piton worker` and worker-aware sandbox launches, through the daemon.
// Usage (in daemon/): cargo build && node tests/e2e/worker.mjs, or `mise run daemon:test`.
//
// nono doesn't nest: the sandbox test records the actual argv at a fake `nono` boundary, then execs real pi.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, readFileSync, existsSync, lstatSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const piton = join(root, "target/debug/piton");
const ext = join(root, "tests/fixtures/faux-extension.ts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" }).toString().trim();

function setup() {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "piton-worker-")));
    const agent = join(dir, "agent");
    mkdirSync(agent);
    // Source checkout with an origin, workflow artifacts, a nono overlay, and a skipped editor index.
    const origin = join(dir, "origin.git");
    const source = join(dir, "repo");
    mkdirSync(source);
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    git(source, "init", "-q", "-b", "main");
    git(source, "config", "user.email", "t@t");
    git(source, "config", "user.name", "t");
    writeFileSync(join(source, ".gitignore"), "/apps/.build\n/.project/.local\n");
    writeFileSync(join(source, ".piton.toml"), '[workers]\nskip = ["apps/.build/index-build"]\n');
    writeFileSync(join(source, ".nono.json"), "{}\n");
    git(source, "add", ".");
    git(source, "commit", "-q", "-m", "init");
    git(source, "remote", "add", "origin", origin);
    git(source, "push", "-q", "-u", "origin", "main");
    git(source, "remote", "set-head", "origin", "main");
    mkdirSync(join(source, ".project/.local"), { recursive: true });
    mkdirSync(join(source, "apps/.build/index-build"), { recursive: true });
    // Fake nono: drop everything up to `--` and exec the rest (pi).
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "nono"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$PITON_TEST_NONO_ARGS"\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n');
    chmodSync(join(bin, "nono"), 0o755);

    const socket = join(dir, "piton.sock");
    const log = join(dir, "piton.log");
    const config = join(dir, "config.toml");
    writeFileSync(
        config,
        [
            `socket = ${JSON.stringify(socket)}`,
            `log = ${JSON.stringify(log)}`,
            `attach_mode = "sandbox"`,
            `empty_grace_ms = 60000`,
            `keep_awake = false`,
            `[tailnet]`,
            `enabled = false`,
            `[pi]`,
            `args = ["-e", ${JSON.stringify(ext)}, "--model", "faux/faux-1"]`,
            `[sandbox]`,
            `command = [${JSON.stringify(join(bin, "nono"))}]`,
            `[env]`,
            `login_shell = false`,
            `mise = false`,
            `[stop]`,
            `grace_ms = 3000`,
            `term_grace_ms = 1000`,
        ].join("\n"),
    );
    const env = { ...process.env, PITON_CONFIG: config, PI_CODING_AGENT_DIR: agent, PITON_TEST_NONO_ARGS: join(dir, "nono-args") };
    return { dir, source, log, env };
}

async function startDaemon(ctx) {
    const d = spawn(piton, ["daemon"], { env: ctx.env, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    d.stderr.on("data", (c) => (err += c));
    for (let i = 0; i < 100 && !err.includes("listening"); i++) await sleep(50);
    assert.ok(err.includes("listening"), "daemon didn't start: " + err);
    d.exited = new Promise((r) => d.on("exit", (code) => r(code)));
    return d;
}

function cli(ctx, args, cwd) {
    return new Promise((res) => {
        const p = spawn(piton, args, { env: ctx.env, cwd: cwd ?? ctx.source, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        p.stdout.on("data", (d) => (out += d));
        p.stderr.on("data", (d) => (err += d));
        p.on("exit", (code) => res({ code, out, err, json: args.includes("--json") && out.trim() ? JSON.parse(out) : undefined }));
    });
}

const tests = {
    async "create, launch in the sandbox with the source's settings, delete"(ctx) {
        const created = await cli(ctx, ["worker", "create", "Fix X", "--issue", "KID-5", "--json"]);
        assert.equal(created.code, 0, created.err);
        assert.equal(created.json.type, "worker");
        const worker = created.json.worker.path;
        assert.equal(worker, join(ctx.dir, "repo--fix-x"));
        assert.equal(created.json.worker.issue, "KID-5");
        assert.ok(lstatSync(join(worker, ".project/.local")).isSymbolicLink());
        assert.ok(!existsSync(join(worker, "apps/.build/index-build")), "skip list honored");
        // An agent edits its worker's overlay to widen its sandbox: ignored.
        writeFileSync(join(worker, ".nono.json"), '{"filesystem":{"allow":["/"]}}\n');

        // Start a sandboxed session and check the argv nono actually received (not sensitive persistent logging).
        const started = await cli(ctx, ["start", worker, "--prompt", "hello"]);
        assert.equal(started.code, 0, started.err);
        await sleep(1500);
        const log = readFileSync(ctx.log, "utf8");
        const args = readFileSync(ctx.env.PITON_TEST_NONO_ARGS, "utf8").trimEnd().split("\n");
        assert.deepEqual(args.slice(0, args.indexOf("--") + 1), [
            "run", "-s", "--profile", join(ctx.source, ".nono.json"), "--extends", "piton",
            "--allow-cwd", "--allow", join(ctx.source, ".project/.local"), "--",
        ]);
        assert.ok(log.includes(`worker of ${ctx.source}`), "launch logs the relation");

        const listed = await cli(ctx, ["worker", "ls", "--json"]);
        assert.equal(listed.json.workers.length, 1);
        assert.equal(listed.json.workers[0].sessions.length, 1, "the worker's live session is listed");
        // The session says which project it belongs to, for the apps' grouping.
        assert.deepEqual(listed.json.workers[0].sessions[0].checkout, { kind: "worker", source: ctx.source, name: "fix-x" });

        // Leftovers (the worker's own .nono.json edit) refuse a delete; --force deletes and stops the session.
        const refused = await cli(ctx, ["worker", "delete", worker, "--json"]);
        assert.equal(refused.code, 4);
        assert.equal(refused.json.refusal.kind, "leftovers");
        const deleted = await cli(ctx, ["worker", "delete", worker, "--force", "--json"]);
        assert.equal(deleted.code, 0, deleted.err);
        assert.equal(deleted.json.stopped, 1);
        assert.ok(!existsSync(worker));
        assert.ok(existsSync(join(ctx.source, ".project/.local")), "source's artifacts survive");
        const after = await cli(ctx, ["ls", "--json"]);
        assert.equal(after.json.length, 0);
    },

    async "workers get no pi.nvim descriptor (a spawned one would bypass piton)"(ctx) {
        const created = await cli(ctx, ["worker", "create", "plain", "--json"]);
        assert.equal(created.code, 0, created.err);
        const worker = created.json.worker.path;
        assert.ok(!existsSync(join(worker, ".agents/pi.nvim.json")));
        assert.equal(git(worker, "status", "--porcelain"), "", "a fresh worker is clean");
        const old = await cli(ctx, ["worker", "create", "old", "--descriptor", ".agents/pi.nvim.json", "--json"]);
        assert.notEqual(old.code, 0, "--descriptor is gone");
    },

    async "refusals: dirty source, existing name, not a worker"(ctx) {
        await cli(ctx, ["worker", "create", "one", "--json"]);
        const exists = await cli(ctx, ["worker", "create", "one", "--json"]);
        assert.equal(exists.code, 4);
        assert.equal(exists.json.refusal.kind, "exists");
        writeFileSync(join(ctx.source, "dirty"), "x");
        const dirty = await cli(ctx, ["worker", "create", "two", "--json"]);
        assert.equal(dirty.json.refusal.kind, "source_dirty");
        const notWorker = await cli(ctx, ["worker", "delete", ctx.source, "--json"]);
        assert.equal(notWorker.json.refusal.kind, "not_a_worker");
    },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
    const ctx = setup();
    const daemon = await startDaemon(ctx);
    try {
        await fn(ctx);
        console.log(`ok   ${name}`);
    } catch (e) {
        failed++;
        console.log(`FAIL ${name}\n     ${e.stack?.split("\n").slice(0, 6).join("\n     ")}`);
    } finally {
        daemon.kill("SIGTERM");
        await daemon.exited;
    }
}
process.exit(failed ? 1 : 0);
