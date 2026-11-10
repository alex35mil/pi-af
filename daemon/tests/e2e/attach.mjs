// End-to-end tests of the piton daemon and `piton attach` against real pi with the faux extension.
// Usage (in daemon/): cargo build && node tests/e2e/attach.mjs [test-name...], or `mise run daemon:test`
// Host mode (nono can't nest inside a nono sandbox); mise and the login-shell environment are off.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const piton = join(root, "target/debug/piton");
const ext = join(root, "tests/fixtures/faux-extension.ts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "piton-e2e-")));
    const ws = join(dir, "ws");
    const agent = join(dir, "agent");
    mkdirSync(ws);
    mkdirSync(agent);
    const socket = join(dir, "piton.sock");
    const config = join(dir, "config.toml");
    writeFileSync(
        config,
        [
            `socket = ${JSON.stringify(socket)}`,
            `log = ${JSON.stringify(join(dir, "piton.log"))}`,
            `attach_mode = "host"`,
            `empty_grace_ms = 1500`,
            `keep_awake = false`,
            `[tailnet]`,
            `enabled = false`,
            `[pi]`,
            `args = ["-e", ${JSON.stringify(ext)}, "--model", "faux/faux-1"]`,
            `[env]`,
            `login_shell = false`,
            `mise = false`,
            `[stop]`,
            `grace_ms = 3000`,
            `term_grace_ms = 1000`,
        ].join("\n"),
    );
    const env = { ...process.env, PITON_CONFIG: config, PI_CODING_AGENT_DIR: agent, PITON_FAUX_TPS: "40" };
    return { dir, ws, agent, socket, config, env };
}

