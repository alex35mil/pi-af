//! The control-socket client every command but `attach` uses, and how commands report failures.

use std::path::Path;
use std::process::ExitCode;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use crate::wire::{AttachControl, ControlRequest, ControlResponse, FRAME_CONTROL, Hello};

/// Sends one control request to the daemon and returns its response.
pub async fn control(socket: &Path, request: ControlRequest) -> Result<ControlResponse, String> {
    let stream = UnixStream::connect(socket)
        .await
        .map_err(|e| format!("daemon not reachable at {}: {e}", socket.display()))?;
    let (read, mut write) = stream.into_split();
    let hello = Hello::Control {
        version: crate::wire::PROTOCOL_VERSION,
    };
    write_line(&mut write, &serde_json::to_vec(&hello).unwrap_or_default())
        .await
        .map_err(|e| e.to_string())?;
    write_line(&mut write, &serde_json::to_vec(&request).unwrap_or_default())
        .await
        .map_err(|e| e.to_string())?;
    let mut lines = BufReader::new(read).lines();
    let line = lines
        .next_line()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("daemon closed the connection")?;
    if let Some(rest) = line.as_bytes().strip_prefix(&[FRAME_CONTROL])
        && let Ok(AttachControl::Error { message }) = serde_json::from_slice::<AttachControl>(rest)
    {
        return Err(message);
    }
    serde_json::from_str(&line).map_err(|e| format!("bad response: {e}"))
}

/// A failed command: the daemon's error, an unreachable daemon, or a response the command didn't expect. Exits 1.
pub fn report(response: Result<ControlResponse, String>) -> ExitCode {
    match response {
        Ok(ControlResponse::Error { message }) | Err(message) => eprintln!("piton: {message}"),
        Ok(other) => eprintln!("piton: unexpected response: {other:?}"),
    }
    ExitCode::from(1)
}

pub async fn write_line<W: AsyncWriteExt + Unpin>(w: &mut W, bytes: &[u8]) -> std::io::Result<()> {
    w.write_all(bytes).await?;
    w.write_all(b"\n").await?;
    w.flush().await
}
