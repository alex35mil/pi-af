//! `piton worker create|ls|delete`: workers through the daemon. With `--json` it prints the daemon's response for
//! scripts and editor tooling (nvim's `cli.lua`); refusals exit 4 so callers can tell them from failures.

use std::path::PathBuf;
use std::process::ExitCode;

use super::WorkerAction;
use super::control::{control, report};
use crate::config::Config;
use crate::wire::{ControlRequest, ControlResponse};

/// Exit code for a refused worker operation, so callers can tell it from a failure.
const EXIT_REFUSED: u8 = 4;

pub async fn run(config: &Config, action: WorkerAction, json: bool) -> ExitCode {
    let here = || std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let request = match action {
        WorkerAction::Create {
            name,
            from,
            label,
            issue,
        } => ControlRequest::WorkerCreate(crate::worker::CreateRequest {
            from: from.unwrap_or_else(here),
            name,
            label,
            issue,
        }),
        WorkerAction::Ls { from } => ControlRequest::WorkerList {
            from: from.unwrap_or_else(here),
        },
        WorkerAction::Delete { path, force } => ControlRequest::WorkerDelete { path, force },
    };
    let response = match control(&config.socket, request).await {
        Ok(response) => response,
        Err(message) => return report(Err(message)),
    };
    let code = match &response {
        ControlResponse::Worker { .. } | ControlResponse::Workers { .. } | ControlResponse::WorkerDeleted { .. } => {
            ExitCode::SUCCESS
        }
        ControlResponse::WorkerRefused { .. } => ExitCode::from(EXIT_REFUSED),
        ControlResponse::Sessions { .. }
        | ControlResponse::Started { .. }
        | ControlResponse::Stopped { .. }
        | ControlResponse::Logging { .. }
        | ControlResponse::Error { .. } => ExitCode::from(1),
    };
    if json {
        println!("{}", serde_json::to_string(&response).unwrap_or_default());
        return code;
    }
    match response {
        ControlResponse::Worker { worker } => println!("{}", worker.path.display()),
        ControlResponse::Workers { workers } => {
            for w in workers {
                println!(
                    "{}  {}  sessions={}",
                    w.worker.path.display(),
                    w.worker.label,
                    w.sessions.len()
                );
            }
        }
        ControlResponse::WorkerDeleted { stopped, warning } => {
            if stopped > 0 {
                println!("stopped {stopped} session(s)");
            }
            if let Some(warning) = warning {
                eprintln!("piton: {warning}");
            }
        }
        ControlResponse::WorkerRefused { refusal } => {
            eprintln!("piton: {refusal}");
            if let crate::worker::WorkerRefusal::Leftovers { lines, .. }
            | crate::worker::WorkerRefusal::SourceDirty { status: lines, .. } = &refusal
            {
                for line in lines {
                    eprintln!("  {line}");
                }
            }
        }
        other @ (ControlResponse::Sessions { .. }
        | ControlResponse::Started { .. }
        | ControlResponse::Stopped { .. }
        | ControlResponse::Logging { .. }
        | ControlResponse::Error { .. }) => return report(Ok(other)),
    }
    code
}
