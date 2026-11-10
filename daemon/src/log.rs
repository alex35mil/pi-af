//! Bounded asynchronous logs. Session tasks never wait on file IO; overload drops records rather than growing memory.
//! Detailed records are kept only while `diagnostics::current()` (set in memory by the daemon or collector) allows them.

use std::io::Write;
use std::path::Path;
use std::sync::{OnceLock, mpsc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::diagnostics::{self, Policy};
use crate::rolling::Rolling;

#[derive(Clone, Copy)]
pub enum Detail {
    Info,
    Debug,
}

enum Record {
    Event { detail: Detail, line: String },
    Flush(mpsc::Sender<()>),
}

static FILE: OnceLock<mpsc::SyncSender<Record>> = OnceLock::new();

pub fn init(path: &Path) -> std::io::Result<()> {
    let mut ring = Rolling::open(path, diagnostics::FILE_BYTES, diagnostics::FILES)?;
    let (tx, rx) = mpsc::sync_channel::<Record>(256);
    let _ = FILE.set(tx);
    std::thread::Builder::new()
        .name("piton.logging".into())
        .spawn(move || {
            let mut budget = 0;
            let mut total = 0;
            let mut window = Instant::now();
            while let Ok(record) = rx.recv() {
                let (detail, line) = match record {
                    Record::Event { detail, line } => (detail, line),
                    Record::Flush(done) => {
                        let _ = done.send(());
                        continue;
                    }
                };
                if window.elapsed() >= Duration::from_secs(1) {
                    budget = 0;
                    total = 0;
                    window = Instant::now();
                }
                match (diagnostics::current().policy, detail) {
                    (Policy::Info, Detail::Debug) => continue,
                    (Policy::Info, Detail::Info) | (Policy::Debug { .. }, Detail::Info) => {}
                    (Policy::Debug { .. }, Detail::Debug) => {
                        if budget >= 20 {
                            continue;
                        }
                        budget += 1;
                    }
                }
                if total >= 100 {
                    continue;
                }
                total += 1;
                // No recursive logging on disk full or permission errors.
                let _ = ring.append(line.as_bytes());
            }
        })?;
    Ok(())
}

pub fn write(line: std::fmt::Arguments<'_>) {
    record(Detail::Info, line);
}

pub fn record(detail: Detail, line: std::fmt::Arguments<'_>) {
    let mut line = format!("{} {line}\n", timestamp());
    if line.len() > 8192 {
        let mut end = 8191;
        while !line.is_char_boundary(end) {
            end -= 1;
        }
        line.truncate(end);
        line.push('\n');
    }
    // launchd uses the bounded file, not an unbounded second copy on stderr.
    match detail {
        Detail::Info => {
            if std::env::var_os("PITON_SERVICE").is_none() {
                let _ = std::io::stderr().write_all(line.as_bytes());
            }
        }
        Detail::Debug => {}
    }
    if let Some(file) = FILE.get() {
        let _ = file.try_send(Record::Event { detail, line });
    }
}

/// Startup failures happen before the async logger is initialized. Never persist a config parser snippet or secrets.
pub fn startup_error(event: &str) {
    if std::env::var_os("PITON_SERVICE").is_none() {
        return;
    }
    if let Ok(mut ring) = Rolling::open(
        &diagnostics::root().join("daemon/current.log"),
        diagnostics::FILE_BYTES,
        diagnostics::FILES,
    ) {
        let _ = ring.append(format!("{} startup.{event}\n", timestamp()).as_bytes());
    }
}

/// Only called during shutdown, never from a session task.
pub fn flush() {
    if let Some(file) = FILE.get() {
        let (tx, rx) = mpsc::channel();
        if file.try_send(Record::Flush(tx)).is_ok() {
            let _ = rx.recv_timeout(Duration::from_secs(1));
        }
    }
}

/// UTC `YYYY-MM-DDTHH:MM:SS.mmmZ` without a date library.
fn timestamp() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs();
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        now.subsec_millis()
    )
}

/// Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[macro_export]
macro_rules! log {
    ($($arg:tt)*) => { $crate::log::write(format_args!($($arg)*)) };
}

#[macro_export]
macro_rules! debug {
    ($($arg:tt)*) => { $crate::log::record($crate::log::Detail::Debug, format_args!($($arg)*)) };
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    #[test]
    fn civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_399), (2025, 11, 7));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }
}
