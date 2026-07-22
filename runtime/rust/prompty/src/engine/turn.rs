//! Canonical Rust-first turn state machine.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{
    CancellationToken, Clock, ContextError, ContextPipeline, ContextPortability, ContextRequest,
    ConversationPort, DelegatedStateReference, DurabilityPort, EngineCheckpoint, EngineEvent,
    EngineEventKind, EnginePermissionDecision, EngineToolRequest, EngineToolResult,
    FinalOutputPolicyRequest, HostPolicyPort, HostPolicyRequest, IdGenerator,
    ModelInvocationRequest, ModelInvocationResponse, ModelPort, ModelReconciliationState,
    ModelStreamPort, PermissionPort, PortError, PostCommitPort, RetryPolicyError, RetryPolicyPort,
    RetryPolicyRequest, ToolOutcome, ToolPort,
};
use crate::types::Message;

/// Terminal semantic status for a canonical turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum TurnStatus {
    Success,
    Failed,
    Cancelled,
    ReconciliationRequired,
}

/// Request accepted by the canonical turn engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TurnEngineRequest {
    pub session_id: String,
    pub turn_id: String,
    pub messages: Vec<Message>,
    #[serde(default)]
    pub inputs: Value,
    pub max_iterations: usize,
    pub max_model_attempts: usize,
    /// Iteration to execute first. Non-zero values are used when resuming a checkpoint.
    pub start_iteration: usize,
    /// Last committed event sequence before this run.
    pub initial_sequence: u64,
    pub stable_prefix_messages: usize,
    pub portability: ContextPortability,
    #[serde(default)]
    pub delegated_state: Vec<DelegatedStateReference>,
    pub active_invocation_id: Option<String>,
    #[serde(default)]
    pub pending_tool_requests: Vec<EngineToolRequest>,
    #[serde(default)]
    pub completed_tool_results: Vec<EngineToolResult>,
    #[serde(default)]
    pub completed_model_iterations: usize,
    #[serde(default)]
    pub reconciliation_required: bool,
    #[serde(default)]
    pub model_reconciliation: Option<ModelReconciliationState>,
    pub pending_output: Option<Value>,
    #[serde(default)]
    pub final_output_ready: bool,
    pub pending_model_response: Option<ModelInvocationResponse>,
    #[serde(default)]
    pub policy_applied_for_iteration: bool,
    pub reconciliation_resolution: Option<EngineToolResult>,
    #[serde(default)]
    pub model_reconciliation_resolution: Option<ModelInvocationResponse>,
}

impl TurnEngineRequest {
    pub fn new(
        session_id: impl Into<String>,
        turn_id: impl Into<String>,
        messages: Vec<Message>,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            turn_id: turn_id.into(),
            stable_prefix_messages: messages.len(),
            messages,
            inputs: Value::Null,
            max_iterations: 10,
            max_model_attempts: 3,
            start_iteration: 0,
            initial_sequence: 0,
            portability: ContextPortability::Portable,
            delegated_state: Vec::new(),
            active_invocation_id: None,
            pending_tool_requests: Vec::new(),
            completed_tool_results: Vec::new(),
            completed_model_iterations: 0,
            reconciliation_required: false,
            model_reconciliation: None,
            pending_output: None,
            final_output_ready: false,
            pending_model_response: None,
            policy_applied_for_iteration: false,
            reconciliation_resolution: None,
            model_reconciliation_resolution: None,
        }
    }

    /// Resume while continuing a journal whose tail may follow the checkpoint.
    pub fn resume_from(
        checkpoint: &EngineCheckpoint,
        max_iterations: usize,
        last_journal_sequence: u64,
    ) -> Self {
        Self {
            session_id: checkpoint.session_id.clone(),
            turn_id: checkpoint.turn_id.clone(),
            stable_prefix_messages: checkpoint.stable_prefix_messages,
            messages: checkpoint.messages.clone(),
            inputs: checkpoint.inputs.clone(),
            max_iterations,
            max_model_attempts: 3,
            start_iteration: if checkpoint.resume_same_iteration {
                checkpoint.iteration
            } else if checkpoint.pending_tool_requests.is_empty()
                && checkpoint.pending_model_response.is_none()
                && !checkpoint.final_output_ready
                && !checkpoint.reconciliation_required
            {
                checkpoint.iteration + 1
            } else {
                checkpoint.iteration
            },
            initial_sequence: last_journal_sequence.max(checkpoint.last_sequence),
            portability: checkpoint.portability,
            delegated_state: checkpoint.delegated_state.clone(),
            active_invocation_id: checkpoint.active_invocation_id.clone(),
            pending_tool_requests: checkpoint.pending_tool_requests.clone(),
            completed_tool_results: checkpoint.completed_tool_results.clone(),
            completed_model_iterations: checkpoint.completed_model_iterations,
            reconciliation_required: checkpoint.reconciliation_required,
            model_reconciliation: checkpoint.model_reconciliation.clone(),
            pending_output: checkpoint.pending_output.clone(),
            final_output_ready: checkpoint.final_output_ready,
            pending_model_response: checkpoint.pending_model_response.clone(),
            policy_applied_for_iteration: checkpoint.policy_applied_for_iteration,
            reconciliation_resolution: None,
            model_reconciliation_resolution: None,
        }
    }

    /// Resume after the host resolves an indeterminate tool effect.
    pub fn resume_after_reconciliation(
        checkpoint: &EngineCheckpoint,
        max_iterations: usize,
        last_journal_sequence: u64,
        resolved_result: EngineToolResult,
    ) -> Result<Self, TurnEngineError> {
        if !checkpoint.reconciliation_required {
            return Err(TurnEngineError::InvalidRequest(
                "checkpoint does not require reconciliation".to_string(),
            ));
        }
        if checkpoint.model_reconciliation.is_some() {
            return Err(TurnEngineError::InvalidRequest(
                "checkpoint requires model reconciliation, not tool reconciliation".to_string(),
            ));
        }
        if resolved_result.outcome == ToolOutcome::Indeterminate {
            return Err(TurnEngineError::InvalidRequest(
                "resolved tool result must have a determinate outcome".to_string(),
            ));
        }

        let mut resolved = checkpoint.clone();
        let existing = resolved
            .completed_tool_results
            .iter_mut()
            .find(|result| result.request_id == resolved_result.request_id)
            .ok_or_else(|| {
                TurnEngineError::InvalidRequest(format!(
                    "checkpoint does not contain indeterminate tool request '{}'",
                    resolved_result.request_id
                ))
            })?;
        if existing.outcome != ToolOutcome::Indeterminate {
            return Err(TurnEngineError::InvalidRequest(format!(
                "tool request '{}' is already determinate",
                resolved_result.request_id
            )));
        }
        *existing = resolved_result.clone();
        if resolved.pending_model_response.is_none() {
            let message = resolved
                .messages
                .iter_mut()
                .find(|message| {
                    message.metadata.get("tool_call_id").and_then(Value::as_str)
                        == Some(resolved_result.request_id.as_str())
                })
                .ok_or_else(|| {
                    TurnEngineError::InvalidRequest(format!(
                        "checkpoint is missing the tool result message for '{}'",
                        resolved_result.request_id
                    ))
                })?;
            *message =
                Message::tool_result(&resolved_result.request_id, resolved_result.model_text());
        }
        resolved.reconciliation_required = false;

        let mut request = Self::resume_from(&resolved, max_iterations, last_journal_sequence);
        request.reconciliation_resolution = Some(resolved_result);
        Ok(request)
    }

    /// Resume after the host resolves an indeterminate model invocation.
    pub fn resume_after_model_reconciliation(
        checkpoint: &EngineCheckpoint,
        max_iterations: usize,
        last_journal_sequence: u64,
        resolved_response: ModelInvocationResponse,
    ) -> Result<Self, TurnEngineError> {
        if !checkpoint.reconciliation_required {
            return Err(TurnEngineError::InvalidRequest(
                "checkpoint does not require reconciliation".to_string(),
            ));
        }
        let reconciliation = checkpoint.model_reconciliation.as_ref().ok_or_else(|| {
            TurnEngineError::InvalidRequest(
                "checkpoint requires tool reconciliation, not model reconciliation".to_string(),
            )
        })?;
        if checkpoint.active_invocation_id.as_deref() != Some(reconciliation.invocation_id.as_str())
        {
            return Err(TurnEngineError::InvalidRequest(
                "model reconciliation identity does not match the active invocation".to_string(),
            ));
        }

        let mut request = Self::resume_from(checkpoint, max_iterations, last_journal_sequence);
        request.start_iteration = checkpoint.iteration;
        request.reconciliation_required = false;
        request.model_reconciliation_resolution = Some(resolved_response);
        Ok(request)
    }
}

