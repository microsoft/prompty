//! Pipeline stage traits — `Renderer`, `Parser`, `Executor`, `Processor`.
//!
//! These define the four stages of the Prompty pipeline:
//! render → parse → execute → process.
//!
//! All traits use `async-trait` for dynamic dispatch compatibility.
//! Implementations are registered in the [`registry`](crate::registry).

use std::pin::Pin;

use async_trait::async_trait;
use futures::StreamExt;

use crate::engine::CancellationToken;
use crate::model::{
    InvocationContextPortability, InvocationContextState, ModelInvocationRequest,
    ModelInvocationResponse, ModelToolRequest, Prompty,
};
use crate::types::Message;

/// Errors returned by pipeline stages.
#[derive(Debug, thiserror::Error)]
pub enum InvokerError {
    /// No invoker registered for the given group and key.
    #[error("no {group} registered for key '{key}'")]
    NotFound { group: String, key: String },

    /// The renderer failed.
    #[error("render error: {0}")]
    Render(Box<dyn std::error::Error + Send + Sync>),

    /// The parser failed.
    #[error("parse error: {0}")]
    Parse(Box<dyn std::error::Error + Send + Sync>),

    /// The executor failed.
    #[error("execute error: {0}")]
    Execute(Box<dyn std::error::Error + Send + Sync>),

    /// The provider request may have been dispatched, so its outcome requires reconciliation.
    #[error("indeterminate execution: {message}")]
    ExecuteIndeterminate {
        message: String,
        metadata: serde_json::Value,
    },

    /// The processor failed.
    #[error("process error: {0}")]
    Process(Box<dyn std::error::Error + Send + Sync>),

    /// Input validation failed.
    #[error("validation error: {0}")]
    Validation(String),

    /// Loading a .prompty file failed.
    #[error("load error: {0}")]
    Load(String),

    /// The operation was cancelled via the cancellation token.
    #[error("cancelled: {0}")]
    Cancelled(String),

    /// LLM call failed after retries, carrying accumulated conversation state (§9.10).
    #[error("{0}")]
    ExecuteRetryExhausted(ExecuteError),

    /// A generic retryable/other error.
    #[error("{0}")]
    Other(String),
}

impl InvokerError {
    /// Mark an execution failure as requiring model-outcome reconciliation.
    ///
    /// Executors should only use this after request dispatch becomes ambiguous.
    /// Configuration, validation, and connection-establishment failures remain
    /// ordinary retryable execution errors.
    pub fn indeterminate_execution(
        message: impl Into<String>,
        metadata: serde_json::Value,
    ) -> Self {
        Self::ExecuteIndeterminate {
            message: message.into(),
            metadata,
        }
    }
}

/// Error from the agent loop that includes accumulated conversation state (§9.10).
#[derive(Debug)]
pub struct ExecuteError {
    pub message: String,
    pub messages: Vec<crate::types::Message>,
}

impl std::fmt::Display for ExecuteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ExecuteError {}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/// Renders a template string with the given inputs.
///
/// Registered under `prompty.renderers` by key (e.g. `"nunjucks"`, `"mustache"`).
/// The key comes from `agent.template.format.kind`.
#[async_trait]
pub trait Renderer: Send + Sync {
    /// Render the template with the provided inputs.
    async fn render(
        &self,
        agent: &Prompty,
        template: &str,
        inputs: &serde_json::Value,
    ) -> Result<String, InvokerError>;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/// Parses rendered text into a list of messages.
///
/// Registered under `prompty.parsers` by key (e.g. `"prompty"`).
/// The key comes from `agent.template.parser.kind`.
#[async_trait]
pub trait Parser: Send + Sync {
    /// Optional pre-render hook: sanitize the template and return
    /// `(modified_template, context)`. The context is passed to `parse`.
    ///
    /// Used in strict mode to verify nonces after rendering.
    fn pre_render(&self, _template: &str) -> Option<(String, serde_json::Value)> {
        None
    }

