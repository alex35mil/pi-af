//! One task per pi process. It owns pi's stdin and stdout, routes responses to the client that asked, broadcasts
//! events, keeps the replay state that neither `get_state` nor `get_entries` contains, and runs the stop sequence.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nix::sys::signal::{Signal, killpg};
use nix::unistd::Pid;
use serde_json::{Map, Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Notify, mpsc, oneshot};
use tokio::time::{Instant, sleep_until};

use crate::config::Config;
use crate::launch::{self, Env, LaunchError, SessionArg};
use crate::prompts::PromptQueue;
use crate::replay::Replay;
use crate::view::{self, Change, StateInput, View};
use crate::wire::{AttachControl, EndReason, LaunchMode, SessionInfo, SessionStatus};

pub type ClientId = u64;
pub type SessionKey = u64;

/// A line for one client: a pi record or a control message.
#[derive(Debug, Clone)]
pub enum Frame {
    Record(Arc<str>),
    Control(Arc<AttachControl>),
}

pub type ClientTx = mpsc::UnboundedSender<Frame>;

/// A native client watching the session view: JSON lines (snapshot, changes, replies).
pub type WatchTx = mpsc::UnboundedSender<Arc<str>>;

/// Where a watcher resumes from.
#[derive(Debug, Clone, Copy)]
pub enum WatchFrom {
    /// A snapshot of the newest `limit` items.
    Snapshot { limit: usize },
    /// The changes after `seq`, or a snapshot when they're no longer kept.
    Seq { seq: u64, limit: usize },
}

/// A command from a native client, turned into pi RPC by the session task.
#[derive(Debug, Clone)]
pub enum ViewCommand {
    /// `message` is the client's id for this message; see [`Sent`].
    Send {
        message: String,
        text: String,
        mode: SendMode,
    },
    Abort,
    Answer {
        request_id: String,
        answer: Value,
    },
}

#[derive(Debug, Clone, Copy)]
pub enum SendMode {
    /// A prompt when idle; queued as a follow-up when a run is active.
    Prompt,
    Steer,
    FollowUp,
}

/// A reply to a native client's request.
pub type ViewReply = oneshot::Sender<Result<Value, String>>;

/// A client command that was forwarded to pi and hasn't been answered.
#[derive(Debug, Clone)]
pub struct Outstanding {
    pub original_id: Option<Value>,
    pub command: String,
}

/// The commands piton itself sends to pi.
#[derive(Debug, Clone)]
pub enum Internal {
    /// The session's identity (id, file, name, model): at launch and after the conversation changes.
    GetState,
    /// The conversation, to (re)build the session view.
    GetEntries,
    /// A first prompt (`piton start --prompt`, `session.start {prompt}`).
    Prompt { text: String },
}

impl Internal {
    /// pi's name for the command, as in its responses.
    fn kind(&self) -> &'static str {
        match self {
            Internal::GetState => "get_state",
            Internal::GetEntries => "get_entries",
            Internal::Prompt { .. } => "prompt",
        }
    }

    fn rpc(&self, id: String) -> Value {
        match self {
            Internal::GetState | Internal::GetEntries => json!({"id": id, "type": self.kind()}),
            Internal::Prompt { text } => json!({"id": id, "type": self.kind(), "message": text}),
        }
    }
}

pub enum SessionCmd {
    Attach {
        client: ClientId,
        tx: ClientTx,
        done: oneshot::Sender<()>,
    },
    Detach {
        client: ClientId,
        done: oneshot::Sender<Vec<Outstanding>>,
    },
    FromClient {
        client: ClientId,
        command: Map<String, Value>,
    },
    /// A command from piton itself; its response only updates the session's own state.
    Internal(Internal),
    Watch {
        watcher: ClientId,
        tx: WatchTx,
        from: WatchFrom,
    },
    Unwatch {
        watcher: ClientId,
    },
    History {
        before: view::ItemId,
        limit: usize,
        reply: ViewReply,
    },
    ToolOutput {
        call_id: String,
        reply: ViewReply,
    },
    Image {
        image: view::ImageId,
        reply: ViewReply,
    },
    View {
        watcher: ClientId,
        command: ViewCommand,
        reply: ViewReply,
    },
    Stop {
        reason: StopReason,
        done: Option<oneshot::Sender<StopOutcome>>,
    },
}

#[derive(Debug, Clone, Copy)]
pub enum StopReason {
    /// `piton stop`, or an empty pi without clients.
    Requested,
    DaemonShutdown,
}