async function startDaemon(ctx) {
    const d = spawn(piton, ["daemon"], { env: ctx.env, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    d.stderr.on("data", (c) => (err += c));
    for (let i = 0; i < 100; i++) {
        if (err.includes("listening")) break;
        await sleep(50);
    }
    assert.ok(err.includes("listening"), "daemon didn't start: " + err);
    d.exited = new Promise((r) => d.on("exit", (code, signal) => r({ code, signal })));
    d.stderrText = () => err;
    return d;
}

function attach(ctx, name) {
    const child = spawn(piton, ["attach"], { cwd: ctx.ws, env: ctx.env, stdio: ["pipe", "pipe", "pipe"] });
    const c = { name, child, records: [], waiters: [], stderr: "", n: 0 };
    let buf = "";
    child.stdout.on("data", (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            const rec = JSON.parse(line);
            c.records.push(rec);
            for (const w of [...c.waiters]) if (w.pred(rec)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(rec); }
        }
    });
    child.stderr.on("data", (d) => (c.stderr += d));
    c.exited = new Promise((r) => child.on("exit", (code, signal) => r({ code, signal })));
    c.send = (cmd) => {
        const id = cmd.id ?? `${name}-${++c.n}`;
        child.stdin.write(JSON.stringify({ ...cmd, id }) + "\n");
        return id;
    };
    c.raw = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
    c.wait = (pred, ms = 15000) => {
        const hit = c.records.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((res, rej) => {
            const w = { pred, resolve: res };
            c.waiters.push(w);
            setTimeout(() => rej(new Error(`${name}: timeout; last ${JSON.stringify(c.records.slice(-3).map((r) => r.type))}; stderr ${c.stderr}`)), ms);
        });
    };
    c.waitNew = (pred, ms) => {
        const from = c.records.length;
        return c.wait((r) => c.records.indexOf(r) >= from && pred(r), ms);
    };
    c.call = async (cmd) => {
        const id = c.send(cmd);
        return c.wait((r) => r.type === "response" && r.id === id);
    };
    c.close = () => {
        child.stdin.end();
        return c.exited;
    };
    return c;
}

async function pitonCli(ctx, args) {
    const p = spawn(piton, args, { env: ctx.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const { code } = await new Promise((r) => p.on("exit", (code) => r({ code })));
    return { code, out, err };
}

async function ls(ctx) {
    const { out } = await pitonCli(ctx, ["ls", "--json"]);
    return JSON.parse(out);
}

const tests = {
    async "relay and detach keeps pi running"(ctx) {
        const a = attach(ctx, "a");
        const st = await a.call({ type: "get_state" });
        assert.equal(st.success, true);
        a.send({ type: "prompt", message: "hello" });
        await a.wait((r) => r.type === "agent_settled");
        assert.ok(a.records.some((r) => r.type === "message_end" && r.message.role === "user"), "user message relayed");
        const res = await a.close();
        assert.equal(res.code, 0, "detach exits 0");
        const sessions = await ls(ctx);
        assert.equal(sessions.length, 1, "pi still running after detach");
        assert.equal(sessions[0].clients, 0);
        assert.equal(sessions[0].id, st.data.sessionId);
    },

    async "prompts sent together all run"(ctx) {
        // pi 1.5 drops a prompt that arrives while the previous one is still starting its run (it answers "started"
        // to both and runs only the first), so piton sends pi one prompt at a time.
        const a = attach(ctx, "a");
        await a.call({ type: "get_state" });
        const lines = ["slow 10", "second", "third"].map((message, i) =>
            JSON.stringify({ type: "prompt", message, streamingBehavior: "followUp", id: `p${i}` }),
        );
        a.child.stdin.write(lines.join("\n") + "\n");
        const responses = await Promise.all(["p0", "p1", "p2"].map((id) => a.wait((r) => r.type === "response" && r.id === id)));
        assert.deepEqual(
            responses.map((r) => [r.success, r.data?.disposition]),
            [[true, "started"], [true, "queued"], [true, "queued"]],
        );
        await a.wait((r) => r.type === "message_end" && r.message.role === "assistant" && r.message.content[0]?.text === "echo: third");
        const users = a.records.filter((r) => r.type === "message_end" && r.message.role === "user");
        assert.deepEqual(users.map((r) => r.message.content[0].text), ["slow 10", "second", "third"]);
        await a.close();
    },

    async "every attach gets a fresh pi"(ctx) {
        const a = attach(ctx, "a");
        const b = attach(ctx, "b");
        const sa = await a.call({ type: "get_state" });
        const sb = await b.call({ type: "get_state" });
        assert.notEqual(sa.data.sessionId, sb.data.sessionId);
        assert.equal(sa.data.messageCount, 0);
        await Promise.all([a.close(), b.close()]);
    },

    async "switch_session to a live session moves the connection, with replay mid-stream"(ctx) {
        const a = attach(ctx, "a");
        const sa = await a.call({ type: "get_state" });
        a.send({ type: "prompt", message: "slow 120" });
        await a.wait((r) => r.assistantMessageEvent?.type === "text_delta");
        await sleep(300);

        const b = attach(ctx, "b");
        await b.call({ type: "get_state" });
        const sw = b.send({ type: "switch_session", sessionPath: sa.data.sessionFile });
        const resp = await b.wait((r) => r.type === "response" && r.id === sw);
        assert.equal(resp.success, true);
        assert.deepEqual(resp.data, { cancelled: false });
        // Replay follows the response: the in-progress message's start and deltas so far.
        await b.wait((r) => b.records.indexOf(r) > b.records.indexOf(resp) && r.type === "message_update");
        await sleep(100);
        const after = b.records.slice(b.records.indexOf(resp) + 1);
        assert.equal(after[0]?.type, "message_start", "replay starts with message_start");
        assert.equal(after[0].message.role, "assistant");
        assert.ok(after.filter((r) => r.type === "message_update").length > 3, "deltas replayed");
        const st = await b.call({ type: "get_state" });
        assert.equal(st.data.sessionId, sa.data.sessionId, "b now talks to a's pi");
        assert.equal(st.data.isStreaming, true);
        // b sees the same message end as a.
        const endA = await a.wait((r) => r.type === "message_end" && r.message.role === "assistant");
        const endB = await b.wait((r) => r.type === "message_end" && r.message.role === "assistant");
        assert.equal(endB.message.content[0].text, endA.message.content[0].text);
        // Reconstructing text from b's replay + live deltas gives the whole message.
        const startIdx = b.records.indexOf(after[0]);
        const text = b.records
            .slice(startIdx)
            .filter((r) => r.type === "message_update" && r.assistantMessageEvent.type === "text_delta")
            .map((r) => r.assistantMessageEvent.delta)
            .join("");
        assert.equal(text, endA.message.content[0].text, "replay + live has no gap or duplicate");
        await Promise.all([a.close(), b.close()]);
        // b's original empty pi is stopped after the empty grace period.
        await sleep(2500);
        const sessions = await ls(ctx);
        assert.equal(sessions.length, 1, "empty pi left behind by the move was stopped");
    },

    async "responses go only to the client that asked; events go to all"(ctx) {
        const a = attach(ctx, "a");
        const sa = await a.call({ type: "get_state" });
        const b = attach(ctx, "b");
        await b.call({ type: "switch_session", sessionPath: sa.data.sessionFile }).catch(() => {});
        // Same request id from both clients.
        a.send({ id: "same", type: "get_state" });
        b.send({ id: "same", type: "get_session_stats" });
        const ra = await a.wait((r) => r.type === "response" && r.id === "same");
        const rb = await b.wait((r) => r.type === "response" && r.id === "same");
        assert.equal(ra.command, "get_state");
        assert.equal(rb.command, "get_session_stats");
        await sleep(200);
        assert.equal(a.records.filter((r) => r.id === "same").length, 1);
        assert.equal(b.records.filter((r) => r.id === "same").length, 1);
        b.send({ type: "prompt", message: "from b" });
        await a.wait((r) => r.type === "message_end" && r.message.role === "user" && JSON.stringify(r.message.content).includes("from b"));
        await Promise.all([a.close(), b.close()]);
    },

    async "pending dialog is replayed to a new client; first answer wins"(ctx) {
        const a = attach(ctx, "a");
        const sa = await a.call({ type: "get_state" });
        a.send({ type: "prompt", message: "ask" });
        const req = await a.wait((r) => r.type === "extension_ui_request" && r.method === "select");
        const b = attach(ctx, "b");
        const sw = b.send({ type: "switch_session", sessionPath: sa.data.sessionFile });
        await b.wait((r) => r.type === "response" && r.id === sw);
        const replayed = await b.wait((r) => r.type === "extension_ui_request" && r.id === req.id);
        assert.equal(replayed.title, "Pick one");
        const status = await ls(ctx);
        assert.equal(status.find((s) => s.id === sa.data.sessionId).status, "needs_input");
        b.raw({ type: "extension_ui_response", id: req.id, value: "beta" });
        // Two connections race; answer from a only once b's answer reached pi (the tool finished).
        await a.wait((r) => r.type === "tool_execution_end");
        a.raw({ type: "extension_ui_response", id: req.id, value: "alpha" });
        await a.wait((r) => r.type === "agent_settled");
        const last = await a.call({ type: "get_last_assistant_text" });
        assert.match(last.data.text, /picked beta/);
        await Promise.all([a.close(), b.close()]);
    },

    async "new_session on a shared pi gives this client a fresh pi"(ctx) {
        const a = attach(ctx, "a");
        const sa = await a.call({ type: "get_state" });
        a.send({ type: "prompt", message: "keep me" });
        await a.wait((r) => r.type === "agent_settled");
        const b = attach(ctx, "b");
        await b.call({ type: "switch_session", sessionPath: sa.data.sessionFile });
        const ns = await b.call({ type: "new_session" });
        assert.equal(ns.success, true);
        const sb = await b.call({ type: "get_state" });
        assert.notEqual(sb.data.sessionId, sa.data.sessionId);
        assert.equal(sb.data.messageCount, 0);
        const sa2 = await a.call({ type: "get_state" });
        assert.equal(sa2.data.sessionId, sa.data.sessionId, "a's conversation untouched");
        const fork = await a.call({ type: "fork", entryId: "x" });
        assert.equal(fork.success, false, "fork is forwarded when unshared (pi rejects the bad entry id)");
        await Promise.all([a.close(), b.close()]);
    },

    async "switch_session to a saved session on a shared pi launches a new pi"(ctx) {
        const old = attach(ctx, "old");
        const so = await old.call({ type: "get_state" });
        old.send({ type: "prompt", message: "saved one" });
        await old.wait((r) => r.type === "agent_settled");
        await pitonCli(ctx, ["stop", "--session", so.data.sessionId]);
        await old.exited;

        const a = attach(ctx, "a");
        const sa = await a.call({ type: "get_state" });
        a.send({ type: "prompt", message: "live one" });
        await a.wait((r) => r.type === "agent_settled");
        const b = attach(ctx, "b");
        await b.call({ type: "switch_session", sessionPath: sa.data.sessionFile });
        const sw = await b.call({ type: "switch_session", sessionPath: so.data.sessionFile });
        assert.equal(sw.success, true);
        const sb = await b.call({ type: "get_state" });
        assert.equal(sb.data.sessionId, so.data.sessionId);
        assert.equal(sb.data.messageCount > 0, true);
        const sa2 = await a.call({ type: "get_state" });
        assert.equal(sa2.data.sessionId, sa.data.sessionId, "a stays on its conversation");
        await Promise.all([a.close(), b.close()]);
    },

    async "piton stop: all connections exit 3"(ctx) {
        const a = attach(ctx, "a");
        const sa = await a.call({ type: "get_state" });
        a.send({ type: "prompt", message: "x" });
        await a.wait((r) => r.type === "agent_settled");
        const b = attach(ctx, "b");
        await b.call({ type: "switch_session", sessionPath: sa.data.sessionFile });
        const stop = await pitonCli(ctx, ["stop", "--session", sa.data.sessionId]);
        assert.equal(stop.code, 0, stop.err);
        const [ea, eb] = await Promise.all([a.exited, b.exited]);
        assert.equal(ea.code, 3);
        assert.equal(eb.code, 3);
        const sessions = await ls(ctx);
        assert.equal(sessions.filter((s) => s.id === sa.data.sessionId).length, 0);
    },

    async "commands in flight get an error when the connection moves"(ctx) {
        const a = attach(ctx, "a");
        const sa = await a.call({ type: "get_state" });
        const b = attach(ctx, "b");
        await b.call({ type: "get_state" });
        // A prompt on b's own pi stays pending only briefly, so use a bash command that takes a while.
        const slow = b.send({ type: "bash", command: "sleep 2; echo hi" });
        await sleep(200);
        const sw = b.send({ type: "switch_session", sessionPath: sa.data.sessionFile });
        const failed = await b.wait((r) => r.type === "response" && r.id === slow);
        assert.equal(failed.success, false);
        assert.equal(failed.error, "connection moved to another session");
        const ok = await b.wait((r) => r.type === "response" && r.id === sw);
        assert.ok(b.records.indexOf(failed) < b.records.indexOf(ok), "error before the move's success");
        await sleep(2500);
        assert.equal(b.records.filter((r) => r.id === slow).length, 1, "no late response from the old pi");
        await Promise.all([a.close(), b.close()]);
    },

    async "daemon shutdown: attach exits 1; daemon not running: attach fails fast"(ctx, daemon) {
        const a = attach(ctx, "a");
        await a.call({ type: "get_state" });
        daemon.kill("SIGTERM");
        const ea = await a.exited;
        assert.equal(ea.code, 1);
        await daemon.exited;
        const t = Date.now();
        const b = attach(ctx, "b");
        const eb = await b.exited;
        assert.equal(eb.code, 1);
        assert.ok(Date.now() - t < 2000, "fails fast");
        assert.match(b.stderr, /not reachable/);
    },
};

const only = process.argv.slice(2);
let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    const ctx = setup();
    const daemon = await startDaemon(ctx);
    const t = Date.now();
    try {
        await fn(ctx, daemon);
        console.log(`ok   ${name} (${Date.now() - t} ms)`);
    } catch (e) {
        failed++;
        console.log(`FAIL ${name}\n     ${e.stack?.split("\n").slice(0, 4).join("\n     ")}\n     daemon: ${daemon.stderrText().slice(-800)}`);
    } finally {
        if (daemon.exitCode === null) {
            daemon.kill("SIGTERM");
            await daemon.exited;
        }
    }
}
process.exit(failed ? 1 : 0);