    /// Parse rendered text into messages.
    async fn parse(
        &self,
        agent: &Prompty,
        rendered: &str,
        context: Option<&serde_json::Value>,
    ) -> Result<Vec<Message>, InvokerError>;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/// Sends messages to an LLM provider and returns the raw response.
///
/// Registered under `prompty.executors` by key (e.g. `"openai"`, `"azure"`, `"anthropic"`).
/// The key comes from `agent.model.provider`.
#[async_trait]
pub trait Executor: Send + Sync {
    /// Execute an LLM call with the given messages.
    async fn execute(
        &self,
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<serde_json::Value, InvokerError>;

    /// Execute an LLM call using the generated invocation context.
    ///
    /// Legacy executors remain compatible: the default forwards the generated
    /// snapshot's messages to [`Self::execute`]. Context-aware providers can
    /// override this to consume delegated provider state.
    async fn execute_with_context(
        &self,
        agent: &Prompty,
        request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
    ) -> Result<serde_json::Value, InvokerError> {
        if cancellation.is_cancelled() {
            return Err(InvokerError::Cancelled(
                "execution cancelled before provider invocation".to_string(),
            ));
        }

        tokio::select! {
            result = self.execute(agent, &request.context.messages) => result,
            _ = cancellation.cancelled() => Err(InvokerError::Cancelled(
                "execution cancelled during provider invocation".to_string(),
            )),
        }
    }

    /// Execute an LLM call and return a stream of raw SSE chunks.
    ///
    /// Not all providers support streaming. Default returns an error.
    /// When implemented, returns a `Stream<Item = Value>` where each item
    /// is a raw SSE chunk from the provider (e.g., OpenAI delta events).
    async fn execute_stream(
        &self,
        _agent: &Prompty,
        _messages: &[Message],
    ) -> Result<Pin<Box<dyn futures::Stream<Item = serde_json::Value> + Send>>, InvokerError> {
        Err(InvokerError::Execute(
            "Streaming not supported by this executor"
                .to_string()
                .into(),
        ))
    }

    /// Execute a streaming LLM call that stops the provider request and drops
    /// its response stream when cancellation is requested.
    async fn execute_stream_cancellable(
        &self,
        agent: &Prompty,
        messages: &[Message],
        cancellation: CancellationToken,
    ) -> Result<Pin<Box<dyn futures::Stream<Item = serde_json::Value> + Send>>, InvokerError> {
        if cancellation.is_cancelled() {
            return Err(InvokerError::Cancelled(
                "streaming execution cancelled before provider invocation".to_string(),
            ));
        }

        let stream = tokio::select! {
            result = self.execute_stream(agent, messages) => result?,
            _ = cancellation.cancelled() => {
                return Err(InvokerError::Cancelled(
                    "streaming execution cancelled during provider invocation".to_string(),
                ));
            }
        };
        Ok(Box::pin(futures::stream::unfold(
            (stream, cancellation),
            |(mut inner, cancellation)| async move {
                tokio::select! {
                    item = inner.next() => item.map(|chunk| (chunk, (inner, cancellation))),
                    _ = cancellation.cancelled() => None,
                }
            },
        )))
    }

    /// Execute a streaming LLM call using the generated invocation context.
    ///
    /// Legacy executors retain streaming compatibility through
    /// [`Self::execute_stream_cancellable`].
    async fn execute_stream_with_context(
        &self,
        agent: &Prompty,
        request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
    ) -> Result<Pin<Box<dyn futures::Stream<Item = serde_json::Value> + Send>>, InvokerError> {
        self.execute_stream_cancellable(agent, &request.context.messages, cancellation.clone())
            .await
    }

    /// Format tool-call results into messages for the next iteration of the
    /// agent loop. Returns messages to append to the conversation.
    ///
    /// Default implementation creates an assistant message with tool calls
    /// and individual tool-result messages — the OpenAI-style pattern.
    fn format_tool_messages(
        &self,
        _raw_response: &serde_json::Value,
        tool_calls: &[crate::types::ToolCall],
        tool_results: &[String],
        _text_content: Option<&str>,
    ) -> Vec<Message> {
        let mut messages = Vec::new();

        // Assistant message echoing tool calls
        let mut assistant_meta = serde_json::Map::new();
        let tc_value: Vec<serde_json::Value> = tool_calls
            .iter()
            .map(|tc| {
                serde_json::json!({
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": tc.arguments,
                    }

                })
            })
            .collect();
        assistant_meta.insert("tool_calls".into(), serde_json::Value::Array(tc_value));

        messages.push(Message {
            role: crate::types::Role::Assistant,
            parts: vec![],
            metadata: serde_json::Value::Object(assistant_meta),
        });

        // Tool result messages
        for (tc, result) in tool_calls.iter().zip(tool_results.iter()) {
            messages.push(Message::tool_result(&tc.id, result));
        }

        messages
    }

