//! Workspaces the native apps can browse and start sessions in: git checkouts under the configured roots, one level
//! at a time (a root is a tree of grouping folders with repositories at varying depth).

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::config::expand_home;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Entry {
    /// A folder without `.git`: browse it further.
    Group { name: String, path: PathBuf },
    /// A git checkout: start sessions here.
    Workspace {
        name: String,
        path: PathBuf,
        /// The checkout this one was cloned from, when it's a worker.
        source: Option<PathBuf>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WorkspaceError {
    /// The config lists no roots (or none of them exists), so the apps can't browse or start sessions anywhere.
    #[error("no workspace roots configured: set `roots` in piton's config.toml")]
    NoRoots,
    #[error("{0} isn't under a configured root")]
    OutsideRoots(PathBuf),
    #[error("{0} isn't a folder")]
    NotAFolder(PathBuf),
    #[error("{0} isn't a git checkout")]
    NotACheckout(PathBuf),
}

/// The configured roots, canonical; roots that don't exist are left out.
pub fn roots(configured: &[String]) -> Vec<PathBuf> {
    configured
        .iter()
        .filter_map(|r| std::fs::canonicalize(expand_home(r)).ok())
        .filter(|p| p.is_dir())
        .collect()
}

/// `path` (canonical) is a root or inside one.
fn within(roots: &[PathBuf], path: &Path) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

/// The direct children of `path` (the roots when `None`): grouping folders and checkouts. Hidden folders are skipped;
/// a checkout isn't descended into.
pub fn browse(roots: &[PathBuf], path: Option<&Path>) -> Result<Vec<Entry>, WorkspaceError> {
    if roots.is_empty() {
        return Err(WorkspaceError::NoRoots);
    }
    let Some(path) = path else {
        return Ok(roots.iter().map(|root| entry(root)).collect());
    };
    let canonical = std::fs::canonicalize(path).map_err(|_| WorkspaceError::NotAFolder(path.into()))?;
    if !within(roots, &canonical) {
        return Err(WorkspaceError::OutsideRoots(canonical));
    }
    if !canonical.is_dir() {
        return Err(WorkspaceError::NotAFolder(canonical));
    }
    let mut entries: Vec<Entry> = std::fs::read_dir(&canonical)
        .map_err(|_| WorkspaceError::NotAFolder(canonical.clone()))?
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| entry(&e.path()))
        .collect();
    entries.sort_by_key(sort_key);
    Ok(entries)
}

/// Checks that a native app may start a session in `path`: a checkout under a root. Returns it canonical.
pub fn check_start(roots: &[PathBuf], path: &Path) -> Result<PathBuf, WorkspaceError> {
    if roots.is_empty() {
        return Err(WorkspaceError::NoRoots);
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| WorkspaceError::NotAFolder(path.into()))?;
    if !within(roots, &canonical) {
        return Err(WorkspaceError::OutsideRoots(canonical));
    }
    if !canonical.join(".git").exists() {
        return Err(WorkspaceError::NotACheckout(canonical));
    }
    Ok(canonical)
}

fn entry(path: &Path) -> Entry {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    if path.join(".git").exists() {
        let source = match crate::project::resolve(path).map(|w| w.relation) {
            Ok(crate::project::Relation::Worker { source, .. }) => Some(source),
            Ok(crate::project::Relation::Source) | Err(_) => None,
        };
        Entry::Workspace {
            name,
            path: path.into(),
            source,
        }
    } else {
        Entry::Group {
            name,
            path: path.into(),
        }
    }
}

/// Groups first, then workspaces; by name.
fn sort_key(entry: &Entry) -> (u8, String) {
    match entry {
        Entry::Group { name, .. } => (0, name.to_lowercase()),
        Entry::Workspace { name, .. } => (1, name.to_lowercase()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap().join("Projects");
        for p in [
            "personal/apps/app/.git",
            "personal/apps/app/src",
            "personal/libs/x/.git",
            ".hidden/y/.git",
        ] {
            std::fs::create_dir_all(root.join(p)).unwrap();
        }
        (dir, root)
    }

    #[test]
    fn browses_one_level() {
        let (_dir, root) = tree();
        let roots = vec![root.clone()];
        assert_eq!(browse(&roots, None).unwrap().len(), 1);
        let top = browse(&roots, Some(&root)).unwrap();
        assert_eq!(
            top,
            [Entry::Group {
                name: "personal".into(),
                path: root.join("personal")
            }]
        );
        let apps = browse(&roots, Some(&root.join("personal/apps"))).unwrap();
        assert_eq!(
            apps,
            [Entry::Workspace {
                name: "app".into(),
                path: root.join("personal/apps/app"),
                source: None
            }]
        );
    }

    #[test]
    fn refuses_outside_roots() {
        let (dir, root) = tree();
        let roots = vec![root.clone()];
        let outside = std::fs::canonicalize(dir.path()).unwrap();
        assert!(matches!(
            browse(&roots, Some(&outside)),
            Err(WorkspaceError::OutsideRoots(_))
        ));
        assert!(matches!(
            check_start(&roots, &outside),
            Err(WorkspaceError::OutsideRoots(_))
        ));
        // `..` can't climb out: paths are canonicalized first.
        assert!(matches!(
            check_start(&roots, &root.join("personal/../..")),
            Err(WorkspaceError::OutsideRoots(_))
        ));
        assert!(matches!(
            check_start(&roots, &root.join("personal")),
            Err(WorkspaceError::NotACheckout(_))
        ));
        assert!(check_start(&roots, &root.join("personal/apps/app")).is_ok());
    }

    #[test]
    fn no_roots_refuses_everything() {
        let (_dir, root) = tree();
        assert_eq!(browse(&[], None), Err(WorkspaceError::NoRoots));
        assert_eq!(browse(&[], Some(&root)), Err(WorkspaceError::NoRoots));
        assert_eq!(
            check_start(&[], &root.join("personal/apps/app")),
            Err(WorkspaceError::NoRoots)
        );
    }
}
