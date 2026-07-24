//! Runtime-local effect ports used by the canonical turn engine.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{CancellationToken, EngineEvent, TurnCommit};
use crate::types::Message;

/// Error returned by a runtime-local effect port.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct PortError {
    pub message: String,
    pub outcome_unknown: bool,
    pub configuration_error: bool,
    pub metadata: Value,
}

impl PortError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            outcome_unknown: false,
            configuration_error: false,
            metadata: Value::Null,
        }
    }

    /// Report that an external effect may have occurred and requires reconciliation.
    pub fn indeterminate(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            outcome_unknown: true,
            configuration_error: false,
            metadata: Value::Null,
        }
    }

    /// Report an indeterminate effect with provider-specific reconciliation metadata.
    pub fn indeterminate_with_metadata(message: impl Into<String>, metadata: Value) -> Self {
        Self {
            message: message.into(),
            outcome_unknown: true,
            configuration_error: false,
            metadata,
        }
    }

    /// Report a plan or binding error that model recovery cannot fix.
    pub fn configuration(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            outcome_unknown: false,
            configuration_error: true,
            metadata: Value::Null,
        }
    }
}

/// Normalized request for one model invocation.
///
/// This is the generated cross-runtime contract; the engine consumes it directly
/// rather than maintaining a structurally identical twin.
pub use crate::model::ModelInvocationRequest;

/// Normalized tool request/result and semantic outcome are the generated
/// cross-runtime contracts. The engine consumes them directly; the historical
/// `Engine*`/`ToolOutcome` names are kept as thin aliases so the durable wire is
/// the canonical Typra projection with no hand-written twin.
pub use crate::model::{
    ModelToolOutcome, ModelToolOutcome as ToolOutcome, ModelToolRequest,
    ModelToolRequest as EngineToolRequest, ModelToolResult, ModelToolResult as EngineToolResult,
};

/// Provider-neutral model response and durable reconciliation state are the
/// generated cross-runtime contracts, consumed directly by the engine.
pub use crate::model::{ModelInvocationResponse, ModelReconciliationState};

impl ModelToolResult {
    /// Render the tool output as model-visible text, tolerating an absent output.
    pub fn model_text(&self) -> String {
        match &self.output {
            Some(Value::String(value)) => value.clone(),
            Some(value) => value.to_string(),
            None => String::new(),
        }
    }
}

/// Host-owned deterministic state supplied before one model invocation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostPolicyRequest {
    pub session_id: String,
    pub turn_id: String,
    pub iteration: usize,
    pub messages: Vec<Message>,
    pub stable_prefix_messages: usize,
    #[serde(default)]
    pub inputs: Value,
}

/// State rewrite produced by the host policy before model invocation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostPolicyResult {
    pub messages: Vec<Message>,
    pub stable_prefix_messages: usize,
    #[serde(default)]
    pub metadata: Value,
}

/// Final output supplied to the host policy immediately before a success commit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FinalOutputPolicyRequest {
    pub session_id: String,
    pub turn_id: String,
    pub iteration: usize,
    pub messages: Vec<Message>,
    pub output: Option<Value>,
    #[serde(default)]
    pub inputs: Value,
}

/// Final output rewrite produced by the host policy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FinalOutputPolicyResult {
    pub output: Option<Value>,
    #[serde(default)]
    pub metadata: Value,
}

/// Typed deterministic policy failure committed by the engine.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct HostPolicyError {
    pub error_kind: String,
    pub message: String,
}

impl HostPolicyError {
    pub fn new(error_kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error_kind: error_kind.into(),
            message: message.into(),
        }
    }
}

/// Context supplied to the retry policy after a retryable model failure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RetryPolicyRequest {
    /// Number of failures observed for this invocation, starting at one.
    pub failed_attempts: usize,
    /// One-based attempt number that will run after backoff.
    pub next_attempt: usize,
    pub max_attempts: usize,
    pub reason: String,
}

/// Retry-policy failure. Cancellation is semantic; other failures are typed host failures.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum RetryPolicyError {
    #[error("retry backoff cancelled")]
    Cancelled,
    #[error(transparent)]
    Failed(PortError),
}

/// Ephemeral provider output that does not participate in semantic event ordering.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[non_exhaustive]
pub enum ModelStreamChunk {
    Text(String),
    Thinking(String),
    Provider(Value),
}

/// Permission decision for a tool request. The generated cross-runtime contract
/// is consumed directly.
pub use crate::model::EnginePermissionDecision;

/// Portable checkpoint data emitted after a committed model/tool round. The
/// generated cross-runtime contract is consumed directly; run identity
/// (`runId`/`parentRunId`/`delegationDepth`) and the nested `contextState` are
/// native to the durable projection.
pub use crate::model::EngineCheckpoint;

#[async_trait]
pub trait ModelPort: Send + Sync {
    async fn invoke(
        &self,
        request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
        stream: &dyn ModelStreamPort,
    ) -> Result<ModelInvocationResponse, PortError>;
}

#[async_trait]
pub trait ModelStreamPort: Send + Sync {
    /// Deliver an ephemeral chunk. Delivery failure must not alter semantic execution.
    async fn emit(&self, chunk: ModelStreamChunk);
}

#[async_trait]
pub trait HostPolicyPort: Send + Sync {
    async fn before_model(
        &self,
        request: HostPolicyRequest,
        cancellation: &CancellationToken,
    ) -> Result<HostPolicyResult, HostPolicyError>;

