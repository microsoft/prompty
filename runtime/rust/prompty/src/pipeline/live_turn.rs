//! Live `pipeline::turn` effect bundle over the canonical [`TurnEngine`].

use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures::{FutureExt, StreamExt};
use rand::Rng;
use serde_json::{Value, json};

use crate::engine::{
    AppendContextPackingStrategy, CancellationToken, Clock, ContextPipeline, ConversationPort,
    DurabilityPort, EngineCheckpoint, EngineEvent, EngineEventKind, EnginePermissionDecision,
    EngineToolRequest, EngineToolResult, FinalOutputPolicyRequest, FinalOutputPolicyResult,
    GeneratedModelPort, GeneratedModelPortAdapter, HostPolicyError, HostPolicyPort,
    HostPolicyRequest, HostPolicyResult, IdGenerator,
    ModelInvocationResponse as EngineModelInvocationResponse, ModelStreamChunk, ModelStreamPort,
    NoopPostCommitPort, PermissionPort, PortError, RetryPolicyError, RetryPolicyPort,
    RetryPolicyRequest, ToolOutcome, ToolPort, TurnEngine, TurnEngineEffects, TurnEngineError,
    TurnEngineRequest, TurnStatus,
};
use crate::guardrails::Guardrails;
use crate::interfaces::{ExecuteError, InvokerError};
use crate::model::{
    InvocationContextPortability, InvocationContextState, InvocationUsage, ModelInvocationRequest,
    ModelInvocationResponse as GeneratedModelInvocationResponse, ModelToolRequest, Prompty,
};
use crate::registry;
use crate::steering::Steering;
use crate::structured::unwrap_structured;
use crate::tracing::Tracer;
use crate::types::{Message, PromptyStream, StreamChunk, ToolCall};

use super::{AgentEvent, Compaction, EventCallback, ToolHandler, TurnOptions};

type SharedEventCallback = Arc<dyn Fn(AgentEvent) + Send + Sync>;

#[derive(Clone)]
struct LiveEvents {
    callback: Option<SharedEventCallback>,
}

impl LiveEvents {
    fn new(callback: Option<EventCallback>) -> Self {
        Self {
            callback: callback.map(Arc::from),
        }
    }

    fn emit(&self, event: AgentEvent) {
        if let Some(callback) = &self.callback {
            if let Err(error) =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback(event)))
            {
                eprintln!("[prompty] Event callback panicked: {error:?}");
            }
        }
    }
}

#[derive(Default)]
struct LiveFailureState {
    invoker: Mutex<Option<InvokerError>>,
    cancellation_reason: Mutex<Option<String>>,
}

impl LiveFailureState {
    fn record_invoker(&self, error: InvokerError) -> PortError {
        let message = error.to_string();
        let port_error = match &error {
            InvokerError::ExecuteIndeterminate { metadata, .. } => {
                PortError::indeterminate_with_metadata(message.clone(), metadata.clone())
            }
            _ => PortError::new(message),
        };
        *self.invoker.lock().expect("live failure lock poisoned") = Some(error);
        port_error
    }

    fn take_invoker(&self) -> Option<InvokerError> {
        self.invoker
            .lock()
            .expect("live failure lock poisoned")
            .take()
    }

    fn set_cancellation_reason(&self, reason: impl Into<String>) {
        *self
            .cancellation_reason
            .lock()
            .expect("live cancellation reason lock poisoned") = Some(reason.into());
    }

    fn take_cancellation_reason(&self) -> Option<String> {
        self.cancellation_reason
            .lock()
            .expect("live cancellation reason lock poisoned")
            .take()
    }
}

struct LivePolicy {
    agent: Arc<Prompty>,
    inputs: Value,
    guardrails: Option<Arc<Guardrails>>,
    #[allow(clippy::type_complexity)]
    validator: Option<Box<dyn Fn(&Value) -> Result<(), String> + Send + Sync>>,
    steering: Option<Steering>,
    context_budget: Option<usize>,
    compaction: Option<Arc<Compaction>>,
    prepared: AtomicBool,
    skip_output_guardrail: Arc<AtomicBool>,
    failures: Arc<LiveFailureState>,
}