#[derive(Debug, Clone, Copy)]
pub struct StopOutcome {
    pub forced: bool,
}

/// What other tasks may read about a session without asking it.
#[derive(Debug, Clone)]
pub struct Shared {
    pub key: SessionKey,
    pub workspace: PathBuf,
    pub checkout: crate::wire::Checkout,
    pub mode: LaunchMode,
    pub id: Option<String>,
    pub file: Option<String>,
    pub status: SessionStatus,
    pub clients: usize,
    pub pid: Option<u32>,
    pub has_messages: bool,
    pub title: Option<String>,
}

impl Shared {
    pub fn info(&self) -> SessionInfo {
        SessionInfo {
            key: self.key,
            id: self.id.clone(),
            file: self.file.clone(),
            workspace: self.workspace.clone(),
            checkout: self.checkout.clone(),
            mode: self.mode,
            status: self.status,
            clients: self.clients,
            pid: self.pid,
            title: self.title.clone(),
        }
    }
}

#[derive(Clone)]
pub struct SessionHandle {
    pub key: SessionKey,
    pub tx: mpsc::UnboundedSender<SessionCmd>,
    pub shared: Arc<Mutex<Shared>>,
}

impl SessionHandle {
    pub fn snapshot(&self) -> Shared {
        lock(&self.shared).clone()
    }

    pub async fn attach(&self, client: ClientId, tx: ClientTx) -> bool {
        let (done, wait) = oneshot::channel();
        if self.tx.send(SessionCmd::Attach { client, tx, done }).is_err() {
            return false;
        }
        wait.await.is_ok()
    }

    pub async fn detach(&self, client: ClientId) -> Vec<Outstanding> {
        let (done, wait) = oneshot::channel();
        if self.tx.send(SessionCmd::Detach { client, done }).is_err() {
            return Vec::new();
        }
        wait.await.unwrap_or_default()
    }

    pub async fn stop(&self, reason: StopReason) -> Option<StopOutcome> {
        let (done, wait) = oneshot::channel();
        self.tx
            .send(SessionCmd::Stop {
                reason,
                done: Some(done),
            })
            .ok()?;
        wait.await.ok()
    }
}

pub fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Called by a session task when it ends, and when its status changes.
pub struct Hooks {
    pub ended: Box<dyn Fn(SessionKey) + Send + Sync>,
    pub status_changed: Arc<Notify>,
    /// Wakes view connections to re-send the session list (they skip unchanged lists).
    pub list_changed: tokio::sync::broadcast::Sender<()>,
}

pub struct LaunchSpec {
    pub key: SessionKey,
    pub workspace: crate::project::Workspace,
    pub mode: LaunchMode,
    pub session: SessionArg,
    pub env: Env,
}

pub fn spawn(config: Arc<Config>, spec: LaunchSpec, hooks: Hooks) -> Result<SessionHandle, LaunchError> {
    let profile = match spec.mode {
        LaunchMode::Sandbox => launch::overlay_profile(&spec.workspace, spec.key)?,
        LaunchMode::Host => None,
    };
    let argv = launch::command_line(
        &config,
        spec.mode,
        &spec.workspace,
        &spec.session,
        profile.as_ref().map(launch::ProfileFile::path),
    );
    // Argument values can contain provider credentials; only structural metadata belongs in persistent logs.
    crate::debug!(
        "session {}: launching {:?} with {} arguments",
        spec.key,
        spec.mode,
        argv.len()
    );
    let (program, args) = argv.split_first().expect("command line is never empty");
    // Look the program up in pi's PATH: under launchd the daemon's own PATH doesn't have nono or pi.
    let program = &launch::resolve_program(program, &spec.env);
    let mut child = Command::new(program)
        .args(args)
        .current_dir(&spec.workspace.path)
        .env_clear()
        .envs(&spec.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|source| LaunchError::Spawn {
            program: program.clone(),
            source,
        })?;

    let checkout = match &spec.workspace.relation {
        crate::project::Relation::Source => crate::wire::Checkout::Source,
        crate::project::Relation::Worker { source, name } => crate::wire::Checkout::Worker {
            source: source.clone(),
            name: name.clone(),
        },
    };
    let shared = Arc::new(Mutex::new(Shared {
        key: spec.key,
        checkout,
        workspace: spec.workspace.path,
        mode: spec.mode,
        id: None,
        file: match &spec.session {
            SessionArg::New => None,
            SessionArg::Resume(file) => Some(file.to_string_lossy().into_owned()),
        },
        status: SessionStatus::Idle,
        clients: 0,
        pid: child.id(),
        has_messages: matches!(spec.session, SessionArg::Resume(_)),
        title: None,
    }));
    let (tx, rx) = mpsc::unbounded_channel();
    let handle = SessionHandle {
        key: spec.key,
        tx,
        shared: shared.clone(),
    };

    let stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    let (pi_tx, mut pi_rx) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(line) = pi_rx.recv().await {
            if stdin.write_all(line.as_bytes()).await.is_err() || stdin.write_all(b"\n").await.is_err() {
                break;
            }
        }
        // Dropping stdin closes it: pi's orderly-shutdown signal.
    });

    let task = SessionTask {
        config,
        _profile: profile,
        shared,
        hooks,
        pi_tx: Some(pi_tx),
        clients: BTreeMap::new(),
        pending: HashMap::new(),
        next_internal: 0,
        replay: Replay::default(),
        stderr_tail: Vec::new(),
        writer: None,
        stopping: None,
        stop_waiters: Vec::new(),
        empty_deadline: None,
        pgid: child.id().map(|pid| Pid::from_raw(pid as i32)),
        view: View::new(spec.key),
        watchers: BTreeMap::new(),
        sent: HashMap::new(),
        sent_order: VecDeque::new(),
        prompts: PromptQueue::default(),
    };
    tokio::spawn(task.run(
        child,
        rx,
        BufReader::new(stdout).lines(),
        BufReader::new(stderr).lines(),
    ));

    let _ = handle.tx.send(SessionCmd::Internal(Internal::GetState));
    // Builds the view from the saved conversation (empty for a new session).
    let _ = handle.tx.send(SessionCmd::Internal(Internal::GetEntries));
    Ok(handle)
}

