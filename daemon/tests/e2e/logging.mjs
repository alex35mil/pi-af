// Host logging lives in the daemon: `[logging] mode` in config.toml is the default, `piton logging` and the apps switch
// it until it expires or the daemon restarts, and nothing is persisted elsewhere. All state is temporary.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import assert from "node:assert/strict";

const binary = resolve(import.meta.dirname, "../../target/debug/piton");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = realpathSync(mkdtempSync(join(tmpdir(), "piton-logging-")));
const logs = join(dir, "logs");
const socket = join(dir, "piton.sock");
const config = join(dir, "config.toml");
const env = { ...process.env, PITON_CONFIG: config, PITON_LOGS_DIR: logs, PITON_RUNTIME: "sandbox" };

function writeConfig(mode) {
    writeFileSync(
        config,
        [
            `socket = ${JSON.stringify(socket)}`,
            `log = ${JSON.stringify(join(dir, "piton.log"))}`,
            `keep_awake = false`,
            ...(mode ? [`[logging]`, `mode = ${JSON.stringify(mode)}`] : []),
            `[tailnet]`,
            `enabled = false`,
            `[env]`,
            `login_shell = false`,
            `mise = false`,
        ].join("\n"),
    );
}

async function startDaemon() {
    const d = spawn(binary, ["daemon"], { env, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    d.stderr.on("data", (c) => (err += c));
    for (let i = 0; i < 100 && !err.includes("listening on"); i++) await sleep(50);
    assert.ok(err.includes("listening on"), "daemon didn't start: " + err);
    d.exited = new Promise((r) => d.on("exit", r));
    return d;
}

async function stop(d) {
    d.kill("SIGTERM");
    await d.exited;
}

function cli(...args) {
    const result = spawnSync(binary, ["logging", ...args], { env, encoding: "utf8" });
    return { code: result.status, out: result.stdout, err: result.stderr };
}

const status = () => {
    const r = cli("status");
    assert.equal(r.code, 0, r.err);
    return JSON.parse(r.out);
};

/// A view client that collects pushed `daemon` states.
function viewClient() {
    const sock = net.connect(socket);
    const c = { lines: [], states: [], waiters: [], n: 0 };
    let buf = "";
    sock.on("data", (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
            const msg = JSON.parse(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
            c.lines.push(msg);
            if (msg.type === "daemon") c.states.push(msg.state);
            for (const w of [...c.waiters]) if (w.pred(msg)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(msg); }
        }
    });
    sock.write(JSON.stringify({ protocol: "view", version: 1, client: "test" }) + "\n");
    // Also matches lines already received: spawnSync (the CLI) blocks the event loop, so pushes can arrive first.
    c.wait = (pred, ms = 5000) =>
        c.lines.find(pred) ??
        new Promise((res, rej) => {
            c.waiters.push({ pred, resolve: res });
            setTimeout(() => rej(new Error(`timeout; states ${JSON.stringify(c.states.slice(-2))}`)), ms);
        });
    c.req = async (type, args = {}) => {
        const id = ++c.n;
        const reply = c.wait((m) => m.type === "reply" && m.id === id);
        sock.write(JSON.stringify({ id, type, ...args }) + "\n");
        const r = await reply;
        if (!r.ok) throw new Error(`${type}: ${r.error}`);
        return r.data;
    };
    c.close = () => sock.destroy();
    return c;
}

let daemon;
try {
    // No daemon: switching fails loudly instead of writing a file nobody reads.
    writeConfig();
    const offline = cli("debug");
    assert.equal(offline.code, 1);
    assert.match(offline.err, /daemon not reachable/);

    daemon = await startDaemon();
    assert.deepEqual(status().policy, { mode: "info" });
    assert.equal(status().default, "info");

    assert.equal(cli("debug").code, 0);
    const timed = status().policy;
    assert.equal(timed.mode, "debug");
    assert.equal(timed.expiration.kind, "until");
    assert.ok(Math.abs(timed.expiration.unix_ms - Date.now() - 3600000) < 5000);
    assert.deepEqual(status().policy, timed, "reading never extends the deadline");
    assert.equal(cli("debug", "--until-disabled").code, 0);
    assert.deepEqual(status().policy, { mode: "debug", expiration: { kind: "manual" } });
    assert.equal(cli("info").code, 0);
    assert.deepEqual(status().policy, { mode: "info" });

    // The apps switch it too, and every client sees the change and the expiry pushed.
    const c = viewClient();
    await c.req("sessions.subscribe");
    await c.wait((m) => m.type === "daemon");
    const until = Date.now() + 700;
    await c.req("daemon.logging", { policy: { mode: "debug", expiration: { kind: "until", unix_ms: until } } });
    const on = await c.wait((m) => m.type === "daemon" && m.state.logging.policy.mode === "debug");
    // The daemon pushes the expiry on its own; no request in between.
    await c.wait((m) => m.type === "daemon" && m.state.logging.policy.mode === "info" && c.lines.indexOf(m) > c.lines.indexOf(on), 3000);
    assert.ok(Date.now() >= until, "not before the deadline");
    assert.deepEqual(status().policy, { mode: "info" }, "expiry returns to the configured default");
    c.close();

    // A restart returns to the config; a configured default of debug is what it starts with.
    assert.equal(cli("debug", "--until-disabled").code, 0);
    await stop(daemon);
    daemon = await startDaemon();
    assert.deepEqual(status().policy, { mode: "info" }, "runtime switches end with the daemon");
    await stop(daemon);
    writeConfig("debug");
    daemon = await startDaemon();
    assert.deepEqual(status(), { directory: logs, policy: { mode: "debug", expiration: { kind: "manual" } }, default: "debug" });

    assert.ok(!existsSync(join(logs, "settings.json")), "no host settings file");

    for (const args of [["collect", "--device", "fake"], ["install", "--device", "fake"], ["uninstall"]]) {
        const result = cli(...args);
        assert.equal(result.code, 1);
        assert.match(result.err, /host-only/);
    }
    console.log("ok   logging: config default, runtime switches, pushed expiry, restart resets, host-only device tooling");
} finally {
    if (daemon) await stop(daemon);
    rmSync(dir, { recursive: true, force: true });
}
