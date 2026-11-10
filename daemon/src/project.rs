//! A workspace's relation to its project: whether it's a source checkout or a worker cloned from one, and the
//! per-project settings in the source's `.piton.toml`.
//!
//! Everything that decides the sandbox (the nono overlay, the shared artifacts folder, the project config) is read
//! from the **source** checkout, never from a worker, so an agent can't widen its own sandbox by editing files in its
//! clone. The relation itself comes from the worker's local git config (`agent.source`), which lives in `.git/` and
//! is checked against the folder layout (`<parent>/<repo>--<name>` next to `<parent>/<repo>`).

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

/// The project config file, read from the source checkout.
pub const PROJECT_CONFIG: &str = ".piton.toml";
/// The nono profile fragment layered over the base profile, read from the source checkout.
pub const NONO_OVERLAY: &str = ".nono.json";
/// This machine's additions to the overlay (gitignored), read from the source checkout. It can only add to
/// `NONO_OVERLAY`: grants for paths that exist here, such as a neighbouring checkout.
pub const NONO_LOCAL_OVERLAY: &str = ".nono.local.json";
/// The only path a worker shares with its source, as a symlink (the pi package's workflow artifacts).
pub const SHARED_PATH: &str = ".project/.local";
/// Separator between a source's folder name and a worker's name.
pub const WORKER_SEPARATOR: &str = "--";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Relation {
    /// A checkout that isn't a worker (or isn't a git repository at all).
    Source,
    /// A worker cloned from `source`, named `name` (`<repo>--<name>`).
    Worker { source: PathBuf, name: String },
}

#[derive(Debug, Clone)]
pub struct Workspace {
    /// The workspace pi runs in (canonical): a checkout or a folder inside one.
    pub path: PathBuf,
    /// The checkout `path` is in (its top folder), or `path` itself when it isn't in one.
    pub checkout: PathBuf,
    /// What `checkout` is.
    pub relation: Relation,
}

impl Workspace {
    /// The checkout whose files decide this workspace's sandbox and settings: never a worker, and never a folder inside
    /// a checkout, both of which an agent working there could edit.
    pub fn source(&self) -> &Path {
        match &self.relation {
            Relation::Source => &self.checkout,
            Relation::Worker { source, .. } => source,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error(
        "{path} says it's a worker of {claimed}, but it isn't laid out as one (expected <parent>/<repo>{WORKER_SEPARATOR}<name> next to <parent>/<repo>)"
    )]
    BadWorker { path: PathBuf, claimed: PathBuf },
    #[error("can't read {path}: {source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("invalid {path}: {source}")]
    Parse {
        path: PathBuf,
        source: Box<toml::de::Error>,
    },
    #[error("invalid {path}: {reason}")]
    Invalid { path: PathBuf, reason: String },
}

/// Resolves `path` (canonical) to a workspace: the checkout it's in and what that checkout is. A checkout with
/// `agent.source` in its local git config is a worker; the claim is accepted only when the layout matches, so a stray
/// config value can't point a sandbox elsewhere. Every enclosing checkout is considered, nearest first, so a nested
/// repository inside a worker (a submodule) is still part of that worker.
pub fn resolve(path: &Path) -> Result<Workspace, ProjectError> {
    let mut nearest: Option<&Path> = None;
    for checkout in path.ancestors().filter(|dir| dir.join(".git").exists()) {
        nearest = nearest.or(Some(checkout));
        let Some(source) = git_config_local(checkout, "agent.source") else {
            continue;
        };
        let source = std::fs::canonicalize(&source).unwrap_or_else(|_| PathBuf::from(&source));
        let Some(name) = worker_name(checkout, &source) else {
            return Err(ProjectError::BadWorker {
                path: checkout.to_path_buf(),
                claimed: source,
            });
        };
        return Ok(Workspace {
            path: path.to_path_buf(),
            checkout: checkout.to_path_buf(),
            relation: Relation::Worker { source, name },
        });
    }
    Ok(Workspace {
        path: path.to_path_buf(),
        checkout: nearest.unwrap_or(path).to_path_buf(),
        relation: Relation::Source,
    })
}

/// A worker's name: `<name>` in `<repo>--<name>`, for a worker laid out next to its source.
pub fn worker_name(worker: &Path, source: &Path) -> Option<String> {
    if !is_worker_layout(worker, source) {
        return None;
    }
    let (wn, sn) = (
        worker.file_name()?.to_string_lossy(),
        source.file_name()?.to_string_lossy(),
    );
    Some(wn[sn.len() + WORKER_SEPARATOR.len()..].to_string())
}

/// `worker` is `<parent>/<repo>--<name>` and `source` is `<parent>/<repo>`.
pub fn is_worker_layout(worker: &Path, source: &Path) -> bool {
    let (Some(wp), Some(sp)) = (worker.parent(), source.parent()) else {
        return false;
    };
    let (Some(wn), Some(sn)) = (worker.file_name(), source.file_name()) else {
        return false;
    };
    let (wn, sn) = (wn.to_string_lossy(), sn.to_string_lossy());
    wp == sp && wn.len() > sn.len() + WORKER_SEPARATOR.len() && wn.starts_with(&format!("{sn}{WORKER_SEPARATOR}"))
}

/// `key` in the local config of the repository rooted at `path` (callers check that `path` has a `.git`).
fn git_config_local(path: &Path, key: &str) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["config", "--local", "--get", key])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