/// A command pi hasn't answered yet, keyed by the id piton sent it with.
enum Pending {
    Client {
        client: ClientId,
        outstanding: Outstanding,
    },
    Internal(Internal),
    View {
        command: String,
        reply: ViewReply,
    },
    /// A native client's message; its replies wait in [`SessionTask::sent`].
    Send {
        command: String,
        message: String,
    },
}

/// A native client's message by its id. A client that lost its connection before the reply sends the message again
/// with the same id; it must reach pi only once.
enum Sent {
    /// Forwarded to pi, no response yet: every send of it gets pi's response.
    Waiting(Vec<ViewReply>),
    /// pi accepted it: a repeat gets the same reply. (A refused message is forgotten, so a repeat tries again.)
    Accepted(Value),
}

/// How many message ids a session remembers for repeats.
const SENT_KEPT: usize = 256;

enum StopPhase {
    /// stdin closed; SIGTERM at the deadline.
    Closing,
    /// SIGTERM sent; SIGKILL at the deadline.
    Terminating,
    Killed,
}

struct SessionTask {
    config: Arc<Config>,
    /// The sandbox overlay pi was launched with; a combined one is removed when the session ends.
    _profile: Option<launch::ProfileFile>,
    shared: Arc<Mutex<Shared>>,
    hooks: Hooks,
    pi_tx: Option<mpsc::UnboundedSender<String>>,
    clients: BTreeMap<ClientId, ClientTx>,
    pending: HashMap<String, Pending>,
    next_internal: u64,
    replay: Replay,
    stderr_tail: Vec<String>,
    writer: Option<ClientId>,
    stopping: Option<(StopPhase, Instant)>,
    stop_waiters: Vec<oneshot::Sender<StopOutcome>>,
    empty_deadline: Option<Instant>,
    pgid: Option<Pid>,
    view: View,
    watchers: BTreeMap<ClientId, Watcher>,
    /// Native clients' messages by id, oldest first in `sent_order`.
    sent: HashMap<String, Sent>,
    sent_order: VecDeque<String>,
    /// pi gets one `prompt` at a time; see [`PromptQueue`].
    prompts: PromptQueue,
}

struct Watcher {
    tx: WatchTx,
    limit: usize,
    /// Waiting for the rebuild to finish before getting a snapshot.
    awaiting_snapshot: bool,
}

const STDERR_TAIL: usize = 20;