    /// Format a streamed tool-call response for the next conversation round.
    ///
    /// Providers that require raw streamed assistant content can override this.
    /// The default delegates to `format_tool_messages`; OpenAI-compatible
    /// executors do not require raw response chunks.
    fn format_stream_tool_messages(
        &self,
        _raw_chunks: &[serde_json::Value],
        tool_calls: &[crate::types::ToolCall],
        tool_results: &[String],
        text_content: Option<&str>,
    ) -> Vec<Message> {
        self.format_tool_messages(
            &serde_json::Value::Null,
            tool_calls,
            tool_results,
            text_content,
        )
    }
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

/// Extracts structured results from raw LLM responses.
///
/// Registered under `prompty.processors` by key (e.g. `"openai"`, `"azure"`).
/// The key comes from `agent.model.provider`.
#[async_trait]
pub trait Processor: Send + Sync {
    /// Process the raw response into a usable result.
    async fn process(
        &self,
        agent: &Prompty,
        response: serde_json::Value,
    ) -> Result<serde_json::Value, InvokerError>;

    /// Map a raw provider response into the generated live-invocation contract.
    ///
    /// Legacy processors remain compatible by returning portable state and
    /// recognizing the established `{id, name, arguments}` tool-call shape.
    /// Providers with native continuation support should override this method
    /// and return a typed delegated state reference.
    async fn process_with_context(
        &self,
        agent: &Prompty,
        response: serde_json::Value,
        _request: &ModelInvocationRequest,
    ) -> Result<ModelInvocationResponse, InvokerError> {
        let output = self.process(agent, response).await?;
        let tool_requests = legacy_tool_requests(&output);
        let assistant_messages = legacy_assistant_messages(&output, &tool_requests);
        Ok(ModelInvocationResponse {
            output: tool_requests.is_empty().then_some(output),
            usage: None,
            assistant_messages,
            tool_requests,
            next_context_state: Some(InvocationContextState {
                portability: InvocationContextPortability::Portable,
                delegated_state: Vec::new(),
            }),
            metadata: serde_json::Value::Null,
        })
    }

    /// Map a raw response without invoking legacy response processing.
    ///
    /// This preserves `raw` execution semantics for existing processors while
    /// allowing providers to override the method when they can derive typed
    /// continuation state from an otherwise raw response.
    async fn process_raw_with_context(
        &self,
        _agent: &Prompty,
        response: serde_json::Value,
        _request: &ModelInvocationRequest,
    ) -> Result<ModelInvocationResponse, InvokerError> {
        let assistant_messages = legacy_assistant_messages(&response, &[]);
        Ok(ModelInvocationResponse {
            output: Some(response),
            usage: None,
            assistant_messages,
            tool_requests: Vec::new(),
            next_context_state: Some(InvocationContextState {
                portability: InvocationContextPortability::Portable,
                delegated_state: Vec::new(),
            }),
            metadata: serde_json::Value::Null,
        })
    }

    /// Process a streaming response into a stream of `StreamChunk` items.
    ///
    /// Takes a raw SSE chunk stream from the executor and yields processed
    /// `StreamChunk::Text` and `StreamChunk::Tool` items.
    ///
    /// Default returns an error. Override in providers that support streaming.
    fn process_stream(
        &self,
        _inner: Pin<Box<dyn futures::Stream<Item = serde_json::Value> + Send>>,
    ) -> Result<Pin<Box<dyn futures::Stream<Item = crate::types::StreamChunk> + Send>>, InvokerError>
    {
        Err(InvokerError::Process(
            "Streaming not supported by this processor"
                .to_string()
                .into(),
        ))
    }
}

fn legacy_tool_requests(output: &serde_json::Value) -> Vec<ModelToolRequest> {
    output
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|tool| {
            let id = tool.get("id")?.as_str()?.to_string();
            let name = tool.get("name")?.as_str()?.to_string();
            let arguments = tool.get("arguments").cloned();
            Some(ModelToolRequest {
                id,
                name,
                arguments,
                metadata: serde_json::Value::Null,
            })
        })
        .collect()
}

fn legacy_assistant_messages(
    output: &serde_json::Value,
    tool_requests: &[ModelToolRequest],
) -> Vec<Message> {
    let content = output.as_str().map(str::to_string).unwrap_or_else(|| {
        (!tool_requests.is_empty())
            .then(String::new)
            .unwrap_or_else(|| output.to_string())
    });
    let mut assistant = Message::with_text(crate::types::Role::Assistant, content);
    if !tool_requests.is_empty() {
        let tool_calls = tool_requests
            .iter()
            .map(|request| {
                let arguments = request
                    .arguments
                    .as_ref()
                    .map(|value| {
                        value
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| value.to_string())
                    })
                    .unwrap_or_else(|| "{}".to_string());
                serde_json::json!({
                    "id": request.id,
                    "type": "function",
                    "function": {
                        "name": request.name,
                        "arguments": arguments,
                    },
                })
            })
            .collect();
        assistant.metadata_mut().insert(
            "tool_calls".to_string(),
            serde_json::Value::Array(tool_calls),
        );
    }
    vec![assistant]
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal executor to test the default format_tool_messages impl
    struct DefaultFormatExecutor;

