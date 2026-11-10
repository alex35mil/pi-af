//! `piton attach`: pi.nvim's connector. Relays pi RPC between stdio and a fresh pi in the daemon.

use std::path::Path;
use std::process::ExitCode;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use super::control::write_line;
use crate::wire::{AttachControl, EndReason, FRAME_CONTROL, FRAME_RECORD, Hello};

/// pi ended (terminated or crashed): the client must not reconnect.
pub const EXIT_PI_ENDED: u8 = 3;
/// Connection lost or daemon unavailable: the client may reconnect.
pub const EXIT_CONNECTION_LOST: u8 = 1;

/// Relays pi RPC between stdio and a session in the daemon. Exit codes follow the pi.nvim connector contract:
/// 0 stdin closed, 3 pi ended, anything else connection lost.
pub async fn run(socket: &Path) -> ExitCode {
    let workspace = match std::env::current_dir().and_then(std::fs::canonicalize) {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("piton attach: can't resolve the working directory: {e}");
            return ExitCode::from(EXIT_CONNECTION_LOST);
        }
    };
    let stream = match UnixStream::connect(socket).await {
        Ok(stream) => stream,
        Err(e) => {
            eprintln!("piton attach: daemon not reachable at {}: {e}", socket.display());
            return ExitCode::from(EXIT_CONNECTION_LOST);
        }
    };
    let (read, mut write) = stream.into_split();
    let hello = Hello::Rpc {
        version: crate::wire::PROTOCOL_VERSION,
        workspace,
        client: Some("attach".into()),
    };
    if write_line(&mut write, &serde_json::to_vec(&hello).unwrap_or_default())
        .await
        .is_err()
    {
        eprintln!("piton attach: daemon closed the connection");
        return ExitCode::from(EXIT_CONNECTION_LOST);
    }

    // stdin -> daemon. EOF means the client detaches.
    let mut upstream = tokio::spawn(async move {
        let mut stdin = BufReader::new(tokio::io::stdin()).lines();
        while let Ok(Some(line)) = stdin.next_line().await {
            if write_line(&mut write, line.as_bytes()).await.is_err() {
                return false;
            }
        }
        let _ = write.shutdown().await;
        true
    });

    // daemon -> stdout.
    let mut frames = BufReader::new(read).lines();
    let mut stdout = tokio::io::stdout();
    loop {
        tokio::select! {
            detached = &mut upstream => {
                return match detached {
                    Ok(true) => ExitCode::SUCCESS,
                    Ok(false) | Err(_) => ExitCode::from(EXIT_CONNECTION_LOST),
                };
            }
            frame = frames.next_line() => {
                let line = match frame {
                    Ok(Some(line)) => line,
                    Ok(None) | Err(_) => {
                        eprintln!("piton attach: connection to the daemon lost");
                        return ExitCode::from(EXIT_CONNECTION_LOST);
                    }
                };
                let bytes = line.as_bytes();
                match bytes.first() {
                    Some(&FRAME_RECORD) => {
                        if write_line(&mut stdout, &bytes[1..]).await.is_err() {
                            return ExitCode::from(EXIT_CONNECTION_LOST);
                        }
                    }
                    Some(&FRAME_CONTROL) => match serde_json::from_slice::<AttachControl>(&bytes[1..]) {
                        Ok(AttachControl::Welcome { .. }) => {}
                        Ok(AttachControl::Error { message }) => {
                            eprintln!("piton attach: {message}");
                            return ExitCode::from(EXIT_CONNECTION_LOST);
                        }
                        Ok(AttachControl::End { reason, stderr }) => {
                            for line in stderr {
                                eprintln!("{line}");
                            }
                            return match reason {
                                EndReason::PiExited => {
                                    eprintln!("piton attach: pi exited");
                                    ExitCode::from(EXIT_PI_ENDED)
                                }
                                EndReason::DaemonShutdown => {
                                    eprintln!("piton attach: daemon shutting down");
                                    ExitCode::from(EXIT_CONNECTION_LOST)
                                }
                            };
                        }
                        Err(e) => eprintln!("piton attach: bad control frame: {e}"),
                    },
                    Some(_) | None => {}
                }
            }
        }
    }
}
