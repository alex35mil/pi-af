//! pi gets one `prompt` at a time.
//!
//! pi marks a run active only after it has prepared the prompt (input hooks, auth check). From pi 1.5, a second
//! `prompt` that arrives during that preparation is answered `"started"` too, and then dropped: it never becomes a
//! message (docs/pi-findings.md, "Queued prompts"). pi answers a prompt only once its run is active or the prompt is
//! queued, so piton writes the next prompt after pi answered the previous one; pi then queues it with its
//! `streamingBehavior`. Every prompt still reaches pi, also when its client left meanwhile, as when it was written
//! at once.

use std::collections::VecDeque;

use serde_json::Value;

/// Prompts piton has for pi, keyed by the id piton sent them with.
#[derive(Debug, Default)]
pub struct PromptQueue {
    /// Written to pi, not answered yet.
    in_flight: Option<String>,
    /// Waiting for `in_flight`'s answer, oldest first.
    held: VecDeque<(String, Value)>,
}

impl PromptQueue {
    /// A prompt to send: returns it when pi can have it now, or keeps it until pi answered the one before.
    pub fn submit(&mut self, id: String, prompt: Value) -> Option<Value> {
        match self.in_flight {
            Some(_) => {
                self.held.push_back((id, prompt));
                None
            }
            None => {
                self.in_flight = Some(id);
                Some(prompt)
            }
        }
    }

    /// pi answered the command `id`. When it was the prompt in flight, returns the next prompt to write.
    pub fn answered(&mut self, id: &str) -> Option<Value> {
        if self.in_flight.as_deref() != Some(id) {
            return None;
        }
        match self.held.pop_front() {
            Some((next, prompt)) => {
                self.in_flight = Some(next);
                Some(prompt)
            }
            None => {
                self.in_flight = None;
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn prompt(id: &str) -> Value {
        json!({"type": "prompt", "id": id})
    }

    #[test]
    fn the_first_prompt_goes_out_at_once() {
        let mut q = PromptQueue::default();
        assert_eq!(q.submit("a".into(), prompt("a")), Some(prompt("a")));
    }

    #[test]
    fn later_prompts_wait_for_the_answer_and_go_out_in_order() {
        let mut q = PromptQueue::default();
        q.submit("a".into(), prompt("a"));
        assert_eq!(q.submit("b".into(), prompt("b")), None);
        assert_eq!(q.submit("c".into(), prompt("c")), None);
        assert_eq!(q.answered("a"), Some(prompt("b")));
        assert_eq!(q.answered("b"), Some(prompt("c")));
        assert_eq!(q.answered("c"), None);
        assert_eq!(q.submit("d".into(), prompt("d")), Some(prompt("d")), "idle again");
    }

    #[test]
    fn answers_to_other_commands_release_nothing() {
        let mut q = PromptQueue::default();
        q.submit("a".into(), prompt("a"));
        q.submit("b".into(), prompt("b"));
        assert_eq!(q.answered("get_state"), None);
        assert_eq!(q.answered("b"), None, "b isn't in flight yet");
        assert_eq!(q.answered("a"), Some(prompt("b")));
    }
}