#[async_trait]
impl HostPolicyPort for LivePolicy {
    async fn before_model(
        &self,
        request: HostPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<HostPolicyResult, HostPolicyError> {
        let mut messages = request.messages;
        let mut stable_prefix_messages = request.stable_prefix_messages.min(messages.len());
        let mut prepared_now = false;
        if !self.prepared.load(Ordering::Acquire) {
            messages = match super::prepare(&self.agent, Some(&self.inputs)).await {
                Ok(messages) => messages,
                Err(error) => {
                    let message = error.to_string();
                    self.failures.record_invoker(error);
                    return Err(HostPolicyError::new("prepare_error", message));
                }
            };
            stable_prefix_messages = messages.len();
            self.prepared.store(true, Ordering::Release);
            prepared_now = true;
        }

        let mut steering_count = 0usize;
        if let Some(steering) = &self.steering {
            let steering_messages = steering.drain();
            steering_count = steering_messages.len();
            messages.extend(steering_messages);
        }

        let mut trimmed_count = 0usize;
        if let Some(budget) = self.context_budget {
            let before_trim = messages.clone();
            let (dropped, mut trimmed) = crate::context::trim_to_context_window(&messages, budget);
            trimmed_count = dropped.len();
            if !dropped.is_empty() {
                if let Some(compaction) = &self.compaction {
                    let span = Tracer::start(&format!("turn.iteration.{}", request.iteration));
                    super::apply_compaction(compaction, &dropped, &mut trimmed, &span).await;
                    span.end();
                }
            }
            stable_prefix_messages =
                stable_prefix_messages.min(common_prefix_len(&before_trim, &trimmed));
            messages = trimmed;
        }

        if let Some(guardrails) = &self.guardrails {
            let result = guardrails.check_input(&messages, &self.agent).await;
            if !result.allowed {
                let reason = result.reason.unwrap_or_else(|| "Input denied".to_string());
                return Err(HostPolicyError::new(
                    "input_guardrail_denied",
                    format!("Input guardrail denied: {reason}"),
                ));
            }
        }

        Ok(HostPolicyResult {
            messages,
            stable_prefix_messages,
            metadata: json!({
                "prepared": prepared_now,
                "steeringCount": steering_count,
                "trimmedCount": trimmed_count,
                "notifyMessagesUpdated": steering_count > 0 || trimmed_count > 0,
            }),
        })
    }

    async fn before_commit(
        &self,
        request: FinalOutputPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<FinalOutputPolicyResult, HostPolicyError> {
        let mut output = request.output;
        if let Some(guardrails) = &self.guardrails
            && !self.skip_output_guardrail.load(Ordering::Acquire)
        {
            let guardrail_output = output.as_ref().unwrap_or(&Value::Null);
            let result = guardrails.check_output(guardrail_output, &self.agent).await;
            if !result.allowed {
                let reason = result.reason.unwrap_or_else(|| "Output denied".to_string());
                return Err(HostPolicyError::new(
                    "output_guardrail_denied",
                    format!("Output guardrail denied: {reason}"),
                ));
            }
            if let Some(rewrite) = result.rewrite {
                output = Some(rewrite);
            }
        }
        output = output.map(|value| unwrap_structured(&value));
        if let Some(validator) = &self.validator {
            let output = output.as_ref().unwrap_or(&Value::Null);
            validator(output).map_err(|message| {
                HostPolicyError::new(
                    "output_validation_failed",
                    format!("Output validation failed: {message}"),
                )
            })?;
        }
        Ok(FinalOutputPolicyResult {
            output,
            metadata: Value::Null,
        })
    }
}

fn common_prefix_len(left: &[Message], right: &[Message]) -> usize {
    left.iter()
        .zip(right)
        .take_while(|(left, right)| left == right)
        .count()
}

struct LiveRetryPolicy {
    events: LiveEvents,
    failures: Arc<LiveFailureState>,
}

#[async_trait]
impl RetryPolicyPort for LiveRetryPolicy {
    async fn backoff(
        &self,
        request: &RetryPolicyRequest,
        cancellation: &CancellationToken,
    ) -> Result<(), RetryPolicyError> {
        self.events.emit(AgentEvent::Status(format!(
            "LLM call failed, retrying (attempt {}/{})...",
            request.next_attempt, request.max_attempts
        )));
        self.events.emit(AgentEvent::Retry {
            operation: "llm".to_string(),
            attempt: request.next_attempt,
            max_attempts: request.max_attempts,
            reason: request.reason.clone(),
        });

        let jitter: f64 = rand::rng().random();
        let seconds = (2.0_f64.powi(request.failed_attempts as i32) + jitter).min(60.0);
        let delay = Duration::from_secs_f64(seconds);
        let started = Instant::now();
        while started.elapsed() < delay {
            if cancellation.is_cancelled() {
                let reason = "Operation cancelled during retry backoff";
                self.failures.set_cancellation_reason(reason);
                return Err(RetryPolicyError::Cancelled);
            }
            let remaining = delay.saturating_sub(started.elapsed());
            tokio::time::sleep(remaining.min(Duration::from_millis(100))).await;
        }
        Ok(())
    }
}

struct LiveModelPort {
    agent: Arc<Prompty>,
    provider: String,
    streaming: bool,
    raw_final: bool,
    agent_mode: bool,
    skip_output_guardrail: Arc<AtomicBool>,
    failures: Arc<LiveFailureState>,
}

impl LiveModelPort {
    fn normalize_tool_requests(tool_calls: Vec<ToolCall>) -> Vec<ModelToolRequest> {
        tool_calls
            .into_iter()
            .map(|tool_call| ModelToolRequest {
                id: tool_call.id,
                name: tool_call.name,
                arguments: Some(
                    serde_json::from_str(&tool_call.arguments)
                        .unwrap_or_else(|_| Value::String(tool_call.arguments.clone())),
                ),
                metadata: json!({ "argumentsText": tool_call.arguments }),
            })
            .collect()
    }

    async fn execute_non_streaming(
        &self,
        request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
    ) -> Result<(GeneratedModelInvocationResponse, Value), InvokerError> {
        let raw_response = registry::invoke_executor_with_context(
            &self.provider,
            &self.agent,
            request,
            cancellation,
        )
        .await?;
        let mut response = if self.raw_final && !self.agent_mode {
            registry::invoke_processor_raw_with_context(
                &self.provider,
                &self.agent,
                raw_response.clone(),
                request,
            )
            .await?
        } else {
            registry::invoke_processor_with_context(
                &self.provider,
                &self.agent,
                raw_response.clone(),
                request,
            )
            .await?
        };
        if self.raw_final && !self.agent_mode {
            self.skip_output_guardrail.store(true, Ordering::Release);
            response.output = Some(raw_response.clone());
            response.tool_requests.clear();
        } else if response.tool_requests.is_empty() {
            response.output = response.output.map(|output| unwrap_structured(&output));
        }
        Ok((response, raw_response))
    }
}

#[async_trait]
impl GeneratedModelPort for LiveModelPort {
    async fn invoke(
        &self,
        request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
        stream: &dyn ModelStreamPort,
    ) -> Result<GeneratedModelInvocationResponse, PortError> {
        if cancellation.is_cancelled() {
            return Err(PortError::new("Operation cancelled"));
        }

        if !self.streaming {
            let (mut response, raw_response) =
                match self.execute_non_streaming(request, cancellation).await {
                    Ok(response) => response,
                    Err(error) => return Err(self.failures.record_invoker(error)),
                };
            let provider_metadata = std::mem::take(&mut response.metadata);
            response.metadata = json!({
                "rawResponse": raw_response,
                "rawChunks": [],
                "textContent": response.output.as_ref().and_then(Value::as_str),
                "streamed": false,
                "providerMetadata": provider_metadata,
            });
            return Ok(response);
        }

        let (tool_calls, processed, raw_response, raw_chunks, streamed, usage) =
            match registry::invoke_executor_stream_with_context(
                &self.provider,
                &self.agent,
                request,
                cancellation,
            )
            .await
            {
                Ok(raw_stream) => {
                    let raw_chunks = Arc::new(Mutex::new(Vec::new()));
                    let collected = raw_chunks.clone();
                    let tee = raw_stream.map(move |chunk| {
                        collected
                            .lock()
                            .expect("stream chunk lock poisoned")
                            .push(chunk.clone());
                        chunk
                    });
                    let prompty_stream = PromptyStream::from_stream("PromptyStream", tee);
                    let mut chunks =
                        registry::invoke_processor_stream(&self.provider, Box::pin(prompty_stream))
                            .map_err(|error| self.failures.record_invoker(error))?;
                    let mut text = Vec::new();
                    let mut tool_calls = Vec::new();
                    let mut usage = None;
                    while let Some(chunk) = chunks.next().await {
                        if cancellation.is_cancelled() {
                            return Err(PortError::new("Operation cancelled"));
                        }
                        match chunk {
                            StreamChunk::Text(value) => {
                                stream.emit(ModelStreamChunk::Text(value.clone())).await;
                                text.push(value);
                            }
                            StreamChunk::Thinking(value) => {
                                stream.emit(ModelStreamChunk::Thinking(value)).await;
                            }
                            StreamChunk::Tool(tool_call) => tool_calls.push(tool_call),
                            StreamChunk::Usage(value) => usage = Some(value),
                            StreamChunk::Error(failure) => {
                                let error = if failure.outcome_unknown() {
                                    InvokerError::indeterminate_execution(
                                        failure.message(),
                                        json!({
                                            "provider": self.provider,
                                            "phase": "stream_transport",
                                        }),
                                    )
                                } else {
                                    InvokerError::Execute(failure.message().to_string().into())
                                };
                                return Err(self.failures.record_invoker(error));
                            }
                        }
                    }
                    (
                        tool_calls,
                        Value::String(text.join("")),
                        Value::Null,
                        raw_chunks
                            .lock()
                            .expect("stream chunk lock poisoned")
                            .clone(),
                        true,
                        usage,
                    )
                }
                Err(stream_error) => {
                    if matches!(stream_error, InvokerError::ExecuteIndeterminate { .. }) {
                        return Err(self.failures.record_invoker(stream_error));
                    }
                    match self.execute_non_streaming(request, cancellation).await {
                        Ok((mut response, raw_response)) => {
                            let provider_metadata = std::mem::take(&mut response.metadata);
                            response.metadata = json!({
                                "rawResponse": raw_response,
                                "rawChunks": [],
                                "textContent": response.output.as_ref().and_then(Value::as_str),
                                "streamed": false,
                                "providerMetadata": provider_metadata,
                                "streamError": stream_error.to_string(),
                            });
                            return Ok(response);
                        }
                        Err(error) => {
                            return Err(self.failures.record_invoker(InvokerError::Execute(
                                format!("{stream_error} (stream), then {error} (non-stream)")
                                    .into(),
                            )));
                        }
                    }
                }
            };

        let completed_response = raw_chunks.iter().rev().find_map(|chunk| {
            (chunk.get("type").and_then(Value::as_str) == Some("response.completed"))
                .then(|| chunk.get("response").cloned())
                .flatten()
        });
        if let Some(completed_response) = completed_response {
            let mut response = registry::invoke_processor_with_context(
                &self.provider,
                &self.agent,
                completed_response.clone(),
                request,
            )
            .await
            .map_err(|error| self.failures.record_invoker(error))?;
            if response.tool_requests.is_empty() {
                response.output = response.output.map(|output| unwrap_structured(&output));
            }
            let provider_metadata = std::mem::take(&mut response.metadata);
            response.metadata = json!({
                "rawResponse": completed_response,
                "rawChunks": raw_chunks,
                "textContent": response.output.as_ref().and_then(Value::as_str),
                "streamed": true,
                "providerMetadata": provider_metadata,
            });
            return Ok(response);
        }

        let text_content = super::extract_text_from_processed(&processed);
        let tool_requests = Self::normalize_tool_requests(tool_calls);
        let output = if tool_requests.is_empty() {
            Some(if self.raw_final && !streamed {
                raw_response.clone()
            } else {
                unwrap_structured(&processed)
            })
        } else {
            None
        };

        Ok(GeneratedModelInvocationResponse {
            output,
            usage: usage
                .map(|usage| {
                    Ok(InvocationUsage {
                        input_tokens: i64::try_from(usage.input_tokens).map_err(|_| {
                            PortError::configuration("usage input token count exceeds Int64 range")
                        })?,
                        output_tokens: i64::try_from(usage.output_tokens).map_err(|_| {
                            PortError::configuration("usage output token count exceeds Int64 range")
                        })?,
                        total_tokens: i64::try_from(usage.total_tokens).map_err(|_| {
                            PortError::configuration("usage total token count exceeds Int64 range")
                        })?,
                    })
                })
                .transpose()?,
            assistant_messages: Vec::new(),
            tool_requests,
            next_context_state: Some(InvocationContextState {
                portability: InvocationContextPortability::Portable,
                delegated_state: Vec::new(),
            }),
            metadata: json!({
                "rawResponse": raw_response,
                "rawChunks": raw_chunks,
                "textContent": text_content,
                "streamed": streamed,
            }),
        })
    }
}

struct LiveStreamPort {
    events: LiveEvents,
}

#[async_trait]
impl ModelStreamPort for LiveStreamPort {
    async fn emit(&self, chunk: ModelStreamChunk) {
        match chunk {
            ModelStreamChunk::Text(value) => self.events.emit(AgentEvent::Token(value)),
            ModelStreamChunk::Thinking(value) => self.events.emit(AgentEvent::Thinking(value)),
            ModelStreamChunk::Provider(_) => {}
        }
    }
}

struct LiveConversationPort {
    provider: String,
    failures: Arc<LiveFailureState>,
}

impl ConversationPort for LiveConversationPort {
    fn format_tool_exchange(
        &self,
        response: &EngineModelInvocationResponse,
        results: &[EngineToolResult],
    ) -> Result<Vec<Message>, PortError> {
        if response.tool_requests.is_empty() || results.is_empty() {
            return Err(PortError::configuration(
                "tool conversation formatting requires non-empty requests and results",
            ));
        }
        let tool_calls = response
            .tool_requests
            .iter()
            .map(|request| ToolCall {
                id: request.id.clone(),
                name: request.name.clone(),
                arguments: request
                    .metadata
                    .get("argumentsText")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| request.arguments.to_string()),
            })
            .collect::<Vec<_>>();
        let tool_results = response
            .tool_requests
            .iter()
            .map(|request| {
                results
                    .iter()
                    .find(|result| result.request_id == request.id)
                    .map(EngineToolResult::model_text)
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>();
        let text_content = response.metadata.get("textContent").and_then(Value::as_str);
        let formatted = if response
            .metadata
            .get("streamed")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let raw_chunks = response
                .metadata
                .get("rawChunks")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            registry::invoke_format_stream_tool_messages(
                &self.provider,
                &raw_chunks,
                &tool_calls,
                &tool_results,
                text_content,
            )
        } else {
            registry::invoke_format_tool_messages(
                &self.provider,
                response.metadata.get("rawResponse").unwrap_or(&Value::Null),
                &tool_calls,
                &tool_results,
                text_content,
            )
        };
        formatted.map_err(|error| self.failures.record_invoker(error))
    }
}

struct LivePermissionPort {
    agent: Arc<Prompty>,
    guardrails: Option<Arc<Guardrails>>,
}

#[async_trait]
impl PermissionPort for LivePermissionPort {
    async fn authorize(
        &self,
        request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EnginePermissionDecision, PortError> {
        let Some(guardrails) = &self.guardrails else {
            return Ok(EnginePermissionDecision {
                approved: true,
                reason: None,
                metadata: Value::Null,
            });
        };
        let arguments = request
            .metadata
            .get("argumentsText")
            .and_then(Value::as_str)
            .and_then(|value| serde_json::from_str(value).ok())
            .unwrap_or_else(|| json!({}));
        let result = guardrails
            .check_tool(&request.name, &arguments, &self.agent)
            .await;
        if result.allowed {
            Ok(EnginePermissionDecision {
                approved: true,
                reason: None,
                metadata: Value::Null,
            })
        } else {
            let reason = result.reason.unwrap_or_else(|| "Tool denied".to_string());
            Ok(EnginePermissionDecision {
                approved: false,
                reason: Some(format!("Error: Tool guardrail denied: {reason}")),
                metadata: json!({ "errorKind": "guardrail_denied" }),
            })
        }
    }
}

struct LiveToolPort {
    agent: Arc<Prompty>,
    inputs: Value,
    tools: Arc<HashMap<String, ToolHandler>>,
    events: LiveEvents,
}

#[async_trait]
impl ToolPort for LiveToolPort {
    async fn execute(
        &self,
        request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EngineToolResult, PortError> {
        let tool_call = ToolCall {
            id: request.id.clone(),
            name: request.name.clone(),
            arguments: request
                .metadata
                .get("argumentsText")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| request.arguments.to_string()),
        };
        let future = std::panic::AssertUnwindSafe(crate::tool_dispatch::dispatch_tool(
            &tool_call,
            &self.tools,
            &self.agent,
            Some(&self.inputs),
        ));
        let output = match future.catch_unwind().await {
            Ok(output) => output,
            Err(panic_info) => {
                let message = if let Some(message) = panic_info.downcast_ref::<&str>() {
                    message.to_string()
                } else if let Some(message) = panic_info.downcast_ref::<String>() {
                    message.clone()
                } else {
                    "unknown panic".to_string()
                };
                self.events.emit(AgentEvent::Error(format!(
                    "Tool '{}' panicked: {}",
                    request.name, message
                )));
                format!("Error: Tool '{}' panicked: {}", request.name, message)
            }
        };
        let failed = output.starts_with("Error:");
        Ok(EngineToolResult {
            request_id: request.id.clone(),
            name: request.name.clone(),
            outcome: if failed {
                ToolOutcome::Failed
            } else {
                ToolOutcome::Success
            },
            output: Value::String(output),
            error_kind: failed.then(|| "tool_error".to_string()),
            metadata: Value::Null,
        })
    }
}

#[derive(Default)]
struct ProjectionState {
    messages: Vec<Message>,
    completed_model_iterations: usize,
    terminal_emitted: bool,
}

struct LiveDurabilityPort {
    events: LiveEvents,
    agent_name: Option<String>,
    provider: String,
    model_id: Option<String>,
    configured_max_iterations: usize,
    agent_mode: bool,
    persistence: Option<Arc<dyn DurabilityPort>>,
    state: Mutex<ProjectionState>,
}

impl LiveDurabilityPort {
    fn update_checkpoint(&self, checkpoint: &EngineCheckpoint) {
        let mut state = self.state.lock().expect("live projection lock poisoned");
        state.messages = checkpoint.messages.clone();
        state.completed_model_iterations = checkpoint.completed_model_iterations;
    }

    fn project(&self, event: &EngineEvent) {
        match event.kind {
            EngineEventKind::TurnStarted => self.events.emit(AgentEvent::TurnStart {
                agent: self.agent_name.clone(),
                max_iterations: self.configured_max_iterations,
            }),
            EngineEventKind::PolicyApplied => {
                let metadata = &event.payload["metadata"];
                let steering_count = metadata
                    .get("steeringCount")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                if steering_count > 0 {
                    self.events.emit(AgentEvent::Status(format!(
                        "Injected {steering_count} steering message(s)"
                    )));
                }
                if metadata
                    .get("notifyMessagesUpdated")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    let messages = self
                        .state
                        .lock()
                        .expect("live projection lock poisoned")
                        .messages
                        .clone();
                    self.events.emit(AgentEvent::MessagesUpdated { messages });
                }
            }
            EngineEventKind::ModelInvocationStarted => {
                self.events.emit(AgentEvent::LlmStart {
                    provider: self.provider.clone(),
                    model_id: self.model_id.clone(),
                    message_count: event
                        .payload
                        .get("messageCount")
                        .and_then(Value::as_u64)
                        .unwrap_or(0) as usize,
                    iteration: event.iteration.unwrap_or_default(),
                });
            }
            EngineEventKind::ModelInvocationCompleted
            | EngineEventKind::ModelInvocationReconciled => {
                self.events.emit(AgentEvent::LlmComplete {
                    iteration: event.iteration.unwrap_or_default(),
                });
            }
            EngineEventKind::ToolExecutionStarted => {
                if let Ok(request) = serde_json::from_value::<EngineToolRequest>(
                    event.payload["toolRequest"].clone(),
                ) {
                    self.events.emit(AgentEvent::ToolCallStart {
                        name: request.name,
                        arguments: request
                            .metadata
                            .get("argumentsText")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                            .unwrap_or_else(|| request.arguments.to_string()),
                    });
                }
            }
            EngineEventKind::ToolExecutionCompleted | EngineEventKind::ToolResultCommitted => {
                if let Ok(result) =
                    serde_json::from_value::<EngineToolResult>(event.payload["toolResult"].clone())
                {
                    let output = result.model_text();
                    self.events.emit(AgentEvent::ToolResult {
                        name: result.name.clone(),
                        result: output.clone(),
                    });
                    self.events.emit(AgentEvent::ToolCallComplete {
                        name: result.name,
                        success: result.outcome == ToolOutcome::Success,
                        result: output,
                        error_kind: result.error_kind,
                    });
                }
            }
            EngineEventKind::ConversationUpdated => {
                let messages = self
                    .state
                    .lock()
                    .expect("live projection lock poisoned")
                    .messages
                    .clone();
                self.events.emit(AgentEvent::MessagesUpdated { messages });
            }
            EngineEventKind::TurnCommitted => self.project_terminal(event, "success"),
            EngineEventKind::TurnCancelled => {
                self.events.emit(AgentEvent::Cancelled);
                self.project_terminal(event, "cancelled");
            }
            EngineEventKind::TurnFailed | EngineEventKind::TurnReconciliationRequired => {
                if event.payload["output"]
                    .get("errorKind")
                    .and_then(Value::as_str)
                    == Some("max_iterations")
                {
                    self.events.emit(AgentEvent::Error(format!(
                        "Agent loop exceeded max iterations ({})",
                        self.configured_max_iterations
                    )));
                }
                self.project_terminal(event, "error");
            }
            _ => {}
        }
    }

    fn project_terminal(&self, event: &EngineEvent, status: &str) {
        let mut state = self.state.lock().expect("live projection lock poisoned");
        if state.terminal_emitted {
            return;
        }
        state.terminal_emitted = true;
        let iterations = if self.agent_mode {
            state.completed_model_iterations
        } else {
            0
        };
        let response = if status == "success" {
            event.payload["output"].clone()
        } else {
            Value::Null
        };
        if status == "success" {
            self.events.emit(AgentEvent::Done {
                response: response.clone(),
                messages: state.messages.clone(),
            });
        }
        self.events.emit(AgentEvent::TurnEnd {
            status: status.to_string(),
            iterations,
            response,
        });
    }

    fn finish_uncommitted_error(&self) {
        let mut state = self.state.lock().expect("live projection lock poisoned");
        if state.terminal_emitted {
            return;
        }
        state.terminal_emitted = true;
        self.events.emit(AgentEvent::TurnEnd {
            status: "error".to_string(),
            iterations: if self.agent_mode {
                state.completed_model_iterations
            } else {
                0
            },
            response: Value::Null,
        });
    }
}

#[async_trait]
impl DurabilityPort for LiveDurabilityPort {
    async fn append(&self, event: &EngineEvent) -> Result<(), PortError> {
        if let Some(persistence) = &self.persistence {
            persistence.append(event).await?;
        }
        self.project(event);
        Ok(())
    }

    async fn append_with_checkpoint(
        &self,
        events: &[EngineEvent],
        checkpoint: &EngineCheckpoint,
    ) -> Result<(), PortError> {
        if let Some(persistence) = &self.persistence {
            persistence
                .append_with_checkpoint(events, checkpoint)
                .await?;
        }
        self.update_checkpoint(checkpoint);
        for event in events {
            self.project(event);
        }
        if events.iter().any(|event| {
            matches!(
                event.kind,
                EngineEventKind::ToolExecutionCompleted | EngineEventKind::ToolResultCommitted
            )
        }) && checkpoint.pending_tool_requests.is_empty()
            && checkpoint.pending_model_response.is_none()
        {
            self.events.emit(AgentEvent::MessagesUpdated {
                messages: checkpoint.messages.clone(),
            });
        }
        Ok(())
    }
}

struct LiveClock;

impl Clock for LiveClock {
    fn now(&self) -> String {
        chrono::Utc::now().to_rfc3339()
    }
}

#[derive(Default)]
struct LiveIds(AtomicU64);

impl IdGenerator for LiveIds {
    fn next_id(&self, kind: &str) -> String {
        format!("{kind}-{}", self.0.fetch_add(1, Ordering::Relaxed) + 1)
    }
}

static LIVE_TURN_IDS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
pub(super) static LIVE_ENGINE_RUNS: AtomicU64 = AtomicU64::new(0);

pub(super) async fn turn(
    agent: &Prompty,
    inputs: Option<&Value>,
    options: Option<TurnOptions>,
) -> Result<Value, InvokerError> {
    let turn_number = LIVE_TURN_IDS.fetch_add(1, Ordering::Relaxed) + 1;
    let mut request = TurnEngineRequest::new(
        format!("legacy-session-{turn_number}"),
        format!("legacy-turn-{turn_number}"),
        Vec::new(),
    );
    request.inputs = inputs.cloned().unwrap_or_else(|| json!({}));
    turn_with_engine_request(agent, request, options).await
}

pub(super) async fn turn_with_engine_request(
    agent: &Prompty,
    mut request: TurnEngineRequest,
    options: Option<TurnOptions>,
) -> Result<Value, InvokerError> {
    let TurnOptions {
        max_iterations,
        raw,
        tools,
        on_event,
        cancelled,
        context_budget,
        guardrails,
        steering,
        parallel_tool_calls,
        validator,
        max_llm_retries,
        compaction,
        durability: persistence,
        permission,
        post_commit,
    } = options.unwrap_or_default();

    let span = Tracer::start("turn");
    span.emit("signature", &json!("prompty.turn"));
    span.emit(
        "description",
        &json!("Canonical TurnEngine live effect bundle"),
    );
    let inputs = if request.inputs.is_null() {
        json!({})
    } else {
        request.inputs.clone()
    };
    request.inputs = inputs.clone();
    span.emit("inputs", &inputs);
    let events = LiveEvents::new(on_event);

    if parallel_tool_calls {
        let message = "parallel_tool_calls=true is not supported by the canonical Rust engine; \
                       tool effects execute sequentially for deterministic durable ordering"
            .to_string();
        events.emit(AgentEvent::TurnStart {
            agent: Some(agent.name.clone()),
            max_iterations,
        });
        events.emit(AgentEvent::Error(message.clone()));
        events.emit(AgentEvent::TurnEnd {
            status: "error".to_string(),
            iterations: 0,
            response: Value::Null,
        });
        span.emit("error", &json!(message));
        span.end();
        return Err(InvokerError::Validation(message));
    }

    #[cfg(test)]
    LIVE_ENGINE_RUNS.fetch_add(1, Ordering::SeqCst);

    let agent = Arc::new(agent.clone());
    let provider = super::resolve_provider(&agent);
    let streaming = super::is_streaming(&agent);
    let agent_mode = !tools.is_empty() || !agent.tools.is_empty();
    let failures = Arc::new(LiveFailureState::default());
    let guardrails = guardrails.map(Arc::new);
    let tools = Arc::new(tools);
    let compaction = compaction.map(Arc::new);
    let skip_output_guardrail = Arc::new(AtomicBool::new(false));
    let durability = Arc::new(LiveDurabilityPort {
        events: events.clone(),
        agent_name: Some(agent.name.clone()),
        provider: provider.clone(),
        model_id: (!agent.model.id.is_empty()).then(|| agent.model.id.clone()),
        configured_max_iterations: max_iterations,
        agent_mode,
        persistence,
        state: Mutex::new(ProjectionState::default()),
    });
    let cancellation = cancelled
        .map(CancellationToken::from_shared)
        .unwrap_or_default();
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        TurnEngineEffects {
            model: Arc::new(GeneratedModelPortAdapter::new(Arc::new(LiveModelPort {
                agent: agent.clone(),
                provider: provider.clone(),
                streaming,
                raw_final: raw && !agent_mode,
                agent_mode,
                skip_output_guardrail: skip_output_guardrail.clone(),
                failures: failures.clone(),
            }))),
            stream: Arc::new(LiveStreamPort {
                events: events.clone(),
            }),
            policy: Arc::new(LivePolicy {
                agent: agent.clone(),
                inputs: inputs.clone(),
                guardrails: guardrails.clone(),
                validator,
                steering,
                context_budget,
                compaction,
                prepared: AtomicBool::new(
                    request.start_iteration > 0
                        || request.policy_applied_for_iteration
                        || !request.messages.is_empty(),
                ),
                skip_output_guardrail,
                failures: failures.clone(),
            }),
            retry: Arc::new(LiveRetryPolicy {
                events: events.clone(),
                failures: failures.clone(),
            }),
            conversation: Arc::new(LiveConversationPort {
                provider,
                failures: failures.clone(),
            }),
            permission: permission.unwrap_or_else(|| {
                Arc::new(LivePermissionPort {
                    agent: agent.clone(),
                    guardrails,
                })
            }),
            tools: Arc::new(LiveToolPort {
                agent,
                inputs: inputs.clone(),
                tools,
                events,
            }),
            durability: durability.clone(),
            post_commit: post_commit.unwrap_or_else(|| Arc::new(NoopPostCommitPort)),
            clock: Arc::new(LiveClock),
            ids: Arc::new(LiveIds::default()),
        },
    );

    request.max_iterations = if agent_mode {
        max_iterations
    } else {
        max_iterations.max(1)
    };
    request.max_model_attempts = max_llm_retries.max(1);

    let result = engine.run(request, cancellation).await;
    let mapped = match result {
        Ok(result) => match result.commit.status {
            TurnStatus::Success => Ok(result.commit.output.unwrap_or(Value::Null)),
            TurnStatus::Cancelled => Err(InvokerError::Cancelled(
                failures
                    .take_cancellation_reason()
                    .unwrap_or_else(|| "Operation cancelled".to_string()),
            )),
            TurnStatus::Failed | TurnStatus::ReconciliationRequired => {
                let output = result.commit.output.unwrap_or(Value::Null);
                let error_kind = output
                    .get("errorKind")
                    .and_then(Value::as_str)
                    .unwrap_or("engine_error");
                let message = output
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("TurnEngine failed")
                    .to_string();
                match error_kind {
                    "prepare_error" => Err(failures
                        .take_invoker()
                        .unwrap_or_else(|| InvokerError::Other(message.clone()))),
                    "output_validation_failed" => Err(InvokerError::Validation(message)),
                    "model_error" => Err(InvokerError::ExecuteRetryExhausted(ExecuteError {
                        message: format!(
                            "LLM call failed after {} retries: {}",
                            max_llm_retries, message
                        ),
                        messages: result.commit.messages,
                    })),
                    "model_outcome_unknown" => Err(failures
                        .take_invoker()
                        .unwrap_or_else(|| InvokerError::Execute(message.clone().into()))),
                    "max_iterations" => Err(InvokerError::Execute(
                        format!("Agent loop exceeded max iterations ({max_iterations})").into(),
                    )),
                    _ => Err(InvokerError::Execute(message.into())),
                }
            }
        },
        Err(error) => {
            durability.finish_uncommitted_error();
            Err(failures
                .take_invoker()
                .unwrap_or_else(|| map_engine_error(error)))
        }
    };

    match &mapped {
        Ok(value) => span.emit("result", value),
        Err(error) => span.emit("error", &json!(error.to_string())),
    }
    span.end();
    mapped
}

fn map_engine_error(error: TurnEngineError) -> InvokerError {
    InvokerError::Execute(error.to_string().into())
}

#[cfg(test)]
mod tests {
    use std::pin::Pin;
    use std::sync::atomic::Ordering;