    async fn before_commit(
        &self,
        request: FinalOutputPolicyRequest,
        cancellation: &CancellationToken,
    ) -> Result<FinalOutputPolicyResult, HostPolicyError>;
}

#[async_trait]
pub trait RetryPolicyPort: Send + Sync {
    async fn backoff(
        &self,
        request: &RetryPolicyRequest,
        cancellation: &CancellationToken,
    ) -> Result<(), RetryPolicyError>;
}

/// Converts one completed model/tool batch into provider-valid conversation messages.
pub trait ConversationPort: Send + Sync {
    fn format_tool_exchange(
        &self,
        response: &ModelInvocationResponse,
        results: &[EngineToolResult],
    ) -> Result<Vec<Message>, PortError>;
}

#[async_trait]
pub trait PermissionPort: Send + Sync {
    async fn authorize(
        &self,
        request: &EngineToolRequest,
        cancellation: &CancellationToken,
    ) -> Result<EnginePermissionDecision, PortError>;
}

#[async_trait]
pub trait ToolPort: Send + Sync {
    async fn execute(
        &self,
        request: &EngineToolRequest,
        cancellation: &CancellationToken,
    ) -> Result<EngineToolResult, PortError>;
}

#[async_trait]
pub trait DurabilityPort: Send + Sync {
    async fn append(&self, event: &EngineEvent) -> Result<(), PortError>;

    /// Atomically append an event and save the checkpoint that includes it.
    async fn append_with_checkpoint(
        &self,
        events: &[EngineEvent],
        checkpoint: &EngineCheckpoint,
    ) -> Result<(), PortError>;
}

#[async_trait]
pub trait PostCommitPort: Send + Sync {
    async fn after_commit(
        &self,
        effect_id: &str,
        commit: &TurnCommit,
        cancellation: &CancellationToken,
    ) -> Result<(), PortError>;
}

/// Supplies deterministic or live timestamps.
pub trait Clock: Send + Sync {
    fn now(&self) -> String;
}

/// Supplies deterministic or live identifiers.
pub trait IdGenerator: Send + Sync {
    fn next_id(&self, kind: &str) -> String;
}

/// Default permission implementation for hosts that explicitly allow all tools.
#[derive(Debug, Clone, Default)]
pub struct AllowAllPermissions;

#[async_trait]
impl PermissionPort for AllowAllPermissions {
    async fn authorize(
        &self,
        _request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EnginePermissionDecision, PortError> {
        Ok(EnginePermissionDecision {
            approved: true,
            reason: Some("allow_all".to_string()),
            metadata: Value::Null,
        })
    }
}

/// No-op durability implementation for explicitly non-durable execution profiles.
#[derive(Debug, Clone, Default)]
pub struct NoopDurabilityPort;

#[async_trait]
impl DurabilityPort for NoopDurabilityPort {
    async fn append(&self, _event: &EngineEvent) -> Result<(), PortError> {
        Ok(())
    }

    async fn append_with_checkpoint(
        &self,
        _events: &[EngineEvent],
        _checkpoint: &EngineCheckpoint,
    ) -> Result<(), PortError> {
        Ok(())
    }
}

/// No-op post-commit implementation.
#[derive(Debug, Clone, Default)]
pub struct NoopPostCommitPort;

#[async_trait]
impl PostCommitPort for NoopPostCommitPort {
    async fn after_commit(
        &self,
        _effect_id: &str,
        _commit: &TurnCommit,
        _cancellation: &CancellationToken,
    ) -> Result<(), PortError> {
        Ok(())
    }
}

/// Drops ephemeral model stream chunks.
#[derive(Debug, Clone, Default)]
pub struct NoopModelStreamPort;

#[async_trait]
impl ModelStreamPort for NoopModelStreamPort {
    async fn emit(&self, _chunk: ModelStreamChunk) {}
}

/// Leaves canonical state and final output unchanged.
#[derive(Debug, Clone, Default)]
pub struct NoopHostPolicyPort;

#[async_trait]
impl HostPolicyPort for NoopHostPolicyPort {
    async fn before_model(
        &self,
        request: HostPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<HostPolicyResult, HostPolicyError> {
        Ok(HostPolicyResult {
            messages: request.messages,
            stable_prefix_messages: request.stable_prefix_messages,
            metadata: Value::Null,
        })
    }

    async fn before_commit(
        &self,
        request: FinalOutputPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<FinalOutputPolicyResult, HostPolicyError> {
        Ok(FinalOutputPolicyResult {
            output: request.output,
            metadata: Value::Null,
        })
    }
}

/// Deterministic retry policy with no delay or side effects.
#[derive(Debug, Clone, Default)]
pub struct NoopRetryPolicyPort;

#[async_trait]
impl RetryPolicyPort for NoopRetryPolicyPort {
    async fn backoff(
        &self,
        _request: &RetryPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<(), RetryPolicyError> {
        Ok(())
    }
}

/// Provider-neutral fallback that preserves assistant messages and appends ordered tool results.
#[derive(Debug, Clone, Default)]
pub struct DefaultConversationPort;

impl ConversationPort for DefaultConversationPort {
    fn format_tool_exchange(
        &self,
        response: &ModelInvocationResponse,
        results: &[EngineToolResult],
    ) -> Result<Vec<Message>, PortError> {
        let mut messages = response.assistant_messages.clone();
        for request in &response.tool_requests {
            if let Some(result) = results
                .iter()
                .find(|result| result.request_id == request.id)
            {
                messages.push(Message::tool_result(&request.id, result.model_text()));
            }
        }
        Ok(messages)
    }
}