/// `.piton.toml` in a source checkout.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ProjectConfig {
    pub workers: WorkersConfig,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WorkersConfig {
    /// Paths relative to the source not copied into a new worker (in addition to the shared artifacts folder), for
    /// example editor indexes that break when copied. Only affects the copy; it can't widen anything.
    pub skip: Vec<String>,
}

impl ProjectConfig {
    pub fn load(source: &Path) -> Result<Self, ProjectError> {
        let path = source.join(PROJECT_CONFIG);
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(source) => return Err(ProjectError::Read { path, source }),
        };
        let config: Self = toml::from_str(&text).map_err(|source| ProjectError::Parse {
            path: path.clone(),
            source: Box::new(source),
        })?;
        for skip in &config.workers.skip {
            validate_relative(skip).map_err(|reason| ProjectError::Invalid {
                path: path.clone(),
                reason: format!("workers.skip {skip:?}: {reason}"),
            })?;
        }
        Ok(config)
    }
}

/// A plain relative path inside the checkout: no absolute paths, `..`, or empty segments.
pub fn validate_relative(path: &str) -> Result<(), &'static str> {
    if path.is_empty() || path.starts_with('/') {
        return Err("must be a relative path");
    }
    if path.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
        return Err("must not contain empty, `.`, or `..` segments");
    }
    Ok(())
}

/// The source's overlay: `.nono.json` and this machine's `.nono.local.json`, combined.
#[derive(Debug, PartialEq)]
pub enum Overlay {
    /// Neither file: the base profile alone.
    None,
    /// Only `.nono.json`: nono reads it where it is.
    File(PathBuf),
    /// `.nono.local.json` too: the combined profile, for the daemon to write where nono can read it (and the sandbox
    /// can't write it).
    Merged(serde_json::Value),
}

impl Overlay {
    /// Reads the source's overlay files. A file that isn't a JSON object, or a local file that would change rather
    /// than add to the committed one, refuses the launch.
    pub fn read(source: &Path) -> Result<Self, ProjectError> {
        let committed = read_json(&source.join(NONO_OVERLAY))?;
        let local = read_json(&source.join(NONO_LOCAL_OVERLAY))?;
        match (committed, local) {
            (None, None) => Ok(Overlay::None),
            (Some(_), None) => Ok(Overlay::File(source.join(NONO_OVERLAY))),
            (None, Some(local)) => Ok(Overlay::Merged(local)),
            (Some(mut committed), Some(local)) => {
                add(&mut committed, local, "").map_err(|reason| ProjectError::Invalid {
                    path: source.join(NONO_LOCAL_OVERLAY),
                    reason,
                })?;
                Ok(Overlay::Merged(committed))
            }
        }
    }
}