    use async_trait::async_trait;
    use futures::{Stream, StreamExt};
    use serde_json::json;

    use super::*;
    use crate::interfaces::{Executor, Processor};
    use crate::model::context::LoadContext;
    use crate::types::StreamFailure;

    const RESPONSES_STREAM_PROVIDER: &str = "live-responses-stream-test";
    const INDETERMINATE_STREAM_PROVIDER: &str = "live-indeterminate-stream-test";
    const POST_OPEN_INDETERMINATE_STREAM_PROVIDER: &str =
        "live-post-open-indeterminate-stream-test";
    static INDETERMINATE_STREAM_OPEN_CALLS: AtomicU64 = AtomicU64::new(0);
    static INDETERMINATE_NON_STREAM_CALLS: AtomicU64 = AtomicU64::new(0);

    struct ResponsesStreamExecutor;

    #[async_trait]
    impl Executor for ResponsesStreamExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<Value, InvokerError> {
            unreachable!("the test exercises the streaming path")
        }

        async fn execute_stream_with_context(
            &self,
            _agent: &Prompty,
            _request: &ModelInvocationRequest,
            _cancellation: &CancellationToken,
        ) -> Result<Pin<Box<dyn Stream<Item = Value> + Send>>, InvokerError> {
            Ok(Box::pin(futures::stream::iter(vec![json!({
                "type": "response.completed",
                "response": {
                    "object": "response",
                    "id": "resp_streamed_tool_round",
                    "output": [{
                        "type": "function_call",
                        "call_id": "call_weather",
                        "name": "weather",
                        "arguments": "{\"city\":\"Paris\"}"
                    }]
                }
            })])))
        }
    }

