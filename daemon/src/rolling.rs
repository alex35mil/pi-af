//! A bounded ring, used by daemon and collector. File work runs off the session/UI paths.
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub struct Rolling {
    path: PathBuf,
    limit: usize,
    files: usize,
    file: File,
    bytes: usize,
}

impl Rolling {
    pub fn open(path: &Path, limit: usize, files: usize) -> io::Result<Self> {
        assert!(limit > 0 && files > 0);
        if let Some(parent) = path.parent() {
            crate::diagnostics::private_dir(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        let bytes = file.metadata()?.len() as usize;
        let mut ring = Self {
            path: path.into(),
            limit,
            files,
            file,
            bytes,
        };
        // Bound files retained by a previous build too, not only new appends.
        for index in 0..files {
            let path = ring.archive(index);
            if path.metadata().is_ok_and(|m| m.len() > limit as u64) {
                OpenOptions::new().write(true).open(path)?.set_len(limit as u64)?;
            }
        }
        ring.bytes = ring.bytes.min(limit);
        Ok(ring)
    }

    fn archive(&self, index: usize) -> PathBuf {
        if index == 0 {
            self.path.clone()
        } else {
            self.path.with_extension(format!("log.{index}"))
        }
    }

    pub fn append(&mut self, bytes: &[u8]) -> io::Result<()> {
        let bytes = &bytes[..bytes.len().min(self.limit)];
        if self.bytes + bytes.len() > self.limit {
            match std::fs::remove_file(self.archive(self.files - 1)) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
            for index in (0..self.files - 1).rev() {
                match std::fs::rename(self.archive(index), self.archive(index + 1)) {
                    Ok(()) => {}
                    Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e),
                }
            }
            self.file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&self.path)?;
            self.bytes = 0;
        }
        self.file.write_all(bytes)?;
        self.bytes += bytes.len();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_after_many_writes_and_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("current.log");
        for _ in 0..3 {
            let mut ring = Rolling::open(&path, 64, 3).unwrap();
            for _ in 0..100 {
                ring.append(b"0123456789\n").unwrap();
            }
        }
        let files: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(Result::unwrap).collect();
        assert_eq!(files.len(), 3);
        assert!(files.iter().all(|f| f.metadata().unwrap().len() <= 64));
    }
    #[test]
    fn bounds_files_from_an_older_build_before_appending() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("current.log");
        std::fs::write(&path, vec![65; 1024]).unwrap();
        std::fs::write(path.with_extension("log.1"), vec![65; 1024]).unwrap();
        let mut ring = Rolling::open(&path, 64, 3).unwrap();
        ring.append(b"new").unwrap();
        assert!(
            std::fs::read_dir(dir.path())
                .unwrap()
                .map(Result::unwrap)
                .all(|f| f.metadata().unwrap().len() <= 64)
        );
    }

    #[test]
    fn one_file_and_oversized_record() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("current.log");
        let mut ring = Rolling::open(&path, 4, 1).unwrap();
        ring.append(b"too long").unwrap();
        ring.append(b"next!").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"next");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
