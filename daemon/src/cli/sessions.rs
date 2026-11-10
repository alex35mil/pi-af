//! `piton ls`, `piton start`, `piton stop`: live sessions.

use std::path::PathBuf;
use std::process::ExitCode;

use super::control::{control, report};
use crate::config::Config;
use crate::wire::{ControlRequest, ControlResponse, LaunchMode, SessionInfo};

pub async fn ls(config: &Config, json: bool) -> ExitCode {
    match control(&config.socket, ControlRequest::List).await {
        Ok(ControlResponse::Sessions { sessions }) => {
            print_sessions(&sessions, json);
            ExitCode::SUCCESS
        }
        other => report(other),
    }
}

pub async fn start(config: &Config, workspace: Option<PathBuf>, host: bool, prompt: Option<String>) -> ExitCode {
    let workspace = match workspace.map_or_else(std::env::current_dir, Ok) {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("piton: {e}");
            return ExitCode::from(2);
        }
    };
    let mode = if host { LaunchMode::Host } else { LaunchMode::Sandbox };
    let request = ControlRequest::Start {
        workspace,
        mode,
        prompt,
    };
    match control(&config.socket, request).await {
        Ok(ControlResponse::Started { session }) => {
            println!(
                "started {} in {} ({:?})",
                session.key,
                session.workspace.display(),
                session.mode
            );
            ExitCode::SUCCESS
        }
        other => report(other),
    }
}

pub async fn stop(config: &Config, session: String) -> ExitCode {
    match control(&config.socket, ControlRequest::Stop { session }).await {
        Ok(ControlResponse::Stopped { forced }) => {
            if forced {
                eprintln!("piton: pi didn't exit in time and was force-stopped");
            }
            ExitCode::SUCCESS
        }
        other => report(other),
    }
}

fn print_sessions(sessions: &[SessionInfo], json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(sessions).unwrap_or_default());
        return;
    }
    for s in sessions {
        println!(
            "{:>4}  {:<11} {:<8} clients={}  {}  {}",
            s.key,
            format!("{:?}", s.status).to_lowercase(),
            format!("{:?}", s.mode).to_lowercase(),
            s.clients,
            s.workspace.display(),
            s.id.as_deref().unwrap_or("-"),
        );
    }
}