impl SessionTask {
    async fn run(
        mut self,
        mut child: Child,
        mut rx: mpsc::UnboundedReceiver<SessionCmd>,
        mut stdout: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
        mut stderr: tokio::io::Lines<BufReader<tokio::process::ChildStderr>>,
    ) {
        let mut stdout_open = true;
        let mut stderr_open = true;
        let mut end_reason = EndReason::PiExited;
        loop {
            let stop_deadline = self.stopping.as_ref().map(|(_, at)| *at);
            tokio::select! {
                line = stdout.next_line(), if stdout_open => match line {
                    Ok(Some(line)) => self.on_pi_line(line),
                    Ok(None) | Err(_) => stdout_open = false,
                },
                line = stderr.next_line(), if stderr_open => match line {
                    Ok(Some(line)) => {
                        self.stderr_tail.push(line);
                        if self.stderr_tail.len() > STDERR_TAIL {
                            self.stderr_tail.remove(0);
                        }
                    }
                    Ok(None) | Err(_) => stderr_open = false,
                },
                cmd = rx.recv() => match cmd {
                    Some(SessionCmd::Stop { reason, done }) => {
                        if let StopReason::DaemonShutdown = reason {
                            end_reason = EndReason::DaemonShutdown;
                        }
                        self.begin_stop(done);
                    }
                    Some(cmd) => self.on_cmd(cmd),
                    // Every handle is gone: nothing can reach this session any more.
                    None => self.begin_stop(None),
                },
                _ = child.wait(), if !stdout_open => break,
                _ = sleep_until(stop_deadline.unwrap_or_else(Instant::now)), if stop_deadline.is_some() => {
                    self.advance_stop();
                }
                _ = sleep_until(self.empty_deadline.unwrap_or_else(Instant::now)), if self.empty_deadline.is_some() => {
                    self.empty_deadline = None;
                    if self.is_empty_and_unused() {
                        crate::log!("session {}: stopping empty pi without clients", lock(&self.shared).key);
                        self.begin_stop(None);
                    }
                }
            }
        }
        // Drain the rest of stderr for the report.
        while let Ok(Some(line)) = stderr.next_line().await {
            self.stderr_tail.push(line);
        }
        let keep = self.stderr_tail.len().saturating_sub(STDERR_TAIL);
        self.stderr_tail.drain(..keep);

        let forced = matches!(self.stopping, Some((StopPhase::Terminating | StopPhase::Killed, _)));
        let stderr_lines = match end_reason {
            EndReason::PiExited => self.stderr_tail.clone(),
            EndReason::DaemonShutdown => Vec::new(),
        };
        let end = Frame::Control(Arc::new(AttachControl::End {
            reason: end_reason,
            stderr: stderr_lines,
        }));
        for tx in self.clients.values() {
            let _ = tx.send(end.clone());
        }
        for waiter in self.stop_waiters.drain(..) {
            let _ = waiter.send(StopOutcome { forced });
        }
        let key = lock(&self.shared).key;
        let exit = match child.try_wait() {
            Ok(Some(status)) => status.to_string(),
            Ok(None) | Err(_) => "unknown status".into(),
        };
        let requested = match self.stopping {
            Some(_) => "stopped",
            None => "pi exited on its own",
        };
        crate::log!(
            "session {key}: ended ({requested}, {exit}{}), {} client(s) told {end_reason:?}",
            if forced { ", force-stopped" } else { "" },
            self.clients.len()
        );
        if self.stopping.is_none() || forced {
            // pi's stderr is forwarded to attached clients above, not persisted: extensions/providers may print secrets.
            crate::log!(
                "session {key}: {} stderr lines withheld from persistent logging",
                self.stderr_tail.len()
            );
        }
        (self.hooks.ended)(key);
        self.hooks.status_changed.notify_one();
    }