    struct ResponsesStreamProcessor;

    struct IndeterminateStreamExecutor;

    struct PostOpenIndeterminateStreamExecutor;

    struct PostOpenIndeterminateStreamProcessor;

    #[async_trait]
    impl Executor for IndeterminateStreamExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<Value, InvokerError> {
            INDETERMINATE_NON_STREAM_CALLS.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"unexpected": "non-stream fallback"}))
        }

        async fn execute_stream_with_context(
            &self,
            _agent: &Prompty,
            _request: &ModelInvocationRequest,
            _cancellation: &CancellationToken,
        ) -> Result<Pin<Box<dyn Stream<Item = Value> + Send>>, InvokerError> {
            INDETERMINATE_STREAM_OPEN_CALLS.fetch_add(1, Ordering::SeqCst);
            Err(InvokerError::indeterminate_execution(
                "stream request may have been dispatched",
                json!({"provider": INDETERMINATE_STREAM_PROVIDER, "phase": "stream_open"}),
            ))
        }
    }

    #[async_trait]
    impl Executor for PostOpenIndeterminateStreamExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<Value, InvokerError> {
            unreachable!("the test exercises the streaming path")
        }

        async fn execute_stream_with_context(
            &self,
            _agent: &Prompty,
            _request: &ModelInvocationRequest,
            _cancellation: &CancellationToken,
        ) -> Result<Pin<Box<dyn Stream<Item = Value> + Send>>, InvokerError> {
            Ok(Box::pin(futures::stream::iter(vec![
                json!({"token": "partial"}),
                json!({"transport_error": "connection reset"}),
            ])))
        }
    }

    #[derive(Default)]
    struct CheckpointRecorder {
        checkpoints: Mutex<Vec<EngineCheckpoint>>,
    }

    #[async_trait]
    impl DurabilityPort for CheckpointRecorder {
        async fn append(&self, _event: &EngineEvent) -> Result<(), PortError> {
            Ok(())
        }

        async fn append_with_checkpoint(
            &self,
            _events: &[EngineEvent],
            checkpoint: &EngineCheckpoint,
        ) -> Result<(), PortError> {
            self.checkpoints
                .lock()
                .expect("checkpoint lock poisoned")
                .push(checkpoint.clone());
            Ok(())
        }
    }

    #[async_trait]
    impl Processor for ResponsesStreamProcessor {
        async fn process(&self, _agent: &Prompty, _response: Value) -> Result<Value, InvokerError> {
            unreachable!("the test exercises the context-aware streaming completion path")
        }

        async fn process_with_context(
            &self,
            _agent: &Prompty,
            response: Value,
            _request: &ModelInvocationRequest,
        ) -> Result<GeneratedModelInvocationResponse, InvokerError> {
            assert_eq!(response["id"], "resp_streamed_tool_round");
            Ok(GeneratedModelInvocationResponse {
                output: None,
                usage: None,
                assistant_messages: Vec::new(),
                tool_requests: vec![ModelToolRequest {
                    id: "call_weather".to_string(),
                    name: "weather".to_string(),
                    arguments: Some(json!({"city": "Paris"})),
                    metadata: Value::Null,
                }],
                next_context_state: Some(InvocationContextState {
                    portability: InvocationContextPortability::Delegated,
                    delegated_state: vec![crate::model::DelegatedStateReference {
                        provider: "openai".to_string(),
                        kind: "response".to_string(),
                        id: "resp_streamed_tool_round".to_string(),
                        metadata: Value::Null,
                    }],
                }),
                metadata: Value::Null,
            })
        }

        fn process_stream(
            &self,
            inner: Pin<Box<dyn Stream<Item = Value> + Send>>,
        ) -> Result<Pin<Box<dyn Stream<Item = crate::types::StreamChunk> + Send>>, InvokerError>
        {
            Ok(Box::pin(inner.map(|_| {
                StreamChunk::Tool(ToolCall {
                    id: "call_weather".to_string(),
                    name: "weather".to_string(),
                    arguments: "{\"city\":\"Paris\"}".to_string(),
                })
            })))
        }
    }

    #[async_trait]
    impl Processor for PostOpenIndeterminateStreamProcessor {
        async fn process(&self, _agent: &Prompty, _response: Value) -> Result<Value, InvokerError> {
            unreachable!("the test exercises the streaming path")
        }

        fn process_stream(
            &self,
            inner: Pin<Box<dyn Stream<Item = Value> + Send>>,
        ) -> Result<Pin<Box<dyn Stream<Item = StreamChunk> + Send>>, InvokerError> {
            Ok(Box::pin(inner.map(|chunk| {
                if let Some(message) = chunk.get("transport_error").and_then(Value::as_str) {
                    StreamChunk::Error(StreamFailure::Indeterminate(format!(
                        "SSE stream error: {message}"
                    )))
                } else {
                    StreamChunk::Text(
                        chunk
                            .get("token")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    )
                }
            })))
        }
    }

    fn responses_agent() -> Prompty {
        Prompty::load_from_value(
            &json!({
                "kind": "prompt",
                "name": "streamed-responses",
                "instructions": "test",
                "model": {"id": "gpt-test", "provider": RESPONSES_STREAM_PROVIDER}
            }),
            &LoadContext::default(),
        )
    }

    fn indeterminate_stream_agent() -> Prompty {
        Prompty::load_from_value(
            &json!({
                "kind": "prompt",
                "name": "indeterminate-stream",
                "instructions": "test",
                "model": {
                    "id": "gpt-test",
                    "provider": INDETERMINATE_STREAM_PROVIDER,
                    "options": {
                        "additionalProperties": {"stream": true}
                    }
                }
            }),
            &LoadContext::default(),
        )
    }

    #[tokio::test]
    async fn streamed_responses_tool_round_preserves_delegated_continuation() {
        registry::register_executor(RESPONSES_STREAM_PROVIDER, ResponsesStreamExecutor);
        registry::register_processor(RESPONSES_STREAM_PROVIDER, ResponsesStreamProcessor);
        let port = LiveModelPort {
            agent: Arc::new(responses_agent()),
            provider: RESPONSES_STREAM_PROVIDER.to_string(),
            streaming: true,
            raw_final: false,
            agent_mode: true,
            skip_output_guardrail: Arc::new(AtomicBool::new(false)),
            failures: Arc::new(LiveFailureState::default()),
        };
        let request = ModelInvocationRequest::load_from_value(&json!({}), &LoadContext::default());

        let response = port
            .invoke(
                &request,
                &CancellationToken::new(),
                &crate::engine::NoopModelStreamPort,
            )
            .await
            .expect("streamed Responses completion should map through the context-aware processor");

        let context = response
            .next_context_state
            .expect("the next invocation must receive a context state");
        assert_eq!(context.portability, InvocationContextPortability::Delegated);
        assert_eq!(context.delegated_state.len(), 1);
        assert_eq!(context.delegated_state[0].provider, "openai");
        assert_eq!(context.delegated_state[0].kind, "response");
        assert_eq!(context.delegated_state[0].id, "resp_streamed_tool_round");
        assert_eq!(response.tool_requests[0].id, "call_weather");
    }

    #[test]
    fn delegated_responses_tool_exchange_uses_provider_formatter() {
        registry::register_executor(RESPONSES_STREAM_PROVIDER, ResponsesStreamExecutor);
        let port = LiveConversationPort {
            provider: RESPONSES_STREAM_PROVIDER.to_string(),
            failures: Arc::new(LiveFailureState::default()),
        };
        let response = EngineModelInvocationResponse {
            output: None,
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: vec![EngineToolRequest {
                id: "call_weather".to_string(),
                name: "weather".to_string(),
                arguments: json!({"city": "Paris"}),
                metadata: Value::Null,
            }],
            next_portability: Some(crate::engine::ContextPortability::Delegated),
            delegated_state: Some(vec![crate::engine::DelegatedStateReference {
                provider: RESPONSES_STREAM_PROVIDER.to_string(),
                kind: "response".to_string(),
                id: "resp_123".to_string(),
                metadata: Value::Null,
            }]),
            metadata: Value::Null,
        };
        let messages = port
            .format_tool_exchange(
                &response,
                &[EngineToolResult {
                    request_id: "call_weather".to_string(),
                    name: "weather".to_string(),
                    outcome: ToolOutcome::Success,
                    output: json!("72F and sunny"),
                    error_kind: None,
                    metadata: Value::Null,
                }],
            )
            .unwrap();

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, crate::types::Role::Assistant);
        assert_eq!(messages[1].metadata["tool_call_id"], "call_weather");
    }

    #[tokio::test]
    async fn post_open_indeterminate_stream_requires_reconciliation_without_success_commit() {
        registry::register_executor(
            POST_OPEN_INDETERMINATE_STREAM_PROVIDER,
            PostOpenIndeterminateStreamExecutor,
        );
        registry::register_processor(
            POST_OPEN_INDETERMINATE_STREAM_PROVIDER,
            PostOpenIndeterminateStreamProcessor,
        );
        let durability = Arc::new(CheckpointRecorder::default());
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured_events = events.clone();
        let request = TurnEngineRequest::new(
            "post-open-stream-session",
            "post-open-stream-turn",
            vec![Message::with_text(crate::types::Role::User, "hello")],
        );

        let error = turn_with_engine_request(
            &Prompty::load_from_value(
                &json!({
                    "kind": "prompt",
                    "name": "post-open-indeterminate-stream",
                    "instructions": "test",
                    "model": {
                        "id": "gpt-test",
                        "provider": POST_OPEN_INDETERMINATE_STREAM_PROVIDER,
                        "options": {
                            "additionalProperties": {"stream": true}
                        }
                    }
                }),
                &LoadContext::default(),
            ),
            request,
            Some(
                TurnOptions::builder()
                    .durability(durability.clone())
                    .on_event(Box::new(move |event| {
                        captured_events
                            .lock()
                            .expect("event lock poisoned")
                            .push(event);
                    }))
                    .build(),
            ),
        )
        .await
        .expect_err("post-open transport failure must require reconciliation");

        assert!(matches!(error, InvokerError::ExecuteIndeterminate { .. }));
        let events = events.lock().expect("event lock poisoned");
        assert!(
            events
                .iter()
                .any(|event| { matches!(event, AgentEvent::Token(value) if value == "partial") })
        );
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, AgentEvent::Done { .. }))
        );
        drop(events);
        let checkpoint = durability
            .checkpoints
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("indeterminate invocation must persist a reconciliation checkpoint");
        assert!(checkpoint.reconciliation_required);
        assert!(!checkpoint.final_output_ready);
        assert!(checkpoint.pending_output.is_none());
    }

    #[tokio::test]
    async fn indeterminate_stream_open_requires_reconciliation_without_fallback() {
        INDETERMINATE_STREAM_OPEN_CALLS.store(0, Ordering::SeqCst);
        INDETERMINATE_NON_STREAM_CALLS.store(0, Ordering::SeqCst);
        registry::register_executor(INDETERMINATE_STREAM_PROVIDER, IndeterminateStreamExecutor);
        let durability = Arc::new(CheckpointRecorder::default());
        let request = TurnEngineRequest::new(
            "stream-reconciliation-session",
            "stream-reconciliation-turn",
            vec![Message::with_text(crate::types::Role::User, "hello")],
        );

        let error = turn_with_engine_request(
            &indeterminate_stream_agent(),
            request,
            Some(
                TurnOptions::builder()
                    .durability(durability.clone())
                    .build(),
            ),
        )
        .await
        .expect_err("indeterminate stream opening must stop for reconciliation");

        assert!(matches!(
            error,
            InvokerError::ExecuteIndeterminate { ref metadata, .. }
                if metadata["phase"] == "stream_open"
        ));
        assert_eq!(INDETERMINATE_STREAM_OPEN_CALLS.load(Ordering::SeqCst), 1);
        assert_eq!(INDETERMINATE_NON_STREAM_CALLS.load(Ordering::SeqCst), 0);
        let checkpoint = durability
            .checkpoints
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("indeterminate invocation must persist a reconciliation checkpoint");
        assert!(checkpoint.reconciliation_required);
        assert!(checkpoint.model_reconciliation.is_some());
    }

    #[test]
    fn indeterminate_invoker_failure_maps_to_model_reconciliation_error() {
        let failures = LiveFailureState::default();
        let error = failures.record_invoker(InvokerError::indeterminate_execution(
            "request timed out after dispatch",
            json!({"provider": "openai", "phase": "request_dispatch"}),
        ));

        assert!(error.outcome_unknown);
        assert_eq!(error.metadata["provider"], "openai");
        assert!(matches!(
            failures.take_invoker(),
            Some(InvokerError::ExecuteIndeterminate { .. })
        ));
    }
}
