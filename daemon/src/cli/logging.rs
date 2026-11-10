//! `piton logging`: switch host logging through the daemon, and run or install the phone-log collector.

use std::process::ExitCode;

use super::LoggingAction;
use crate::config::Config;
use crate::diagnostics::{Expiration, Policy};
use crate::wire::{ControlRequest, ControlResponse};

pub async fn run(action: LoggingAction, config: &Config) -> ExitCode {
    let root = crate::diagnostics::root();
    let result: Result<(), String> = match action {
        LoggingAction::Status => logging_state(&config.socket, ControlRequest::Logging)
            .await
            .map(|state| {
                println!(
                    "{}",
                    serde_json::json!({"directory": root, "policy": state.policy, "default": state.default})
                );
            }),
        LoggingAction::Info => set(config, Policy::Info).await,
        LoggingAction::Debug { until_disabled } => {
            let policy = if until_disabled {
                Policy::Debug {
                    expiration: Expiration::Manual,
                }
            } else {
                Policy::for_one_hour()
            };
            set(config, policy).await
        }
        LoggingAction::Collect { device } => match host_only("device collection") {
            Ok(()) => {
                let _ = crate::log::init(&root.join("collector/current.log"));
                crate::collector::run(&root, &config.socket, &device)
                    .await
                    .map_err(|e| e.to_string())
            }
            Err(e) => Err(e),
        },
        LoggingAction::Install { device } => host_only("installing the collector").and_then(|()| {
            crate::service::install_collector(&device)
                .map(|p| println!("installed {}", p.display()))
                .map_err(|e| e.to_string())
        }),
        LoggingAction::Uninstall => host_only("uninstalling the collector").and_then(|()| {
            crate::service::uninstall_collector()
                .map(|p| println!("removed {}", p.display()))
                .map_err(|e| e.to_string())
        }),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            if std::env::var_os("PITON_SERVICE").is_some() {
                crate::log!("logging command failed: {error}");
                crate::log::flush();
            }
            eprintln!("piton logging: {error}");
            ExitCode::from(1)
        }
    }
}

fn host_only(what: &str) -> Result<(), String> {
    match std::env::var("PITON_RUNTIME").as_deref() {
        Ok("sandbox") => Err(format!("{what} is host-only")),
        Ok(_) | Err(_) => Ok(()),
    }
}

/// Switches the daemon's logging until the policy expires or the daemon restarts.
async fn set(config: &Config, policy: Policy) -> Result<(), String> {
    let state = logging_state(&config.socket, ControlRequest::SetLogging { policy }).await?;
    println!(
        "{}",
        serde_json::json!({"policy": state.policy, "default": state.default})
    );
    Ok(())
}

/// The daemon's logging state after `request` (`Logging` reads it, `SetLogging` switches it). Also the collector's gate.
pub async fn logging_state(
    socket: &std::path::Path,
    request: ControlRequest,
) -> Result<crate::diagnostics::State, String> {
    match super::control(socket, request).await? {
        ControlResponse::Logging { logging } => Ok(logging),
        ControlResponse::Error { message } => Err(message),
        other @ (ControlResponse::Sessions { .. }
        | ControlResponse::Started { .. }
        | ControlResponse::Stopped { .. }
        | ControlResponse::Worker { .. }
        | ControlResponse::Workers { .. }
        | ControlResponse::WorkerDeleted { .. }
        | ControlResponse::WorkerRefused { .. }) => Err(format!("unexpected response: {other:?}")),
    }
}
