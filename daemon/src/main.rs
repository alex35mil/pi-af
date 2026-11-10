mod awake;
mod cli;
mod collector;
mod config;
mod daemon;
mod diagnostics;
mod launch;
mod log;
mod project;
mod prompts;
mod replay;
mod rolling;
mod service;
mod session;
mod tailnet;
mod view;
mod viewconn;
mod websocket;
mod wire;
mod worker;
mod workspaces;

use std::process::ExitCode;

/// `<package version> (<git commit>[-dirty])`, from build.rs.
pub const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), " (", env!("PITON_BUILD"), ")");

fn main() -> ExitCode {
    cli::main()
}
