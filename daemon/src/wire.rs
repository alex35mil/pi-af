//! Messages between the daemon and its local clients (`piton attach`, the CLI) over the Unix socket.
//!
//! Every connection starts with one [`Hello`] line. After an `rpc` hello the client sends raw pi RPC lines and the
//! daemon sends tagged frames: `r<pi record>` or `c<AttachControl>`, one per line, so control messages never mix with
//! pi records on `piton attach`'s stdout. After a `control` hello the client sends one [`ControlRequest`] line and gets
//! one [`ControlResponse`] line.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;

pub const FRAME_RECORD: u8 = b'r';
pub const FRAME_CONTROL: u8 = b'c';

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "protocol", rename_all = "snake_case")]
pub enum Hello {
    /// Raw pi RPC for one session; a new pi is launched in `workspace`.
    Rpc {
        version: u32,
        workspace: PathBuf,
        #[serde(default)]
        client: Option<String>,
    },
    /// One control request and its response.
    Control { version: u32 },
    /// The native clients' protocol: requests with ids, replies, and pushed session-list and session-view updates.
    /// See [`ViewRequest`].
    View {
        version: u32,
        #[serde(default)]
        client: Option<String>,
    },
}

/// A request on a `view` connection. Replies echo `id`: `{"type":"reply","id":..,"ok":true,"data":..}` or
/// `{"type":"reply","id":..,"ok":false,"error":..}`. Pushed lines have no id: `sessions` (the session list, after
/// `sessions.subscribe` and on every change), `snapshot`, `change`, and `history` (see view.rs).
#[derive(Debug, Deserialize)]
pub struct ViewEnvelope {
    pub id: serde_json::Value,
    #[serde(flatten)]
    pub request: ViewRequest,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ViewRequest {
    #[serde(rename = "sessions.list")]
    SessionsList,
    /// Daemon-wide state (keep-awake). Also pushed as `daemon` lines after `sessions.subscribe`, on change.
    #[serde(rename = "daemon.state")]
    DaemonState,
    /// Turn keep-awake on or off until the daemon restarts (the config's `keep_awake` is the default).
    #[serde(rename = "daemon.keep_awake")]
    DaemonKeepAwake { on: bool },
    /// Switch host logging until the policy expires or the daemon restarts (the config's `[logging] mode` is the
    /// default).
    #[serde(rename = "daemon.logging")]
    DaemonLogging { policy: crate::diagnostics::Policy },
    /// Push the session list now and whenever it changes.
    #[serde(rename = "sessions.subscribe")]
    SessionsSubscribe,
    /// The direct children of `path` under the configured roots (the roots when omitted): groups and checkouts.
    #[serde(rename = "workspaces.browse")]
    WorkspacesBrowse {
        #[serde(default)]
        path: Option<PathBuf>,
    },
    /// Start a session in a checkout under the configured roots.
    #[serde(rename = "session.start")]
    SessionStart {
        workspace: PathBuf,
        #[serde(default)]
        mode: Option<LaunchMode>,
        #[serde(default)]
        prompt: Option<String>,
    },
    #[serde(rename = "session.stop")]
    SessionStop { session: u64 },
    /// Watch one session: a snapshot (or the changes since `from`), then every change. One watch per session per
    /// connection; watching again replaces it.
    #[serde(rename = "session.watch")]
    SessionWatch {
        session: u64,
        #[serde(default)]
        from: Option<u64>,
        #[serde(default)]
        limit: Option<usize>,
    },
    #[serde(rename = "session.unwatch")]
    SessionUnwatch { session: u64 },
    #[serde(rename = "session.history")]
    SessionHistory {
        session: u64,
        before: u64,
        #[serde(default)]
        limit: Option<usize>,
    },
    #[serde(rename = "session.tool_output")]
    SessionToolOutput { session: u64, call_id: String },
    /// One image's data, by the id in its reference block (items and tool outputs never carry image data).
    #[serde(rename = "session.image")]
    SessionImage { session: u64, image: u64 },
    /// Send a message. `message_id` is the client's id for it: a send repeated with the same id (a retry after the
    /// reply was lost) reaches pi once and gets the first one's reply.
    #[serde(rename = "session.send")]
    SessionSend {
        session: u64,
        message_id: String,
        text: String,
        #[serde(default)]
        mode: SendModeWire,
    },
    #[serde(rename = "session.abort")]
    SessionAbort { session: u64 },
    /// Answer a pending dialog with pi's `extension_ui_response` fields: `value`, `confirmed`, or `cancelled`.
    #[serde(rename = "session.answer")]
    SessionAnswer {
        session: u64,
        request_id: String,
        answer: serde_json::Value,
    },
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SendModeWire {
    /// A prompt when idle; a follow-up when the agent is working.
    #[default]
    Prompt,
    Steer,
    FollowUp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchMode {
    /// pi inside nono.
    Sandbox,
    /// pi directly on the host.
    Host,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AttachControl {
    /// The connection is attached to a freshly launched pi.
    Welcome { session: u64 },
    /// The connection couldn't be set up; the daemon closes it.
    Error { message: String },
    /// The connection ends; the daemon closes it.
    End {
        reason: EndReason,
        #[serde(default)]
        stderr: Vec<String>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    /// The session's pi ended (terminated or crashed). `piton attach` exits 3.
    PiExited,
    /// The daemon is shutting down. `piton attach` exits 1, so clients reconnect later.
    DaemonShutdown,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ControlRequest {
    List,
    Start {
        workspace: PathBuf,
        mode: LaunchMode,
        #[serde(default)]
        prompt: Option<String>,
    },
    Stop {
        /// pi session id, session file, or piton session key.
        session: String,
    },
    WorkerCreate(crate::worker::CreateRequest),
    WorkerList {
        /// The source checkout or any of its workers.
        from: PathBuf,
    },
    WorkerDelete {
        path: PathBuf,
        /// Delete despite uncommitted changes or unpushed commits.
        #[serde(default)]
        force: bool,
    },
    /// The host logging policy in effect (`piton logging status`, the collector).
    Logging,
    /// Switch host logging until the policy expires or the daemon restarts.
    SetLogging {
        policy: crate::diagnostics::Policy,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ControlResponse {
    Sessions {
        sessions: Vec<SessionInfo>,
    },
    Started {
        session: SessionInfo,
    },
    Stopped {
        forced: bool,
    },
    Worker {
        worker: crate::worker::WorkerInfo,
    },
    Workers {
        workers: Vec<WorkerEntry>,
    },
    WorkerDeleted {
        /// Sessions that were running in the worker and got stopped.
        stopped: usize,
        /// Set when the source couldn't be fast-forwarded afterwards.
        warning: Option<String>,
    },
    /// A worker operation was refused for a reason the caller can act on.
    WorkerRefused {
        refusal: crate::worker::WorkerRefusal,
    },
    Logging {
        logging: crate::diagnostics::State,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerEntry {
    #[serde(flatten)]
    pub worker: crate::worker::WorkerInfo,
    /// Live sessions in the worker.
    pub sessions: Vec<SessionInfo>,
}

/// Daemon-wide state for the apps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaemonState {
    /// `<package version> (<git commit>[-dirty])` of the running daemon.
    pub version: String,
    /// Keep-awake is enabled: the Mac is held awake while sessions are live.
    pub keep_awake: bool,
    /// The assertion is held right now (enabled and at least one live session).
    pub awake: bool,
    pub sessions: usize,
    /// Host logging (this Mac's app, the daemon, and the phone-log collector).
    pub logging: crate::diagnostics::State,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    /// piton's key for the pi process; stable while it runs.
    pub key: u64,
    /// pi's current session id and file (they change on `new_session` / `switch_session`).
    pub id: Option<String>,
    pub file: Option<String>,
    pub workspace: PathBuf,
    /// What `workspace` is: a project's own checkout, or a worker of one. The apps group sessions by project.
    pub checkout: Checkout,
    pub mode: LaunchMode,
    pub status: SessionStatus,
    pub clients: usize,
    pub pid: Option<u32>,
    /// The session name, or the first line of the first user message.
    pub title: Option<String>,
}

/// A session's workspace relative to its project (see project.rs): decided from the worker's git config and folder
/// layout, so a repository whose own name contains `--` isn't mistaken for a worker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Checkout {
    /// The project's own checkout: the workspace is the project.
    Source,
    /// A worker `<repo>--<name>` of the project at `source`.
    Worker { source: PathBuf, name: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Idle,
    Working,
    NeedsInput,
    Stopping,
}
