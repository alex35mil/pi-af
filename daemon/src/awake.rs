//! Keeps the Mac reachable while piton has live sessions: holds a prevent-idle-sleep assertion (`caffeinate -i`, an
//! IOKit assertion held for as long as the process runs) whenever keep-awake is on and at least one pi is running,
//! working or idle, so the phone can always reach a session it might want to steer. Released when the last session
//! ends or keep-awake is turned off (config `keep_awake`, toggled at runtime from the apps). The display may still
//! sleep and the screen lock; the daemon and Tailscale keep running. Lid-closed sleep on battery needs the privileged
//! helper (not built yet).

use std::sync::Arc;

use tokio::process::{Child, Command};

use crate::daemon::Daemon;

pub async fn run(daemon: Arc<Daemon>) {
    let notify = daemon.status_changed();
    let mut assertion: Option<Child> = None;
    loop {
        let live = daemon.session_count();
        let wanted = daemon.keep_awake() && live > 0;
        match (wanted, assertion.is_some()) {
            (true, false) => {
                assertion = Command::new("caffeinate")
                    .args(["-i", "-w"])
                    .arg(std::process::id().to_string())
                    .kill_on_drop(true)
                    .spawn()
                    .map_err(|e| crate::log!("keep-awake: caffeinate failed: {e}"))
                    .ok();
                if assertion.is_some() {
                    crate::log!("keep-awake: holding the Mac awake ({live} live session(s))");
                }
            }
            (false, true) => {
                if let Some(mut child) = assertion.take() {
                    let _ = child.kill().await;
                }
                crate::log!("keep-awake: released");
            }
            (true, true) | (false, false) => {}
        }
        notify.notified().await;
    }
}