    fn on_cmd(&mut self, cmd: SessionCmd) {
        match cmd {
            SessionCmd::Attach { client, tx, done } => {
                for line in self.replay.frames() {
                    let _ = tx.send(Frame::Record(line));
                }
                self.clients.insert(client, tx);
                self.empty_deadline = None;
                self.sync_shared();
                let _ = done.send(());
            }
            SessionCmd::Detach { client, done } => {
                self.clients.remove(&client);
                let mut outstanding = Vec::new();
                self.pending.retain(|_, p| match p {
                    Pending::Client {
                        client: c,
                        outstanding: o,
                    } if *c == client => {
                        outstanding.push(o.clone());
                        false
                    }
                    // A view command's reply belongs to a watcher, not an rpc client.
                    Pending::Client { .. } | Pending::Internal(_) | Pending::View { .. } | Pending::Send { .. } => true,
                });
                if self.writer == Some(client) {
                    self.writer = None;
                }
                self.sync_shared();
                self.arm_empty_timer();
                let _ = done.send(outstanding);
            }
            SessionCmd::FromClient { client, command } => self.handle_client_command(client, command),
            SessionCmd::Internal(command) => self.internal(command),
            SessionCmd::Watch { watcher, tx, from } => self.watch(watcher, tx, from),
            SessionCmd::Unwatch { watcher } => {
                self.watchers.remove(&watcher);
                self.sync_shared();
                self.arm_empty_timer();
            }
            SessionCmd::History { before, limit, reply } => {
                let _ = reply.send(Ok(self.view.history(before, limit)));
            }
            SessionCmd::ToolOutput { call_id, reply } => {
                let _ = reply.send(
                    self.view
                        .tool_output(&call_id)
                        .cloned()
                        .ok_or_else(|| format!("no output for tool call {call_id}")),
                );
            }
            SessionCmd::Image { image, reply } => {
                let _ = reply.send(
                    self.view
                        .image(image)
                        .map(|i| serde_json::json!(i))
                        .ok_or_else(|| format!("no image {image}")),
                );
            }
            SessionCmd::View {
                watcher,
                command,
                reply,
            } => self.view_command(watcher, command, reply),
            SessionCmd::Stop { .. } => unreachable!("handled in run"),
        }
    }

    fn watch(&mut self, watcher: ClientId, tx: WatchTx, from: WatchFrom) {
        let limit = match from {
            WatchFrom::Snapshot { limit } | WatchFrom::Seq { limit, .. } => limit,
        };
        let resumed = match from {
            WatchFrom::Seq { seq, .. } if !self.view.reset_pending() => self.view.changes_since(seq),
            WatchFrom::Seq { .. } | WatchFrom::Snapshot { .. } => None,
        };
        let awaiting_snapshot = match resumed {
            Some(lines) => {
                for line in lines {
                    let _ = tx.send(line);
                }
                false
            }
            None if self.view.reset_pending() => {
                crate::log!(
                    "session {}: watcher {watcher} waits for the view rebuild to finish",
                    lock(&self.shared).key
                );
                true
            }
            None => {
                let _ = tx.send(self.view.snapshot(limit).to_string().into());
                false
            }
        };
        self.watchers.insert(
            watcher,
            Watcher {
                tx,
                limit,
                awaiting_snapshot,
            },
        );
        self.empty_deadline = None;
        self.sync_shared();
    }

    fn send_waiting_snapshots(&mut self) {
        for w in self.watchers.values_mut().filter(|w| w.awaiting_snapshot) {
            let _ = w.tx.send(self.view.snapshot(w.limit).to_string().into());
            w.awaiting_snapshot = false;
        }
    }

    /// Sends committed view changes to every watcher that has its snapshot.
    fn broadcast(&mut self, changes: Vec<Change>) {
        for change in changes {
            let committed = self.view.commit(change);
            for w in self.watchers.values() {
                if !w.awaiting_snapshot {
                    let _ = w.tx.send(committed.line.clone());
                }
            }
            if committed.reset {
                // After a reset every watcher needs a new snapshot.
                for w in self.watchers.values_mut() {
                    let _ = w.tx.send(self.view.snapshot(w.limit).to_string().into());
                    w.awaiting_snapshot = false;
                }
            }
        }
    }

    fn publish_view_state(&mut self) {
        let dialogs: Vec<Value> = self
            .replay
            .pending_dialogs()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();
        let input = {
            let shared = lock(&self.shared);
            StateInput {
                status: shared.status,
                workspace: shared.workspace.clone(),
                mode: shared.mode,
                session_id: shared.id.clone(),
                session_file: shared.file.clone(),
                dialogs,
            }
        };
        if let Some(change) = self.view.publish_state(input) {
            lock(&self.shared).title = self.view.title();
            // The id, file, or title may have changed.
            let _ = self.hooks.list_changed.send(());
            self.broadcast(vec![change]);
        }
    }

