//! The session view for native clients: a structured model of one pi conversation, built from pi's persisted entries
//! (`get_entries`) and kept current from the event stream, sent as a snapshot followed by numbered changes.
//!
//! - Items are a flat list in conversation order. A tool call is its own item, linked to the assistant message that
//!   made it (`message`) and to pi by `call_id`, so a client can render a timeline or nest tools under messages.
//! - Message content stays pi's JSON content blocks; the view models structure, not content.
//! - Tool output is a preview (tail, bounded); the full result is fetched on demand.
//! - Image data never travels in items, changes, or tool output: each image block becomes a reference
//!   `{"type": "image", "image": <id>, "mime_type"}`, fetched one at a time with `session.image`. A pasted screenshot is
//!   about 1 MB of base64; inline, a few of them make a snapshot too large for a phone's WebSocket.
//! - Every change has a sequence number. A client that drops sends its last one and gets the changes it missed, or a
//!   fresh snapshot when they're no longer kept. A conversation change (switch, new session, compaction) is a `reset`:
//!   clients replace everything with a new snapshot.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::wire::{LaunchMode, SessionStatus};

/// Changes kept for resuming clients.
const LOG_CAPACITY: usize = 5000;
/// Tool output preview bounds.
const PREVIEW_LINES: usize = 40;
const PREVIEW_BYTES: usize = 4096;
/// Snapshot / history window bounds.
pub const DEFAULT_WINDOW: usize = 50;
pub const MAX_WINDOW: usize = 200;

pub type ItemId = u64;
pub type ImageId = u64;

