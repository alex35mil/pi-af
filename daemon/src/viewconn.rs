//! A `view` connection: the native clients' protocol over any line transport (the Unix socket or the tailnet
//! WebSocket). Requests carry an `id` and get one `reply`; session lists and session views are pushed.
//!
//! Requests are taken in order: whatever a request does to a session (queue a message for pi, watch, unwatch) happens
//! before the next request is read, so a client's messages reach pi in the order it sent them. Waiting for the outcome
//! (pi's response, a launch, a stop) happens off the connection's loop, so a slow request never holds up the others or
//! the pushed session list.

use std::collections::BTreeMap;
use std::sync::Arc;

use futures_util::FutureExt;
use futures_util::future::BoxFuture;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

use crate::daemon::Daemon;
use crate::launch::SessionArg;
use crate::session::{ClientId, Internal, SendMode, SessionCmd, SessionHandle, StopReason, ViewCommand, WatchFrom};
use crate::view::DEFAULT_WINDOW;
use crate::wire::{LaunchMode, SendModeWire, ViewEnvelope, ViewRequest};

/// Serves one view connection: `lines` are its requests, `out` its outgoing lines. Returns when `lines` ends.
pub async fn serve(
    daemon: Arc<Daemon>,
    mut lines: mpsc::UnboundedReceiver<String>,
    out: mpsc::UnboundedSender<Arc<str>>,
) {
    let watcher: ClientId = daemon.next_client_id();
    let mut watching: BTreeMap<u64, SessionHandle> = BTreeMap::new();
    let mut subscribed = false;
    let mut last_list: Option<String> = None;
    let mut last_state: Option<String> = None;
    let changed = daemon.status_changed_broadcast();
    let mut changed = changed.subscribe();
    loop {
        tokio::select! {
            line = lines.recv() => {
                let Some(line) = line else { break };
                let envelope: ViewEnvelope = match serde_json::from_str(&line) {
                    Ok(e) => e,
                    Err(e) => {
                        let id = serde_json::from_str::<Value>(&line).ok().and_then(|v| v.get("id").cloned()).unwrap_or(Value::Null);
                        let _ = out.send(reply(&id, Err(format!("invalid request: {e}"))));
                        continue;
                    }
                };
                let id = envelope.id.clone();
                let subscribes = matches!(envelope.request, ViewRequest::SessionsSubscribe);
                match handle(&daemon, watcher, &mut watching, &out, envelope.request) {
                    Handled::Now(result) => {
                        let _ = out.send(reply(&id, result));
                    }
                    Handled::Later(outcome) => {
                        let out = out.clone();
                        tokio::spawn(async move {
                            let _ = out.send(reply(&id, outcome.await));
                        });
                    }
                }
                if subscribes {
                    subscribed = true;
                    last_list = None;
                    last_state = None;
                }
            }
            _ = changed.recv() => {}
        }
        if subscribed {
            let list = sessions_line(&daemon);
            if last_list.as_deref() != Some(list.as_str()) {
                let _ = out.send(list.clone().into());
                last_list = Some(list);
            }
            let state = json!({"type": "daemon", "state": daemon.state()}).to_string();
            if last_state.as_deref() != Some(state.as_str()) {
                let _ = out.send(state.clone().into());
                last_state = Some(state);
            }
        }
    }
    for handle in watching.values() {
        let _ = handle.tx.send(SessionCmd::Unwatch { watcher });
    }
}

