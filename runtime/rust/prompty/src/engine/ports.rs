//! Runtime-local effect ports used by the canonical turn engine.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{CancellationToken, EngineEvent, ModelInvocationContextSnapshot, TurnCommit};
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelInvocationRequest {
    pub context: ModelInvocationContextSnapshot,
}

/// Normalized tool request produced by a provider adapter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineToolRequest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub arguments: Value,
    #[serde(default)]
    pub metadata: Value,
}

/// Normalized result of one tool request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineToolResult {
    pub request_id: String,
    pub name: String,
    pub outcome: ToolOutcome,
    #[serde(default)]
    pub output: Value,
    pub error_kind: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

/// Semantic outcome of an external tool effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum ToolOutcome {
    Success,
    Failed,
    /// The host cannot determine whether the external effect occurred.
    Indeterminate,
}

impl EngineToolResult {
    pub fn model_text(&self) -> String {
        match &self.output {
            Value::String(value) => value.clone(),
            value => value.to_string(),
        }
    }
}

/// Provider-neutral response from a model invocation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelInvocationResponse {
    pub output: Option<Value>,
    /// Cumulative token usage for this invocation when the provider reports it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<crate::types::Usage>,
    #[serde(default)]
    pub assistant_messages: Vec<Message>,
    #[serde(default)]
    pub tool_requests: Vec<EngineToolRequest>,
    /// Portability classification to use for the next invocation.
    pub next_portability: Option<super::ContextPortability>,
    /// Provider-held state to use for the next invocation.
    pub delegated_state: Option<Vec<super::DelegatedStateReference>>,
    #[serde(default)]
    pub metadata: Value,
}

/// Durable state required to reconcile one indeterminate model invocation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelReconciliationState {
    pub invocation_id: String,
    pub request: ModelInvocationRequest,
    pub failed_attempt: usize,
    pub message: String,
    #[serde(default)]
    pub metadata: Value,
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

/// Permission decision for a tool request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnginePermissionDecision {
    pub approved: bool,
    pub reason: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

/// Portable checkpoint data emitted after a committed model/tool round.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineCheckpoint {
    pub id: String,
    pub session_id: String,
    pub turn_id: String,
    pub iteration: usize,
    pub last_sequence: u64,
    pub messages: Vec<Message>,
    /// Exact cache-stable prefix boundary. Missing legacy values conservatively decode as zero.
    #[serde(default)]
    pub stable_prefix_messages: usize,
    #[serde(default)]
    pub inputs: Value,
    pub active_invocation_id: Option<String>,
    #[serde(default)]
    pub pending_tool_requests: Vec<EngineToolRequest>,
    #[serde(default)]
    pub completed_tool_results: Vec<EngineToolResult>,
    #[serde(default)]
    pub completed_model_iterations: usize,
    #[serde(default)]
    pub reconciliation_required: bool,
    /// Typed provider invocation state when model outcome reconciliation is required.
    #[serde(default)]
    pub model_reconciliation: Option<ModelReconciliationState>,
    pub pending_output: Option<Value>,
    #[serde(default)]
    pub final_output_ready: bool,
    /// Model response retained until all tool results can be formatted as one conversation batch.
    pub pending_model_response: Option<ModelInvocationResponse>,
    /// Resume this exact iteration because the checkpoint precedes the external model effect.
    #[serde(default)]
    pub resume_same_iteration: bool,
    /// The host policy rewrite is already durable for this iteration and must not be repeated.
    #[serde(default)]
    pub policy_applied_for_iteration: bool,
    pub portability: super::ContextPortability,
    pub delegated_state: Vec<super::DelegatedStateReference>,
    #[serde(default)]
    pub metadata: Value,
}

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
