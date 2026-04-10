//! Steering — inject messages between agent loop iterations.
//!
//! Matches TypeScript `core/steering.ts`. A simple FIFO string queue
//! that converts queued strings to `user` messages when drained.

use std::collections::VecDeque;

use crate::types::{Message, Role};

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

/// A FIFO queue of steering messages to inject into the agent loop.
///
/// Usage:
/// ```
/// use prompty::steering::Steering;
///
/// let mut s = Steering::new();
/// s.send("Please use the search tool first.");
/// s.send("Remember to cite sources.");
///
/// // In the turn loop, drain before the next LLM call:
/// let messages = s.drain();
/// // → [Message { role: User, content: "Please use..." }, Message { role: User, content: "Remember..." }]
/// ```
pub struct Steering {
    queue: VecDeque<String>,
}

impl Steering {
    /// Create a new empty Steering queue.
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
        }
    }

    /// Enqueue a steering message (as a plain string).
    pub fn send(&mut self, message: impl Into<String>) {
        self.queue.push_back(message.into());
    }

    /// Drain all queued messages, converting them to `user` Messages.
    ///
    /// The queue is emptied after calling this.
    pub fn drain(&mut self) -> Vec<Message> {
        self.queue
            .drain(..)
            .map(|text| Message::text(Role::User, &text))
            .collect()
    }

    /// Check if there are pending steering messages.
    pub fn has_pending(&self) -> bool {
        !self.queue.is_empty()
    }

    /// Get the number of pending messages.
    pub fn len(&self) -> usize {
        self.queue.len()
    }

    /// Check if the queue is empty.
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
}

impl Default for Steering {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_is_empty() {
        let s = Steering::new();
        assert!(s.is_empty());
        assert!(!s.has_pending());
        assert_eq!(s.len(), 0);
    }

    #[test]
    fn test_send_and_drain() {
        let mut s = Steering::new();
        s.send("First message");
        s.send("Second message");

        assert!(s.has_pending());
        assert_eq!(s.len(), 2);

        let msgs = s.drain();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, Role::User);
        assert_eq!(msgs[0].text_content(), "First message");
        assert_eq!(msgs[1].text_content(), "Second message");

        // Queue is now empty
        assert!(s.is_empty());
        assert!(!s.has_pending());
    }

    #[test]
    fn test_drain_empty() {
        let mut s = Steering::new();
        let msgs = s.drain();
        assert!(msgs.is_empty());
    }

    #[test]
    fn test_fifo_order() {
        let mut s = Steering::new();
        s.send("A");
        s.send("B");
        s.send("C");

        let msgs = s.drain();
        assert_eq!(msgs[0].text_content(), "A");
        assert_eq!(msgs[1].text_content(), "B");
        assert_eq!(msgs[2].text_content(), "C");
    }

    #[test]
    fn test_default() {
        let s = Steering::default();
        assert!(s.is_empty());
    }
}
