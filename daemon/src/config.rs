//! piton's configuration: `~/.config/piton/config.toml`, or the file named by `--config` / `PITON_CONFIG`.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::wire::LaunchMode;

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Unix socket of the daemon. An override for tests and development: the Mac app always connects to the default
    /// (`Endpoint.defaultLocal` in PitonKit), so a daemon on another socket runs without it.
    pub socket: PathBuf,
    /// Daemon log file (appended). Lines also go to stderr.
    pub log: Option<PathBuf>,
    /// Mode for sessions launched by `piton attach`.
    pub attach_mode: LaunchMode,
    pub pi: PiConfig,
    pub sandbox: SandboxConfig,
    pub env: EnvConfig,
    pub stop: StopConfig,
    /// How long a pi with no messages, no run, and no pending dialog may stay without clients.
    pub empty_grace_ms: u64,
    /// Hold a prevent-idle-sleep assertion (`caffeinate -i`) while any session is live, idle ones included, so the
    /// owner's other devices can reach the Mac.
    pub keep_awake: bool,
    pub tailnet: TailnetConfig,
    pub logging: LoggingConfig,
    /// Folders whose workspaces the native apps may browse and start sessions in. None by default: the apps can't
    /// start sessions until the owner lists some. `piton attach` and the CLI aren't limited. A leading `~/` is
    /// expanded.
    pub roots: Vec<String>,
}

/// The `view` protocol over WebSocket on this Mac's tailnet addresses, for the owner's other devices.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TailnetConfig {
    pub enabled: bool,
    pub port: u16,
    /// The tailscale CLI.
    pub cli: String,
    /// How often to ping each client; one that answers none of three pings in a row is dropped.
    pub heartbeat_ms: u64,
    /// While Tailscale isn't up (not started yet at login, logged out), how often to try again to listen.
    pub retry_ms: u64,
}

/// Host logging: the daemon, the Mac app, and the phone-log collector. The apps and `piton logging` switch it at runtime
/// until the daemon restarts; this is what it starts with and returns to when a timed switch expires.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LoggingConfig {
    pub mode: crate::diagnostics::Mode,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PiConfig {
    /// pi executable and leading arguments; piton adds `--mode rpc`, then `args`, then session arguments.
    pub command: Vec<String>,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SandboxConfig {
    /// nono executable.
    pub command: Vec<String>,
    /// Base profile. A source checkout's `.nono.json` extends it; its `.project/.local` is allowed. See project.rs.
    /// Grants every sandboxed pi needs belong in this profile, not in piton's config.
    pub profile: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EnvConfig {
    /// Start from the login shell's environment (captured once at daemon start) instead of the daemon's own.
    pub login_shell: bool,
    /// Add `mise env -C <workspace> --json` for every launch.
    pub mise: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct StopConfig {
    /// After closing pi's stdin, how long pi may take before SIGTERM.
    pub grace_ms: u64,
    /// After SIGTERM, how long before SIGKILL.
    pub term_grace_ms: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            socket: home().join(".local/state/piton/piton.sock"),
            log: Some(crate::diagnostics::root().join("daemon/current.log")),
            attach_mode: LaunchMode::Sandbox,
            pi: PiConfig::default(),
            sandbox: SandboxConfig::default(),
            env: EnvConfig::default(),
            stop: StopConfig::default(),
            empty_grace_ms: 10_000,
            keep_awake: true,
            tailnet: TailnetConfig::default(),
            logging: LoggingConfig::default(),
            roots: Vec::new(),
        }
    }
}

impl Default for TailnetConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            port: 7357,
            cli: "tailscale".into(),
            heartbeat_ms: 10_000,
            retry_ms: 10_000,
        }
    }
}

impl Default for PiConfig {
    fn default() -> Self {
        Self {
            command: vec!["pi".into()],
            args: Vec::new(),
        }
    }
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            command: vec!["nono".into()],
            profile: "piton".into(),
        }
    }
}

impl Default for EnvConfig {
    fn default() -> Self {
        Self {
            login_shell: true,
            mise: true,
        }
    }
}

impl Default for StopConfig {
    fn default() -> Self {
        Self {
            grace_ms: 15_000,
            term_grace_ms: 3_000,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("can't read {path}: {source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("invalid config {path}: {source}")]
    Parse {
        path: PathBuf,
        source: Box<toml::de::Error>,
    },
    #[error("invalid config: {0}")]
    Invalid(&'static str),
}

pub fn load(explicit: Option<&Path>) -> Result<Config, ConfigError> {
    let (path, required) = match explicit {
        Some(path) => (path.to_path_buf(), true),
        None => (home().join(".config/piton/config.toml"), false),
    };
    let mut config = match std::fs::read_to_string(&path) {
        Ok(text) => toml::from_str::<Config>(&text).map_err(|source| ConfigError::Parse {
            path: path.clone(),
            source: Box::new(source),
        })?,
        Err(source) if !required && source.kind() == std::io::ErrorKind::NotFound => Config::default(),
        Err(source) => return Err(ConfigError::Read { path, source }),
    };
    if config.pi.command.is_empty() {
        return Err(ConfigError::Invalid("pi.command must not be empty"));
    }
    if config.sandbox.command.is_empty() {
        return Err(ConfigError::Invalid("sandbox.command must not be empty"));
    }
    config.socket = expand_home(&config.socket.to_string_lossy());
    config.log = config.log.map(|log| expand_home(&log.to_string_lossy()));
    Ok(config)
}

pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn expand_home(path: &str) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => home().join(rest),
        None => PathBuf::from(path),
    }
}