/// An image cut out of the conversation, served by `session.image`.
#[derive(Debug, Clone, Serialize)]
pub struct Image {
    pub mime_type: Option<String>,
    /// pi's base64 data, unchanged.
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Item {
    User {
        id: ItemId,
        timestamp: Option<i64>,
        /// pi's message content: a string or content blocks.
        content: Value,
    },
    Assistant {
        id: ItemId,
        timestamp: Option<i64>,
        /// pi's content blocks (text, thinking, toolCall). Streaming text arrives as `delta` changes.
        content: Vec<Value>,
        streaming: bool,
        stop_reason: Option<String>,
        error: Option<String>,
        model: Option<String>,
    },
    Tool {
        id: ItemId,
        call_id: String,
        /// The assistant item that made the call, when known.
        message: Option<ItemId>,
        name: String,
        args: Value,
        status: ToolStatus,
        /// The tail of the output's text, bounded; `truncated` when there's more (fetch with `session.tool_output`).
        preview: Option<String>,
        truncated: bool,
    },
    Summary {
        id: ItemId,
        kind: SummaryKind,
        text: String,
    },
    Notice {
        id: ItemId,
        level: NoticeLevel,
        text: String,
    },
    /// A message role the view doesn't model (bash executions, custom messages, future roles), passed through.
    Other {
        id: ItemId,
        role: String,
        timestamp: Option<i64>,
        message: Value,
    },
}

impl Item {
    pub fn id(&self) -> ItemId {
        match self {
            Item::User { id, .. }
            | Item::Assistant { id, .. }
            | Item::Tool { id, .. }
            | Item::Summary { id, .. }
            | Item::Notice { id, .. }
            | Item::Other { id, .. } => *id,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    /// Called by the model, not started yet.
    Pending,
    Running,
    Done,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryKind {
    Compaction,
    Branch,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeltaField {
    Text,
    Thinking,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Change {
    Append {
        item: Item,
    },
    Replace {
        item: Item,
    },
    /// Append `text` to `content[index][field]` of assistant item `item`.
    Delta {
        item: ItemId,
        index: usize,
        field: DeltaField,
        text: String,
    },
    State {
        state: ViewState,
    },
    /// The conversation changed; a new snapshot follows (clients replace everything).
    Reset,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ViewState {
    pub status: SessionStatus,
    pub workspace: PathBuf,
    pub mode: LaunchMode,
    pub session_id: Option<String>,
    pub session_file: Option<String>,
    pub session_name: Option<String>,
    pub title: Option<String>,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub queue: Queue,
    /// Pending extension dialogs, as pi's `extension_ui_request` records.
    pub dialogs: Vec<Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Queue {
    pub steering: Vec<String>,
    pub follow_up: Vec<String>,
}

/// What the session task supplies when the view's state is published.
pub struct StateInput {
    pub status: SessionStatus,
    pub workspace: PathBuf,
    pub mode: LaunchMode,
    pub session_id: Option<String>,
    pub session_file: Option<String>,
    pub dialogs: Vec<Value>,
}

/// A committed change, serialized once for every watcher.
#[derive(Debug, Clone)]
pub struct Committed {
    pub seq: u64,
    pub line: Arc<str>,
    pub reset: bool,
}

pub struct View {
    key: u64,
    items: Vec<Item>,
    next_id: ItemId,
    /// Tool items by pi's `toolCallId`.
    tools: HashMap<String, ItemId>,
    /// Full tool results by `toolCallId`, for `session.tool_output`.
    outputs: HashMap<String, Value>,
    /// Image data referenced from items and tool outputs, for `session.image`.
    images: HashMap<ImageId, Image>,
    next_image: ImageId,
    /// The assistant item being streamed.
    streaming: Option<ItemId>,
    seq: u64,
    log: VecDeque<Committed>,
    /// Records received while a `get_entries` is in flight.
    pending_reset: Option<Vec<(String, Map<String, Value>)>>,
    session_name: Option<String>,
    model: Option<String>,
    thinking_level: Option<String>,
    queue: Queue,
    state: Option<ViewState>,
}

impl View {
    pub fn new(key: u64) -> Self {
        Self {
            key,
            items: Vec::new(),
            next_id: 1,
            tools: HashMap::new(),
            outputs: HashMap::new(),
            images: HashMap::new(),
            next_image: 1,
            streaming: None,
            seq: 0,
            log: VecDeque::new(),
            pending_reset: None,
            session_name: None,
            model: None,
            thinking_level: None,
            queue: Queue::default(),
            state: None,
        }
    }

    // ----- Reading -----

    #[cfg(test)]
    pub fn seq(&self) -> u64 {
        self.seq
    }

    /// The first user message's text, shortened: the session's title in lists.
    pub fn title(&self) -> Option<String> {
        self.session_name.clone().or_else(|| {
            self.items.iter().find_map(|item| match item {
                Item::User { content, .. } => {
                    let text = text_of(content);
                    let line = text.lines().find(|l| !l.trim().is_empty())?.trim();
                    Some(shorten(line, 80))
                }
                Item::Assistant { .. }
                | Item::Tool { .. }
                | Item::Summary { .. }
                | Item::Notice { .. }
                | Item::Other { .. } => None,
            })
        })
    }

    pub fn snapshot(&self, limit: usize) -> Value {
        let limit = limit.clamp(1, MAX_WINDOW);
        let start = self.items.len().saturating_sub(limit);
        json!({
            "type": "snapshot",
            "session": self.key,
            "seq": self.seq,
            "items": &self.items[start..],
            "has_more": start > 0,
            "state": self.state,
        })
    }

    /// Items before `before`, newest `limit`.
    pub fn history(&self, before: ItemId, limit: usize) -> Value {
        let limit = limit.clamp(1, MAX_WINDOW);
        let end = self
            .items
            .iter()
            .position(|i| i.id() >= before)
            .unwrap_or(self.items.len());
        let start = end.saturating_sub(limit);
        json!({
            "type": "history",
            "session": self.key,
            "items": &self.items[start..end],
            "has_more": start > 0,
        })
    }

    pub fn tool_output(&self, call_id: &str) -> Option<&Value> {
        self.outputs.get(call_id)
    }

    pub fn image(&self, id: ImageId) -> Option<&Image> {
        self.images.get(&id)
    }

    /// Changes after `seq`, when they're all still kept and no reset happened since.
    pub fn changes_since(&self, seq: u64) -> Option<Vec<Arc<str>>> {
        if seq > self.seq {
            return None;
        }
        if seq == self.seq {
            return Some(Vec::new());
        }
        let first = self.log.front()?;
        if first.seq > seq + 1 {
            return None;
        }
        let missed: Vec<&Committed> = self.log.iter().filter(|c| c.seq > seq).collect();
        if missed.iter().any(|c| c.reset) {
            return None;
        }
        Some(missed.into_iter().map(|c| c.line.clone()).collect())
    }

    // ----- Changing -----

    pub fn commit(&mut self, change: Change) -> Committed {
        self.seq += 1;
        let reset = matches!(change, Change::Reset);
        let line: Arc<str> = json!({"type": "change", "session": self.key, "seq": self.seq, "change": change})
            .to_string()
            .into();
        let committed = Committed {
            seq: self.seq,
            line,
            reset,
        };
        self.log.push_back(committed.clone());
        if self.log.len() > LOG_CAPACITY {
            self.log.pop_front();
        }
        committed
    }

    /// The state to publish, when it changed.
    pub fn publish_state(&mut self, input: StateInput) -> Option<Change> {
        let state = ViewState {
            status: input.status,
            workspace: input.workspace,
            mode: input.mode,
            session_id: input.session_id,
            session_file: input.session_file,
            session_name: self.session_name.clone(),
            title: self.title(),
            model: self.model.clone(),
            thinking_level: self.thinking_level.clone(),
            queue: self.queue.clone(),
            dialogs: input.dialogs,
        };
        if self.state.as_ref() == Some(&state) {
            return None;
        }
        self.state = Some(state.clone());
        Some(Change::State { state })
    }

    /// From a `get_state` response.
    pub fn on_state_data(&mut self, data: &Map<String, Value>) {
        self.session_name = str_field(data, "sessionName");
        self.thinking_level = str_field(data, "thinkingLevel");
        self.model = data.get("model").and_then(|m| {
            m.get("name")
                .or_else(|| m.get("id"))
                .and_then(Value::as_str)
                .map(str::to_string)
        });
    }

    /// Starts a rebuild: records are held until `finish_reset`.
    pub fn begin_reset(&mut self) {
        if self.pending_reset.is_none() {
            self.pending_reset = Some(Vec::new());
        }
    }

    pub fn reset_pending(&self) -> bool {
        self.pending_reset.is_some()
    }

    /// Gives up a rebuild (the `get_entries` failed): the held records are applied to the current list.
    pub fn cancel_reset(&mut self) -> Vec<Change> {
        let held = self.pending_reset.take().unwrap_or_default();
        held.into_iter()
            .flat_map(|(kind, record)| self.apply(&kind, &record))
            .collect()
    }

    /// Rebuilds the list from a `get_entries` response. `live` are the records of pi's temporary state now (the
    /// in-progress message, running tools), applied after the persisted entries. Of the records held during the
    /// rebuild, only completions are applied (deduplicated): the in-progress state is covered by `live`.
    pub fn finish_reset(&mut self, data: &Map<String, Value>, live: &[Map<String, Value>]) -> Change {
        let held = self.pending_reset.take().unwrap_or_default();
        self.items.clear();
        self.tools.clear();
        self.outputs.clear();
        self.images.clear();
        self.streaming = None;
        let branch = active_branch(data);
        // A completion held during the rebuild may already be in the entries; each entry absorbs one such record.
        let mut persisted: HashMap<MessageKey, usize> = HashMap::new();
        for message in branch
            .iter()
            .filter_map(|e| e.get("message").and_then(Value::as_object))
        {
            *persisted.entry(MessageKey::of(message)).or_default() += 1;
        }
        for entry in &branch {
            self.apply_entry(entry);
        }
        for (kind, record) in held {
            match kind.as_str() {
                "message_end" => {
                    let key = record.get("message").and_then(Value::as_object).map(MessageKey::of);
                    match key.as_ref().and_then(|k| persisted.get_mut(k)).filter(|n| **n > 0) {
                        Some(n) => *n -= 1,
                        None => {
                            self.apply(&kind, &record);
                        }
                    }
                }
                "tool_execution_end" => {
                    self.apply(&kind, &record);
                }
                _ => {}
            }
        }
        for record in live {
            let kind = record
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            self.apply(&kind, record);
        }
        Change::Reset
    }

    /// Applies one pi event record; returns the changes to send.
    pub fn apply(&mut self, kind: &str, record: &Map<String, Value>) -> Vec<Change> {
        if let Some(held) = &mut self.pending_reset {
            held.push((kind.to_string(), record.clone()));
            return Vec::new();
        }
        match kind {
            "message_start" => self.on_message_start(record),
            "message_update" => self.on_message_update(record),
            "message_end" => match record.get("message") {
                Some(Value::Object(message)) => self.on_message(message, true),
                Some(_) | None => Vec::new(),
            },
            "tool_execution_start" => self.on_tool_event(record, ToolStatus::Running, None),
            "tool_execution_update" => {
                let partial = record.get("partialResult").cloned();
                self.on_tool_event(record, ToolStatus::Running, partial)
            }
            "tool_execution_end" => {
                let status = match record.get("isError").and_then(Value::as_bool) {
                    Some(true) => ToolStatus::Error,
                    Some(false) | None => ToolStatus::Done,
                };
                let result = record.get("result").cloned();
                self.on_tool_event(record, status, result)
            }
            "queue_update" => {
                self.queue = Queue {
                    steering: strings(record.get("steering")),
                    follow_up: strings(record.get("followUp")),
                };
                Vec::new()
            }
            "session_info_changed" => {
                self.session_name = str_field(record, "name");
                Vec::new()
            }
            "thinking_level_changed" => {
                self.thinking_level = str_field(record, "level");
                Vec::new()
            }
            "auto_retry_start" => {
                let text = format!(
                    "Retrying ({}/{}): {}",
                    record.get("attempt").and_then(Value::as_u64).unwrap_or(0),
                    record.get("maxAttempts").and_then(Value::as_u64).unwrap_or(0),
                    str_field(record, "errorMessage").unwrap_or_default()
                );
                vec![self.notice(NoticeLevel::Warning, text)]
            }
            "auto_retry_end" => match record.get("success").and_then(Value::as_bool) {
                Some(false) => {
                    let text = format!(
                        "Retries failed: {}",
                        str_field(record, "finalError").unwrap_or_default()
                    );
                    vec![self.notice(NoticeLevel::Error, text)]
                }
                Some(true) | None => Vec::new(),
            },
            "compaction_end" => match (
                record.get("aborted").and_then(Value::as_bool),
                str_field(record, "errorMessage"),
            ) {
                // pi's message already says what failed ("Compaction failed: Nothing to compact ...").
                (_, Some(error)) => vec![self.notice(NoticeLevel::Error, error)],
                (Some(true), None) => vec![self.notice(NoticeLevel::Info, "Compaction aborted".into())],
                // A successful compaction triggers a rebuild from entries (see the session task).
                (Some(false) | None, None) => Vec::new(),
            },
            "agent_settled" => match record.get("aborted").and_then(Value::as_bool) {
                Some(true) => {
                    let mut changes = self.end_streaming();
                    changes.push(self.notice(NoticeLevel::Info, "Aborted".into()));
                    changes
                }
                Some(false) | None => self.end_streaming(),
            },
            "extension_error" => {
                let text = format!(
                    "Extension error ({}): {}",
                    str_field(record, "extensionPath").unwrap_or_default(),
                    str_field(record, "error").unwrap_or_default()
                );
                vec![self.notice(NoticeLevel::Error, text)]
            }
            _ => Vec::new(),
        }
    }

    // ----- Internals -----

    fn next(&mut self) -> ItemId {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Replaces every image block in `value` (pi's `{"type": "image", "data", "mimeType"}`, at any depth) with a
    /// reference, keeping its data for `session.image`.
    fn detach_images(&mut self, value: &mut Value) {
        match value {
            Value::Object(map) => {
                let image = map.get("type").and_then(Value::as_str) == Some("image")
                    && map.get("data").is_some_and(Value::is_string);
                if !image {
                    for nested in map.values_mut() {
                        self.detach_images(nested);
                    }
                    return;
                }
                let Some(Value::String(data)) = map.remove("data") else {
                    return;
                };
                let mime_type = str_field(map, "mimeType");
                let id = self.next_image;
                self.next_image += 1;
                *value = json!({"type": "image", "image": id, "mime_type": mime_type});
                self.images.insert(id, Image { mime_type, data });
            }
            Value::Array(items) => {
                for nested in items {
                    self.detach_images(nested);
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
        }
    }

    fn push(&mut self, item: Item) -> Change {
        self.items.push(item.clone());
        Change::Append { item }
    }

    fn get_mut(&mut self, id: ItemId) -> Option<&mut Item> {
        self.items.iter_mut().rev().find(|i| i.id() == id)
    }

    fn replace(&self, id: ItemId) -> Option<Change> {
        self.items
            .iter()
            .rev()
            .find(|i| i.id() == id)
            .map(|item| Change::Replace { item: item.clone() })
    }

    fn notice(&mut self, level: NoticeLevel, text: String) -> Change {
        let id = self.next();
        self.push(Item::Notice { id, level, text })
    }

    /// A streamed message that never got its `message_end` (pi stopped mid-stream): mark it finished.
    fn end_streaming(&mut self) -> Vec<Change> {
        let Some(id) = self.streaming.take() else {
            return Vec::new();
        };
        if let Some(Item::Assistant { streaming, .. }) = self.get_mut(id) {
            *streaming = false;
        }
        self.replace(id).into_iter().collect()
    }

    fn apply_entry(&mut self, entry: &Map<String, Value>) {
        match entry.get("type").and_then(Value::as_str).unwrap_or_default() {
            "message" => {
                if let Some(Value::Object(message)) = entry.get("message") {
                    self.on_message(message, false);
                }
            }
            "compaction" => {
                let id = self.next();
                let text = str_field(entry, "summary").unwrap_or_default();
                self.push(Item::Summary {
                    id,
                    kind: SummaryKind::Compaction,
                    text,
                });
            }
            "branch_summary" => {
                let id = self.next();
                let text = str_field(entry, "summary").unwrap_or_default();
                self.push(Item::Summary {
                    id,
                    kind: SummaryKind::Branch,
                    text,
                });
            }
            "custom_message" if entry.get("display").and_then(Value::as_bool) == Some(true) => {
                let id = self.next();
                let timestamp = entry_timestamp(entry);
                let mut message = Value::Object(entry.clone());
                self.detach_images(&mut message);
                self.push(Item::Other {
                    id,
                    role: "custom".into(),
                    timestamp,
                    message,
                });
            }
            // Model, thinking-level, label, session info, usage, context edits, custom state: not shown.
            _ => {}
        }
    }

    fn on_message_start(&mut self, record: &Map<String, Value>) -> Vec<Change> {
        let Some(Value::Object(message)) = record.get("message") else {
            return Vec::new();
        };
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            // Other roles are added at their `message_end`, which carries the complete message.
            return Vec::new();
        }
        let timestamp = message.get("timestamp").and_then(Value::as_i64);
        let mut changes = self.end_streaming();
        let id = self.next();
        self.streaming = Some(id);
        changes.push(self.push(Item::Assistant {
            id,
            timestamp,
            content: Vec::new(),
            streaming: true,
            stop_reason: None,
            error: None,
            model: str_field(message, "model"),
        }));
        changes
    }

    fn on_message_update(&mut self, record: &Map<String, Value>) -> Vec<Change> {
        let Some(id) = self.streaming else {
            return Vec::new();
        };
        let Some(Value::Object(event)) = record.get("assistantMessageEvent") else {
            return Vec::new();
        };
        let Some(index) = event.get("contentIndex").and_then(Value::as_u64).map(|i| i as usize) else {
            return Vec::new();
        };
        let kind = event.get("type").and_then(Value::as_str).unwrap_or_default();
        let mut tool_call: Option<Value> = None;
        {
            let Some(Item::Assistant { content, .. }) = self.get_mut(id) else {
                return Vec::new();
            };
            while content.len() <= index {
                content.push(Value::Null);
            }
            match kind {
                "text_start" => content[index] = json!({"type": "text", "text": ""}),
                "thinking_start" => content[index] = json!({"type": "thinking", "thinking": ""}),
                "text_delta" | "thinking_delta" => {
                    let (field, key) = match kind {
                        "text_delta" => (DeltaField::Text, "text"),
                        _ => (DeltaField::Thinking, "thinking"),
                    };
                    let delta = event
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    if let Value::Object(block) = &mut content[index] {
                        let current = block.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
                        block.insert(key.into(), Value::String(current + &delta));
                    }
                    return vec![Change::Delta {
                        item: id,
                        index,
                        field,
                        text: delta,
                    }];
                }
                "text_end" | "thinking_end" => {
                    let key = if kind == "text_end" { "text" } else { "thinking" };
                    if let (Some(Value::String(text)), Value::Object(block)) =
                        (event.get("content"), &mut content[index])
                    {
                        block.insert(key.into(), Value::String(text.clone()));
                    }
                }
                "toolcall_start" => {
                    content[index] = json!({
                        "type": "toolCall",
                        "id": event.get("id").cloned().unwrap_or(Value::Null),
                        "name": event.get("toolName").cloned().unwrap_or(Value::Null),
                        "arguments": {},
                    });
                }
                "toolcall_end" => {
                    if let Some(call) = event.get("toolCall") {
                        content[index] = call.clone();
                        tool_call = Some(call.clone());
                    }
                }
                // Argument deltas and provider-level events: the final block replaces them.
                _ => return Vec::new(),
            }
        }
        let mut changes: Vec<Change> = self.replace(id).into_iter().collect();
        if let Some(call) = tool_call {
            changes.extend(self.ensure_tool(&call, Some(id)));
        }
        changes
    }

    /// A complete message: a `message_end` (`live`) or a persisted entry.
    fn on_message(&mut self, message: &Map<String, Value>, live: bool) -> Vec<Change> {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let timestamp = message.get("timestamp").and_then(Value::as_i64);
        let mut message = message.clone();
        for value in message.values_mut() {
            self.detach_images(value);
        }
        let message = &message;
        match role.as_str() {
            "system" => Vec::new(),
            "user" => {
                let id = self.next();
                vec![self.push(Item::User {
                    id,
                    timestamp,
                    content: message.get("content").cloned().unwrap_or(Value::Null),
                })]
            }
            "assistant" => {
                let content: Vec<Value> = match message.get("content") {
                    Some(Value::Array(blocks)) => blocks.clone(),
                    Some(_) | None => Vec::new(),
                };
                let stop_reason = str_field(message, "stopReason");
                let error = str_field(message, "errorMessage");
                let model = str_field(message, "model");
                let mut changes = Vec::new();
                let id = match self.streaming.filter(|_| live) {
                    Some(id) => {
                        self.streaming = None;
                        if let Some(Item::Assistant {
                            content: c,
                            streaming,
                            stop_reason: s,
                            error: e,
                            model: m,
                            ..
                        }) = self.get_mut(id)
                        {
                            *c = content.clone();
                            *streaming = false;
                            *s = stop_reason;
                            *e = error;
                            *m = model;
                        }
                        changes.extend(self.replace(id));
                        id
                    }
                    None => {
                        let id = self.next();
                        changes.push(self.push(Item::Assistant {
                            id,
                            timestamp,
                            content: content.clone(),
                            streaming: false,
                            stop_reason,
                            error,
                            model,
                        }));
                        id
                    }
                };
                for block in &content {
                    if block.get("type").and_then(Value::as_str) == Some("toolCall") {
                        changes.extend(self.ensure_tool(block, Some(id)));
                    }
                }
                changes
            }
            "toolResult" => {
                let Some(call_id) = str_field(message, "toolCallId") else {
                    return Vec::new();
                };
                let status = match message.get("isError").and_then(Value::as_bool) {
                    Some(true) => ToolStatus::Error,
                    Some(false) | None => ToolStatus::Done,
                };
                let result = json!({"content": message.get("content").cloned().unwrap_or(Value::Null)});
                let mut changes = Vec::new();
                if !self.tools.contains_key(&call_id) {
                    let call = json!({"id": call_id, "name": str_field(message, "toolName"), "arguments": {}});
                    changes.extend(self.ensure_tool(&call, None));
                }
                changes.extend(self.set_tool(&call_id, status, Some(result)));
                changes
            }
            "compactionSummary" | "branchSummary" => {
                let id = self.next();
                let kind = if role == "compactionSummary" {
                    SummaryKind::Compaction
                } else {
                    SummaryKind::Branch
                };
                vec![self.push(Item::Summary {
                    id,
                    kind,
                    text: str_field(message, "summary").unwrap_or_default(),
                })]
            }
            "custom" if message.get("display").and_then(Value::as_bool) != Some(true) => Vec::new(),
            _ => {
                let id = self.next();
                vec![self.push(Item::Other {
                    id,
                    role,
                    timestamp,
                    message: Value::Object(message.clone()),
                })]
            }
        }
    }

    /// Adds the tool item for a `toolCall` block if it isn't in the list yet.
    fn ensure_tool(&mut self, call: &Value, message: Option<ItemId>) -> Vec<Change> {
        let Some(call_id) = call.get("id").and_then(Value::as_str).map(str::to_string) else {
            return Vec::new();
        };
        if let Some(&existing) = self.tools.get(&call_id) {
            // Learned the arguments or the message later (a call first seen from its execution events).
            let args = call.get("arguments").cloned();
            if let Some(Item::Tool {
                args: a, message: m, ..
            }) = self.get_mut(existing)
            {
                if let Some(args) = args.filter(|a| a.as_object().is_some_and(|o| !o.is_empty())) {
                    *a = args;
                }
                if m.is_none() {
                    *m = message;
                }
            }
            return self.replace(existing).into_iter().collect();
        }
        let id = self.next();
        self.tools.insert(call_id.clone(), id);
        vec![self.push(Item::Tool {
            id,
            call_id,
            message,
            name: call.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
            args: call.get("arguments").cloned().unwrap_or(Value::Null),
            status: ToolStatus::Pending,
            preview: None,
            truncated: false,
        })]
    }

    fn on_tool_event(&mut self, record: &Map<String, Value>, status: ToolStatus, result: Option<Value>) -> Vec<Change> {
        let Some(call_id) = str_field(record, "toolCallId") else {
            return Vec::new();
        };
        let mut changes = Vec::new();
        if !self.tools.contains_key(&call_id) {
            let call = json!({
                "id": call_id,
                "name": record.get("toolName").cloned().unwrap_or(Value::Null),
                "arguments": record.get("args").cloned().unwrap_or(Value::Null),
            });
            changes.extend(self.ensure_tool(&call, self.streaming));
        }
        changes.extend(self.set_tool(&call_id, status, result));
        changes
    }

    fn set_tool(&mut self, call_id: &str, status: ToolStatus, result: Option<Value>) -> Vec<Change> {
        let Some(&id) = self.tools.get(call_id) else {
            return Vec::new();
        };
        let preview = result.as_ref().map(|r| preview(r.get("content").unwrap_or(r)));
        if let Some(mut result) = result
            && matches!(status, ToolStatus::Done | ToolStatus::Error)
        {
            self.detach_images(&mut result);
            // `tool_execution_end` and the `toolResult` message both carry the result: keep one copy of its images.
            if let Some(old) = self.outputs.insert(call_id.to_string(), result) {
                let mut stale = Vec::new();
                image_refs(&old, &mut stale);
                for id in stale {
                    self.images.remove(&id);
                }
            }
        }
        if let Some(Item::Tool {
            status: s,
            preview: p,
            truncated: t,
            ..
        }) = self.get_mut(id)
        {
            // A finished tool stays finished: late `running` updates from a rebuild don't move it back.
            let finished = matches!(*s, ToolStatus::Done | ToolStatus::Error);
            if !(finished && matches!(status, ToolStatus::Running | ToolStatus::Pending)) {
                *s = status;
            }
            if let Some((text, truncated)) = preview {
                *p = Some(text);
                *t = truncated;
            }
        }
        self.replace(id).into_iter().collect()
    }
}

/// What identifies a message across pi's event stream and its persisted entries. Not the timestamp alone: messages queued
/// together (follow-ups, parallel tool results) share a millisecond.
#[derive(PartialEq, Eq, Hash)]
struct MessageKey {
    role: Option<String>,
    timestamp: Option<i64>,
    tool_call: Option<String>,
    content: String,
}

impl MessageKey {
    fn of(message: &Map<String, Value>) -> Self {
        Self {
            role: str_field(message, "role"),
            timestamp: message.get("timestamp").and_then(Value::as_i64),
            tool_call: str_field(message, "toolCallId"),
            content: message.get("content").map(Value::to_string).unwrap_or_default(),
        }
    }
}

/// The entries on the active branch, root first: follow `parentId` from `leafId`.
fn active_branch(data: &Map<String, Value>) -> Vec<Map<String, Value>> {
    let entries: Vec<&Map<String, Value>> = match data.get("entries") {
        Some(Value::Array(entries)) => entries.iter().filter_map(Value::as_object).collect(),
        Some(_) | None => return Vec::new(),
    };
    let by_id: HashMap<&str, &Map<String, Value>> = entries
        .iter()
        .filter_map(|e| e.get("id").and_then(Value::as_str).map(|id| (id, *e)))
        .collect();
    let mut branch = Vec::new();
    let mut cursor = data.get("leafId").and_then(Value::as_str);
    let mut guard = 0;
    while let Some(id) = cursor {
        let Some(entry) = by_id.get(id) else { break };
        branch.push((*entry).clone());
        cursor = entry.get("parentId").and_then(Value::as_str);
        guard += 1;
        if guard > entries.len() {
            break;
        }
    }
    branch.reverse();
    branch
}

/// The ids of the image references in `value`, at any depth.
fn image_refs(value: &Value, out: &mut Vec<ImageId>) {
    match value {
        Value::Object(map) => match (
            map.get("type").and_then(Value::as_str),
            map.get("image").and_then(Value::as_u64),
        ) {
            (Some("image"), Some(id)) => out.push(id),
            (Some(_) | None, Some(_) | None) => map.values().for_each(|v| image_refs(v, out)),
        },
        Value::Array(items) => items.iter().for_each(|v| image_refs(v, out)),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

/// The tail of a result's text content, bounded; and whether it was cut.
fn preview(content: &Value) -> (String, bool) {
    let text = text_of(content);
    let lines: Vec<&str> = text.lines().collect();
    // Images aren't in the text: the full output has them.
    let images = match content {
        Value::Array(blocks) => blocks
            .iter()
            .any(|b| b.get("type").and_then(Value::as_str) == Some("image")),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) | Value::Object(_) => false,
    };
    let mut truncated = images || lines.len() > PREVIEW_LINES;
    let mut out = lines[lines.len().saturating_sub(PREVIEW_LINES)..].join("\n");
    if out.len() > PREVIEW_BYTES {
        let mut cut = out.len() - PREVIEW_BYTES;
        while !out.is_char_boundary(cut) {
            cut += 1;
        }
        out = out[cut..].to_string();
        truncated = true;
    }
    (out, truncated)
}

/// The text of a content value: a string, or the `text` of its text blocks joined.
fn text_of(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::Object(_) => String::new(),
    }
}

fn shorten(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{}…", cut.trim_end())
}

fn str_field(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key).and_then(Value::as_str).map(str::to_string)
}

fn entry_timestamp(entry: &Map<String, Value>) -> Option<i64> {
    entry.get("timestamp").and_then(Value::as_i64)
}

fn strings(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).map(str::to_string).collect(),
        Some(_) | None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(v: Value) -> (String, Map<String, Value>) {
        let map = v.as_object().unwrap().clone();
        (map["type"].as_str().unwrap().to_string(), map)
    }

    fn apply_all(view: &mut View, records: Vec<Value>) -> Vec<Change> {
        records
            .into_iter()
            .flat_map(|r| {
                let (k, m) = rec(r);
                view.apply(&k, &m)
            })
            .collect()
    }

    fn entries(list: Vec<Value>) -> Map<String, Value> {
        let leaf = list.last().and_then(|e| e["id"].as_str()).map(str::to_string);
        json!({"entries": list, "leafId": leaf}).as_object().unwrap().clone()
    }

    /// A tool-using turn from pi 1.3.0's event stream (shape from docs/pi-findings.md).
    fn tool_turn() -> Vec<Value> {
        vec![
            json!({"type":"message_start","message":{"role":"system","content":"","timestamp":1}}),
            json!({"type":"message_end","message":{"role":"system","content":"","timestamp":1}}),
            json!({"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"run it"}],"timestamp":2}}),
            json!({"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"run it"}],"timestamp":2}}),
            json!({"type":"message_start","message":{"role":"assistant","content":[],"timestamp":3,"model":"m"}}),
            json!({"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}),
            json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Run"}}),
            json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"ning"}}),
            json!({"type":"message_update","assistantMessageEvent":{"type":"toolcall_start","contentIndex":1,"id":"c1","toolName":"bash"}}),
            json!({"type":"message_update","assistantMessageEvent":{"type":"toolcall_end","contentIndex":1,"toolCall":{"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"ls"}}}}),
            json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Running"},{"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"ls"}}],"timestamp":3,"stopReason":"toolUse"}}),
            json!({"type":"tool_execution_start","toolCallId":"c1","toolName":"bash","args":{"command":"ls"}}),
            json!({"type":"tool_execution_update","toolCallId":"c1","toolName":"bash","args":{},"partialResult":{"content":[{"type":"text","text":"a"}]}}),
            json!({"type":"tool_execution_end","toolCallId":"c1","toolName":"bash","result":{"content":[{"type":"text","text":"a\nb"}]},"isError":false}),
            json!({"type":"message_start","message":{"role":"toolResult","toolCallId":"c1","content":[{"type":"text","text":"a\nb"}],"timestamp":4}}),
            json!({"type":"message_end","message":{"role":"toolResult","toolCallId":"c1","toolName":"bash","content":[{"type":"text","text":"a\nb"}],"isError":false,"timestamp":4}}),
            json!({"type":"agent_settled","aborted":false}),
        ]
    }

    #[test]
    fn live_turn_builds_user_assistant_tool() {
        let mut view = View::new(1);
        let changes = apply_all(&mut view, tool_turn());
        assert!(
            changes
                .iter()
                .any(|c| matches!(c, Change::Delta { text, .. } if text == "ning"))
        );
        let snap = view.snapshot(50);
        let items = snap["items"].as_array().unwrap();
        let kinds: Vec<&str> = items.iter().map(|i| i["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["user", "assistant", "tool"]);
        assert_eq!(items[1]["streaming"], false);
        assert_eq!(items[1]["content"][0]["text"], "Running");
        assert_eq!(items[2]["call_id"], "c1");
        assert_eq!(items[2]["message"], items[1]["id"]);
        assert_eq!(items[2]["status"], "done");
        assert_eq!(items[2]["preview"], "a\nb");
        assert_eq!(items[2]["args"]["command"], "ls");
        assert_eq!(view.tool_output("c1").unwrap()["content"][0]["text"], "a\nb");
        assert_eq!(view.title().as_deref(), Some("run it"));
    }

    #[test]
    fn rebuild_from_entries_matches_and_dedupes() {
        let msg =
            |id: &str, parent: Option<&str>, m: Value| json!({"type":"message","id":id,"parentId":parent,"message":m});
        let data = entries(vec![
            json!({"type":"model_change","id":"e0","parentId":null}),
            msg(
                "e1",
                Some("e0"),
                json!({"role":"user","content":"run it","timestamp":2}),
            ),
            msg(
                "e2",
                Some("e1"),
                json!({"role":"assistant","content":[{"type":"text","text":"Running"},{"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"ls"}}],"timestamp":3}),
            ),
            msg(
                "e3",
                Some("e2"),
                json!({"role":"toolResult","toolCallId":"c1","toolName":"bash","content":[{"type":"text","text":"out"}],"isError":true,"timestamp":4}),
            ),
        ]);
        let mut view = View::new(1);
        view.begin_reset();
        // A completion that arrived while get_entries was in flight, already in the entries: not added twice.
        let held = data["entries"][2]["message"].clone();
        let (k, m) = rec(json!({"type":"message_end","message":held}));
        assert!(view.apply(&k, &m).is_empty(), "held during the rebuild");
        assert!(matches!(view.finish_reset(&data, &[]), Change::Reset));
        let snap = view.snapshot(50);
        let items = snap["items"].as_array().unwrap();
        let kinds: Vec<&str> = items.iter().map(|i| i["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["user", "assistant", "tool"]);
        assert_eq!(items[2]["status"], "error");
    }

    /// Compaction as pi 1.3.0 reports it (docs/pi-findings.md): a failure is a notice with pi's own message; a success
    /// leaves a `compaction` entry the rebuild shows as a summary.
    #[test]
    fn compaction() {
        let mut view = View::new(1);
        let changes = apply_all(
            &mut view,
            vec![
                json!({"type":"compaction_start","reason":"manual"}),
                json!({"type":"compaction_end","reason":"manual","aborted":false,"willRetry":false,"errorMessage":"Compaction failed: Nothing to compact (session too small)"}),
            ],
        );
        assert!(
            matches!(&changes[..], [Change::Append { item: Item::Notice { text, .. } }] if text == "Compaction failed: Nothing to compact (session too small)")
        );
        let ok = apply_all(
            &mut view,
            vec![
                json!({"type":"compaction_end","reason":"manual","aborted":false,"willRetry":false,"result":{"summary":"s"}}),
            ],
        );
        assert!(ok.is_empty(), "a success waits for the rebuild");
        let data = entries(vec![
            json!({"type":"message","id":"e1","parentId":null,"message":{"role":"user","content":"one","timestamp":1}}),
            json!({"type":"compaction","id":"e2","parentId":"e1","summary":"we talked","firstKeptEntryId":"e1"}),
        ]);
        view.begin_reset();
        view.finish_reset(&data, &[]);
        let snap = view.snapshot(50);
        assert_eq!(snap["items"][1]["type"], "summary");
        assert_eq!(snap["items"][1]["text"], "we talked");
    }

    /// Follow-ups queued together reach pi in one millisecond: each is its own message, live and across a rebuild.
    #[test]
    fn messages_sharing_a_timestamp_are_all_kept() {
        let user = |text: &str| json!({"role":"user","content":[{"type":"text","text":text}],"timestamp":7});
        let mut view = View::new(1);
        apply_all(
            &mut view,
            vec![
                json!({"type":"message_end","message":user("second")}),
                json!({"type":"message_end","message":user("third")}),
            ],
        );
        assert_eq!(view.snapshot(50)["items"].as_array().unwrap().len(), 2);

        // During a rebuild: "second" is already in the entries, "third" arrives only as an event.
        let data = entries(vec![
            json!({"type":"message","id":"e1","parentId":null,"message":user("second")}),
        ]);
        view.begin_reset();
        apply_all(
            &mut view,
            vec![
                json!({"type":"message_end","message":user("second")}),
                json!({"type":"message_end","message":user("third")}),
            ],
        );
        view.finish_reset(&data, &[]);
        let texts: Vec<String> = view.snapshot(50)["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["content"][0]["text"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(texts, ["second", "third"]);
    }

    #[test]
    fn rebuild_applies_live_in_progress_message() {
        let mut view = View::new(1);
        view.begin_reset();
        let live: Vec<Map<String, Value>> = [
            json!({"type":"message_start","message":{"role":"assistant","content":[],"timestamp":9}}),
            json!({"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}),
            json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"hal"}}),
        ]
        .into_iter()
        .map(|v| v.as_object().unwrap().clone())
        .collect();
        view.finish_reset(&entries(vec![]), &live);
        let snap = view.snapshot(50);
        assert_eq!(snap["items"][0]["streaming"], true);
        assert_eq!(snap["items"][0]["content"][0]["text"], "hal");
        // Later deltas continue the same item.
        apply_all(
            &mut view,
            vec![
                json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"f"}}),
            ],
        );
        assert_eq!(view.snapshot(50)["items"][0]["content"][0]["text"], "half");
    }

    #[test]
    fn active_branch_skips_abandoned_entries() {
        let msg = |id: &str, parent: Option<&str>, text: &str, ts: i64| json!({"type":"message","id":id,"parentId":parent,"message":{"role":"user","content":text,"timestamp":ts}});
        let mut data = entries(vec![
            msg("a", None, "one", 1),
            msg("b", Some("a"), "abandoned", 2),
            msg("c", Some("a"), "two", 3),
        ]);
        data.insert("leafId".into(), json!("c"));
        let mut view = View::new(1);
        view.begin_reset();
        view.finish_reset(&data, &[]);
        let texts: Vec<String> = view.snapshot(50)["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["content"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(texts, ["one", "two"]);
    }

    #[test]
    fn resume_from_seq_or_snapshot() {
        let mut view = View::new(1);
        for change in apply_all(&mut view, tool_turn()) {
            view.commit(change);
        }
        let seq = view.seq();
        assert_eq!(view.changes_since(seq).unwrap().len(), 0);
        assert_eq!(view.changes_since(seq - 2).unwrap().len(), 2);
        let reset = view.commit(Change::Reset);
        assert!(reset.reset);
        assert!(view.changes_since(seq).is_none(), "a reset since forces a snapshot");
        assert!(view.changes_since(view.seq() + 1).is_none());
    }

    #[test]
    fn previews_are_bounded_tails() {
        let long: String = (0..100).map(|i| format!("line{i}\n")).collect();
        let (text, truncated) = preview(&json!([{"type":"text","text": long}]));
        assert!(truncated);
        assert!(text.ends_with("line99"));
        assert_eq!(text.lines().count(), PREVIEW_LINES);
        let (short, truncated) = preview(&json!("ok"));
        assert_eq!((short.as_str(), truncated), ("ok", false));
    }

    /// A user message with a pasted screenshot and a tool that returned an image, from a live turn and from entries.
    fn image_turn() -> Vec<Value> {
        let user = json!({"role":"user","content":[{"type":"text","text":"look"},{"type":"image","mimeType":"image/png","data":"AAAA"}],"timestamp":2});
        let result = json!({"content":[{"type":"image","mimeType":"image/jpeg","data":"BBBB"}]});
        vec![
            json!({"type":"message_end","message":user}),
            json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"read","arguments":{"path":"a.png"}}],"timestamp":3}}),
            json!({"type":"tool_execution_end","toolCallId":"c1","toolName":"read","result":result,"isError":false}),
            json!({"type":"message_end","message":{"role":"toolResult","toolCallId":"c1","toolName":"read","content":result["content"],"isError":false,"timestamp":4}}),
        ]
    }

    #[test]
    fn images_are_references_fetched_on_demand() {
        let mut view = View::new(1);
        let changes = apply_all(&mut view, image_turn());
        let wire: String = changes.iter().map(|c| json!(c).to_string()).collect();
        assert!(
            !wire.contains("AAAA") && !wire.contains("BBBB"),
            "changes carry no image data"
        );
        let snap = view.snapshot(50);
        assert!(!snap.to_string().contains("AAAA"), "snapshots carry no image data");
        let block = &snap["items"][0]["content"][1];
        assert_eq!(block["type"], "image");
        assert_eq!(block["mime_type"], "image/png");
        let id = block["image"].as_u64().unwrap();
        assert_eq!(view.image(id).unwrap().data, "AAAA");

        let output = view.tool_output("c1").unwrap().clone();
        assert!(
            !output.to_string().contains("BBBB"),
            "tool output carries no image data"
        );
        let tool_image = output["content"][0]["image"].as_u64().unwrap();
        assert_eq!(view.image(tool_image).unwrap().data, "BBBB");
        assert_eq!(view.images.len(), 2, "the tool result's second copy replaced the first");
        assert_eq!(
            snap["items"][2]["truncated"], true,
            "an image-only output offers the full output"
        );

        // A rebuild from entries drops the old images and refers to the new ones.
        let entry = json!({"type":"message","id":"e1","parentId":null,"message":image_turn()[0]["message"]});
        view.begin_reset();
        view.finish_reset(&entries(vec![entry]), &[]);
        assert!(view.image(id).is_none());
        let rebuilt = view.snapshot(50)["items"][0]["content"][1]["image"].as_u64().unwrap();
        assert_eq!(view.image(rebuilt).unwrap().data, "AAAA");
        assert_eq!(view.images.len(), 1);
    }

    /// Writes the protocol fixtures the Swift client decodes (`apps/packages/PitonKit/Tests/Fixtures`), so a protocol
    /// change that the Swift types don't follow fails PitonKit's tests. Fails here when the committed fixtures are
    /// stale; regenerate with `PITON_WRITE_FIXTURES=1 cargo test fixtures`.
    #[test]
    fn fixtures() {
        use crate::wire::{LaunchMode, SessionInfo, SessionStatus};
        let mut view = View::new(7);
        let mut lines: Vec<String> = Vec::new();
        let state = |status, dialogs| StateInput {
            status,
            workspace: "/Users/me/Projects/app".into(),
            mode: LaunchMode::Sandbox,
            session_id: Some("01a1-session".into()),
            session_file: Some("/Users/me/.config/pi/agent/sessions/--app--/s.jsonl".into()),
            dialogs,
        };
        let snapshot_before = view.snapshot(50).to_string();
        for record in tool_turn() {
            let (k, m) = rec(record);
            for change in view.apply(&k, &m) {
                lines.push(view.commit(change).line.to_string());
            }
        }
        let dialog = json!({"type":"extension_ui_request","id":"d1","method":"select","title":"Allow?","options":["Allow","Block"],"timeout":30000});
        if let Some(change) = view.publish_state(state(SessionStatus::NeedsInput, vec![dialog])) {
            lines.push(view.commit(change).line.to_string());
        }
        for notice in [
            json!({"type":"auto_retry_start","attempt":1,"maxAttempts":3,"errorMessage":"529 overloaded"}),
            json!({"type":"agent_settled","aborted":true}),
        ] {
            let (k, m) = rec(notice);
            for change in view.apply(&k, &m) {
                lines.push(view.commit(change).line.to_string());
            }
        }
        lines.push(view.commit(Change::Reset).line.to_string());
        let info = SessionInfo {
            key: 7,
            id: Some("01a1-session".into()),
            file: Some("/Users/me/.config/pi/agent/sessions/--app--/s.jsonl".into()),
            workspace: "/Users/me/Projects/app--fix-login".into(),
            checkout: crate::wire::Checkout::Worker {
                source: "/Users/me/Projects/app".into(),
                name: "fix-login".into(),
            },
            mode: LaunchMode::Sandbox,
            status: SessionStatus::Working,
            clients: 2,
            pid: Some(4242),
            title: Some("run it".into()),
        };
        let files: Vec<(&str, String)> = vec![
            ("snapshot-empty.json", snapshot_before),
            ("snapshot.json", view.snapshot(50).to_string()),
            ("snapshot-images.json", {
                let mut images = View::new(8);
                apply_all(&mut images, image_turn());
                images.snapshot(50).to_string()
            }),
            (
                "image.json",
                json!({"type":"reply","id":"c9","ok":true,"data":Image { mime_type: Some("image/png".into()), data: "AAAA".into() }}).to_string(),
            ),
            ("history.json", view.history(3, 50).to_string()),
            ("changes.jsonl", lines.join("\n")),
            (
                "sessions.json",
                json!({"type":"sessions","sessions":[info]}).to_string(),
            ),
            (
                "daemon.json",
                json!({"type": "daemon", "state": crate::wire::DaemonState {
                    // Fixed: the real one changes with every commit.
                    version: "0.1.0 (abc1234567)".into(),
                    keep_awake: true,
                    awake: true,
                    sessions: 2,
                    logging: crate::diagnostics::State {
                        policy: crate::diagnostics::Policy::Debug {
                            expiration: crate::diagnostics::Expiration::Until { unix_ms: 1234 },
                        },
                        default: crate::diagnostics::Mode::Info,
                    },
                }})
                .to_string(),
            ),
            (
                "replies.jsonl",
                [
                    json!({"type":"reply","id":"r1","ok":true,"data":{}}),
                    json!({"type":"reply","id":2,"ok":true,"data":{"session":info}}),
                    json!({"type":"reply","id":"r3","ok":false,"error":"no live session 9"}),
                ]
                .iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
            ),
        ];
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../apps/packages/PitonKit/Tests/Fixtures");
        let write = std::env::var_os("PITON_WRITE_FIXTURES").is_some();
        let mut stale = Vec::new();
        for (name, content) in files {
            // Pretty-print single objects for readable diffs; JSONL stays one object per line.
            let content = match name.ends_with(".json") {
                true => serde_json::to_string_pretty(&serde_json::from_str::<Value>(&content).unwrap()).unwrap() + "\n",
                false => content + "\n",
            };
            let path = dir.join(name);
            if write {
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(&path, &content).unwrap();
            } else if std::fs::read_to_string(&path).ok().as_deref() != Some(content.as_str()) {
                stale.push(name);
            }
        }
        assert!(
            stale.is_empty(),
            "stale protocol fixtures {stale:?}: run `PITON_WRITE_FIXTURES=1 cargo test fixtures` in daemon/ and update PitonKit"
        );
    }

    #[test]
    fn history_pages_backwards() {
        let mut view = View::new(1);
        for i in 0..10 {
            apply_all(
                &mut view,
                vec![json!({"type":"message_end","message":{"role":"user","content":format!("m{i}"),"timestamp":i}})],
            );
        }
        let snap = view.snapshot(3);
        assert_eq!(snap["has_more"], true);
        let first = snap["items"][0]["id"].as_u64().unwrap();
        let page = view.history(first, 5);
        assert_eq!(page["items"].as_array().unwrap().len(), 5);
        assert_eq!(page["has_more"], true);
        assert_eq!(page["items"][4]["content"], "m6");
    }
}