fn read_json(path: &Path) -> Result<Option<serde_json::Value>, ProjectError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(ProjectError::Read {
                path: path.into(),
                source,
            });
        }
    };
    match serde_json::from_str(&text) {
        Ok(value @ serde_json::Value::Object(_)) => Ok(Some(value)),
        Ok(_) => Err(ProjectError::Invalid {
            path: path.into(),
            reason: "must be a JSON object".into(),
        }),
        Err(e) => Err(ProjectError::Invalid {
            path: path.into(),
            reason: e.to_string(),
        }),
    }
}

/// Adds `extra` to `base`: objects merge key by key, lists gain the items they don't have, and a value both have must
/// be the same. So a local file can grant more, never change or remove what the committed one says.
fn add(base: &mut serde_json::Value, extra: serde_json::Value, at: &str) -> Result<(), String> {
    use serde_json::Value;
    match (base, extra) {
        (Value::Object(base), Value::Object(extra)) => {
            for (key, value) in extra {
                let path = format!("{at}.{key}");
                match base.get_mut(&key) {
                    Some(existing) => add(existing, value, &path)?,
                    None => {
                        base.insert(key, value);
                    }
                }
            }
            Ok(())
        }
        (Value::Array(base), Value::Array(extra)) => {
            for item in extra {
                if !base.contains(&item) {
                    base.push(item);
                }
            }
            Ok(())
        }
        (base, extra) if *base == extra => Ok(()),
        (_, _) => Err(format!(
            "`{}` would change a value of {NONO_OVERLAY}; the local file can only add",
            at.trim_start_matches('.')
        )),
    }
}

