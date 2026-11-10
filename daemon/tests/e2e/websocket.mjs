// End-to-end tests of the `view` protocol over the tailnet WebSocket, with a fake `tailscale` CLI that puts this "Mac"
// on 127.0.0.1 and answers `whois` from a file the test writes. Real pi with the faux extension, host mode.
// Usage (in daemon/): cargo build && node tests/e2e/websocket.mjs, or `mise run daemon:test`.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const piton = join(root, "target/debug/piton");
const ext = join(root, "tests/fixtures/faux-extension.ts");
const fakeTailscale = join(root, "tests/fixtures/fake-tailscale.sh");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const whois = (node, user, login, extra = {}) =>
    JSON.stringify({
        Node: { StableID: node, Name: `${node}.tail.ts.net.`, User: user, ...extra },
        UserProfile: { ID: user, LoginName: login },
    });
const OWN_PHONE = whois("iphone", 1, "me@example.com");

function setup() {
    chmodSync(fakeTailscale, 0o755);
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "piton-ws-")));
    // Native apps start sessions only in checkouts under a root.
    const root = join(dir, "Projects");
    const ws = join(root, "ws");
    const agent = join(dir, "agent");
    mkdirSync(join(ws, ".git"), { recursive: true });
    mkdirSync(agent);
    const whoisFile = join(dir, "whois.json");
    writeFileSync(whoisFile, OWN_PHONE);
    const log = join(dir, "piton.log");
    const config = join(dir, "config.toml");
    writeFileSync(
        config,
        [
            `socket = ${JSON.stringify(join(dir, "piton.sock"))}`,
            `log = ${JSON.stringify(log)}`,
            `attach_mode = "host"`,
            `empty_grace_ms = 60000`,
            `keep_awake = false`,
            `roots = [${JSON.stringify(root)}]`,
            `[pi]`,
            `args = ["-e", ${JSON.stringify(ext)}, "--model", "faux/faux-1"]`,
            `[env]`,
            `login_shell = false`,
            `mise = false`,
            `[tailnet]`,
            `port = 0`,
            `heartbeat_ms = 300`,
            `retry_ms = 200`,
            `cli = ${JSON.stringify(fakeTailscale)}`,
        ].join("\n"),
    );
    const stopped = join(dir, "tailscale-stopped");
    const env = { ...process.env, PITON_CONFIG: config, PI_CODING_AGENT_DIR: agent, PITON_FAUX_TPS: "40", PITON_FAKE_WHOIS: whoisFile, PITON_FAKE_STOPPED: stopped, PITON_LOGS_DIR: join(dir, "logging") };
    return { dir, ws, whoisFile, log, stopped, env };
}

function startDaemon(ctx) {
    const d = spawn(piton, ["daemon"], { env: ctx.env, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    d.stderr.on("data", (c) => (err += c));
    d.err = () => err;
    d.exited = new Promise((r) => d.on("exit", (code) => r(code)));
    return d;
}

/// Waits for the tailnet listener; its port goes into `ctx.port`.
async function listening(d, ctx) {
    for (let i = 0; i < 100 && !/tailnet: listening on/.test(d.err()); i++) await sleep(50);
    const m = /tailnet: listening on 127\.0\.0\.1:(\d+)/.exec(d.err());
    assert.ok(m, "tailnet listener didn't start: " + d.err());
    ctx.port = Number(m[1]);
}

/// A WebSocket view client. `opened` resolves true when the server accepted, false when it closed first.
function wsClient(ctx, name) {
    const sock = new WebSocket(`ws://127.0.0.1:${ctx.port}`);
    const c = { name, lines: [], waiters: [], n: 0, closed: false };
    c.opened = new Promise((res) => {
        sock.addEventListener("open", () => {
            sock.send(JSON.stringify({ protocol: "view", version: 1, client: name }));
            res(true);
        });
        sock.addEventListener("error", () => res(false));
        sock.addEventListener("close", () => res(false));
    });
    c.closedP = new Promise((res) => sock.addEventListener("close", () => { c.closed = true; res(); }));
    sock.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        c.lines.push(msg);
        for (const w of [...c.waiters]) if (w.pred(msg)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(msg); }
    });
    c.wait = (pred, ms = 15000) => {
        const hit = c.lines.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((res, rej) => {
            c.waiters.push({ pred, resolve: res });
            setTimeout(() => rej(new Error(`${name}: timeout; last ${JSON.stringify(c.lines.slice(-2)).slice(0, 400)}`)), ms);
        });
    };
    c.req = async (type, args = {}) => {
        const id = `${name}-${++c.n}`;
        sock.send(JSON.stringify({ id, type, ...args }));
        const reply = await c.wait((m) => m.type === "reply" && m.id === id);
        if (!reply.ok) throw new Error(`${type}: ${reply.error}`);
        return reply.data;
    };
    c.raw = (obj) => sock.send(JSON.stringify(obj));
    c.close = () => sock.close();
    return c;
}