/// Final committed turn data supplied to post-commit effects.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TurnCommit {
    pub session_id: String,
    pub turn_id: String,
    pub status: TurnStatus,
    pub output: Option<Value>,
    pub messages: Vec<Message>,
    pub iterations: usize,
    pub last_sequence: u64,
    pub portability: ContextPortability,
    pub delegated_state: Vec<DelegatedStateReference>,
    /// Typed provider state when this commit requires model reconciliation.
    #[serde(default)]
    pub model_reconciliation: Option<ModelReconciliationState>,
}

/// Result returned by the canonical turn engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TurnEngineResult {
    pub commit: TurnCommit,
    pub snapshots: Vec<super::ModelInvocationContextSnapshot>,
    pub tool_results: Vec<EngineToolResult>,
    /// A non-fatal post-commit failure. The turn itself remains committed.
    pub post_commit_error: Option<String>,
}

/// Errors that prevent the engine from producing a committed turn result.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum TurnEngineError {
    #[error(transparent)]
    Context(#[from] ContextError),
    #[error("{stage} failed: {source}")]
    Port {
        stage: &'static str,
        #[source]
        source: PortError,
    },
    #[error("invalid turn request: {0}")]
    InvalidRequest(String),
    #[error("{stage} durability failed after effect '{request_id}': {source}")]
    RecoveryRequired {
        stage: &'static str,
        request_id: String,
        checkpoint: Box<EngineCheckpoint>,
        tool_results: Vec<EngineToolResult>,
        #[source]
        source: Box<PortError>,
    },
}

/// Runtime-local effects used by the canonical state machine.
pub struct TurnEngineEffects {
    pub model: Arc<dyn ModelPort>,
    pub stream: Arc<dyn ModelStreamPort>,
    pub policy: Arc<dyn HostPolicyPort>,
    pub retry: Arc<dyn RetryPolicyPort>,
    pub conversation: Arc<dyn ConversationPort>,
    pub permission: Arc<dyn PermissionPort>,
    pub tools: Arc<dyn ToolPort>,
    pub durability: Arc<dyn DurabilityPort>,
    pub post_commit: Arc<dyn PostCommitPort>,
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn IdGenerator>,
}

/// One canonical orchestration loop for both live and deterministic execution.
pub struct TurnEngine {
    context: ContextPipeline,
    effects: TurnEngineEffects,
}

impl TurnEngine {
    pub fn new(context: ContextPipeline, effects: TurnEngineEffects) -> Self {
        Self { context, effects }
    }