/// The nono arguments for a sandboxed pi in `workspace`, before `--`: the base profile, extended by the source's
/// overlay (`profile`, its path) when it has one; the workspace read-write; and the source's shared artifacts folder
/// when it has one.
pub fn sandbox_args(workspace: &Workspace, base_profile: &str, profile: Option<&Path>) -> Vec<String> {
    let source = workspace.source();
    let mut args: Vec<String> = vec!["run".into(), "-s".into()];
    match profile {
        // `--extends` takes a profile name only, so the overlay is the profile.
        Some(overlay) => args.extend([
            "--profile".into(),
            path_arg(overlay),
            "--extends".into(),
            base_profile.into(),
        ]),
        None => args.extend(["--profile".into(), base_profile.into()]),
    }
    args.push("--allow-cwd".into());
    let shared = source.join(SHARED_PATH);
    if shared.is_dir() {
        args.extend(["--allow".into(), path_arg(&shared)]);
    }
    args
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_layout() {
        let source = Path::new("/p/repo");
        assert!(is_worker_layout(Path::new("/p/repo--fix-x"), source));
        assert_eq!(
            worker_name(Path::new("/p/repo--fix-x"), source).as_deref(),
            Some("fix-x")
        );
        // A source whose own name contains the separator: the worker name is what follows the source's name.
        assert_eq!(
            worker_name(Path::new("/p/a--b--fix"), Path::new("/p/a--b")).as_deref(),
            Some("fix")
        );
        assert_eq!(worker_name(Path::new("/q/repo--fix-x"), source), None);
        assert!(!is_worker_layout(Path::new("/p/repo--"), source));
        assert!(!is_worker_layout(Path::new("/p/repox--fix"), source));
        assert!(!is_worker_layout(Path::new("/q/repo--fix"), source));
        assert!(!is_worker_layout(Path::new("/p/repo"), source));
    }

    #[test]
    fn relative_paths() {
        assert!(validate_relative("apps/.build/index-build").is_ok());
        assert!(validate_relative("/abs").is_err());
        assert!(validate_relative("a/../b").is_err());
        assert!(validate_relative("a//b").is_err());
        assert!(validate_relative("").is_err());
    }

    #[test]
    fn sandbox_args_use_the_source() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("repo");
        let worker = dir.path().join("repo--w");
        std::fs::create_dir_all(source.join(SHARED_PATH)).unwrap();
        std::fs::write(source.join(NONO_OVERLAY), "{}").unwrap();
        std::fs::create_dir_all(&worker).unwrap();
        // A worker's own overlay is ignored.
        std::fs::write(worker.join(NONO_OVERLAY), r#"{"filesystem":{"allow":["/"]}}"#).unwrap();

        let ws = Workspace {
            path: worker.clone(),
            checkout: worker.clone(),
            relation: Relation::Worker {
                source: source.clone(),
                name: "w".into(),
            },
        };
        // The overlay comes from the source; the worker's own is never read.
        let overlay = Overlay::read(ws.source()).unwrap();
        assert_eq!(overlay, Overlay::File(source.join(NONO_OVERLAY)));
        let args = sandbox_args(&ws, "piton", Some(&source.join(NONO_OVERLAY)));
        assert_eq!(
            args,
            [
                "run".to_string(),
                "-s".into(),
                "--profile".into(),
                path_arg(&source.join(NONO_OVERLAY)),
                "--extends".into(),
                "piton".into(),
                "--allow-cwd".into(),
                "--allow".into(),
                path_arg(&source.join(SHARED_PATH)),
            ]
        );
    }

    #[test]
    fn sandbox_args_without_overlay_or_artifacts() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace {
            path: dir.path().to_path_buf(),
            checkout: dir.path().to_path_buf(),
            relation: Relation::Source,
        };
        assert_eq!(Overlay::read(ws.source()).unwrap(), Overlay::None);
        assert_eq!(
            sandbox_args(&ws, "piton", None),
            ["run", "-s", "--profile", "piton", "--allow-cwd"]
        );
    }

    /// `.nono.local.json` adds this machine's grants to `.nono.json`; it can't change or remove what's committed.
    #[test]
    fn the_local_overlay_only_adds() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path();
        let write = |name: &str, text: &str| std::fs::write(source.join(name), text).unwrap();
        write(
            NONO_OVERLAY,
            r#"{"filesystem":{"read":["/a"],"allow":["/c"]},"network":{"open_port":[0]}}"#,
        );
        write(
            NONO_LOCAL_OVERLAY,
            r#"{"filesystem":{"read":["/a","/b"],"read_file":["/f"]},"network":{"open_port":[0]}}"#,
        );
        let Overlay::Merged(merged) = Overlay::read(source).unwrap() else {
            panic!("not merged");
        };
        assert_eq!(
            merged,
            serde_json::json!({
                "filesystem": {"read": ["/a", "/b"], "allow": ["/c"], "read_file": ["/f"]},
                "network": {"open_port": [0]},
            })
        );

        // Changing a committed value is refused, so is a file that isn't an object.
        write(
            NONO_LOCAL_OVERLAY,
            r#"{"network":{"network_profile":"open"},"filesystem":"/"}"#,
        );
        let err = Overlay::read(source).unwrap_err().to_string();
        assert!(err.contains("can only add"), "{err}");
        write(NONO_LOCAL_OVERLAY, "[]");
        assert!(Overlay::read(source).is_err());

        // A local file alone is the overlay.
        std::fs::remove_file(source.join(NONO_OVERLAY)).unwrap();
        write(NONO_LOCAL_OVERLAY, r#"{"filesystem":{"read":["/b"]}}"#);
        assert!(matches!(Overlay::read(source).unwrap(), Overlay::Merged(_)));
    }

    /// pi started in a folder inside a checkout takes the checkout's settings, not an overlay the folder has.
    #[test]
    fn subfolders_resolve_to_their_checkout() {
        let dir = tempfile::tempdir().unwrap();
        let repo = std::fs::canonicalize(dir.path()).unwrap().join("repo");
        let sub = repo.join("src/deep");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::write(sub.join(NONO_OVERLAY), r#"{"filesystem":{"allow":["/"]}}"#).unwrap();
        let ws = resolve(&sub).unwrap();
        assert_eq!(
            (ws.path.as_path(), ws.checkout.as_path()),
            (sub.as_path(), repo.as_path())
        );
        assert_eq!(ws.relation, Relation::Source);
        assert_eq!(ws.source(), repo.as_path());
        assert_eq!(Overlay::read(ws.source()).unwrap(), Overlay::None);
        // Outside any checkout, the folder stands for itself.
        let loose = std::fs::canonicalize(dir.path()).unwrap();
        assert_eq!(resolve(&loose).unwrap().checkout, loose);
    }
}
