//! Pipeline stage traits — `Renderer`, `Parser`, `Executor`, `Processor`.
//!
//! These define the four stages of the Prompty pipeline:
//! render → parse → execute → process.
//!
//! All traits use `async-trait` for dynamic dispatch compatibility.
//! Implementations are registered in the [`registry`](crate::registry).

use std::pin::Pin;

use async_trait::async_trait;

use crate::model::Prompty;
use crate::types::{Message, ToolResult};

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

    /// Format tool-call results into messages for the next iteration of the
    /// agent loop. Returns messages to append to the conversation.
    ///
    /// Default implementation creates an assistant message with tool calls
    /// and individual tool-result messages — the OpenAI-style pattern.
    fn format_tool_messages(
        &self,
        _raw_response: &serde_json::Value,
        tool_calls: &[crate::types::ToolCall],
        tool_results: &[ToolResult],
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
            metadata: assistant_meta,
        });

        // Tool result messages
        for (tc, result) in tool_calls.iter().zip(tool_results.iter()) {
            messages.push(Message::tool_result_rich(&tc.id, result));
        }

        messages
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

    #[test]
    fn test_default_format_tool_messages_single() {
        let executor = DefaultFormatExecutor;
        let tool_calls = vec![crate::types::ToolCall {
            id: "call_1".into(),
            name: "get_weather".into(),
            arguments: r#"{"city":"NYC"}"#.into(),
        }];
        let results = vec![crate::ToolResult::from_text("72°F")];

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
        let results = vec![crate::ToolResult::from_text("3"), crate::ToolResult::from_text("1")];

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
