//! Cooperative cancellation shared by model, tool, and engine effect boundaries.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

/// Cloneable cooperative cancellation token.
#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bridge an existing shared cancellation flag into the canonical engine.
    pub fn from_shared(cancelled: Arc<AtomicBool>) -> Self {
        Self { cancelled }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}
