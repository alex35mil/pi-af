//! Remote access over the tailnet: who this Mac is, and whether a connection comes from one of the owner's devices.
//!
//! A peer is accepted only when Tailscale reports it belongs to the same user as this Mac, it isn't a tagged node (a
//! server, no user), it isn't shared in from another tailnet, and it isn't this Mac itself. The last rule matters:
//! sandboxed agents on this Mac can open network connections, and through the tailnet address they'd look like the
//! owner. Local clients use the Unix socket, which the sandbox can't reach.
//!
//! Identity comes from the `tailscale` CLI (`status --json`, `whois --json <ip:port>`), which talks to tailscaled.

use std::net::{IpAddr, SocketAddr};

use serde::Deserialize;
use tokio::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelfNode {
    pub user: u64,
    pub node: String,
    pub addresses: Vec<IpAddr>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Peer {
    pub user: u64,
    pub login: String,
    pub node: String,
    pub name: String,
    pub tagged: bool,
    pub shared: bool,
}

/// Why a connection was refused. Logged; the peer only sees the connection close.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Refusal {
    #[error("tailscale doesn't know {0}")]
    Unknown(SocketAddr),
    #[error("{name} belongs to {login}, not this Mac's user")]
    OtherUser { name: String, login: String },
    #[error("{name} is a tagged node")]
    Tagged { name: String },
    #[error("{name} is shared in from another tailnet")]
    Shared { name: String },
    #[error("connection from this Mac itself (local clients use the Unix socket)")]
    SelfNode,
    #[error("tailscale whois failed: {0}")]
    Whois(String),
}

