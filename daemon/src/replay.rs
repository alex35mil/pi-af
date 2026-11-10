//! pi's temporary state: what neither `get_state` nor `get_entries` contains, kept from the event stream as pi's
//! original records so a client that attaches mid-run gets it replayed (see "Replay" in docs/design.md). Also what
//! the session's status is derived from: a run, a compaction, a pending dialog.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Map, Value};
use tokio::time::Instant;

#[derive(Default)]
pub struct Replay {
    compaction: Option<Arc<str>>,
    /// The message started but not ended: its `message_start` and `message_update` records.
    message: Vec<Arc<str>>,
    /// Running tools in start order: `tool_execution_start` and the latest `tool_execution_update` (each update carries
    /// the tool's latest partial result).
    tools: Vec<RunningTool>,
    queue: Option<Arc<str>>,
    /// Pending dialogs in request order, with their expiry.
    dialogs: Vec<Dialog>,
    status: BTreeMap<String, Arc<str>>,
    widgets: BTreeMap<String, Arc<str>>,
    run_active: bool,
}

struct RunningTool {
    call_id: String,
    start: Arc<str>,
    update: Option<Arc<str>>,
}

struct Dialog {
    id: String,
    line: Arc<str>,
    expires: Option<Instant>,
    /// Asked during the current run, so it can't outlive the run.
    in_run: bool,
}

impl Dialog {
    fn pending(&self, now: Instant) -> bool {
        self.expires.is_none_or(|e| e > now)
    }
}

impl Replay {
    /// Follows one pi record (`kind` is its `type`; `line` the record as pi wrote it).
    pub fn track(&mut self, kind: &str, record: &Map<String, Value>, line: &Arc<str>) {
        match kind {
            "agent_start" => self.run_active = true,
            "agent_settled" => {
                self.run_active = false;
                self.message.clear();
                self.tools.clear();
                self.dialogs.retain(|d| !d.in_run);
            }
            "compaction_start" => self.compaction = Some(line.clone()),
            "compaction_end" => self.compaction = None,
            "message_start" => self.message = vec![line.clone()],
            "message_update" => {
                if !self.message.is_empty() {
                    self.message.push(line.clone());
                }
            }
            "message_end" => self.message.clear(),
            "tool_execution_start" => {
                if let Some(id) = str_field(record, "toolCallId") {
                    self.tools.push(RunningTool {
                        call_id: id,
                        start: line.clone(),
                        update: None,
                    });
                }
            }
            "tool_execution_update" => {
                if let Some(id) = str_field(record, "toolCallId")
                    && let Some(tool) = self.tools.iter_mut().find(|t| t.call_id == id)
                {
                    tool.update = Some(line.clone());
                }
            }
            "tool_execution_end" => {
                if let Some(id) = str_field(record, "toolCallId") {
                    self.tools.retain(|t| t.call_id != id);
                }
            }
            "queue_update" => self.queue = Some(line.clone()),
            "extension_ui_request" => self.track_ui(record, line),
            _ => {}
        }
    }

    fn track_ui(&mut self, record: &Map<String, Value>, line: &Arc<str>) {
        let method = record.get("method").and_then(Value::as_str).unwrap_or_default();
        match method {
            "select" | "confirm" | "input" | "editor" => {
                let Some(id) = str_field(record, "id") else { return };
                let expires = record
                    .get("timeout")
                    .and_then(Value::as_u64)
                    .map(|ms| Instant::now() + Duration::from_millis(ms));
                self.dialogs.push(Dialog {
                    id,
                    line: line.clone(),
                    expires,
                    in_run: self.run_active,
                });
            }
            "setStatus" => {
                let Some(key) = str_field(record, "statusKey") else {
                    return;
                };
                match record.get("statusText") {
                    Some(Value::String(_)) => self.status.insert(key, line.clone()),
                    Some(_) | None => self.status.remove(&key),
                };
            }
            "setWidget" => {
                let Some(key) = str_field(record, "widgetKey") else {
                    return;
                };
                match record.get("widgetLines") {
                    Some(Value::Array(_)) => self.widgets.insert(key, line.clone()),
                    Some(_) | None => self.widgets.remove(&key),
                };
            }
            _ => {}
        }
    }

    /// The conversation was replaced (switch, new session, fork, clone): its in-progress state is gone.
    pub fn forget_conversation(&mut self) {
        self.message.clear();
        self.tools.clear();
        self.queue = None;
    }

