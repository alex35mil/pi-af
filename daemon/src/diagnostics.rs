//! Host logging policy. The default comes from `config.toml` (`[logging] mode`); the daemon holds the current policy in
//! memory and changes it at runtime for the CLI and the Mac app (see `Daemon::set_logging`). A runtime change is
//! temporary: it lasts until it expires or the daemon restarts. The collector and the Mac app follow the daemon's policy.
//! The sandbox gets read-only access to `logs/`, never to the control socket next to it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const FILE_BYTES: usize = 2 * 1024 * 1024;
pub const FILES: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum Policy {
    #[default]
    Info,
    Debug {
        expiration: Expiration,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Expiration {
    /// An absolute deadline, so re-reading never extends it.
    Until { unix_ms: u64 },
    /// Until changed (a runtime change also ends when the daemon restarts).
    Manual,
}

/// The configured default (`[logging] mode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Info,
    Debug,
}

impl Mode {
    pub fn policy(self) -> Policy {
        match self {
            Self::Info => Policy::Info,
            Self::Debug => Policy::Debug {
                expiration: Expiration::Manual,
            },
        }
    }
}

impl Policy {
    /// The policy in effect at `now`: an expired deadline gives way to `expired` (the configured default).
    pub fn effective(&self, now: u64, expired: Mode) -> Self {
        match self {
            Self::Info => Self::Info,
            Self::Debug {
                expiration: Expiration::Manual,
            } => self.clone(),
            Self::Debug {
                expiration: Expiration::Until { unix_ms },
            } => {
                if now < *unix_ms {
                    self.clone()
                } else {
                    expired.policy()
                }
            }
        }
    }

    /// Debug for the next hour.
    pub fn for_one_hour() -> Self {
        Self::Debug {
            expiration: Expiration::Until {
                unix_ms: now_ms() + 3_600_000,
            },
        }
    }
}

/// What the daemon reports: the policy in effect and the configured default it returns to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub policy: Policy,
    pub default: Mode,
}

impl State {
    /// With an expired deadline replaced by the default.
    pub fn effective(&self, now: u64) -> Self {
        Self {
            policy: self.policy.effective(now, self.default),
            default: self.default,
        }
    }
}

/// This process's policy: set by the daemon (from its config, then runtime changes) or by the collector (from the
/// daemon). The file logger reads it for every record.
static CURRENT: Mutex<State> = Mutex::new(State {
    policy: Policy::Info,
    default: Mode::Info,
});

/// The policy in effect now.
pub fn current() -> State {
    CURRENT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .effective(now_ms())
}

pub fn set(state: State) {
    *CURRENT.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = state;
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn root() -> PathBuf {
    std::env::var_os("PITON_LOGS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::config::home().join(".local/state/piton/logs"))
}

pub fn private_dir(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiration_is_exclusive_and_returns_to_the_default() {
        let policy = Policy::Debug {
            expiration: Expiration::Until { unix_ms: 5000 },
        };
        assert_eq!(policy.effective(4999, Mode::Info), policy);
        assert_eq!(policy.effective(5000, Mode::Info), Policy::Info);
        assert_eq!(policy.effective(5000, Mode::Debug), Mode::Debug.policy());
        let manual = Policy::Debug {
            expiration: Expiration::Manual,
        };
        assert_eq!(manual.effective(u64::MAX, Mode::Info), manual);
    }

    #[test]
    fn swift_wire_shapes() {
        let fixture = include_str!("../../apps/packages/PitonKit/Tests/Fixtures/logging-policies.json");
        for value in serde_json::from_str::<Vec<serde_json::Value>>(fixture).unwrap() {
            let policy: Policy = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(policy).unwrap(), value);
        }
        assert!(serde_json::from_value::<Policy>(serde_json::json!({"mode":"debug"})).is_err());
    }
}
