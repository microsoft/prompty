//! Cooperative cancellation shared by model, tool, and engine effect boundaries.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

use tokio::sync::Notify;

/// Cloneable cooperative cancellation token.
#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bridge an existing shared cancellation flag into the canonical engine.
    pub fn from_shared(cancelled: Arc<AtomicBool>) -> Self {
        Self {
            cancelled,
            notify: Arc::new(Notify::new()),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    /// Wait until cancellation is requested.
    ///
    /// Tokens bridged from an externally-owned atomic flag are polled as a
    /// compatibility fallback because that owner cannot signal this token.
    pub async fn cancelled(&self) {
        while !self.is_cancelled() {
            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(10)) => {}
            }
        }
    }
}