    /// The records to replay to a client that attaches now, in the order docs/design.md gives.
    pub fn frames(&mut self) -> Vec<Arc<str>> {
        let now = Instant::now();
        self.dialogs.retain(|d| d.pending(now));
        let mut out = Vec::new();
        out.extend(self.compaction.iter().cloned());
        out.extend(self.message.iter().cloned());
        for tool in &self.tools {
            out.push(tool.start.clone());
            out.extend(tool.update.iter().cloned());
        }
        out.extend(self.queue.iter().cloned());
        out.extend(self.dialogs.iter().map(|d| d.line.clone()));
        out.extend(self.status.values().cloned());
        out.extend(self.widgets.values().cloned());
        out
    }

    /// The in-progress message and running tools, for the session view's rebuild.
    pub fn live_lines(&self) -> Vec<Arc<str>> {
        let mut lines = self.message.clone();
        for tool in &self.tools {
            lines.push(tool.start.clone());
            lines.extend(tool.update.iter().cloned());
        }
        lines
    }

    /// Pending dialogs' `extension_ui_request` records, in request order.
    pub fn pending_dialogs(&self) -> impl Iterator<Item = &Arc<str>> {
        let now = Instant::now();
        self.dialogs.iter().filter(move |d| d.pending(now)).map(|d| &d.line)
    }

    pub fn has_dialog(&self, id: &str) -> bool {
        self.dialogs.iter().any(|d| d.id == id)
    }

    /// Takes a dialog's answer: true the first time for a pending dialog, false when it's answered, expired, or
    /// unknown (pi would ignore the answer).
    pub fn answer_dialog(&mut self, id: &str) -> bool {
        let Some(pos) = self.dialogs.iter().position(|d| d.id == id) else {
            return false;
        };
        self.dialogs.remove(pos);
        true
    }

    pub fn needs_input(&self) -> bool {
        self.pending_dialogs().next().is_some()
    }

    /// A run or a compaction is active.
    pub fn working(&self) -> bool {
        self.run_active || self.compaction.is_some()
    }
}

fn str_field(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key).and_then(Value::as_str).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn feed(replay: &mut Replay, records: &[Value]) {
        for record in records {
            let map = record.as_object().unwrap();
            let line: Arc<str> = record.to_string().into();
            replay.track(map["type"].as_str().unwrap(), map, &line);
        }
    }

    fn types(lines: &[Arc<str>]) -> Vec<String> {
        lines
            .iter()
            .map(|l| {
                let v: Value = serde_json::from_str(l).unwrap();
                v["type"].as_str().unwrap().to_string() + v["method"].as_str().map_or("", |_| ":ui")
            })
            .collect()
    }

    #[test]
    fn mid_run_state_replays_in_order_and_clears_when_settled() {
        let mut replay = Replay::default();
        feed(
            &mut replay,
            &[
                json!({"type":"agent_start"}),
                json!({"type":"tool_execution_start","toolCallId":"t1"}),
                json!({"type":"tool_execution_update","toolCallId":"t1","partialResult":1}),
                json!({"type":"tool_execution_update","toolCallId":"t1","partialResult":2}),
                json!({"type":"message_start"}),
                json!({"type":"message_update"}),
                json!({"type":"queue_update","followUp":["x"]}),
                json!({"type":"extension_ui_request","id":"d1","method":"confirm"}),
                json!({"type":"extension_ui_request","id":"s","method":"setStatus","statusKey":"k","statusText":"busy"}),
            ],
        );
        assert!(replay.working() && replay.needs_input());
        assert_eq!(
            types(&replay.frames()),
            [
                "message_start",
                "message_update",
                "tool_execution_start",
                "tool_execution_update",
                "queue_update",
                "extension_ui_request:ui",
                "extension_ui_request:ui"
            ]
        );
        assert!(
            replay.frames()[3].contains("\"partialResult\":2"),
            "only the latest update"
        );
        feed(&mut replay, &[json!({"type":"agent_settled"})]);
        assert!(
            !replay.working() && !replay.needs_input(),
            "a run's dialogs end with it"
        );
        assert_eq!(types(&replay.frames()), ["queue_update", "extension_ui_request:ui"]);
    }

    #[test]
    fn a_dialog_is_answered_once() {
        let mut replay = Replay::default();
        feed(
            &mut replay,
            &[json!({"type":"extension_ui_request","id":"d1","method":"select","options":["a"]})],
        );
        assert!(replay.has_dialog("d1"));
        assert!(replay.answer_dialog("d1"));
        assert!(!replay.answer_dialog("d1"));
        assert!(!replay.needs_input());
    }
}
