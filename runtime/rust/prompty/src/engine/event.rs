//! Ordered semantic events emitted by the canonical turn engine.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Stable semantic event kinds. Streaming token deltas are intentionally separate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum EngineEventKind {
    TurnStarted,
    PolicyApplied,
    ContextPrepared,
    ModelInvocationStarted,
    ModelInvocationCompleted,
    ModelInvocationFailed,
    ModelReconciliationRequired,
    ModelInvocationReconciled,
    PermissionRequested,
    PermissionResolved,
    ToolExecutionStarted,
    ToolExecutionCompleted,
    ToolResultCommitted,
    ToolResultReconciled,
    ConversationUpdated,
    CheckpointCreated,
    TurnCommitted,
    TurnCancelled,
    TurnFailed,
    TurnReconciliationRequired,
    PostCommitStarted,
    PostCommitCompleted,
    PostCommitFailed,
}

/// One event in the monotonic semantic event stream.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineEvent {
    pub sequence: u64,
    pub id: String,
    pub timestamp: String,
    pub session_id: String,
    pub turn_id: String,
    pub invocation_id: Option<String>,
    pub iteration: Option<usize>,
    pub kind: EngineEventKind,
    #[serde(default)]
    pub payload: Value,
}
