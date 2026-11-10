// Probes pi RPC behavior that piton's contract relies on. Usage (in daemon/): node tests/probe/probe.mjs <scenario>
// Runs real `pi --mode rpc` with the faux extension in a scratch workspace and agent dir.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const ext = join(root, "tests/fixtures/faux-extension.ts");

export function scratch() {
    const dir = mkdtempSync(join(tmpdir(), "piton-probe-"));
    const ws = join(dir, "ws");
    const agent = join(dir, "agent");
    mkdirSync(ws);
    mkdirSync(agent);
    return { dir, ws, agent };
}

export function startPi({ ws, agent }, args = [], env = {}) {
    const child = spawn("pi", ["--mode", "rpc", "-e", ext, "--model", "faux/faux-1", ...args], {
        cwd: ws,
        env: { ...process.env, PI_CODING_AGENT_DIR: agent, ...env },
        stdio: ["pipe", "pipe", "pipe"],
    });
    const records = [];
    const waiters = [];
    let buf = Buffer.alloc(0);
    child.stdout.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        let nl;
        while ((nl = buf.indexOf(10)) >= 0) {
            const line = buf.subarray(0, nl).toString("utf8");
            buf = buf.subarray(nl + 1);
            if (!line.trim()) continue;
            const rec = JSON.parse(line);
            rec.__t = Date.now();
            records.push(rec);
            for (const w of [...waiters]) if (w.pred(rec)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(rec); }
        }
    });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    const exited = new Promise((r) => child.on("exit", (code, signal) => r({ code, signal })));
    let n = 0;
    return {
        child,
        records,
        exited,
        stderr: () => stderr,
        send(cmd) {
            const id = cmd.id ?? `c${++n}`;
            child.stdin.write(JSON.stringify({ ...cmd, id }) + "\n");
            return id;
        },
        raw(obj) {
            child.stdin.write(JSON.stringify(obj) + "\n");
        },
        wait(pred, ms = 15000) {
            const hit = records.find(pred);
            if (hit) return Promise.resolve(hit);
            return new Promise((res, rej) => {
                const w = { pred, resolve: res };
                waiters.push(w);
                setTimeout(() => rej(new Error("timeout waiting; last: " + JSON.stringify(records.slice(-3).map(short)))), ms);
            });
        },
        async call(cmd) {
            const id = this.send(cmd);
            return this.wait((r) => r.type === "response" && r.id === id);
        },
        close() {
            child.stdin.end();
            return exited;
        },
    };
}

export const short = (r) => {
    const o = { type: r.type };
    if (r.command) o.command = r.command;
    if (r.id) o.id = r.id;
    if (r.message?.role) o.role = r.message.role;
    if (r.assistantMessageEvent) o.ev = r.assistantMessageEvent.type;
    if (r.method) o.method = r.method;
    if (r.toolName) o.tool = r.toolName;
    return o;
};