#[derive(Debug, thiserror::Error)]
pub enum TailnetError {
    #[error("can't run tailscale: {0}")]
    Spawn(std::io::Error),
    #[error("tailscale {command} failed: {stderr}")]
    Failed { command: &'static str, stderr: String },
    #[error("unexpected tailscale output: {0}")]
    Parse(String),
    #[error("tailscale isn't running (backend state {0})")]
    NotRunning(String),
}

pub async fn self_node(cli: &str) -> Result<SelfNode, TailnetError> {
    let out = run(cli, &["status", "--json"], "status").await?;
    parse_status(&out)
}

pub async fn identify(cli: &str, peer: SocketAddr) -> Result<Peer, Refusal> {
    let out = run(cli, &["whois", "--json", &peer.to_string()], "whois")
        .await
        .map_err(|e| match e {
            TailnetError::Failed { stderr, .. } if stderr.contains("no match") || stderr.contains("not found") => {
                Refusal::Unknown(peer)
            }
            other @ (TailnetError::Spawn(_)
            | TailnetError::Failed { .. }
            | TailnetError::Parse(_)
            | TailnetError::NotRunning(_)) => Refusal::Whois(other.to_string()),
        })?;
    parse_whois(&out).map_err(|e| Refusal::Whois(e.to_string()))
}

/// The decision, separate from the CLI so it can be tested.
pub fn check(me: &SelfNode, peer: &Peer) -> Result<(), Refusal> {
    if peer.node == me.node {
        return Err(Refusal::SelfNode);
    }
    if peer.tagged {
        return Err(Refusal::Tagged {
            name: peer.name.clone(),
        });
    }
    if peer.shared {
        return Err(Refusal::Shared {
            name: peer.name.clone(),
        });
    }
    if peer.user != me.user {
        return Err(Refusal::OtherUser {
            name: peer.name.clone(),
            login: peer.login.clone(),
        });
    }
    Ok(())
}

/// How long a `tailscale` call may take; a hung tailscaled must not hold connections open.
const CLI_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

async fn run(cli: &str, args: &[&str], command: &'static str) -> Result<Vec<u8>, TailnetError> {
    let child = Command::new(cli)
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(CLI_TIMEOUT, child)
        .await
        .map_err(|_| TailnetError::Failed {
            command,
            stderr: format!("timed out after {}s", CLI_TIMEOUT.as_secs()),
        })?
        .map_err(TailnetError::Spawn)?;
    if !out.status.success() {
        return Err(TailnetError::Failed {
            command,
            stderr: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        });
    }
    Ok(out.stdout)
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Status {
    backend_state: String,
    #[serde(rename = "Self")]
    me: StatusSelf,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct StatusSelf {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "UserID")]
    user_id: u64,
    #[serde(rename = "TailscaleIPs", default)]
    tailscale_ips: Vec<IpAddr>,
}

fn parse_status(bytes: &[u8]) -> Result<SelfNode, TailnetError> {
    let status: Status = serde_json::from_slice(bytes).map_err(|e| TailnetError::Parse(e.to_string()))?;
    if status.backend_state != "Running" {
        return Err(TailnetError::NotRunning(status.backend_state));
    }
    Ok(SelfNode {
        user: status.me.user_id,
        node: status.me.id,
        addresses: status.me.tailscale_ips,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Whois {
    node: WhoisNode,
    user_profile: WhoisUser,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WhoisNode {
    #[serde(rename = "StableID")]
    stable_id: String,
    name: String,
    user: u64,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(rename = "SharerID", default)]
    sharer_id: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WhoisUser {
    #[serde(rename = "ID")]
    id: u64,
    login_name: String,
}

fn parse_whois(bytes: &[u8]) -> Result<Peer, TailnetError> {
    let whois: Whois = serde_json::from_slice(bytes).map_err(|e| TailnetError::Parse(e.to_string()))?;
    Ok(Peer {
        // A tagged node's `User` is the tagger, not an owner; `UserProfile` says who it is.
        user: whois.user_profile.id,
        login: whois.user_profile.login_name,
        node: whois.node.stable_id,
        name: whois.node.name.trim_end_matches('.').to_string(),
        tagged: !whois.node.tags.is_empty(),
        shared: whois.node.sharer_id.is_some_and(|s| s != 0) || whois.node.user != whois.user_profile.id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shaped like `tailscale status --json` and `tailscale whois --json` output, trimmed; the values are made up.
    const STATUS: &str = r#"{"BackendState":"Running","Self":{"ID":"nMyMac1CNTRL","UserID":123456789,
        "TailscaleIPs":["100.64.0.1","fd7a:115c:a1e0::1"],"HostName":"My Mac"}}"#;
    const WHOIS_SELF: &str = r#"{"Node":{"ID":1,"StableID":"nMyMac1CNTRL",
        "Name":"my-mac.example.ts.net.","User":123456789},
        "UserProfile":{"ID":123456789,"LoginName":"me@example.com","DisplayName":"Me"}}"#;

    fn whois(node: &str, user: u64, login: &str, tags: &str, sharer: &str) -> Vec<u8> {
        format!(
            r#"{{"Node":{{"StableID":"{node}","Name":"{node}.tail.ts.net.","User":{user},"Tags":{tags}{sharer}}},
            "UserProfile":{{"ID":{user},"LoginName":"{login}"}}}}"#
        )
        .into_bytes()
    }

    #[test]
    fn decisions() {
        let me = parse_status(STATUS.as_bytes()).unwrap();
        assert_eq!(me.user, 123456789);
        assert_eq!(me.addresses.len(), 2);
        let own = |node: &str| parse_whois(&whois(node, me.user, "me@example.com", "[]", "")).unwrap();

        assert_eq!(check(&me, &own("iphone")), Ok(()));
        assert_eq!(
            check(&me, &parse_whois(WHOIS_SELF.as_bytes()).unwrap()),
            Err(Refusal::SelfNode)
        );
        let other = parse_whois(&whois("theirs", 42, "bob@example.com", "[]", "")).unwrap();
        assert!(matches!(check(&me, &other), Err(Refusal::OtherUser { login, .. }) if login == "bob@example.com"));
        let tagged = parse_whois(&whois("server", me.user, "me@example.com", r#"["tag:ci"]"#, "")).unwrap();
        assert!(matches!(check(&me, &tagged), Err(Refusal::Tagged { .. })));
        let shared = parse_whois(&whois("guest", me.user, "me@example.com", "[]", r#","SharerID":99"#)).unwrap();
        assert!(matches!(check(&me, &shared), Err(Refusal::Shared { .. })));
    }

    #[test]
    fn not_running() {
        let stopped = r#"{"BackendState":"Stopped","Self":{"ID":"x","UserID":1}}"#;
        assert!(matches!(parse_status(stopped.as_bytes()), Err(TailnetError::NotRunning(s)) if s == "Stopped"));
    }
}