const tests = {
    async "own device: full view protocol over the websocket"(ctx) {
        const c = wsClient(ctx, "iphone");
        assert.equal(await c.opened, true);
        await c.req("sessions.subscribe");
        const { session } = await c.req("session.start", { workspace: ctx.ws, mode: "host" });
        await c.wait((m) => m.type === "sessions" && m.sessions.some((s) => s.key === session.key));
        await c.req("session.watch", { session: session.key });
        await c.wait((m) => m.type === "snapshot" && m.session === session.key);
        await c.req("session.send", { session: session.key, message_id: "m1", text: "slow 10" });
        await c.wait((m) => m.type === "change" && m.change.op === "delta");
        await c.wait((m) => m.type === "change" && m.change.op === "state" && m.change.state.status === "idle" && c.lines.some((l) => l.change?.op === "delta"), 20000);
        c.close();
        await c.closedP;
        await sleep(200);
        const log = readFileSync(ctx.log, "utf8");
        assert.match(log, /view client connected over the tailnet: iphone \(iphone\.tail\.ts\.net, me@example\.com\)/);
        assert.match(log, /view client disconnected from the tailnet: iphone\.tail\.ts\.net/);
    },

    async "logging policy changes at runtime without replacing sessions"(ctx) {
        const a = wsClient(ctx, "info");
        assert.equal(await a.opened, true);
        const { session } = await a.req("session.start", { workspace: ctx.ws, mode: "host" });
        a.close();
        await a.closedP;
        await sleep(100);
        assert.ok(!readFileSync(ctx.log, "utf8").includes("TCP accepted"));
        execFileSync(piton, ["logging", "debug", "--until-disabled"], { env: ctx.env });
        const b = wsClient(ctx, "debug");
        assert.equal(await b.opened, true);
        const listed = await b.req("sessions.list");
        assert.equal(listed.sessions[0].key, session.key);
        b.close();
        await b.closedP;
        await sleep(100);
        assert.equal((readFileSync(ctx.log, "utf8").match(/TCP accepted/g) ?? []).length, 1);
        execFileSync(piton, ["logging", "info"], { env: ctx.env });
        const c = wsClient(ctx, "info-again");
        assert.equal(await c.opened, true);
        const again = await c.req("sessions.list");
        assert.equal(again.sessions[0].key, session.key);
        assert.equal(again.sessions[0].pid, listed.sessions[0].pid);
        c.close();
        await c.closedP;
        await sleep(100);
        assert.equal((readFileSync(ctx.log, "utf8").match(/TCP accepted/g) ?? []).length, 1);
    },

    async "heartbeat: a silent client is dropped, an answering one stays"(ctx) {
        // Node's WebSocket answers pings: it stays past many heartbeats.
        const alive = wsClient(ctx, "alive");
        assert.equal(await alive.opened, true);
        await alive.req("sessions.list");
        await sleep(1500);
        assert.equal(alive.closed, false, "an answering client stays connected");
        await alive.req("sessions.list");

        // A raw TCP client that completes the handshake and then never reads or answers: a phone that lost its network.
        const net = await import("node:net");
        const sock = net.connect(ctx.port, "127.0.0.1");
        await new Promise((r) => sock.on("connect", r));
        sock.write(
            "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
        );
        await new Promise((r) => sock.once("data", r)); // 101 Switching Protocols
        // The hello as one masked text frame.
        const hello = Buffer.from(JSON.stringify({ protocol: "view", version: 1, client: "silent" }));
        const mask = Buffer.from([1, 2, 3, 4]);
        const masked = Buffer.from(hello.map((b, i) => b ^ mask[i % 4]));
        sock.write(Buffer.concat([Buffer.from([0x81, 0x80 | hello.length]), mask, masked]));
        // Reads (so the close is noticed) but never answers a ping.
        sock.resume();
        const closed = new Promise((r) => sock.on("close", r));
        sock.on("error", () => {});
        await Promise.race([closed, sleep(5000)]);
        assert.ok(sock.destroyed || sock.readableEnded, "the silent client is dropped");
        const log = readFileSync(ctx.log, "utf8");
        assert.match(log, /tailnet client iphone\.tail\.ts\.net stopped answering/);
        assert.equal(alive.closed, false);
        alive.close();
    },

    async "refused before the handshake: other user, tagged, shared, this Mac"(ctx) {
        const cases = [
            ["other user", whois("theirs", 2, "bob@example.com"), /belongs to bob@example\.com/],
            ["tagged", whois("server", 1, "me@example.com", { Tags: ["tag:ci"] }), /is a tagged node/],
            ["shared", whois("guest", 1, "me@example.com", { SharerID: 99 }), /shared in from another tailnet/],
            ["this Mac", whois("self-node", 1, "me@example.com"), /from this Mac itself/],
        ];
        for (const [label, identity, reason] of cases) {
            writeFileSync(ctx.whoisFile, identity);
            const c = wsClient(ctx, label);
            assert.equal(await c.opened, false, `${label}: the websocket must not open`);
            await sleep(100);
            assert.match(readFileSync(ctx.log, "utf8"), reason, label);
        }
    },

    "tailscale up only after the daemon started: it listens once it is": {
        before(ctx) {
            writeFileSync(ctx.stopped, "");
        },
        async run(ctx, daemon) {
            await sleep(500);
            assert.match(daemon.err(), /tailnet: not listening: tailscale isn't running/);
            assert.equal((daemon.err().match(/not listening/g) ?? []).length, 1, "logged once, not on every retry");
            rmSync(ctx.stopped);
            await listening(daemon, ctx);
            const c = wsClient(ctx, "iphone");
            assert.equal(await c.opened, true);
            await c.req("sessions.list");
            c.close();
        },
    },

    async "whois failure refuses"(ctx) {
        writeFileSync(ctx.whoisFile, "not json");
        const c = wsClient(ctx, "garbled");
        assert.equal(await c.opened, false);
        await sleep(100);
        assert.match(readFileSync(ctx.log, "utf8"), /refused: tailscale whois failed/);
    },

    async "only the view protocol: rpc hello is closed"(ctx) {
        const sock = new WebSocket(`ws://127.0.0.1:${ctx.port}`);
        await new Promise((r) => sock.addEventListener("open", r));
        const closed = new Promise((r) => sock.addEventListener("close", r));
        sock.send(JSON.stringify({ protocol: "rpc", version: 1, workspace: ctx.ws }));
        await closed;
        await sleep(100);
        assert.match(readFileSync(ctx.log, "utf8"), /sent an unsupported hello/);
        const sessions = readFileSync(ctx.log, "utf8").match(/launched pid/g) ?? [];
        assert.equal(sessions.length, 0, "no pi launched for a remote rpc hello");
    },
};

const only = process.argv.slice(2);
let failed = 0;
for (const [name, test] of Object.entries(tests)) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    // A test is a function (run once the daemon listens on the tailnet), or `{ before, run }` when it prepares the
    // daemon's start and waits for the listener itself.
    const { before, run } = typeof test === "function" ? { run: test } : test;
    const ctx = setup();
    before?.(ctx);
    const daemon = startDaemon(ctx);
    if (!before) await listening(daemon, ctx);
    const t = Date.now();
    try {
        await run(ctx, daemon);
        console.log(`ok   ${name} (${Date.now() - t} ms)`);
    } catch (e) {
        failed++;
        console.log(`FAIL ${name}\n     ${e.stack?.split("\n").slice(0, 5).join("\n     ")}\n     log: ${readFileSync(ctx.log, "utf8").slice(-1200)}`);
    } finally {
        daemon.kill("SIGTERM");
        await daemon.exited;
    }
}
process.exit(failed ? 1 : 0);