/// What a request comes to once it's been taken: its reply now, or the outcome to wait for.
enum Handled {
    Now(Result<Value, String>),
    Later(BoxFuture<'static, Result<Value, String>>),
}

impl From<Result<Value, String>> for Handled {
    fn from(result: Result<Value, String>) -> Self {
        Handled::Now(result)
    }
}

fn handle(
    daemon: &Arc<Daemon>,
    watcher: ClientId,
    watching: &mut BTreeMap<u64, SessionHandle>,
    out: &mpsc::UnboundedSender<Arc<str>>,
    request: ViewRequest,
) -> Handled {
    let find = |key: u64| daemon.session(key).ok_or_else(|| format!("no live session {key}"));
    match request {
        ViewRequest::SessionsList => Ok(sessions_value(daemon)).into(),
        ViewRequest::DaemonState => Ok(json!({"state": daemon.state()})).into(),
        ViewRequest::DaemonKeepAwake { on } => {
            crate::log!("view client {watcher}: keep-awake {}", if on { "on" } else { "off" });
            daemon.set_keep_awake(on);
            Ok(json!({"state": daemon.state()})).into()
        }
        ViewRequest::DaemonLogging { policy } => {
            crate::log!("view client {watcher}: logging change");
            daemon.set_logging(policy);
            Ok(json!({"state": daemon.state()})).into()
        }
        // The connection pushes the list after the reply (see `serve`).
        ViewRequest::SessionsSubscribe => Ok(json!({})).into(),
        ViewRequest::WorkspacesBrowse { path } => {
            let roots = crate::workspaces::roots(&daemon.config().roots);
            crate::workspaces::browse(&roots, path.as_deref())
                .map(|entries| json!({"entries": entries}))
                .map_err(|e| e.to_string())
                .into()
        }
        ViewRequest::SessionStart {
            workspace,
            mode,
            prompt,
        } => {
            let daemon = daemon.clone();
            Handled::Later(
                async move {
                    // Native apps start sessions only in checkouts under the configured roots.
                    let roots = crate::workspaces::roots(&daemon.config().roots);
                    let workspace = crate::workspaces::check_start(&roots, &workspace).map_err(|e| e.to_string())?;
                    let handle = daemon
                        .launch_in(&workspace, mode.unwrap_or(LaunchMode::Sandbox), SessionArg::New)
                        .await
                        .map_err(|e| e.to_string())?;
                    if let Some(text) = prompt {
                        let _ = handle.tx.send(SessionCmd::Internal(Internal::Prompt { text }));
                    }
                    Ok(json!({"session": handle.snapshot().info()}))
                }
                .boxed(),
            )
        }
        ViewRequest::SessionStop { session } => {
            let handle = match find(session) {
                Ok(handle) => handle,
                Err(e) => return Err(e).into(),
            };
            crate::log!("session {session}: stop requested by view client {watcher}");
            Handled::Later(
                async move {
                    let forced = handle.stop(StopReason::Requested).await.is_some_and(|o| o.forced);
                    Ok(json!({"forced": forced}))
                }
                .boxed(),
            )
        }
        ViewRequest::SessionWatch { session, from, limit } => {
            let handle = match find(session) {
                Ok(handle) => handle,
                Err(e) => return Err(e).into(),
            };
            crate::log!(
                "view client {watcher}: watch session {session}{}",
                from.map_or_else(|| " (snapshot)".to_string(), |seq| format!(" from seq {seq}"))
            );
            if let Some(previous) = watching.remove(&session) {
                let _ = previous.tx.send(SessionCmd::Unwatch { watcher });
            }
            let limit = limit.unwrap_or(DEFAULT_WINDOW);
            let from = match from {
                Some(seq) => WatchFrom::Seq { seq, limit },
                None => WatchFrom::Snapshot { limit },
            };
            // The session task writes view lines straight to this connection.
            let tx = out.clone();
            if handle.tx.send(SessionCmd::Watch { watcher, tx, from }).is_err() {
                return Err(format!("session {session} ended")).into();
            }
            watching.insert(session, handle);
            Ok(json!({})).into()
        }
        ViewRequest::SessionUnwatch { session } => {
            crate::log!("view client {watcher}: unwatch session {session}");
            if let Some(handle) = watching.remove(&session) {
                let _ = handle.tx.send(SessionCmd::Unwatch { watcher });
            }
            Ok(json!({})).into()
        }
        ViewRequest::SessionHistory { session, before, limit } => ask(find(session), |reply| SessionCmd::History {
            before,
            limit: limit.unwrap_or(DEFAULT_WINDOW),
            reply,
        }),
        ViewRequest::SessionToolOutput { session, call_id } => {
            ask(find(session), |reply| SessionCmd::ToolOutput { call_id, reply })
        }
        ViewRequest::SessionImage { session, image } => ask(find(session), |reply| SessionCmd::Image { image, reply }),
        ViewRequest::SessionSend {
            session,
            message_id,
            text,
            mode,
        } => {
            crate::log!("view client {watcher}: message received for session {session}");
            let mode = match mode {
                SendModeWire::Prompt => SendMode::Prompt,
                SendModeWire::Steer => SendMode::Steer,
                SendModeWire::FollowUp => SendMode::FollowUp,
            };
            let command = ViewCommand::Send {
                message: message_id,
                text,
                mode,
            };
            match view_command(find(session), watcher, command) {
                Handled::Now(result) => Handled::Now(result),
                Handled::Later(outcome) => Handled::Later(
                    async move {
                        let result = outcome.await;
                        match &result {
                            Ok(_) => crate::log!("view client {watcher}: message acknowledged for session {session}"),
                            Err(_) => crate::log!("view client {watcher}: message refused for session {session}"),
                        }
                        result
                    }
                    .boxed(),
                ),
            }
        }
        ViewRequest::SessionAbort { session } => view_command(find(session), watcher, ViewCommand::Abort),
        ViewRequest::SessionAnswer {
            session,
            request_id,
            answer,
        } => view_command(find(session), watcher, ViewCommand::Answer { request_id, answer }),
    }
}

fn view_command(handle: Result<SessionHandle, String>, watcher: ClientId, command: ViewCommand) -> Handled {
    ask(handle, |reply| SessionCmd::View {
        watcher,
        command,
        reply,
    })
}

/// Queues a command on the session now, in request order; its reply is waited for later.
fn ask(
    handle: Result<SessionHandle, String>,
    make: impl FnOnce(oneshot::Sender<Result<Value, String>>) -> SessionCmd,
) -> Handled {
    let handle = match handle {
        Ok(handle) => handle,
        Err(e) => return Handled::Now(Err(e)),
    };
    let (tx, rx) = oneshot::channel();
    if handle.tx.send(make(tx)).is_err() {
        return Handled::Now(Err("session ended".to_string()));
    }
    Handled::Later(async move { rx.await.map_err(|_| "session ended".to_string())? }.boxed())
}

fn sessions_value(daemon: &Daemon) -> Value {
    let sessions: Vec<_> = daemon.sessions_info();
    json!({"sessions": sessions})
}

fn sessions_line(daemon: &Daemon) -> String {
    let mut value = sessions_value(daemon);
    if let Value::Object(map) = &mut value {
        map.insert("type".into(), json!("sessions"));
    }
    value.to_string()
}

fn reply(id: &Value, result: Result<Value, String>) -> Arc<str> {
    match result {
        Ok(data) => json!({"type": "reply", "id": id, "ok": true, "data": data}),
        Err(error) => json!({"type": "reply", "id": id, "ok": false, "error": error}),
    }
    .to_string()
    .into()
}