    /// A native client's command: steering commands make it the writer, like pi RPC from an rpc client.
    fn view_command(&mut self, watcher: ClientId, command: ViewCommand, reply: ViewReply) {
        let (rpc, pending) = match command {
            ViewCommand::Send { message, text, mode } => {
                match self.sent.get_mut(&message) {
                    Some(Sent::Waiting(replies)) => {
                        replies.push(reply);
                        return;
                    }
                    Some(Sent::Accepted(data)) => {
                        let _ = reply.send(Ok(data.clone()));
                        return;
                    }
                    None => {}
                }
                // pi decides whether a run is active: it starts a run when idle and applies `streamingBehavior` only
                // during one. The session's status can't decide it: it follows pi's events, which lag behind (a
                // message sent right after another would find the session still idle, and pi would refuse it).
                let behavior = match mode {
                    SendMode::Prompt | SendMode::FollowUp => "followUp",
                    SendMode::Steer => "steer",
                };
                let rpc = json!({"type": "prompt", "message": text, "streamingBehavior": behavior});
                self.remember_sent(message.clone(), Sent::Waiting(vec![reply]));
                let command = command_type(rpc.as_object().expect("an object"));
                (rpc, Pending::Send { command, message })
            }
            ViewCommand::Abort => {
                let rpc = json!({"type": "abort"});
                let command = command_type(rpc.as_object().expect("an object"));
                (rpc, Pending::View { command, reply })
            }
            ViewCommand::Answer { request_id, answer } => {
                let mut response = match answer {
                    Value::Object(map) => map,
                    Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) | Value::Array(_) => {
                        let _ = reply.send(Err("answer must be an object".into()));
                        return;
                    }
                };
                response.insert("type".into(), json!("extension_ui_response"));
                response.insert("id".into(), json!(request_id));
                let answered = self.replay.has_dialog(&request_id);
                self.handle_client_command(watcher, response);
                let _ = reply.send(match answered {
                    true => Ok(json!({})),
                    false => Err("that question was already answered or expired".into()),
                });
                self.publish_view_state();
                return;
            }
        };
        let Value::Object(mut command) = rpc else { return };
        self.next_internal += 1;
        let id = format!("piton:v{watcher}:{}", self.next_internal);
        self.writer = Some(watcher);
        command.insert("id".into(), Value::String(id.clone()));
        self.pending.insert(id, pending);
        self.send_to_pi(&Value::Object(command));
    }

    fn remember_sent(&mut self, message: String, sent: Sent) {
        if self.sent.insert(message.clone(), sent).is_none() {
            self.sent_order.push_back(message);
        }
        while self.sent_order.len() > SENT_KEPT {
            if let Some(oldest) = self.sent_order.pop_front() {
                self.sent.remove(&oldest);
            }
        }
    }

    /// pi answered a native client's message: reply to every send of it, and remember an accepted one for repeats.
    fn answer_sent(&mut self, message: &str, result: Result<Value, String>) {
        let waiting = match self.sent.remove(message) {
            Some(Sent::Waiting(replies)) => replies,
            Some(Sent::Accepted(_)) | None => Vec::new(),
        };
        for reply in waiting {
            let _ = reply.send(result.clone());
        }
        match result {
            Ok(data) => {
                self.sent.insert(message.to_string(), Sent::Accepted(data));
            }
            Err(_) => self.sent_order.retain(|m| m != message),
        }
    }

    fn handle_client_command(&mut self, client: ClientId, mut command: Map<String, Value>) {
        let kind = command_type(&command);
        match kind.as_str() {
            "extension_ui_response" => {
                let id = command.get("id").and_then(Value::as_str).map(str::to_string);
                let Some(id) = id else { return };
                if !self.replay.answer_dialog(&id) {
                    // Already answered by another client, expired, or unknown: pi would ignore it.
                    return;
                }
                self.writer = Some(client);
                self.sync_shared();
                self.send_to_pi(&Value::Object(command));
                return;
            }
            "prompt" | "steer" | "follow_up" | "abort" | "bash" => self.writer = Some(client),
            _ => {}
        }
        self.next_internal += 1;
        let id = format!("piton:c{client}:{}", self.next_internal);
        let original_id = command.insert("id".into(), Value::String(id.clone()));
        self.pending.insert(
            id,
            Pending::Client {
                client,
                outstanding: Outstanding {
                    original_id,
                    command: kind,
                },
            },
        );
        self.send_to_pi(&Value::Object(command));
    }

    /// Writes a command to pi. A `prompt` waits until pi answered the one before it ([`PromptQueue`]).
    fn send_to_pi(&mut self, value: &Value) {
        let prompt_id = match (
            value.get("type").and_then(Value::as_str),
            value.get("id").and_then(Value::as_str),
        ) {
            (Some("prompt"), Some(id)) => Some(id.to_string()),
            (Some(_) | None, Some(_) | None) => None,
        };
        match prompt_id {
            Some(id) => {
                if let Some(prompt) = self.prompts.submit(id, value.clone()) {
                    self.write_to_pi(&prompt);
                }
            }
            None => self.write_to_pi(value),
        }
    }

    fn write_to_pi(&mut self, value: &Value) {
        if let Some(tx) = &self.pi_tx {
            let _ = tx.send(value.to_string());
        }
    }

    fn on_pi_line(&mut self, line: String) {
        let Ok(Value::Object(record)) = serde_json::from_str::<Value>(&line) else {
            return;
        };
        let kind = record
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if kind == "response" || kind == "bash_execution_update" {
            self.route_response(kind == "response", record);
            return;
        }
        let line: Arc<str> = line.into();
        self.track(&kind, &record, &line);
        for tx in self.clients.values() {
            let _ = tx.send(Frame::Record(line.clone()));
        }
        let changes = self.view.apply(&kind, &record);
        self.broadcast(changes);
        if kind == "compaction_end" && record.get("result").is_some() {
            // The conversation was rewritten: rebuild the view from entries.
            self.internal(Internal::GetEntries);
        }
        self.publish_view_state();
    }

    fn internal(&mut self, command: Internal) {
        match command {
            Internal::GetEntries => self.view.begin_reset(),
            Internal::GetState | Internal::Prompt { .. } => {}
        }
        self.next_internal += 1;
        let id = format!("piton:i:{}", self.next_internal);
        let rpc = command.rpc(id.clone());
        self.pending.insert(id, Pending::Internal(command));
        self.send_to_pi(&rpc);
    }

    /// pi's temporary state now, as records for the view's rebuild: the in-progress message and running tools.
    fn live_records(&self) -> Vec<Map<String, Value>> {
        self.replay
            .live_lines()
            .into_iter()
            .filter_map(|l| match serde_json::from_str::<Value>(&l) {
                Ok(Value::Object(map)) => Some(map),
                Ok(_) | Err(_) => None,
            })
            .collect()
    }

    fn route_response(&mut self, is_response: bool, mut record: Map<String, Value>) {
        let Some(id) = record.get("id").and_then(Value::as_str).map(str::to_string) else {
            return;
        };
        if is_response && let Some(next) = self.prompts.answered(&id) {
            self.write_to_pi(&next);
        }
        let pending = if is_response { self.pending.remove(&id) } else { None };
        let route = match pending {
            Some(p) => Some(p),
            // `bash_execution_update` repeats the command id while the command is still pending.
            None if !is_response => self.pending.get(&id).and_then(|p| match p {
                Pending::Client { client, outstanding } => Some(Pending::Client {
                    client: *client,
                    outstanding: outstanding.clone(),
                }),
                Pending::Internal(command) => Some(Pending::Internal(command.clone())),
                // Native clients don't send `bash`; nothing streams to a view reply.
                Pending::View { .. } | Pending::Send { .. } => None,
            }),
            None => None,
        };
        match route {
            Some(Pending::Client { client, outstanding }) => {
                if is_response {
                    self.after_response(&outstanding.command, &record);
                }
                match outstanding.original_id {
                    Some(original) => record.insert("id".into(), original),
                    None => record.remove("id"),
                };
                if let Some(tx) = self.clients.get(&client) {
                    let _ = tx.send(Frame::Record(Value::Object(record).to_string().into()));
                }
            }
            Some(Pending::Internal(command)) if is_response => self.after_response(command.kind(), &record),
            Some(Pending::View { command, reply }) if is_response => {
                self.after_response(&command, &record);
                let _ = reply.send(view_result(&record));
            }
            Some(Pending::Send { command, message }) if is_response => {
                self.after_response(&command, &record);
                self.answer_sent(&message, view_result(&record));
            }
            Some(Pending::Internal(_) | Pending::View { .. } | Pending::Send { .. }) | None => {}
        }
    }

    /// Keeps the session's id and file current after commands that change the conversation.
    fn after_response(&mut self, command: &str, record: &Map<String, Value>) {
        let success = record.get("success").and_then(Value::as_bool).unwrap_or(false);
        if !success {
            if command == "get_entries" {
                let key = lock(&self.shared).key;
                crate::log!("session {key}: get_entries failed; the view keeps its previous items");
                let changes = self.view.cancel_reset();
                self.broadcast(changes);
                // Watchers that waited for the rebuild get the view as it is, instead of waiting forever.
                self.send_waiting_snapshots();
            }
            return;
        }
        match command {
            "get_state" => {
                if let Some(Value::Object(data)) = record.get("data") {
                    let mut shared = lock(&self.shared);
                    shared.id = data.get("sessionId").and_then(Value::as_str).map(str::to_string);
                    shared.file = data.get("sessionFile").and_then(Value::as_str).map(str::to_string);
                    let count = data.get("messageCount").and_then(Value::as_u64).unwrap_or(0);
                    shared.has_messages = count > 0;
                    drop(shared);
                    self.view.on_state_data(data);
                }
                self.arm_empty_timer();
                self.publish_view_state();
            }
            "get_entries" => {
                if let Some(Value::Object(data)) = record.get("data") {
                    let live = self.live_records();
                    let reset = self.view.finish_reset(data, &live);
                    self.broadcast(vec![reset]);
                    self.publish_view_state();
                }
            }
            "switch_session" | "new_session" | "fork" | "clone" => {
                // The conversation changed: forget the old one's temporary state, ask for the new identity, and
                // rebuild the view.
                self.replay.forget_conversation();
                self.internal(Internal::GetState);
                self.internal(Internal::GetEntries);
            }
            _ => {}
        }
    }

    fn track(&mut self, kind: &str, record: &Map<String, Value>, line: &Arc<str>) {
        self.replay.track(kind, record, line);
        if kind == "message_end" {
            let role = record
                .get("message")
                .and_then(|m| m.get("role"))
                .and_then(Value::as_str);
            if matches!(role, Some("user" | "assistant" | "toolResult")) {
                lock(&self.shared).has_messages = true;
            }
        }
        self.sync_shared();
    }

    fn status(&self) -> SessionStatus {
        if self.stopping.is_some() {
            return SessionStatus::Stopping;
        }
        if self.replay.needs_input() {
            return SessionStatus::NeedsInput;
        }
        if self.replay.working() {
            return SessionStatus::Working;
        }
        SessionStatus::Idle
    }

    fn sync_shared(&mut self) {
        let status = self.status();
        let clients = self.clients.len() + self.watchers.len();
        let (status_changed, list_changed) = {
            let mut shared = lock(&self.shared);
            let status_changed = shared.status != status;
            let list_changed = status_changed || shared.clients != clients;
            shared.status = status;
            shared.clients = clients;
            (status_changed, list_changed)
        };
        if status_changed {
            self.hooks.status_changed.notify_one();
        }
        if list_changed {
            let _ = self.hooks.list_changed.send(());
        }
    }

    fn is_empty_and_unused(&self) -> bool {
        let has_messages = lock(&self.shared).has_messages;
        self.clients.is_empty()
            && self.watchers.is_empty()
            && !has_messages
            && matches!(self.status(), SessionStatus::Idle)
    }

    fn arm_empty_timer(&mut self) {
        if self.stopping.is_none() && self.is_empty_and_unused() && self.empty_deadline.is_none() {
            self.empty_deadline = Some(Instant::now() + Duration::from_millis(self.config.empty_grace_ms));
        }
    }

    fn begin_stop(&mut self, done: Option<oneshot::Sender<StopOutcome>>) {
        self.stop_waiters.extend(done);
        if self.stopping.is_some() {
            return;
        }
        self.pi_tx = None; // closes pi's stdin once the writer drains
        self.stopping = Some((
            StopPhase::Closing,
            Instant::now() + Duration::from_millis(self.config.stop.grace_ms),
        ));
        self.sync_shared();
    }

    fn advance_stop(&mut self) {
        let Some((phase, _)) = &self.stopping else {
            return;
        };
        let key = lock(&self.shared).key;
        match phase {
            StopPhase::Closing => {
                crate::log!("session {key}: pi didn't exit after stdin closed; sending SIGTERM");
                self.signal(Signal::SIGTERM);
                self.stopping = Some((
                    StopPhase::Terminating,
                    Instant::now() + Duration::from_millis(self.config.stop.term_grace_ms),
                ));
            }
            StopPhase::Terminating => {
                crate::log!("session {key}: pi didn't exit after SIGTERM; sending SIGKILL");
                self.signal(Signal::SIGKILL);
                self.stopping = Some((StopPhase::Killed, Instant::now() + Duration::from_secs(3600)));
            }
            StopPhase::Killed => {}
        }
    }

    fn signal(&self, signal: Signal) {
        if let Some(pgid) = self.pgid {
            let _ = killpg(pgid, signal);
        }
    }
}

/// pi's response to a native client's command as the client's reply.
fn view_result(record: &Map<String, Value>) -> Result<Value, String> {
    match record.get("success").and_then(Value::as_bool) {
        Some(true) => Ok(record.get("data").cloned().unwrap_or(json!({}))),
        Some(false) | None => Err(record
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("pi refused the command")
            .to_string()),
    }
}

fn command_type(command: &Map<String, Value>) -> String {
    command
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}