    pub async fn run(
        &self,
        request: TurnEngineRequest,
        cancellation: CancellationToken,
    ) -> Result<TurnEngineResult, TurnEngineError> {
        self.validate_request(&request)?;
        let mut state = TurnState::new(request);
        let max_iterations = state.max_iterations;
        let start_iteration = state.iteration;
        let inputs = state.inputs.clone();
        self.emit(
            &mut state,
            EngineEventKind::TurnStarted,
            None,
            None,
            json!({
                "maxIterations": max_iterations,
                "startIteration": start_iteration,
                "inputs": inputs,
            }),
        )
        .await?;

        if let Some(response) = state.model_reconciliation_resolution.take() {
            let reconciliation = state.model_reconciliation.clone().ok_or_else(|| {
                TurnEngineError::InvalidRequest(
                    "model reconciliation response is missing durable reconciliation state"
                        .to_string(),
                )
            })?;
            state.reconciliation_required = false;
            state.model_reconciliation = None;
            if let Err(message) =
                state.apply_model_response(&reconciliation.invocation_id, &response)
            {
                return self
                    .commit_failed(state, "provider_state_error", &message, &cancellation)
                    .await;
            }
            self.persist_model_reconciliation(
                &mut state,
                &reconciliation.invocation_id,
                &reconciliation,
                &response,
            )
            .await?;
        }

        if let Some(resolution) = state.reconciliation_resolution.take() {
            self.persist_reconciliation(&mut state, &resolution).await?;
        }

        if state.reconciliation_required {
            return self
                .commit_reconciliation(
                    state,
                    "effect_outcome_unknown",
                    "Checkpoint requires explicit effect reconciliation",
                    &cancellation,
                )
                .await;
        }

        if state.final_output_ready {
            if cancellation.is_cancelled() {
                return self.commit_cancelled(state, &cancellation).await;
            }
            state.output = state.pending_output.clone();
            return self.apply_final_policy(state, &cancellation).await;
        }

        while state.iteration < state.max_iterations {
            if cancellation.is_cancelled() {
                return self.commit_cancelled(state, &cancellation).await;
            }

            if state.pending_tool_requests.is_empty() && state.pending_model_response.is_some() {
                let invocation_id = state
                    .active_invocation_id
                    .clone()
                    .unwrap_or_else(|| self.effects.ids.next_id("invocation"));
                if let Err(error) = self.finalize_tool_exchange(&mut state) {
                    return self
                        .commit_failed(
                            state,
                            "conversation_format_error",
                            &error.to_string(),
                            &cancellation,
                        )
                        .await;
                }
                self.persist_conversation_update(&mut state, &invocation_id)
                    .await?;
                state.active_invocation_id = None;
                state.iteration += 1;
                continue;
            }

            if !state.pending_tool_requests.is_empty() {
                let invocation_id = state
                    .active_invocation_id
                    .clone()
                    .unwrap_or_else(|| self.effects.ids.next_id("invocation"));
                let tool_request = state.pending_tool_requests.remove(0);
                let tool_result = match self
                    .execute_tool(&mut state, &invocation_id, &tool_request, &cancellation)
                    .await
                {
                    Ok(result) => result,
                    Err(ExecuteToolError::Cancelled) => {
                        return self.commit_cancelled(state, &cancellation).await;
                    }
                    Err(ExecuteToolError::Permission(source)) => {
                        return self
                            .commit_failed(
                                state,
                                "permission_error",
                                &source.to_string(),
                                &cancellation,
                            )
                            .await;
                    }
                    Err(ExecuteToolError::Configuration(source)) => {
                        return self
                            .commit_failed(
                                state,
                                "tool_configuration_error",
                                &source.to_string(),
                                &cancellation,
                            )
                            .await;
                    }
                    Err(ExecuteToolError::Engine(error)) => return Err(error),
                };
                let outcome_unknown = tool_result.outcome == ToolOutcome::Indeterminate;
                state.tool_results.push(tool_result);
                if state.pending_model_response.is_none() {
                    // Backward-compatible recovery for checkpoints written before
                    // conversation-batch state became explicit.
                    let result = state
                        .tool_results
                        .last()
                        .expect("tool result was just appended");
                    state
                        .messages
                        .push(Message::tool_result(&tool_request.id, result.model_text()));
                }
                self.persist_tool_result(&mut state, &invocation_id, &tool_request)
                    .await?;
                if outcome_unknown {
                    return self
                        .commit_reconciliation(
                            state,
                            "effect_outcome_unknown",
                            "Tool effect outcome is unknown and requires reconciliation",
                            &cancellation,
                        )
                        .await;
                }
                if state.pending_tool_requests.is_empty() && state.pending_model_response.is_none()
                {
                    state.active_invocation_id = None;
                    state.iteration += 1;
                }
                continue;
            }

            let invocation_id = self.effects.ids.next_id("invocation");
            if state.policy_applied_for_iteration {
                state.policy_applied_for_iteration = false;
            } else {
                let policy_request = HostPolicyRequest {
                    session_id: state.session_id.clone(),
                    turn_id: state.turn_id.clone(),
                    iteration: state.iteration,
                    messages: state.messages.clone(),
                    stable_prefix_messages: state.stable_prefix_messages,
                    inputs: state.inputs.clone(),
                };
                let policy_result = match self
                    .effects
                    .policy
                    .before_model(policy_request, &cancellation)
                    .await
                {
                    Ok(result) => result,
                    Err(error) => {
                        return self
                            .commit_failed(state, &error.error_kind, &error.message, &cancellation)
                            .await;
                    }
                };
                if cancellation.is_cancelled() {
                    return self.commit_cancelled(state, &cancellation).await;
                }
                if policy_result.stable_prefix_messages > policy_result.messages.len() {
                    return self
                        .commit_failed(
                            state,
                            "policy_error",
                            "host policy stable prefix exceeds rewritten message count",
                            &cancellation,
                        )
                        .await;
                }
                let policy_changed = state.messages != policy_result.messages
                    || state.stable_prefix_messages != policy_result.stable_prefix_messages;
                if policy_changed {
                    state.messages = policy_result.messages;
                    state.stable_prefix_messages = policy_result.stable_prefix_messages;
                    self.persist_policy_update(&mut state, &invocation_id, policy_result.metadata)
                        .await?;
                    state.policy_applied_for_iteration = false;
                }
            }
            let snapshot = match self
                .context
                .prepare(&ContextRequest {
                    session_id: state.session_id.clone(),
                    turn_id: state.turn_id.clone(),
                    invocation_id: invocation_id.clone(),
                    iteration: state.iteration,
                    messages: state.messages.clone(),
                    stable_prefix_messages: state.stable_prefix_messages.min(state.messages.len()),
                    portability: state.portability,
                    delegated_state: state.delegated_state.clone(),
                    inputs: state.inputs.clone(),
                })
                .await
            {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    return self
                        .commit_failed(state, "context_error", &error.to_string(), &cancellation)
                        .await;
                }
            };
            let iteration = state.iteration;
            self.emit(
                &mut state,
                EngineEventKind::ContextPrepared,
                Some(&invocation_id),
                Some(iteration),
                serde_json::to_value(&snapshot).unwrap_or(Value::Null),
            )
            .await?;
            state.snapshots.push(snapshot.clone());

            if cancellation.is_cancelled() {
                return self.commit_cancelled(state, &cancellation).await;
            }

            let model_request = ModelInvocationRequest { context: snapshot };
            state.active_invocation_id = Some(invocation_id.clone());
            let mut attempt = 0usize;
            let model_response = loop {
                if cancellation.is_cancelled() {
                    return self.commit_cancelled(state, &cancellation).await;
                }
                self.emit(
                    &mut state,
                    EngineEventKind::ModelInvocationStarted,
                    Some(&invocation_id),
                    Some(iteration),
                    json!({
                        "snapshotId": model_request.context.id,
                        "attempt": attempt,
                        "messageCount": model_request.context.messages.len(),
                    }),
                )
                .await?;
                match self
                    .effects
                    .model
                    .invoke(&model_request, &cancellation, self.effects.stream.as_ref())
                    .await
                {
                    Ok(response) => break response,
                    Err(source) => {
                        if cancellation.is_cancelled() {
                            return self.commit_cancelled(state, &cancellation).await;
                        }
                        attempt += 1;
                        let outcome_unknown = source.outcome_unknown;
                        let exhausted = outcome_unknown || attempt >= state.max_model_attempts;
                        let reason = source.to_string();
                        self.emit(
                            &mut state,
                            EngineEventKind::ModelInvocationFailed,
                            Some(&invocation_id),
                            Some(iteration),
                            json!({
                                "attempt": attempt - 1,
                                "exhausted": exhausted,
                                "outcomeUnknown": outcome_unknown,
                                "message": reason,
                            }),
                        )
                        .await?;
                        if outcome_unknown {
                            state.reconciliation_required = true;
                            state.model_reconciliation = Some(ModelReconciliationState {
                                invocation_id: invocation_id.clone(),
                                request: model_request.clone(),
                                failed_attempt: attempt - 1,
                                message: reason.clone(),
                                metadata: source.metadata.clone(),
                            });
                            self.persist_model_reconciliation_required(&mut state, &invocation_id)
                                .await?;
                            return self
                                .commit_reconciliation(
                                    state,
                                    "model_outcome_unknown",
                                    &reason,
                                    &cancellation,
                                )
                                .await;
                        }
                        if exhausted {
                            return self
                                .commit_failed(state, "model_error", &reason, &cancellation)
                                .await;
                        }
                        match self
                            .effects
                            .retry
                            .backoff(
                                &RetryPolicyRequest {
                                    failed_attempts: attempt,
                                    next_attempt: attempt + 1,
                                    max_attempts: state.max_model_attempts,
                                    reason,
                                },
                                &cancellation,
                            )
                            .await
                        {
                            Ok(()) => {}
                            Err(RetryPolicyError::Cancelled) => {
                                return self.commit_cancelled(state, &cancellation).await;
                            }
                            Err(RetryPolicyError::Failed(source)) => {
                                return self
                                    .commit_failed(
                                        state,
                                        "retry_policy_error",
                                        &source.to_string(),
                                        &cancellation,
                                    )
                                    .await;
                            }
                        }
                        if cancellation.is_cancelled() {
                            return self.commit_cancelled(state, &cancellation).await;
                        }
                    }
                }
            };
            state.model_reconciliation = None;
            state.reconciliation_required = false;
            if let Err(message) = state.apply_model_response(&invocation_id, &model_response) {
                return self
                    .commit_failed(state, "provider_state_error", &message, &cancellation)
                    .await;
            }
            self.persist_model_response(&mut state, &invocation_id, &model_response)
                .await?;

            if cancellation.is_cancelled() {
                return self.commit_cancelled(state, &cancellation).await;
            }

            if state.final_output_ready {
                state.output = state.pending_output.clone();
                return self.apply_final_policy(state, &cancellation).await;
            }
        }

