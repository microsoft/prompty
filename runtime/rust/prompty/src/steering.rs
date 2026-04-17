//! Steering — inject messages between agent loop iterations.
//!
//! Matches TypeScript `core/steering.ts`. A thread-safe FIFO string queue
//! that converts queued strings to `user` messages when drained.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::types::{Message, Role};

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

/// A thread-safe FIFO queue of steering messages to inject into the agent loop.
///
/// Per spec §13.5, `send()` MUST be safe to call from any thread while the
/// agent loop is running, and `drain()` MUST atomically remove all messages.
///
/// Usage:
/// ```
/// use prompty::steering::Steering;
///
/// let s = Steering::new();
/// s.send("Please use the search tool first.");
/// s.send("Remember to cite sources.");
///
/// // In the turn loop, drain before the next LLM call:
/// let messages = s.drain();
/// // → [Message { role: User, content: "Please use..." }, Message { role: User, content: "Remember..." }]
/// ```
#[derive(Clone)]
pub struct Steering {
    queue: Arc<Mutex<VecDeque<String>>>,
}

impl Steering {
    /// Create a new empty Steering queue.
    pub fn new() -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    /// Enqueue a steering message (as a plain string). Thread-safe.
    pub fn send(&self, message: impl Into<String>) {
        self.queue
            .lock()
            .expect("steering lock poisoned")
            .push_back(message.into());
    }

    /// Atomically drain all queued messages, converting them to `user` Messages.
    ///
    /// The queue is emptied after calling this.
    pub fn drain(&self) -> Vec<Message> {
        self.queue
            .lock()
            .expect("steering lock poisoned")
            .drain(..)
            .map(|text| Message::with_text(Role::User, &text))
            .collect()
    }

    /// Check if there are pending steering messages.
    pub fn has_pending(&self) -> bool {
        !self
            .queue
            .lock()
            .expect("steering lock poisoned")
            .is_empty()
    }

    /// Get the number of pending messages.
    pub fn len(&self) -> usize {
        self.queue.lock().expect("steering lock poisoned").len()
    }

    /// Check if the queue is empty.
    pub fn is_empty(&self) -> bool {
        self.queue
            .lock()
            .expect("steering lock poisoned")
            .is_empty()
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
        let s = Steering::new();
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
        let s = Steering::new();
        let msgs = s.drain();
        assert!(msgs.is_empty());
    }

    #[test]
    fn test_fifo_order() {
        let s = Steering::new();
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

    #[test]
    fn test_thread_safe_send() {
        let s = Steering::new();
        let s2 = s.clone();
        let handle = std::thread::spawn(move || {
            s2.send("from another thread");
        });
        handle.join().unwrap();
        assert_eq!(s.len(), 1);
        let msgs = s.drain();
        assert_eq!(msgs[0].text_content(), "from another thread");
    }
}