    #[async_trait]
    impl Executor for DefaultFormatExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<serde_json::Value, InvokerError> {
            Ok(serde_json::json!({}))
        }
        // Uses default format_tool_messages
    }

    struct PendingStreamExecutor;

    #[async_trait]
    impl Executor for PendingStreamExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<serde_json::Value, InvokerError> {
            Ok(serde_json::Value::Null)
        }

        async fn execute_stream(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<Pin<Box<dyn futures::Stream<Item = serde_json::Value> + Send>>, InvokerError>
        {
            futures::future::pending().await
        }
    }

    #[tokio::test]
    async fn test_cancellable_stream_aborts_pending_provider_invocation() {
        let executor = PendingStreamExecutor;
        let cancellation = CancellationToken::new();
        let cancellation_task = cancellation.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            cancellation_task.cancel();
        });

        let result = tokio::time::timeout(
            std::time::Duration::from_millis(100),
            executor.execute_stream_cancellable(&Prompty::default(), &[], cancellation),
        )
        .await
        .expect("cancellation should not leave the provider invocation pending");

        assert!(matches!(result, Err(InvokerError::Cancelled(_))));
    }

    #[test]
    fn test_default_format_tool_messages_single() {
        let executor = DefaultFormatExecutor;
        let tool_calls = vec![crate::types::ToolCall {
            id: "call_1".into(),
            name: "get_weather".into(),
            arguments: r#"{"city":"NYC"}"#.into(),
        }];
        let results = vec!["72°F".to_string()];

        let msgs =
            executor.format_tool_messages(&serde_json::json!({}), &tool_calls, &results, None);

        assert_eq!(msgs.len(), 2);
        // First: assistant message with tool_calls metadata
        assert_eq!(msgs[0].role, crate::types::Role::Assistant);
        let tc_meta = msgs[0]
            .metadata
            .get("tool_calls")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(tc_meta.len(), 1);
        assert_eq!(tc_meta[0]["id"], "call_1");
        assert_eq!(tc_meta[0]["type"], "function");
        assert_eq!(tc_meta[0]["function"]["name"], "get_weather");
        assert_eq!(tc_meta[0]["function"]["arguments"], r#"{"city":"NYC"}"#);
        // Second: tool result message
        assert_eq!(msgs[1].role, crate::types::Role::Tool);
        assert_eq!(msgs[1].text_content(), "72°F");
        assert_eq!(msgs[1].metadata["tool_call_id"], "call_1");
    }

    #[test]
    fn test_default_format_tool_messages_multiple() {
        let executor = DefaultFormatExecutor;
        let tool_calls = vec![
            crate::types::ToolCall {
                id: "c1".into(),
                name: "add".into(),
                arguments: "{}".into(),
            },
            crate::types::ToolCall {
                id: "c2".into(),
                name: "sub".into(),
                arguments: "{}".into(),
            },
        ];
        let results = vec!["3".to_string(), "1".to_string()];

        let msgs =
            executor.format_tool_messages(&serde_json::json!({}), &tool_calls, &results, None);

        // 1 assistant + 2 tool results = 3
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].role, crate::types::Role::Assistant);
        assert_eq!(msgs[1].role, crate::types::Role::Tool);
        assert_eq!(msgs[1].text_content(), "3");
        assert_eq!(msgs[2].role, crate::types::Role::Tool);
        assert_eq!(msgs[2].text_content(), "1");
    }

    #[test]
    fn test_default_format_tool_messages_empty() {
        let executor = DefaultFormatExecutor;
        let msgs = executor.format_tool_messages(&serde_json::json!({}), &[], &[], None);
        // Assistant message with empty tool_calls, no tool result messages
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, crate::types::Role::Assistant);
    }

    #[test]
    fn test_invoker_error_display() {
        let err = InvokerError::NotFound {
            group: "executor".into(),
            key: "test".into(),
        };
        assert_eq!(err.to_string(), "no executor registered for key 'test'");

        let err = InvokerError::Validation("missing field".into());
        assert_eq!(err.to_string(), "validation error: missing field");
    }
}