        self.commit_failed(
            state,
            "max_iterations",
            "Maximum model iterations reached",
            &cancellation,
        )
        .await
    }

    fn validate_request(&self, request: &TurnEngineRequest) -> Result<(), TurnEngineError> {
        if request.session_id.is_empty() {
            return Err(TurnEngineError::InvalidRequest(
                "session_id is required".to_string(),
            ));
        }
        if request.turn_id.is_empty() {
            return Err(TurnEngineError::InvalidRequest(
                "turn_id is required".to_string(),
            ));
        }
        if request.max_model_attempts == 0 {
            return Err(TurnEngineError::InvalidRequest(
                "max_model_attempts must be greater than zero".to_string(),
            ));
        }
        if request.start_iteration > request.max_iterations {
            return Err(TurnEngineError::InvalidRequest(
                "start_iteration must not exceed max_iterations".to_string(),
            ));
        }
        if request.stable_prefix_messages > request.messages.len() {
            return Err(TurnEngineError::InvalidRequest(
                "stable_prefix_messages exceeds initial message count".to_string(),
            ));
        }
        if request.portability == ContextPortability::Portable
            && !request.delegated_state.is_empty()
        {
            return Err(TurnEngineError::InvalidRequest(
                "portable turns cannot begin with delegated provider state".to_string(),
            ));
        }
        Ok(())
    }

    fn finalize_tool_exchange(&self, state: &mut TurnState) -> Result<(), PortError> {
        let Some(response) = state.pending_model_response.take() else {
            return Ok(());
        };
        if response.tool_requests.is_empty() {
            return Ok(());
        }
        let results = response
            .tool_requests
            .iter()
            .filter_map(|request| {
                state
                    .tool_results
                    .iter()
                    .find(|result| result.request_id == request.id)
                    .cloned()
            })
            .collect::<Vec<_>>();
        if results.len() != response.tool_requests.len() {
            state.pending_model_response = Some(response);
            return Err(PortError::configuration(
                "tool exchange is incomplete and cannot be formatted",
            ));
        }
        let messages = match self
            .effects
            .conversation
            .format_tool_exchange(&response, &results)
        {
            Ok(messages) => messages,
            Err(error) => {
                state.pending_model_response = Some(response);
                return Err(error);
            }
        };
        state.messages.extend(messages);
        Ok(())
    }

    async fn persist_policy_update(
        &self,
        state: &mut TurnState,
        invocation_id: &str,
        metadata: Value,
    ) -> Result<EngineCheckpoint, TurnEngineError> {
        let sequence = state.sequence + 1;
        state.policy_applied_for_iteration = true;
        let checkpoint = self.build_checkpoint(state, sequence, true);
        let event = self.build_event(
            state,
            sequence,
            EngineEventKind::PolicyApplied,
            Some(invocation_id),
            Some(state.iteration),
            json!({
                "messages": state.messages.clone(),
                "stablePrefixMessages": state.stable_prefix_messages,
                "metadata": metadata,
            }),
        );
        let checkpoint_event = self.build_checkpoint_event(state, &checkpoint, invocation_id);
        if let Err(source) = self
            .effects
            .durability
            .append_with_checkpoint(&[event, checkpoint_event], &checkpoint)
            .await
        {
            return Err(TurnEngineError::RecoveryRequired {
                stage: "host policy",
                request_id: invocation_id.to_string(),
                checkpoint: Box::new(checkpoint),
                tool_results: state.tool_results.clone(),
                source: Box::new(source),
            });
        }
        state.sequence = sequence + 1;
        Ok(checkpoint)
    }

    async fn persist_conversation_update(
        &self,
        state: &mut TurnState,
        invocation_id: &str,
    ) -> Result<EngineCheckpoint, TurnEngineError> {
        let sequence = state.sequence + 1;
        let checkpoint = self.build_checkpoint(state, sequence, false);
        let event = self.build_event(
            state,
            sequence,
            EngineEventKind::ConversationUpdated,
            Some(invocation_id),
            Some(state.iteration),
            json!({ "messageCount": state.messages.len() }),
        );
        let checkpoint_event = self.build_checkpoint_event(state, &checkpoint, invocation_id);
        if let Err(source) = self
            .effects
            .durability
            .append_with_checkpoint(&[event, checkpoint_event], &checkpoint)
            .await
        {
            return Err(TurnEngineError::RecoveryRequired {
                stage: "conversation update",
                request_id: invocation_id.to_string(),
                checkpoint: Box::new(checkpoint),
                tool_results: state.tool_results.clone(),
                source: Box::new(source),
            });
        }
        state.sequence = sequence + 1;
        Ok(checkpoint)
    }

    async fn persist_model_reconciliation_required(
        &self,
        state: &mut TurnState,
        invocation_id: &str,
    ) -> Result<EngineCheckpoint, TurnEngineError> {
        let sequence = state.sequence + 1;
        let checkpoint = self.build_checkpoint(state, sequence, false);
        let reconciliation = state
            .model_reconciliation
            .as_ref()
            .expect("model reconciliation state must exist before persistence");
        let event = self.build_event(
            state,
            sequence,
            EngineEventKind::ModelReconciliationRequired,
            Some(invocation_id),
            Some(state.iteration),
            serde_json::to_value(reconciliation).unwrap_or(Value::Null),
        );
        let checkpoint_event = self.build_checkpoint_event(state, &checkpoint, invocation_id);
        if let Err(source) = self
            .effects
            .durability
            .append_with_checkpoint(&[event, checkpoint_event], &checkpoint)
            .await
        {
            return Err(TurnEngineError::RecoveryRequired {
                stage: "model reconciliation",
                request_id: invocation_id.to_string(),
                checkpoint: Box::new(checkpoint),
                tool_results: state.tool_results.clone(),
                source: Box::new(source),
            });
        }
        state.sequence = sequence + 1;
        Ok(checkpoint)
    }

    async fn persist_model_reconciliation(
        &self,
        state: &mut TurnState,
        invocation_id: &str,
        reconciliation: &ModelReconciliationState,
        response: &ModelInvocationResponse,
    ) -> Result<EngineCheckpoint, TurnEngineError> {
        let sequence = state.sequence + 1;
        let checkpoint = self.build_checkpoint(state, sequence, false);
        let event = self.build_event(
            state,
            sequence,
            EngineEventKind::ModelInvocationReconciled,
            Some(invocation_id),
            Some(state.iteration),
            json!({
                "reconciliation": reconciliation,
                "hasOutput": response.output.is_some(),
                "toolRequests": response.tool_requests.len(),
                "metadata": response.metadata,
            }),
        );
        let checkpoint_event = self.build_checkpoint_event(state, &checkpoint, invocation_id);
        if let Err(source) = self
            .effects
            .durability
            .append_with_checkpoint(&[event, checkpoint_event], &checkpoint)
            .await
        {
            return Err(TurnEngineError::RecoveryRequired {
                stage: "model reconciliation resolution",
                request_id: invocation_id.to_string(),
                checkpoint: Box::new(checkpoint),
                tool_results: state.tool_results.clone(),
                source: Box::new(source),
            });
        }
        state.sequence = sequence + 1;
        Ok(checkpoint)
    }

    async fn persist_model_response(
        &self,
        state: &mut TurnState,
        invocation_id: &str,
        response: &ModelInvocationResponse,
    ) -> Result<EngineCheckpoint, TurnEngineError> {
        let sequence = state.sequence + 1;
        let checkpoint = self.build_checkpoint(state, sequence, false);
        let event = self.build_event(
            state,
            sequence,
            EngineEventKind::ModelInvocationCompleted,
            Some(invocation_id),
            Some(state.iteration),
            json!({
                "hasOutput": response.output.is_some(),
                "toolRequests": response.tool_requests.len(),
                "nextPortability": response.next_portability,
                "delegatedState": response.delegated_state,
                "metadata": response.metadata,
            }),
        );
        let checkpoint_event = self.build_checkpoint_event(state, &checkpoint, invocation_id);
        if let Err(source) = self
            .effects
            .durability
            .append_with_checkpoint(&[event, checkpoint_event], &checkpoint)
            .await
        {
            return Err(TurnEngineError::RecoveryRequired {
                stage: "model response",
                request_id: invocation_id.to_string(),
                checkpoint: Box::new(checkpoint),
                tool_results: state.tool_results.clone(),
                source: Box::new(source),
            });
        }
        state.sequence = sequence + 1;
        Ok(checkpoint)
    }

    async fn execute_tool(
        &self,
        state: &mut TurnState,
        invocation_id: &str,
        request: &EngineToolRequest,
        cancellation: &CancellationToken,
    ) -> Result<EngineToolResult, ExecuteToolError> {
        self.emit(
            state,
            EngineEventKind::PermissionRequested,
            Some(invocation_id),
            Some(state.iteration),
            json!({ "toolRequest": request }),
        )
        .await
        .map_err(ExecuteToolError::Engine)?;
        let decision = self
            .effects
            .permission
            .authorize(request, cancellation)
            .await
            .map_err(ExecuteToolError::Permission)?;
        self.emit_permission_resolved(state, invocation_id, request, &decision)
            .await
            .map_err(ExecuteToolError::Engine)?;

        if !decision.approved {
            let error_kind = decision
                .metadata
                .get("errorKind")
                .and_then(Value::as_str)
                .unwrap_or("permission_denied")
                .to_string();
            return Ok(EngineToolResult {
                request_id: request.id.clone(),
                name: request.name.clone(),
                outcome: ToolOutcome::Failed,
                output: Value::String(
                    decision
                        .reason
                        .unwrap_or_else(|| "Permission denied".to_string()),
                ),
                error_kind: Some(error_kind),
                metadata: decision.metadata,
            });
        }

        if cancellation.is_cancelled() {
            return Err(ExecuteToolError::Cancelled);
        }

        self.emit(
            state,
            EngineEventKind::ToolExecutionStarted,
            Some(invocation_id),
            Some(state.iteration),
            json!({ "toolRequest": request }),
        )
        .await
        .map_err(ExecuteToolError::Engine)?;
        if cancellation.is_cancelled() {
            return Err(ExecuteToolError::Cancelled);
        }
        let result = match self.effects.tools.execute(request, cancellation).await {
            Ok(result) => result,
            Err(error) if error.configuration_error => {
                return Err(ExecuteToolError::Configuration(error));
            }
            Err(error) => EngineToolResult {
                request_id: request.id.clone(),
                name: request.name.clone(),
                outcome: if error.outcome_unknown {
                    ToolOutcome::Indeterminate
                } else {
                    ToolOutcome::Failed
                },
                output: Value::String(if error.outcome_unknown {
                    format!(
                        "Tool '{}' outcome is unknown and requires reconciliation: {error}",
                        request.name
                    )
                } else {
                    format!("Tool '{}' failed: {error}", request.name)
                }),
                error_kind: Some(if error.outcome_unknown {
                    "effect_outcome_unknown".to_string()
                } else {
                    "tool_error".to_string()
                }),
                metadata: Value::Null,
            },
        };
        Ok(result)
    }

    async fn persist_tool_result(
        &self,
        state: &mut TurnState,
        invocation_id: &str,
        request: &EngineToolRequest,
    ) -> Result<EngineCheckpoint, TurnEngineError> {
        let sequence = state.sequence + 1;
        let checkpoint = self.build_checkpoint(state, sequence, false);
        let result = state
            .tool_results
            .last()
            .expect("tool result must be added before persistence");
        let event_kind = if matches!(
            result.error_kind.as_deref(),
            Some("permission_denied" | "guardrail_denied")
        ) {
            EngineEventKind::ToolResultCommitted
        } else {
            EngineEventKind::ToolExecutionCompleted
        };
        let event = self.build_event(
            state,
            sequence,
            event_kind,
            Some(invocation_id),
            Some(state.iteration),
            json!({ "toolResult": result }),
        );
        let checkpoint_event = self.build_checkpoint_event(state, &checkpoint, invocation_id);
        if let Err(source) = self
            .effects
            .durability
            .append_with_checkpoint(&[event, checkpoint_event], &checkpoint)
            .await
        {
            return Err(TurnEngineError::RecoveryRequired {
                stage: "tool result",
                request_id: request.id.clone(),
                checkpoint: Box::new(checkpoint),
                tool_results: state.tool_results.clone(),
                source: Box::new(source),
            });
        }
        state.sequence = sequence + 1;
        Ok(checkpoint)
    }

    async fn persist_reconciliation(
        &self,
        state: &mut TurnState,
        result: &EngineToolResult,
    ) -> Result<EngineCheckpoint, TurnEngineError> {
        let sequence = state.sequence + 1;
        let checkpoint = self.build_checkpoint(state, sequence, false);
        let invocation_id = state
            .active_invocation_id
            .as_deref()
            .unwrap_or("reconciliation");
        let event = self.build_event(
            state,
            sequence,
            EngineEventKind::ToolResultReconciled,
            Some(invocation_id),
            Some(state.iteration),
            json!({ "toolResult": result }),
        );
        let checkpoint_event = self.build_checkpoint_event(state, &checkpoint, invocation_id);
        if let Err(source) = self
            .effects
            .durability
            .append_with_checkpoint(&[event, checkpoint_event], &checkpoint)
            .await
        {
            return Err(TurnEngineError::RecoveryRequired {
                stage: "tool reconciliation",
                request_id: result.request_id.clone(),
                checkpoint: Box::new(checkpoint),
                tool_results: state.tool_results.clone(),
                source: Box::new(source),
            });
        }
        state.sequence = sequence + 1;
        Ok(checkpoint)
    }

    fn build_checkpoint_event(
        &self,
        state: &TurnState,
        checkpoint: &EngineCheckpoint,
        invocation_id: &str,
    ) -> EngineEvent {
        self.build_event(
            state,
            checkpoint.last_sequence + 1,
            EngineEventKind::CheckpointCreated,
            Some(invocation_id),
            Some(checkpoint.iteration),
            json!({
                "checkpointId": checkpoint.id,
                "includedThroughSequence": checkpoint.last_sequence,
            }),
        )
    }

    fn build_checkpoint(
        &self,
        state: &TurnState,
        last_sequence: u64,
        resume_same_iteration: bool,
    ) -> EngineCheckpoint {
        EngineCheckpoint {
            id: self.effects.ids.next_id("checkpoint"),
            session_id: state.session_id.clone(),
            turn_id: state.turn_id.clone(),
            iteration: state.iteration,
            last_sequence,
            messages: state.messages.clone(),
            stable_prefix_messages: state.stable_prefix_messages,
            inputs: state.inputs.clone(),
            active_invocation_id: state.active_invocation_id.clone(),
            pending_tool_requests: state.pending_tool_requests.clone(),
            completed_tool_results: state.tool_results.clone(),
            completed_model_iterations: state.completed_model_iterations,
            reconciliation_required: state.reconciliation_required
                || state
                    .tool_results
                    .last()
                    .is_some_and(|result| result.outcome == ToolOutcome::Indeterminate),
            model_reconciliation: state.model_reconciliation.clone(),
            pending_output: state.pending_output.clone(),
            final_output_ready: state.final_output_ready,
            pending_model_response: state.pending_model_response.clone(),
            resume_same_iteration,
            policy_applied_for_iteration: state.policy_applied_for_iteration,
            portability: state.portability,
            delegated_state: state.delegated_state.clone(),
            metadata: Value::Null,
        }
    }

    async fn emit_permission_resolved(
        &self,
        state: &mut TurnState,
        invocation_id: &str,
        request: &EngineToolRequest,
        decision: &EnginePermissionDecision,
    ) -> Result<(), TurnEngineError> {
        self.emit(
            state,
            EngineEventKind::PermissionResolved,
            Some(invocation_id),
            Some(state.iteration),
            json!({ "toolRequestId": request.id, "decision": decision }),
        )
        .await
    }

    async fn commit_success(
        &self,
        state: TurnState,
        cancellation: &CancellationToken,
    ) -> Result<TurnEngineResult, TurnEngineError> {
        self.commit(
            state,
            TurnStatus::Success,
            EngineEventKind::TurnCommitted,
            cancellation,
        )
        .await
    }

    async fn apply_final_policy(
        &self,
        mut state: TurnState,
        cancellation: &CancellationToken,
    ) -> Result<TurnEngineResult, TurnEngineError> {
        let request = FinalOutputPolicyRequest {
            session_id: state.session_id.clone(),
            turn_id: state.turn_id.clone(),
            iteration: state.iteration,
            messages: state.messages.clone(),
            output: state.output.clone(),
            inputs: state.inputs.clone(),
        };
        let result = match self
            .effects
            .policy
            .before_commit(request, cancellation)
            .await
        {
            Ok(result) => result,
            Err(error) => {
                return self
                    .commit_failed(state, &error.error_kind, &error.message, cancellation)
                    .await;
            }
        };
        if cancellation.is_cancelled() {
            return self.commit_cancelled(state, cancellation).await;
        }
        state.output = result.output;
        self.commit_success(state, cancellation).await
    }

    async fn commit_cancelled(
        &self,
        state: TurnState,
        cancellation: &CancellationToken,
    ) -> Result<TurnEngineResult, TurnEngineError> {
        self.commit(
            state,
            TurnStatus::Cancelled,
            EngineEventKind::TurnCancelled,
            cancellation,
        )
        .await
    }

    async fn commit_failed(
        &self,
        mut state: TurnState,
        error_kind: &str,
        message: &str,
        cancellation: &CancellationToken,
    ) -> Result<TurnEngineResult, TurnEngineError> {
        state.output = Some(json!({ "errorKind": error_kind, "message": message }));
        self.commit(
            state,
            TurnStatus::Failed,
            EngineEventKind::TurnFailed,
            cancellation,
        )
        .await
    }

    async fn commit_reconciliation(
        &self,
        mut state: TurnState,
        error_kind: &str,
        message: &str,
        cancellation: &CancellationToken,
    ) -> Result<TurnEngineResult, TurnEngineError> {
        state.output = Some(json!({ "errorKind": error_kind, "message": message }));
        self.commit(
            state,
            TurnStatus::ReconciliationRequired,
            EngineEventKind::TurnReconciliationRequired,
            cancellation,
        )
        .await
    }

    async fn commit(
        &self,
        mut state: TurnState,
        status: TurnStatus,
        kind: EngineEventKind,
        cancellation: &CancellationToken,
    ) -> Result<TurnEngineResult, TurnEngineError> {
        let iteration = state.iteration;
        let terminal_payload = json!({ "status": status, "output": state.output });
        self.emit(&mut state, kind, None, Some(iteration), terminal_payload)
            .await?;
        let mut commit = TurnCommit {
            session_id: state.session_id.clone(),
            turn_id: state.turn_id.clone(),
            status,
            output: state.output.clone(),
            messages: state.messages.clone(),
            iterations: state.completed_model_iterations,
            last_sequence: state.sequence,
            portability: state.portability,
            delegated_state: state.delegated_state.clone(),
            model_reconciliation: state.model_reconciliation.clone(),
        };

        let post_commit_error = if status == TurnStatus::Success {
            let effect_id = format!(
                "post_commit:{}:{}:{}:{}",
                commit.session_id.len(),
                commit.session_id,
                commit.turn_id.len(),
                commit.turn_id
            );
            let started = self
                .emit(
                    &mut state,
                    EngineEventKind::PostCommitStarted,
                    None,
                    Some(iteration),
                    json!({ "effectId": effect_id }),
                )
                .await;
            if let Err(error) = started {
                Some(format!(
                    "post-commit effect '{effect_id}' was not started because its start event could not be persisted: {error}"
                ))
            } else {
                match self
                    .effects
                    .post_commit
                    .after_commit(&effect_id, &commit, cancellation)
                    .await
                {
                    Ok(()) => self
                        .emit(
                            &mut state,
                            EngineEventKind::PostCommitCompleted,
                            None,
                            Some(iteration),
                            json!({ "effectId": effect_id }),
                        )
                        .await
                        .err()
                        .map(|error| {
                            format!(
                                "post-commit effect '{effect_id}' completed, but its completion event could not be persisted: {error}"
                            )
                        }),
                    Err(source) => {
                        let message = source.to_string();
                        let event_error = self
                            .emit(
                                &mut state,
                                EngineEventKind::PostCommitFailed,
                                None,
                                Some(iteration),
                                json!({ "effectId": effect_id, "message": message }),
                            )
                            .await
                            .err();
                        Some(match event_error {
                            Some(error) => format!(
                                "{message}; failure event for post-commit effect '{effect_id}' could not be persisted: {error}"
                            ),
                            None => message,
                        })
                    }
                }
            }
        } else {
            None
        };
        commit.last_sequence = state.sequence;

        Ok(TurnEngineResult {
            commit,
            snapshots: state.snapshots,
            tool_results: state.tool_results,
            post_commit_error,
        })
    }

    async fn emit(
        &self,
        state: &mut TurnState,
        kind: EngineEventKind,
        invocation_id: Option<&str>,
        iteration: Option<usize>,
        payload: Value,
    ) -> Result<(), TurnEngineError> {
        let sequence = state.sequence + 1;
        let event = self.build_event(state, sequence, kind, invocation_id, iteration, payload);
        self.effects
            .durability
            .append(&event)
            .await
            .map_err(|source| TurnEngineError::Port {
                stage: "event journal",
                source,
            })?;
        state.sequence = sequence;
        Ok(())
    }

    fn build_event(
        &self,
        state: &TurnState,
        sequence: u64,
        kind: EngineEventKind,
        invocation_id: Option<&str>,
        iteration: Option<usize>,
        payload: Value,
    ) -> EngineEvent {
        EngineEvent {
            sequence,
            id: self.effects.ids.next_id("event"),
            timestamp: self.effects.clock.now(),
            session_id: state.session_id.clone(),
            turn_id: state.turn_id.clone(),
            invocation_id: invocation_id.map(str::to_string),
            iteration,
            kind,
            payload,
        }
    }
}

