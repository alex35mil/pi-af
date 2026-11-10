//! `piton service install|uninstall|status`: the daemon as a launchd user agent (starts at login, restarts on crash).

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::config::home;

pub const LABEL: &str = "com.alex35mil.piton";
const COLLECTOR_LABEL: &str = "com.alex35mil.piton.logs";

#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    #[error("can't find the piton executable: {0}")]
    Exe(std::io::Error),
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
    #[error("launchctl {args} failed: {stderr}")]
    Launchctl { args: String, stderr: String },
    #[error("the running daemon didn't exit within {waited}s; check `piton service status` and try again")]
    StillLoaded { waited: u64 },
}

fn plist_path(label: &str) -> PathBuf {
    home().join("Library/LaunchAgents").join(format!("{label}.plist"))
}

fn domain() -> String {
    format!("gui/{}", nix::unistd::getuid())
}

/// Writes the agent's plist and (re)loads it. `exe` is the binary launchd runs; `config` is passed as `--config` when
/// given.
pub fn install(config: Option<&Path>) -> Result<PathBuf, ServiceError> {
    let exe = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(ServiceError::Exe)?;
    let mut args = vec![exe.to_string_lossy().into_owned()];
    if let Some(config) = config {
        let config = std::fs::canonicalize(config).map_err(|source| ServiceError::Io {
            path: config.into(),
            source,
        })?;
        args.push("--config".into());
        args.push(config.to_string_lossy().into_owned());
    }
    args.push("daemon".into());
    install_agent(LABEL, &args)
}

/// Separate from the daemon: restarting, disabling, or uninstalling this never stops a pi session.
pub fn install_collector(device: &str) -> Result<PathBuf, ServiceError> {
    let exe = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(ServiceError::Exe)?;
    install_agent(
        COLLECTOR_LABEL,
        &[
            exe.to_string_lossy().into_owned(),
            "logging".into(),
            "collect".into(),
            "--device".into(),
            device.into(),
        ],
    )
}

fn install_agent(label: &str, args: &[String]) -> Result<PathBuf, ServiceError> {
    // Process logs use bounded writers. Do not create an unbounded duplicate via launchd's stderr redirection.
    let plist = render(label, args, Path::new("/dev/null"));
    let path = plist_path(label);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|source| ServiceError::Io {
            path: dir.into(),
            source,
        })?;
    }
    // Replace a loaded agent so the new binary and arguments take effect.
    unload(label)?;
    std::fs::write(&path, plist).map_err(|source| ServiceError::Io {
        path: path.clone(),
        source,
    })?;
    launchctl(&["bootstrap", &domain(), &path.to_string_lossy()])?;
    Ok(path)
}

/// How long a running daemon may take to exit: it stops every pi first (stop grace 15 s + SIGTERM grace 3 s by
/// default), and launchd kills it after its own exit timeout.
const UNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(40);

/// Boots the agent out and waits until launchd has let go of it. `bootout` returns while the old daemon is still
/// shutting down; a `bootstrap` in that window fails with "Bootstrap failed: 5: Input/output error".
fn unload(label: &str) -> Result<(), ServiceError> {
    let target = format!("{}/{label}", domain());
    if launchctl(&["print", &target]).is_err() {
        return Ok(()); // not loaded
    }
    let _ = launchctl(&["bootout", &target]);
    let started = std::time::Instant::now();
    let mut told = false;
    while launchctl(&["print", &target]).is_ok() {
        if started.elapsed() > UNLOAD_TIMEOUT {
            return Err(ServiceError::StillLoaded {
                waited: UNLOAD_TIMEOUT.as_secs(),
            });
        }
        if !told && started.elapsed() > std::time::Duration::from_secs(2) {
            eprintln!("piton: waiting for the running daemon to stop its sessions and exit…");
            told = true;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    Ok(())
}

pub fn uninstall() -> Result<PathBuf, ServiceError> {
    uninstall_agent(LABEL)
}

pub fn uninstall_collector() -> Result<PathBuf, ServiceError> {
    uninstall_agent(COLLECTOR_LABEL)
}

fn uninstall_agent(label: &str) -> Result<PathBuf, ServiceError> {
    let path = plist_path(label);
    unload(label)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(path),
        Err(source) => Err(ServiceError::Io { path, source }),
    }
}

pub fn status() -> Result<String, ServiceError> {
    launchctl(&["print", &format!("{}/{LABEL}", domain())])
}

fn launchctl(args: &[&str]) -> Result<String, ServiceError> {
    let out = Command::new("launchctl")
        .args(args)
        .output()
        .map_err(|source| ServiceError::Io {
            path: "launchctl".into(),
            source,
        })?;
    if !out.status.success() {
        return Err(ServiceError::Launchctl {
            args: args.join(" "),
            stderr: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn render(label: &str, args: &[String], log: &Path) -> String {
    let args: String = args
        .iter()
        .map(|a| format!("        <string>{}</string>\n", xml_escape(a)))
        .collect();
    let log = xml_escape(&log.to_string_lossy());
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>EnvironmentVariables</key>
    <dict><key>PITON_SERVICE</key><string>1</string></dict>
    <key>ProgramArguments</key>
    <array>
{args}    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>{log}</string>
    <key>StandardErrorPath</key>
    <string>{log}</string>
</dict>
</plist>
"#
    )
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_plist() {
        let plist = render(LABEL, &["/bin/piton".into(), "daemon".into()], Path::new("/dev/null"));
        assert!(plist.contains("<string>/bin/piton</string>\n        <string>daemon</string>"));
        assert!(plist.contains("<key>SuccessfulExit</key>\n        <false/>"));
        let collector = render(
            COLLECTOR_LABEL,
            &["/bin/piton".into(), "logging".into(), "collect".into()],
            Path::new("/dev/null"),
        );
        assert!(collector.contains("<string>com.alex35mil.piton.logs</string>"));
        assert!(collector.contains("<key>PITON_SERVICE</key>"));
        assert!(!collector.contains("launchd.log"));
    }
}
