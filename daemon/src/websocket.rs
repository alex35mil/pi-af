//! The `view` protocol over WebSocket on the tailnet addresses, for the phone and other remote devices. One text frame
//! per message; the first is the hello, as on the Unix socket. Every connection is checked against Tailscale before
//! the WebSocket handshake (see tailnet.rs).

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::config::TailnetConfig;
use crate::daemon::Daemon;
use crate::session::lock;
use crate::tailnet::{self, SelfNode};
use crate::wire::{Hello, PROTOCOL_VERSION};

/// A client that answers none of this many pings in a row is dropped.
const MISSED_PINGS: u32 = 3;
/// How often to check that this Mac's tailnet addresses haven't changed while listening.
const RECHECK: Duration = Duration::from_secs(60);

/// Serves the tailnet for as long as the daemon runs: listens on each of this Mac's tailnet addresses. Tailscale may
/// not be up when the daemon starts (launchd starts it at login), so this keeps trying every `retry_ms`, and listens
/// again when the addresses change. Connections already open are left alone.
pub async fn serve_tailnet(daemon: Arc<Daemon>, cli: String, config: TailnetConfig) {
    let mut listening: Option<Listening> = None;
    let mut last_problem: Option<String> = None;
    loop {
        let problem = match tailnet::self_node(&cli).await {
            Ok(me) if listening.as_ref().is_some_and(|l| l.addresses == me.addresses) => None,
            Ok(me) => {
                if let Some(old) = listening.take() {
                    crate::log!("tailnet: this Mac's addresses changed; listening again");
                    old.stop();
                }
                match listen(&daemon, &cli, me, config.port, config.heartbeat_ms).await {
                    Ok(now) => {
                        let addrs: Vec<String> = now.bound.iter().map(ToString::to_string).collect();
                        crate::log!("tailnet: listening on {}", addrs.join(", "));
                        listening = Some(now);
                        None
                    }
                    Err(e) => Some(e),
                }
            }
            // While listening, the listeners stay: Tailscale back on the same addresses reaches them again.
            Err(e) => Some(e.to_string()),
        };
        match (&problem, &listening) {
            // Logged once per distinct problem, not on every retry.
            (Some(p), None) if last_problem.as_ref() != Some(p) => crate::log!("tailnet: not listening: {p}"),
            (Some(p), Some(_)) if last_problem.as_ref() != Some(p) => crate::log!("tailnet: {p}"),
            (Some(_), None | Some(_)) | (None, None | Some(_)) => {}
        }
        last_problem = problem;
        tokio::time::sleep(match listening {
            Some(_) => RECHECK,
            None => Duration::from_millis(config.retry_ms.max(1)),
        })
        .await;
    }
}

/// The listeners on this Mac's tailnet addresses.
struct Listening {
    addresses: Vec<std::net::IpAddr>,
    bound: Vec<SocketAddr>,
    accepting: Vec<tokio::task::JoinHandle<()>>,
}

impl Listening {
    /// Stops accepting (closing the listeners); connections already open go on.
    fn stop(self) {
        for task in self.accepting {
            task.abort();
        }
    }
}

/// Binds every tailnet address of `me` (all or none) and starts accepting.
async fn listen(
    daemon: &Arc<Daemon>,
    cli: &str,
    me: SelfNode,
    port: u16,
    heartbeat_ms: u64,
) -> Result<Listening, String> {
    if me.addresses.is_empty() {
        return Err("tailscale reports no addresses for this Mac".into());
    }
    let mut listeners = Vec::new();
    for ip in &me.addresses {
        let addr = SocketAddr::new(*ip, port);
        let listener = TcpListener::bind(addr)
            .await
            .map_err(|e| format!("can't listen on {addr}: {e}"))?;
        listeners.push(listener);
    }
    let mut bound = Vec::new();
    let mut accepting = Vec::new();
    for listener in listeners {
        bound.push(listener.local_addr().map_err(|e| e.to_string())?);
        let (daemon, cli, me) = (daemon.clone(), cli.to_string(), me.clone());
        accepting.push(tokio::spawn(async move {
            accept_loop(daemon, cli, me, listener, heartbeat_ms).await;
        }));
    }
    Ok(Listening {
        addresses: me.addresses,
        bound,
        accepting,
    })
}