enum ExecuteToolError {
    Cancelled,
    Permission(PortError),
    Configuration(PortError),
    Engine(TurnEngineError),
}

struct TurnState {
    session_id: String,
    turn_id: String,
    messages: Vec<Message>,
    inputs: Value,
    max_iterations: usize,
    max_model_attempts: usize,
    stable_prefix_messages: usize,
    portability: ContextPortability,
    delegated_state: Vec<DelegatedStateReference>,
    active_invocation_id: Option<String>,
    pending_tool_requests: Vec<EngineToolRequest>,
    reconciliation_required: bool,
    model_reconciliation: Option<ModelReconciliationState>,
    completed_model_iterations: usize,
    pending_output: Option<Value>,
    final_output_ready: bool,
    pending_model_response: Option<ModelInvocationResponse>,
    policy_applied_for_iteration: bool,
    reconciliation_resolution: Option<EngineToolResult>,
    model_reconciliation_resolution: Option<ModelInvocationResponse>,
    iteration: usize,
    sequence: u64,
    output: Option<Value>,
    snapshots: Vec<super::ModelInvocationContextSnapshot>,
    tool_results: Vec<EngineToolResult>,
}

impl TurnState {
    fn new(request: TurnEngineRequest) -> Self {
        Self {
            session_id: request.session_id,
            turn_id: request.turn_id,
            messages: request.messages,
            inputs: request.inputs,
            max_iterations: request.max_iterations,
            max_model_attempts: request.max_model_attempts,
            stable_prefix_messages: request.stable_prefix_messages,
            portability: request.portability,
            delegated_state: request.delegated_state,
            active_invocation_id: request.active_invocation_id,
            pending_tool_requests: request.pending_tool_requests,
            iteration: request.start_iteration,
            sequence: request.initial_sequence,
            output: None,
            snapshots: Vec::new(),
            tool_results: request.completed_tool_results,
            reconciliation_required: request.reconciliation_required,
            model_reconciliation: request.model_reconciliation,
            completed_model_iterations: request.completed_model_iterations,
            pending_output: request.pending_output,
            final_output_ready: request.final_output_ready,
            pending_model_response: request.pending_model_response,
            policy_applied_for_iteration: request.policy_applied_for_iteration,
            reconciliation_resolution: request.reconciliation_resolution,
            model_reconciliation_resolution: request.model_reconciliation_resolution,
        }
    }

