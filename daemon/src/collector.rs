//! Host-only development tooling: periodically copy Piton's bounded log directory using Apple's paired-device channel,
//! independent of Tailscale and the apps' connection. It follows the daemon's logging policy (asked over the control
//! socket): Info mode, or no daemon, performs no device IO. All retained data lives under logs/.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::diagnostics::{self, Policy};

#[derive(Debug, thiserror::Error)]
pub enum CollectError {
    #[error("device log copy timed out")]
    Timeout,
    #[error("device tool failed (exit {code:?}); check pairing, device unlock, and Xcode wireless connectivity")]
    Device { code: Option<i32> },
    #[error("device snapshot contains an unexpected file, symlink, or exceeds its size limit")]
    InvalidSnapshot,
    #[error("log collection IO failed: {0}")]
    Io(#[from] std::io::Error),
}

enum CopyOutcome {
    Published,
    Disabled,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Status {
    Disabled {
        checked_ms: u64,
        last_success_ms: Option<u64>,
    },
    /// The daemon isn't reachable, so its policy is unknown: no collection until it is.
    NoDaemon {
        checked_ms: u64,
        last_success_ms: Option<u64>,
    },
    Collected {
        collected_ms: u64,
    },
    Unavailable {
        attempted_ms: u64,
        last_success_ms: Option<u64>,
        error: String,
    },
}

fn status(root: &Path, value: Status) -> std::io::Result<()> {
    diagnostics::private_dir(&root.join("iphone"))?;
    let temporary = root.join("iphone/status.tmp");
    std::fs::write(&temporary, serde_json::to_vec(&value)?)?;
    std::fs::rename(temporary, root.join("iphone/status.json"))
}

/// The daemon's policy as the collector sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Gate {
    Policy(Policy),
    NoDaemon,
}

/// Asks the daemon; also applies its policy to this process's own log.
async fn ask(socket: &Path) -> Gate {
    match crate::cli::logging_state(socket, crate::wire::ControlRequest::Logging).await {
        Ok(state) => {
            diagnostics::set(state.clone());
            Gate::Policy(state.policy)
        }
        Err(_) => Gate::NoDaemon,
    }
}

pub async fn run(root: &Path, socket: &Path, device: &str) -> Result<(), CollectError> {
    recover(root)?;
    let restored = std::fs::read(root.join("iphone/status.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Status>(&b).ok());
    let mut last_success = match restored {
        Some(
            Status::Disabled { last_success_ms, .. }
            | Status::NoDaemon { last_success_ms, .. }
            | Status::Unavailable { last_success_ms, .. },
        ) => last_success_ms,
        Some(Status::Collected { collected_ms }) => Some(collected_ms),
        None => None,
    };
    let mut next_attempt = tokio::time::Instant::now();
    let mut failures: u32 = 0;
    let mut previous = None;
    let gate = async || ask(socket).await;
    loop {
        let current = gate().await;
        let prior = previous.replace(current.clone());
        let idle = match &current {
            Gate::NoDaemon => Some(Status::NoDaemon {
                checked_ms: diagnostics::now_ms(),
                last_success_ms: last_success,
            }),
            Gate::Policy(Policy::Info) => Some(Status::Disabled {
                checked_ms: diagnostics::now_ms(),
                last_success_ms: last_success,
            }),
            Gate::Policy(Policy::Debug { .. }) => None,
        };
        match idle {
            Some(idle) => {
                if prior.as_ref() != Some(&current) {
                    status(root, idle)?;
                }
                // No device discovery, ping, or transfer while disabled. Poll only the daemon's policy.
                next_attempt = tokio::time::Instant::now();
                failures = 0;
            }
            None => {
                if tokio::time::Instant::now() >= next_attempt {
                    match copy(root, device, "/usr/bin/xcrun", &gate).await {
                        Ok(CopyOutcome::Published) => {
                            last_success = Some(diagnostics::now_ms());
                            status(
                                root,
                                Status::Collected {
                                    collected_ms: last_success.expect("just set"),
                                },
                            )?;
                            failures = 0;
                        }
                        Ok(CopyOutcome::Disabled) => {}
                        Err(error) => {
                            failures = failures.saturating_add(1);
                            status(
                                root,
                                Status::Unavailable {
                                    attempted_ms: diagnostics::now_ms(),
                                    last_success_ms: last_success,
                                    error: error.to_string(),
                                },
                            )?;
                            crate::log!("collector: {error}");
                        }
                    }
                    // 30 s healthy, then 60, 120, ... at most 5 min unavailable. Never keep the phone awake for logging.
                    let delay = (30_u64 * (1_u64 << failures.min(4))).min(300);
                    next_attempt = tokio::time::Instant::now() + Duration::from_secs(delay);
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

async fn copy(
    root: &Path,
    device: &str,
    xcrun: &str,
    gate: &impl AsyncFn() -> Gate,
) -> Result<CopyOutcome, CollectError> {
    match gate().await {
        Gate::Policy(Policy::Debug { .. }) => {}
        Gate::Policy(Policy::Info) | Gate::NoDaemon => return Ok(CopyOutcome::Disabled),
    }
    let incoming = root.join("iphone/incoming");
    remove_dir(&incoming)?;
    diagnostics::private_dir(&root.join("iphone"))?;
    diagnostics::private_dir(&incoming)?;
    let operation = async {
        let mut child = Command::new(xcrun)
            .args([
                "devicectl",
                "device",
                "copy",
                "from",
                "--device",
                device,
                "--domain-type",
                "appDataContainer",
                "--domain-identifier",
                "com.alex35mil.piton.ios",
                "--source",
                "Library/Logs/Piton",
                "--destination",
            ])
            .arg(&incoming)
            .args(["--timeout", "12", "--quiet"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()?;
        let result = tokio::time::timeout(Duration::from_secs(15), child.wait())
            .await
            .map_err(|_| CollectError::Timeout)??;
        if !result.success() {
            return Err(CollectError::Device { code: result.code() });
        }
        // Recheck after the transfer: disabling/expiry cancels publication even when a copy was in flight.
        match gate().await {
            Gate::Policy(Policy::Debug { .. }) => {}
            Gate::Policy(Policy::Info) | Gate::NoDaemon => return Ok(CopyOutcome::Disabled),
        }
        publish(root, &incoming)?;
        Ok(CopyOutcome::Published)
    }
    .await;
    remove_dir(&incoming)?;
    operation
}

fn remove_dir(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Recover the last published snapshot if the process died between directory renames, and remove partial transfers.
fn recover(root: &Path) -> std::io::Result<()> {
    let snapshot = root.join("iphone/snapshot");
    let old = root.join("iphone/previous");
    if !snapshot.exists() && old.exists() {
        std::fs::rename(&old, snapshot)?;
    }
    remove_dir(&old)?;
    remove_dir(&root.join("iphone/incoming"))
}

/// Validate the fixed file set before replacing the last good snapshot. Failure preserves the previous capture.
fn publish(root: &Path, incoming: &Path) -> Result<(), CollectError> {
    let allowed = [
        "current.log",
        "archive-1.log",
        "archive-2.log",
        "archive-3.log",
        "archive-4.log",
        "settings.json",
    ];
    let mut logs = 0;
    for entry in std::fs::read_dir(incoming)? {
        let entry = entry?;
        let name = entry.file_name();
        let metadata = std::fs::symlink_metadata(entry.path())?;
        let name = name.to_str().ok_or(CollectError::InvalidSnapshot)?;
        let limit = if name == "settings.json" {
            4096
        } else {
            diagnostics::FILE_BYTES as u64
        };
        if !allowed.contains(&name) || !metadata.is_file() || metadata.len() > limit {
            return Err(CollectError::InvalidSnapshot);
        }
        if name != "settings.json" {
            logs += 1;
        }
    }
    if logs == 0 {
        return Err(CollectError::InvalidSnapshot);
    }
    let snapshot = root.join("iphone/snapshot");
    let old = root.join("iphone/previous");
    remove_dir(&old)?;
    if snapshot.exists() {
        std::fs::rename(&snapshot, &old)?;
    }
    if let Err(error) = std::fs::rename(incoming, &snapshot) {
        if old.exists() {
            let _ = std::fs::rename(&old, &snapshot);
        }
        return Err(error.into());
    }
    remove_dir(&old)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn interrupted_publication_recovers_last_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let previous = root.path().join("iphone/previous");
        std::fs::create_dir_all(&previous).unwrap();
        std::fs::write(previous.join("current.log"), "last good").unwrap();
        std::fs::create_dir_all(root.path().join("iphone/incoming")).unwrap();
        recover(root.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.path().join("iphone/snapshot/current.log")).unwrap(),
            "last good"
        );
        assert!(!previous.exists());
        assert!(!root.path().join("iphone/incoming").exists());
    }

    #[tokio::test]
    async fn info_level_or_no_daemon_never_runs_device_tool() {
        let root = tempfile::tempdir().unwrap();
        for gate in [Gate::Policy(Policy::Info), Gate::NoDaemon] {
            let gate = async || gate.clone();
            assert!(matches!(
                copy(root.path(), "phone", "/must/not/be/run", &gate).await.unwrap(),
                CopyOutcome::Disabled
            ));
        }
        assert!(!root.path().join("iphone").exists());
    }

    #[tokio::test]
    async fn transfer_uses_fixed_app_directory_and_preserves_capture_on_failure() {
        let root = tempfile::tempdir().unwrap();
        let gate = async || {
            Gate::Policy(Policy::Debug {
                expiration: diagnostics::Expiration::Manual,
            })
        };
        let executable = root.path().join("fake-devicectl");
        std::fs::write(&executable, include_str!("../tests/fixtures/fake-devicectl.sh")).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(matches!(
            copy(root.path(), "a phone with spaces", executable.to_str().unwrap(), &gate)
                .await
                .unwrap(),
            CopyOutcome::Published
        ));
        let capture = root.path().join("iphone/snapshot/current.log");
        assert_eq!(std::fs::read_to_string(&capture).unwrap(), "fake phone event\n");
        assert!(matches!(
            copy(root.path(), "fail", executable.to_str().unwrap(), &gate).await,
            Err(CollectError::Device { code: Some(7) })
        ));
        assert_eq!(std::fs::read_to_string(capture).unwrap(), "fake phone event\n");
        assert!(!root.path().join("iphone/incoming").exists());
    }
    #[test]
    fn snapshot_is_bounded_and_invalid_transfer_preserves_last_good() {
        let root = tempfile::tempdir().unwrap();
        let incoming = root.path().join("iphone/incoming");
        std::fs::create_dir_all(&incoming).unwrap();
        std::fs::write(incoming.join("current.log"), "good").unwrap();
        publish(root.path(), &incoming).unwrap();
        std::fs::create_dir_all(&incoming).unwrap();
        std::fs::write(incoming.join("unexpected"), "bad").unwrap();
        assert!(matches!(
            publish(root.path(), &incoming),
            Err(CollectError::InvalidSnapshot)
        ));
        assert_eq!(
            std::fs::read(root.path().join("iphone/snapshot/current.log")).unwrap(),
            b"good"
        );
    }
    #[test]
    fn rejects_symlinks_and_oversized_files() {
        let root = tempfile::tempdir().unwrap();
        let incoming = root.path().join("iphone/incoming");
        std::fs::create_dir_all(&incoming).unwrap();
        std::os::unix::fs::symlink("/etc/passwd", incoming.join("current.log")).unwrap();
        assert!(matches!(
            publish(root.path(), &incoming),
            Err(CollectError::InvalidSnapshot)
        ));
        std::fs::remove_file(incoming.join("current.log")).unwrap();
        std::fs::write(incoming.join("current.log"), vec![0; diagnostics::FILE_BYTES + 1]).unwrap();
        assert!(matches!(
            publish(root.path(), &incoming),
            Err(CollectError::InvalidSnapshot)
        ));
    }
}
