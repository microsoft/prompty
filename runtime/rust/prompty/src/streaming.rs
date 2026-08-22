//! Streaming-failure reconciliation over classified provider stream chunks.
//!
//! Canonical, provider-agnostic reconciliation of a [`StreamChunk`] sequence into
//! the streaming-failure contract asserted by the `Processor.processStream`
//! vectors: the preserved partial text, whether the stream requires reconciliation
//! (an indeterminate terminal failure), and whether a completion was committed.
//!
//! Providers own only the wire classification that turns their raw SSE chunks into
//! [`StreamChunk`]s (text vs. determinate/indeterminate failure). This module then
//! reconciles that classified sequence identically for every provider, mirroring
//! the verified Python reference (`core/streaming.py`).

use crate::types::StreamChunk;

/// Outcome of reconciling a classified stream-chunk sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamReconciliation {
    /// Concatenation of every text chunk emitted on the stream.
    pub partial_text: String,
    /// True when any terminal failure is indeterminate (outcome unknown).
    pub requires_reconciliation: bool,
    /// True only when the stream terminated with no failure at all.
    pub completion_committed: bool,
}

/// Reconcile classified stream chunks into a [`StreamReconciliation`].
///
/// Partial text is the concatenation of every text chunk. A stream requires
/// reconciliation when any terminal failure is indeterminate (the provider
/// outcome is unknown). A completion is committed only when the stream terminates
/// with no failure at all.
pub fn reconcile_stream<'a, I>(chunks: I) -> StreamReconciliation
where
    I: IntoIterator<Item = &'a StreamChunk>,
{
    let mut partial_text = String::new();
    let mut requires_reconciliation = false;
    let mut has_failure = false;

    for chunk in chunks {
        match chunk {
            StreamChunk::Text(text) => partial_text.push_str(text),
            StreamChunk::Failure(failure) => {
                has_failure = true;
                if failure.outcome_unknown() {
                    requires_reconciliation = true;
                }
            }
            _ => {}
        }
    }

    StreamReconciliation {
        partial_text,
        requires_reconciliation,
        completion_committed: !has_failure,
    }
}
