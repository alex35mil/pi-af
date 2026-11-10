// End-to-end tests of the `view` protocol (native clients) against real pi with the faux extension.
// Usage (in daemon/): cargo build && node tests/e2e/view.mjs, or `mise run daemon:test`.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const piton = join(root, "target/debug/piton");
const ext = join(root, "tests/fixtures/faux-extension.ts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/// `options.roots: false` leaves `roots` out of the config, as for a user who hasn't set any.
function setup(options = {}) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "piton-view-")));
    // Native apps start sessions only in checkouts under a root.
    const root = join(dir, "Projects");
    const ws = join(root, "ws");
    const agent = join(dir, "agent");
    mkdirSync(join(ws, ".git"), { recursive: true });
    mkdirSync(join(root, "group", "inner", ".git"), { recursive: true });
    mkdirSync(agent);
    const socket = join(dir, "piton.sock");
    const config = join(dir, "config.toml");
    writeFileSync(
        config,
        [
            `socket = ${JSON.stringify(socket)}`,
            `log = ${JSON.stringify(join(dir, "piton.log"))}`,
            `attach_mode = "host"`,
            `empty_grace_ms = 60000`,
            `keep_awake = false`,
            ...(options.roots === false ? [] : [`roots = [${JSON.stringify(root)}]`]),
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
    return { dir, root, ws, socket, env: { ...process.env, PITON_CONFIG: config, PI_CODING_AGENT_DIR: agent, PITON_FAUX_TPS: "40" } };
}

async function startDaemon(ctx) {
    const d = spawn(piton, ["daemon"], { env: ctx.env, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    d.stderr.on("data", (c) => (err += c));
    for (let i = 0; i < 100 && !err.includes("listening"); i++) await sleep(50);
    assert.ok(err.includes("listening"), "daemon didn't start: " + err);
    d.exited = new Promise((r) => d.on("exit", (code) => r(code)));
    d.err = () => err;
    return d;
}

/// A view client: requests with ids, replies, and pushed lines.
function viewClient(ctx, name) {
    const sock = net.connect(ctx.socket);
    const c = { name, lines: [], waiters: [], n: 0 };
    let buf = "";
    sock.on("data", (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            const msg = JSON.parse(line);
            c.lines.push(msg);
            for (const w of [...c.waiters]) if (w.pred(msg)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(msg); }
        }
    });
    sock.write(JSON.stringify({ protocol: "view", version: 1, client: name }) + "\n");
    c.wait = (pred, ms = 15000) => {
        const hit = c.lines.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((res, rej) => {
            c.waiters.push({ pred, resolve: res });
            setTimeout(() => rej(new Error(`${name}: timeout; last ${JSON.stringify(c.lines.slice(-3)).slice(0, 600)}`)), ms);
        });
    };
    c.waitNew = (pred, ms) => {
        const from = c.lines.length;
        return c.wait((m) => c.lines.indexOf(m) >= from && pred(m), ms);
    };
    c.req = async (type, args = {}) => {
        const id = `${name}-${++c.n}`;
        sock.write(JSON.stringify({ id, type, ...args }) + "\n");
        const reply = await c.wait((m) => m.type === "reply" && m.id === id);
        if (!reply.ok) throw new Error(`${type}: ${reply.error}`);
        return reply.data;
    };
    c.reqRaw = async (type, args = {}) => {
        const id = `${name}-${++c.n}`;
        sock.write(JSON.stringify({ id, type, ...args }) + "\n");
        return c.wait((m) => m.type === "reply" && m.id === id);
    };
    c.close = () => sock.end();
    /// Applies snapshot/change lines for `session` to a local model, like a client would.
    c.model = (session) => {
        let items = [];
        let state = null;
        for (const m of c.lines) {
            if (m.session !== session) continue;
            if (m.type === "snapshot") {
                items = structuredClone(m.items);
                state = m.state;
            } else if (m.type === "change") {
                const ch = m.change;
                if (ch.op === "append") items.push(structuredClone(ch.item));
                else if (ch.op === "replace") items = items.map((i) => (i.id === ch.item.id ? structuredClone(ch.item) : i));
                else if (ch.op === "delta") {
                    const item = items.find((i) => i.id === ch.item);
                    const key = ch.field === "text" ? "text" : "thinking";
                    item.content[ch.index][key] = (item.content[ch.index][key] ?? "") + ch.text;
                } else if (ch.op === "state") state = ch.state;
                else if (ch.op === "reset") items = [];
            }
        }
        return { items, state };
    };
    return c;
}

const tests = {
    async "start, watch, prompt, stream, settle"(ctx) {
        const c = viewClient(ctx, "phone");
        await c.req("sessions.subscribe");
        const { session } = await c.req("session.start", { workspace: ctx.ws, mode: "host" });
        const key = session.key;
        await c.wait((m) => m.type === "sessions" && m.sessions.some((s) => s.key === key));
        await c.req("session.watch", { session: key });
        await c.wait((m) => m.type === "snapshot" && m.session === key);
        await c.req("session.send", { session: key, message_id: "m1", text: "slow 30" });
        await c.wait((m) => m.type === "change" && m.change.op === "delta");
        await c.wait((m) => m.type === "change" && m.change.op === "state" && m.change.state.status === "idle" && c.lines.some((l) => l.change?.op === "delta"), 20000);
        const { items, state } = c.model(key);
        const kinds = items.map((i) => i.type);
        assert.deepEqual(kinds, ["user", "assistant"]);
        assert.equal(items[1].streaming, false);
        assert.match(items[1].content[0].text, /^word0 word1 .* word29$/);
        assert.equal(state.title, "slow 30");
        const list = await c.wait((m) => m.type === "sessions" && m.sessions.some((s) => s.key === key && s.title === "slow 30"));
        assert.ok(list);
        c.close();
    },

    async "tools and dialogs; answering from the view"(ctx) {
        const c = viewClient(ctx, "phone");
        const { session } = await c.req("session.start", { workspace: ctx.ws, mode: "host" });
        const key = session.key;
        await c.req("session.watch", { session: key });
        await c.req("session.send", { session: key, message_id: "m1", text: "ask" });
        const st = await c.wait((m) => m.type === "change" && m.change.op === "state" && m.change.state.dialogs.length === 1);
        assert.equal(st.change.state.status, "needs_input");
        const dialog = st.change.state.dialogs[0];
        assert.equal(dialog.method, "select");
        await c.req("session.answer", { session: key, request_id: dialog.id, answer: { value: "beta" } });
        const late = await c.reqRaw("session.answer", { session: key, request_id: dialog.id, answer: { value: "alpha" } });
        assert.equal(late.ok, false, "a second answer is refused");
        await c.wait((m) => m.type === "change" && m.change.op === "state" && m.change.state.status === "idle" && m.change.state.dialogs.length === 0, 20000);
        await sleep(300);
        const { items } = c.model(key);
        const tool = items.find((i) => i.type === "tool");
        assert.equal(tool.name, "faux_ask");
        assert.equal(tool.status, "done");
        assert.equal(tool.preview, "picked beta");
        const owner = items.find((i) => i.id === tool.message);
        assert.equal(owner.type, "assistant", "tool links to its assistant message");
        const out = await c.req("session.tool_output", { session: key, call_id: tool.call_id });
        assert.equal(out.content[0].text, "picked beta");
        c.close();
    },

    async "images travel as references; session.image returns the data"(ctx) {
        const c = viewClient(ctx, "phone");
        const { session } = await c.req("session.start", { workspace: ctx.ws, mode: "host" });
        const key = session.key;
        await c.req("session.watch", { session: key });
        await c.req("session.send", { session: key, message_id: "m1", text: "picture" });
        await c.wait((m) => m.type === "change" && m.change.op === "state" && m.change.state.status === "idle" && c.model(key).items.some((i) => i.type === "tool" && i.status === "done"), 20000);
        await sleep(300);
        const tool = c.model(key).items.find((i) => i.type === "tool");
        assert.equal(tool.name, "faux_picture");
        assert.equal(tool.truncated, true, "the preview can't show the image");
        const out = await c.req("session.tool_output", { session: key, call_id: tool.call_id });
        const ref = out.content.find((b) => b.type === "image");
        assert.equal(ref.data, undefined, "no image data in the tool output");
        assert.equal(ref.mime_type, "image/png");
        const image = await c.req("session.image", { session: key, image: ref.image });
        assert.equal(image.mime_type, "image/png");
        assert.equal(Buffer.from(image.data, "base64").length, 1536 * 1024);
        // A fresh watcher's snapshot stays small, whatever the conversation's images weigh.
        const late = viewClient(ctx, "late");
        await late.req("session.watch", { session: key });
        const snap = await late.wait((m) => m.type === "snapshot" && m.session === key);
        assert.ok(JSON.stringify(snap).length < 64 * 1024, "snapshot carries no image data");
        const missing = await c.reqRaw("session.image", { session: key, image: 999 });
        assert.equal(missing.ok, false);
        late.close();
        c.close();
    },

    async "nvim and phone on one session: same conversation both ways"(ctx) {
        // pi.nvim through piton attach.
        const nvim = spawn(piton, ["attach"], { cwd: ctx.ws, env: ctx.env, stdio: ["pipe", "pipe", "pipe"] });
        const nrecs = [];
        let nbuf = "";
        nvim.stdout.on("data", (d) => {
            nbuf += d;
            let i;
            while ((i = nbuf.indexOf("\n")) >= 0) {
                const l = nbuf.slice(0, i);
                nbuf = nbuf.slice(i + 1);
                if (l.trim()) nrecs.push(JSON.parse(l));
            }
        });
        const waitN = async (pred, ms = 15000) => {
            const t = Date.now();
            while (Date.now() - t < ms) {
                const hit = nrecs.find(pred);
                if (hit) return hit;
                await sleep(25);
            }
            throw new Error("nvim timeout: " + JSON.stringify(nrecs.slice(-3)).slice(0, 400));
        };
        nvim.stdin.write(JSON.stringify({ id: "s", type: "get_state" }) + "\n");
        const st = await waitN((r) => r.id === "s");
        nvim.stdin.write(JSON.stringify({ id: "p", type: "prompt", message: "from nvim" }) + "\n");
        await waitN((r) => r.type === "agent_settled");

        const c = viewClient(ctx, "phone");
        const { sessions } = await c.req("sessions.list");
        const s = sessions.find((x) => x.id === st.data.sessionId);
        assert.ok(s, "nvim's session is listed");
        assert.equal(s.clients, 1);
        await c.req("session.watch", { session: s.key });
        const snap = await c.wait((m) => m.type === "snapshot" && m.session === s.key);
        assert.equal(snap.items[0].type, "user");
        assert.equal(snap.items[0].content[0].text, "from nvim");
        await c.req("session.send", { session: s.key, message_id: "m1", text: "from phone" });
        await waitN((r) => r.type === "message_end" && r.message.role === "user" && JSON.stringify(r.message.content).includes("from phone"));
        await waitN((r) => r.type === "agent_settled" && nrecs.indexOf(r) > nrecs.findIndex((x) => JSON.stringify(x).includes("from phone")));
        await sleep(300);
        const { items } = c.model(s.key);
        assert.deepEqual(items.map((i) => i.type), ["user", "assistant", "user", "assistant"]);
        nvim.stdin.end();
        c.close();
    },

    async "resume from seq after a drop, or a snapshot"(ctx) {
        const a = viewClient(ctx, "a");
        const { session } = await a.req("session.start", { workspace: ctx.ws, mode: "host", prompt: "first" });
        const key = session.key;
        await a.req("session.watch", { session: key });
        await a.wait((m) => m.type === "change" && m.change.op === "state" && m.change.state.status === "idle" && a.model(key).items.length >= 2, 20000);
        const lastSeq = Math.max(...a.lines.filter((m) => m.session === key && m.seq).map((m) => m.seq));
        a.close();
        // Something happens while the client is away.
        const other = viewClient(ctx, "other");
        await other.req("session.send", { session: key, message_id: "m1", text: "while away" });
        await sleep(1500);
        const b = viewClient(ctx, "b");
        await b.req("session.watch", { session: key, from: lastSeq });
        await sleep(500);
        assert.ok(!b.lines.some((m) => m.type === "snapshot"), "resumed with changes, no snapshot");
        const missed = b.lines.filter((m) => m.type === "change");
        assert.ok(missed.length > 0);
        assert.equal(missed[0].seq, lastSeq + 1, "no gap");
        // A seq the daemon doesn't have gets a snapshot.
        const c = viewClient(ctx, "c");
        await c.req("session.watch", { session: key, from: 999999 });
        await c.wait((m) => m.type === "snapshot");
        other.close();
        b.close();
        c.close();
    },

    async "a repeated message id reaches pi once"(ctx) {
        const a = viewClient(ctx, "phone");
        const { session } = await a.req("session.start", { workspace: ctx.ws, mode: "host" });
        const key = session.key;
        await a.req("session.watch", { session: key });
        // The phone sends, then its connection drops before the reply; it sends again on a new connection, and once
        // more after the run (a late retry). Both repeats get the first reply.
        const first = a.req("session.send", { session: key, message_id: "walk-1", text: "slow 20" });
        const b = viewClient(ctx, "phone-again");
        const repeat = await b.req("session.send", { session: key, message_id: "walk-1", text: "slow 20" });
        assert.deepEqual(repeat, await first);
        await a.wait((m) => m.type === "change" && m.change.op === "state" && m.change.state.status === "idle" && a.model(key).items.length >= 2, 20000);
        const late = await b.req("session.send", { session: key, message_id: "walk-1", text: "slow 20" });
        assert.deepEqual(late, await first);
        await sleep(500);
        assert.deepEqual(a.model(key).items.map((i) => i.type), ["user", "assistant"], "one message, one reply");
        // A new id is a new message.
        await b.req("session.send", { session: key, message_id: "walk-2", text: "again" });
        await a.wait((m) => m.type === "change" && m.change.op === "state" && m.change.state.status === "idle" && a.model(key).items.length >= 4, 20000);
        const missing = await b.reqRaw("session.send", { session: key, text: "no id" });
        assert.equal(missing.ok, false, "message_id is required");
        a.close();
        b.close();
    },

    async "a slow request doesn't hold up the connection; messages keep their order"(ctx) {
        const c = viewClient(ctx, "phone");
        await c.req("sessions.subscribe");
        const { session } = await c.req("session.start", { workspace: ctx.ws, mode: "host" });
        const key = session.key;
        await c.req("session.watch", { session: key });
        await c.wait((m) => m.type === "snapshot" && m.session === key);
        // Three messages written back to back, without waiting for replies: pi gets them in that order (the first a
        // prompt, the others follow-ups queued behind it).
        const sent = ["slow 20", "second", "third"].map((text, i) =>
            c.req("session.send", { session: key, message_id: `order-${i}`, text }),
        );
        await Promise.all(sent);
        const text = (i) => (typeof i.content === "string" ? i.content : i.content.find((b) => b.type === "text")?.text);
        await c.wait((m) => m.type === "change" && m.change.op === "replace" && m.change.item.type === "assistant" && text(m.change.item) === "echo: third", 30000);
        const users = c.model(key).items.filter((i) => i.type === "user").map(text);
        assert.deepEqual(users, ["slow 20", "second", "third"], JSON.stringify(c.model(key).items.map((i) => [i.type, text(i)])));

        // A stop that waits for pi to exit (a frozen pi: the grace periods, then SIGKILL) doesn't hold up requests
        // behind it.
        const other = await c.req("session.start", { workspace: ctx.ws, mode: "host" });
        process.kill(other.session.pid, "SIGSTOP");
        const stopping = c.req("session.stop", { session: other.session.key });
        const t = Date.now();
        await c.req("daemon.state");
        assert.ok(Date.now() - t < 1000, "daemon.state answered while the stop was pending");
        assert.deepEqual(await stopping, { forced: true });
        c.close();
    },

    async "history pages and errors"(ctx) {
        const c = viewClient(ctx, "phone");
        const { session } = await c.req("session.start", { workspace: ctx.ws, mode: "host" });
        const key = session.key;
        for (const t of ["one", "two", "three"]) {
            await c.req("session.send", { session: key, message_id: t, text: t });
            await sleep(700);
        }
        await c.req("session.watch", { session: key, limit: 2 });
        const snap = await c.wait((m) => m.type === "snapshot");
        assert.equal(snap.items.length, 2);
        assert.equal(snap.has_more, true);
        const page = await c.req("session.history", { session: key, before: snap.items[0].id, limit: 10 });
        assert.equal(page.items.length, 4);
        assert.equal(page.has_more, false);
        const bad = await c.reqRaw("session.watch", { session: 424242 });
        assert.equal(bad.ok, false);
        const junk = await c.reqRaw("no.such.thing");
        assert.equal(junk.ok, false);
        c.close();
    },

    async "keep-awake: held while sessions live (idle too), toggled from the view"(ctx) {
        const c = viewClient(ctx, "mac");
        await c.req("sessions.subscribe");
        const daemonLine = (pred) => c.wait((m) => m.type === "daemon" && pred(m.state));
        // The test config turns keep-awake off.
        await daemonLine((s) => s.keep_awake === false && s.awake === false && s.sessions === 0);
        await c.req("daemon.keep_awake", { on: true });
        await daemonLine((s) => s.keep_awake === true && s.awake === false);
        const { session } = await c.req("session.start", { workspace: ctx.ws, mode: "host" });
        // Held for an idle session: no prompt was sent.
        await daemonLine((s) => s.awake === true && s.sessions === 1);
        const off = await c.req("daemon.keep_awake", { on: false });
        assert.equal(off.state.keep_awake, false);
        await daemonLine((s) => s.keep_awake === false && s.awake === false && s.sessions === 1);
        await c.req("daemon.keep_awake", { on: true });
        await daemonLine((s) => s.keep_awake === true && s.awake === true);
        await c.req("session.stop", { session: session.key });
        await daemonLine((s) => s.awake === false && s.sessions === 0);
        const state = await c.req("daemon.state");
        const { version, ...rest } = state.state;
        assert.match(version, /^\d+\.\d+\.\d+ \([0-9a-f]{10}(-dirty)?\)$/, "version with the git commit");
        assert.deepEqual(rest, {
            keep_awake: true,
            awake: false,
            sessions: 0,
            logging: { policy: { mode: "info" }, default: "info" },
        });
        c.close();
    },

    async "workspaces: browse the roots; start only inside them"(ctx) {
        const c = viewClient(ctx, "phone");
        const top = await c.req("workspaces.browse");
        assert.deepEqual(top.entries.map((e) => e.path), [ctx.root]);
        const level = await c.req("workspaces.browse", { path: ctx.root });
        assert.deepEqual(
            level.entries.map((e) => [e.kind, e.name]),
            [["group", "group"], ["workspace", "ws"]],
        );
        const inner = await c.req("workspaces.browse", { path: join(ctx.root, "group") });
        assert.equal(inner.entries[0].kind, "workspace");
        const outside = await c.reqRaw("workspaces.browse", { path: ctx.dir });
        assert.equal(outside.ok, false);
        assert.match(outside.error, /isn't under a configured root/);
        const escape = await c.reqRaw("session.start", { workspace: join(ctx.root, ".."), mode: "host" });
        assert.equal(escape.ok, false, "no session outside the roots");
        const notCheckout = await c.reqRaw("session.start", { workspace: join(ctx.root, "group"), mode: "host" });
        assert.match(notCheckout.error, /isn't a git checkout/);
        const ok = await c.req("session.start", { workspace: join(ctx.root, "group", "inner"), mode: "host" });
        assert.ok(ok.session.key);
        c.close();
    },

    "workspaces: without roots, the apps can't browse or start sessions": {
        setup: { roots: false },
        async run(ctx) {
            const c = viewClient(ctx, "phone");
            const browse = await c.reqRaw("workspaces.browse");
            assert.equal(browse.ok, false);
            assert.match(browse.error, /no workspace roots configured/);
            const start = await c.reqRaw("session.start", { workspace: ctx.ws, mode: "host" });
            assert.equal(start.ok, false);
            assert.match(start.error, /no workspace roots configured/);
            c.close();
        },
    },
};

const only = process.argv.slice(2);
let failed = 0;
for (const [name, test] of Object.entries(tests)) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    // A test is a function, or `{ setup, run }` when it needs a different config.
    const { setup: options, run } = typeof test === "function" ? { run: test } : test;
    const ctx = setup(options);
    const daemon = await startDaemon(ctx);
    const t = Date.now();
    try {
        await run(ctx);
        console.log(`ok   ${name} (${Date.now() - t} ms)`);
    } catch (e) {
        failed++;
        console.log(`FAIL ${name}\n     ${e.stack?.split("\n").slice(0, 5).join("\n     ")}\n     daemon: ${daemon.err().slice(-1500)}`);
    } finally {
        daemon.kill("SIGTERM");
        await daemon.exited;
    }
}
process.exit(failed ? 1 : 0);