export function sessionFiles(agent) {
    const out = [];
    const walk = (d) => {
        if (!existsSync(d)) return;
        for (const e of readdirSync(d)) {
            const p = join(d, e);
            if (statSync(p).isDirectory()) walk(p);
            else if (p.endsWith(".jsonl")) out.push(p);
        }
    };
    walk(join(agent, "sessions"));
    return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const scenarios = {
    // When is the session file created? Does get_state report it before any message?
    async "session-file"() {
        const s = scratch();
        const pi = startPi(s);
        const st = await pi.call({ type: "get_state" });
        log("state before prompt:", JSON.stringify({ sessionFile: st.data.sessionFile, sessionId: st.data.sessionId, messageCount: st.data.messageCount }));
        log("file exists before prompt:", existsSync(st.data.sessionFile), sessionFiles(s.agent));
        pi.send({ type: "prompt", message: "hi" });
        await pi.wait((r) => r.type === "agent_settled");
        log("file exists after prompt:", existsSync(st.data.sessionFile), sessionFiles(s.agent));
        const st2 = await pi.call({ type: "get_state" });
        log("messageCount after:", st2.data.messageCount);
        await pi.close();
    },

    // Do user messages produce message_start/end events? Order of response vs events?
    async "events"() {
        const s = scratch();
        const pi = startPi(s);
        await pi.call({ type: "get_state" });
        pi.send({ type: "prompt", message: "hi" });
        await pi.wait((r) => r.type === "agent_settled");
        log(pi.records.map(short).map((x) => JSON.stringify(x)).join("\n"));
        await pi.close();
    },

    // Resume a saved session with --session, and --session-id on an empty session.
    async "resume"() {
        const s = scratch();
        let pi = startPi(s);
        const st = await pi.call({ type: "get_state" });
        pi.send({ type: "prompt", message: "remember me" });
        await pi.wait((r) => r.type === "agent_settled");
        await pi.close();
        pi = startPi(s, ["--session", st.data.sessionFile]);
        const st2 = await pi.call({ type: "get_state" });
        const ent = await pi.call({ type: "get_entries" });
        log("resumed same file:", st2.data.sessionFile === st.data.sessionFile, "id same:", st2.data.sessionId === st.data.sessionId, "messages:", st2.data.messageCount, "entries:", ent.data.entries?.length);
        await pi.close();
        pi = startPi(s, ["--session-id", "fixed-id-123"]);
        const st3 = await pi.call({ type: "get_state" });
        log("--session-id state:", JSON.stringify({ id: st3.data.sessionId, file: st3.data.sessionFile }));
        await pi.close();
    },

    // Dialog with and without a client answer; what a late answer does.
    async "dialog"() {
        const s = scratch();
        const pi = startPi(s);
        await pi.call({ type: "get_state" });
        pi.send({ type: "prompt", message: "ask" });
        const req = await pi.wait((r) => r.type === "extension_ui_request" && r.method === "select");
        log("dialog request:", JSON.stringify({ id: req.id, title: req.title, options: req.options, timeout: req.timeout }));
        const st = await pi.call({ type: "get_state" });
        log("state while waiting:", JSON.stringify({ isStreaming: st.data.isStreaming }));
        pi.raw({ type: "extension_ui_response", id: req.id, value: "beta" });
        pi.raw({ type: "extension_ui_response", id: req.id, value: "alpha" });
        await pi.wait((r) => r.type === "agent_settled");
        const after = pi.records.filter((r) => r.__t >= req.__t).map(short);
        log("after answer:", JSON.stringify(after));
        const errs = pi.records.filter((r) => r.type === "response" && r.success === false);
        log("error responses:", JSON.stringify(errs));
        const last = await pi.call({ type: "get_last_assistant_text" });
        log("last text:", JSON.stringify(last.data));
        await pi.close();
    },

    // Tool execution events and get_entries while a tool runs.
    async "tool"() {
        const s = scratch();
        const pi = startPi(s);
        await pi.call({ type: "get_state" });
        pi.send({ type: "prompt", message: "tool" });
        await pi.wait((r) => r.type === "tool_execution_start");
        const st = await pi.call({ type: "get_state" });
        const ent = await pi.call({ type: "get_entries" });
        log("during tool: isStreaming", st.data.isStreaming, "entry types:", JSON.stringify(ent.data.entries.map((e) => e.type + ":" + (e.message?.role ?? ""))));
        await pi.wait((r) => r.type === "agent_settled");
        log(JSON.stringify(pi.records.filter((r) => r.type.startsWith("tool_")).map((r) => ({ type: r.type, id: r.toolCallId, keys: Object.keys(r) }))));
        await pi.close();
    },

    // Streaming state: get_state/get_entries mid-message; steer and follow-up while streaming.
    async "streaming"() {
        const s = scratch();
        const pi = startPi(s, [], { PITON_FAUX_TPS: "20" });
        await pi.call({ type: "get_state" });
        pi.send({ type: "prompt", message: "slow 40" });
        await pi.wait((r) => r.assistantMessageEvent?.type === "text_delta");
        const st = await pi.call({ type: "get_state" });
        const ent = await pi.call({ type: "get_entries" });
        log("mid-stream: isStreaming", st.data.isStreaming, "messageCount", st.data.messageCount, "entries roles:", JSON.stringify(ent.data.entries.map((e) => e.message?.role ?? e.type)));
        const fu = await pi.call({ type: "prompt", message: "after that", streamingBehavior: "followUp" });
        log("prompt while streaming:", JSON.stringify(fu));
        await pi.wait((r) => r.type === "queue_update");
        log("queue_update:", JSON.stringify(pi.records.find((r) => r.type === "queue_update")));
        await pi.wait((r) => r.type === "agent_settled", 30000);
        await pi.close();
    },

    // Prompts sent back to back: does pi refuse a plain prompt while a run starts? What timestamps do queued
    // follow-ups get?
    async "queued"() {
        const s = scratch();
        const pi = startPi(s, [], { PITON_FAUX_TPS: "40" });
        await pi.call({ type: "get_state" });
        const first = pi.send({ type: "prompt", message: "slow 10" });
        const plain = pi.send({ type: "prompt", message: "plain" });
        const second = pi.send({ type: "prompt", message: "second", streamingBehavior: "followUp" });
        const third = pi.send({ type: "prompt", message: "third", streamingBehavior: "followUp" });
        await pi.wait((r) => r.type === "agent_settled", 30000);
        // Once idle, a prompt with streamingBehavior starts a run (the behavior applies only during one).
        const idle = pi.send({ type: "prompt", message: "idle", streamingBehavior: "followUp" });
        await pi.wait((r) => r.type === "agent_settled" && pi.records.filter((x) => x.type === "agent_settled").length === 2);
        for (const [name, id] of Object.entries({ first, plain, second, third, idle })) {
            const r = pi.records.find((x) => x.type === "response" && x.id === id);
            log(name, "->", JSON.stringify({ success: r.success, data: r.data, error: r.error }));
        }
        const users = pi.records.filter((r) => r.type === "message_end" && r.message.role === "user");
        log("user messages:", JSON.stringify(users.map((r) => [r.message.content[0].text, r.message.timestamp])));
        await pi.close();
    },

    // Compaction: its events, and get_entries after it.
    async "compaction"() {
        const s = scratch();
        // Keep almost nothing, so three short exchanges are enough to compact.
        writeFileSync(join(s.agent, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
        const pi = startPi(s);
        await pi.call({ type: "get_state" });
        for (const m of ["one", "two", "three"]) {
            pi.send({ type: "prompt", message: m });
            await pi.wait((r) => r.type === "agent_settled" && !r.__seen && (r.__seen = true));
        }
        const from = pi.records.length;
        const res = await pi.call({ type: "compact" });
        log("compact response:", JSON.stringify({ success: res.success, error: res.error, keys: Object.keys(res.data ?? {}) }));
        log("events:", JSON.stringify(pi.records.slice(from).filter((r) => r.type !== "response").map((r) => ({ type: r.type, keys: Object.keys(r).filter((k) => k !== "__t") }))));
        const end = pi.records.slice(from).find((r) => r.type === "compaction_end");
        log("compaction_end:", JSON.stringify({ aborted: end?.aborted, error: end?.errorMessage, result: end?.result && Object.keys(end.result) }));
        const ent = await pi.call({ type: "get_entries" });
        log("entries after:", JSON.stringify(ent.data.entries.map((e) => e.type + (e.message ? ":" + e.message.role : ""))));
        await pi.close();
    },

    // setStatus / setWidget records from an extension, and how clearing looks.
    async "status"() {
        const s = scratch();
        const pi = startPi(s);
        await pi.call({ type: "get_state" });
        pi.send({ type: "prompt", message: "status" });
        await pi.wait((r) => r.type === "agent_settled");
        pi.send({ type: "prompt", message: "status clear" });
        await pi.wait((r) => r.type === "agent_settled" && pi.records.filter((x) => x.type === "agent_settled").length === 2);
        const ui = pi.records.filter((r) => r.type === "extension_ui_request").map(({ __t, ...r }) => r);
        log(JSON.stringify(ui, null, 1));
        await pi.close();
    },

    // switch_session while a run streams: the response, what happens to the run, and the events after.
    async "switch-streaming"() {
        const s = scratch();
        let pi = startPi(s);
        const saved = await pi.call({ type: "get_state" });
        pi.send({ type: "prompt", message: "saved one" });
        await pi.wait((r) => r.type === "agent_settled");
        await pi.close();
        pi = startPi(s, [], { PITON_FAUX_TPS: "20" });
        await pi.call({ type: "get_state" });
        pi.send({ type: "prompt", message: "slow 100" });
        await pi.wait((r) => r.assistantMessageEvent?.type === "text_delta");
        const from = pi.records.length;
        const res = await pi.call({ type: "switch_session", sessionPath: saved.data.sessionFile });
        log("switch response:", JSON.stringify({ success: res.success, data: res.data, error: res.error }));
        const ended = pi.records.slice(from).find((r) => r.type === "message_end");
        log("interrupted message:", JSON.stringify({ stopReason: ended?.message.stopReason, chars: JSON.stringify(ended?.message.content).length }));
        await sleep(1500);
        log("after:", JSON.stringify(pi.records.slice(from).filter((r) => r.type !== "message_update").map(short)));
        const st = await pi.call({ type: "get_state" });
        log("state:", JSON.stringify({ file: st.data.sessionFile === saved.data.sessionFile, isStreaming: st.data.isStreaming, messageCount: st.data.messageCount }));
        await pi.close();
    },

    // pi killed mid-run (SIGKILL): what the session file holds, and what a resume sees.
    async "killed"() {
        const s = scratch();
        let pi = startPi(s, [], { PITON_FAUX_TPS: "20" });
        const st = await pi.call({ type: "get_state" });
        pi.send({ type: "prompt", message: "before" });
        await pi.wait((r) => r.type === "agent_settled");
        pi.send({ type: "prompt", message: "slow 200" });
        await pi.wait((r) => r.assistantMessageEvent?.type === "text_delta");
        pi.child.kill("SIGKILL");
        log("exit:", JSON.stringify(await pi.exited));
        pi = startPi(s, ["--session", st.data.sessionFile]);
        const ent = await pi.call({ type: "get_entries" });
        log("entries after resume:", JSON.stringify(ent.data.entries.filter((e) => e.message).map((e) => [e.message.role, JSON.stringify(e.message.content).slice(0, 40)])));
        pi.send({ type: "prompt", message: "after" });
        await pi.wait((r) => r.type === "agent_settled");
        const ent2 = await pi.call({ type: "get_entries" });
        log("entries after a new prompt:", JSON.stringify(ent2.data.entries.filter((e) => e.message).map((e) => e.message.role)), "leaf parent chain ok:", ent2.data.leafId != null);
        await pi.close();
    },

    // Stop behavior: stdin close while idle and while streaming; timing.
    async "stop"() {
        for (const busy of [false, true]) {
            const s = scratch();
            const pi = startPi(s, [], { PITON_FAUX_TPS: "20" });
            await pi.call({ type: "get_state" });
            if (busy) {
                pi.send({ type: "prompt", message: "slow 200" });
                await pi.wait((r) => r.assistantMessageEvent?.type === "text_delta");
            }
            const t = Date.now();
            const res = await pi.close();
            log(busy ? "busy" : "idle", "stdin close ->", JSON.stringify(res), Date.now() - t, "ms; tail:", JSON.stringify(pi.records.slice(-2).map(short)));
        }
    },
};

const name = process.argv[2];
if (!scenarios[name]) {
    console.error("scenarios:", Object.keys(scenarios).join(", "));
    process.exit(2);
}
await scenarios[name]();