    fn apply_model_response(
        &mut self,
        invocation_id: &str,
        response: &ModelInvocationResponse,
    ) -> Result<(), String> {
        self.completed_model_iterations += 1;
        if response.tool_requests.is_empty() {
            self.messages.extend(response.assistant_messages.clone());
            self.pending_model_response = None;
        } else {
            self.pending_model_response = Some(response.clone());
        }
        self.apply_provider_state(response)?;
        self.active_invocation_id = Some(invocation_id.to_string());
        self.pending_tool_requests = response.tool_requests.clone();
        self.pending_output = response.output.clone();
        self.final_output_ready = self.pending_tool_requests.is_empty();
        Ok(())
    }

    fn apply_provider_state(&mut self, response: &ModelInvocationResponse) -> Result<(), String> {
        if let Some(portability) = response.next_portability {
            self.portability = portability;
        }
        if let Some(delegated_state) = &response.delegated_state {
            self.delegated_state = delegated_state.clone();
        } else if self.portability == ContextPortability::Portable {
            self.delegated_state.clear();
        }

        if self.portability == ContextPortability::Portable && !self.delegated_state.is_empty() {
            return Err("portable provider state cannot retain delegated references".to_string());
        }
        if self.portability == ContextPortability::Delegated && self.delegated_state.is_empty() {
            return Err("delegated provider state requires at least one reference".to_string());
        }
        Ok(())
    }
}