async fn accept_loop(daemon: Arc<Daemon>, cli: String, me: SelfNode, listener: TcpListener, heartbeat_ms: u64) {
    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let (daemon, cli, me) = (daemon.clone(), cli.clone(), me.clone());
                tokio::spawn(async move { serve(daemon, &cli, &me, stream, peer, heartbeat_ms).await });
            }
            Err(e) => crate::log!("tailnet accept failed: {e}"),
        }
    }
}

async fn serve(daemon: Arc<Daemon>, cli: &str, me: &SelfNode, stream: TcpStream, peer: SocketAddr, heartbeat_ms: u64) {
    let started = Instant::now();
    crate::debug!("tailnet: TCP accepted; identifying peer");
    let who = match tailnet::identify(cli, peer).await {
        Ok(who) => who,
        Err(refusal) => {
            crate::log!("tailnet connection from {peer} refused: {refusal}");
            return;
        }
    };
    if let Err(refusal) = tailnet::check(me, &who) {
        crate::log!("tailnet connection from {peer} refused: {refusal}");
        return;
    }
    crate::debug!(
        "tailnet: identity accepted after {} ms; waiting for websocket upgrade",
        started.elapsed().as_millis()
    );
    let mut ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            crate::log!("tailnet websocket handshake with {} failed: {e}", who.name);
            return;
        }
    };
    crate::debug!(
        "tailnet: websocket upgraded after {} ms; waiting for protocol hello",
        started.elapsed().as_millis()
    );
    // The hello: the view protocol only (piton attach stays local).
    let hello = loop {
        match ws.next().await {
            Some(Ok(Message::Text(text))) => break serde_json::from_str::<Hello>(&text),
            Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => continue,
            Some(Ok(Message::Binary(_) | Message::Close(_)) | Err(_)) | None => return,
        }
    };
    let client = match hello {
        Ok(Hello::View { version, client }) if version == PROTOCOL_VERSION => client,
        Ok(Hello::View { .. }) => {
            let _ = ws.close(None).await;
            crate::log!("tailnet client {} speaks another protocol version", who.name);
            return;
        }
        Ok(Hello::Rpc { .. } | Hello::Control { .. }) | Err(_) => {
            let _ = ws.close(None).await;
            crate::log!("tailnet client {} sent an unsupported hello", who.name);
            return;
        }
    };
    crate::log!(
        "view client connected over the tailnet: {} ({}, {})",
        client.as_deref().unwrap_or("unnamed"),
        who.name,
        who.login
    );
    let (mut sink, mut source) = ws.split();
    let (in_tx, in_rx) = mpsc::unbounded_channel::<String>();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Arc<str>>();
    let heard = Arc::new(Mutex::new(Instant::now()));
    let reader = {
        let heard = heard.clone();
        tokio::spawn(async move {
            while let Some(message) = source.next().await {
                *lock(&heard) = Instant::now();
                match message {
                    Ok(Message::Text(text)) => {
                        if in_tx.send(text.to_string()).is_err() {
                            break;
                        }
                    }
                    Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_)) => {}
                    Ok(Message::Binary(_) | Message::Close(_)) | Err(_) => break,
                }
            }
        })
    };
    // Pings the client and drops it when it stops answering: a phone that lost its network sends no close, and the
    // TCP connection would otherwise linger for many minutes. Aborting the reader ends `serve` below.
    let stop_reading = reader.abort_handle();
    let interval = Duration::from_millis(heartbeat_ms.max(1));
    let name = who.name.clone();
    let writer = tokio::spawn(async move {
        let mut ticks = tokio::time::interval_at(tokio::time::Instant::now() + interval, interval);
        loop {
            tokio::select! {
                line = out_rx.recv() => {
                    let Some(line) = line else { break };
                    if sink.send(Message::text(line.to_string())).await.is_err() {
                        break;
                    }
                }
                _ = ticks.tick() => {
                    let silent = lock(&heard).elapsed();
                    if silent > interval * MISSED_PINGS {
                        crate::log!("tailnet client {name} stopped answering ({} s silent); dropping it", silent.as_secs());
                        break;
                    }
                    if sink.send(Message::Ping(Default::default())).await.is_err() {
                        break;
                    }
                }
            }
        }
        stop_reading.abort();
        let _ = sink.close().await;
    });
    crate::viewconn::serve(daemon, in_rx, out_tx).await;
    reader.abort();
    let _ = writer.await;
    crate::log!("view client disconnected from the tailnet: {}", who.name);
}
