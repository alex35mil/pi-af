//! Embeds the git commit the binary was built from (`PITON_BUILD`), so a running daemon can say which build it is:
//! `<short sha>`, plus `-dirty` when the working tree had uncommitted changes, or `unknown` outside a git checkout.

use std::process::Command;

fn main() {
    let git = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    let build = match git(&["rev-parse", "--short=10", "HEAD"]) {
        Some(sha) => {
            // Untracked files don't change the binary; tracked changes do.
            let dirty = git(&["status", "--porcelain", "--untracked-files=no"]).is_some_and(|s| !s.is_empty());
            if dirty { format!("{sha}-dirty") } else { sha }
        }
        None => "unknown".to_string(),
    };
    println!("cargo:rustc-env=PITON_BUILD={build}");
    // Rebuild when HEAD moves or the index changes (a commit, a checkout, staging).
    if let Some(dir) = git(&["rev-parse", "--git-dir"]) {
        println!("cargo:rerun-if-changed={dir}/HEAD");
        println!("cargo:rerun-if-changed={dir}/index");
        if let Some(head) = git(&["symbolic-ref", "-q", "HEAD"]) {
            println!("cargo:rerun-if-changed={dir}/{head}");
        }
    }
}
