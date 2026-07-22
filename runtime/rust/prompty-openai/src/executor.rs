//! OpenAI executor — sends requests to the OpenAI Chat Completions API.
//!
//! Dispatches on `agent.model.apiType` to call the appropriate endpoint:
//! `chat`, `embedding`, or `image`.

use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::LazyLock;

use prompty::engine::CancellationToken;
use prompty::interfaces::{Executor, InvokerError};
use prompty::model::{ModelInvocationRequest, Prompty};
use prompty::types::Message;

use crate::wire;

/// Shared HTTP client — reuses connection pool across requests.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// OpenAI executor implementing the `Executor` trait.
pub struct OpenAIExecutor;

#[async_trait]
impl Executor for OpenAIExecutor {
    async fn execute(&self, agent: &Prompty, messages: &[Message]) -> Result<Value, InvokerError> {
        Self::execute_request(agent, messages, None).await
    }

    async fn execute_with_context(
        &self,
        agent: &Prompty,
        request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
    ) -> Result<Value, InvokerError> {
        if cancellation.is_cancelled() {
            return Err(InvokerError::Cancelled(
                "execution cancelled before OpenAI provider invocation".to_string(),
            ));
        }
        tokio::select! {
            result = Self::execute_request(agent, &request.context.messages, Some(request)) => result,
            _ = cancellation.cancelled() => Err(InvokerError::Cancelled(
                "execution cancelled during OpenAI provider invocation".to_string(),
            )),
        }
    }

    fn format_tool_messages(
        &self,
        raw_response: &serde_json::Value,
        tool_calls: &[prompty::types::ToolCall],
        tool_results: &[String],
        _text_content: Option<&str>,
    ) -> Vec<Message> {
        if raw_response.get("object").and_then(Value::as_str) == Some("response") {
            wire::format_responses_tool_messages(raw_response, tool_calls, tool_results)
        } else {
            wire::format_tool_messages(tool_calls, tool_results)
        }
    }

    fn format_stream_tool_messages(
        &self,
        raw_chunks: &[Value],
        tool_calls: &[prompty::types::ToolCall],
        tool_results: &[String],
        _text_content: Option<&str>,
    ) -> Vec<Message> {
        if raw_chunks.iter().any(|chunk| {
            chunk
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|event_type| event_type.starts_with("response."))
        }) {
            wire::format_stream_responses_tool_messages(raw_chunks, tool_calls, tool_results)
        } else {
            wire::format_tool_messages(tool_calls, tool_results)
        }
    }

    async fn execute_stream(
        &self,
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>, InvokerError> {
        Self::execute_stream_request(agent, messages, None).await
    }

    async fn execute_stream_with_context(
        &self,
        agent: &Prompty,
        request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
    ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>, InvokerError> {
        if cancellation.is_cancelled() {
            return Err(InvokerError::Cancelled(
                "streaming execution cancelled before OpenAI provider invocation".to_string(),
            ));
        }
        tokio::select! {
            result = Self::execute_stream_request(agent, &request.context.messages, Some(request)) => result,
            _ = cancellation.cancelled() => Err(InvokerError::Cancelled(
                "streaming execution cancelled during OpenAI provider invocation".to_string(),
            )),
        }
    }
}

impl OpenAIExecutor {
    async fn execute_request(
        agent: &Prompty,
        messages: &[Message],
        request: Option<&ModelInvocationRequest>,
    ) -> Result<Value, InvokerError> {
        let api_type = agent
            .model
            .api_type
            .as_ref()
            .map(|t| t.as_str())
            .unwrap_or("chat");

        let (url, body) = match api_type {
            "chat" | "agent" => {
                let args = wire::build_chat_args(agent, messages);
                let url = build_url(agent, "/v1/chat/completions")?;
                (url, args)
            }
            "responses" => {
                let mut args = wire::build_responses_args(agent, messages);
                if let Some(response_id) = request.and_then(openai_response_id) {
                    args["previous_response_id"] = Value::String(response_id.to_string());
                }
                let url = build_url(agent, "/v1/responses")?;
                (url, args)
            }
            "embedding" => {
                let args = wire::build_embedding_args(agent, messages);
                let url = build_url(agent, "/v1/embeddings")?;
                (url, args)
            }
            "image" => {
                let args = wire::build_image_args(agent, messages);
                let url = build_url(agent, "/v1/images/generations")?;
                (url, args)
            }
            other => {
                return Err(InvokerError::Execute(
                    format!("Unsupported apiType: {other}").into(),
                ));
            }
        };

        let api_key = get_api_key(agent)?;
        let client = &*HTTP_CLIENT;
        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(classify_transport_failure)?;

        if !response.status().is_success() {
            let status = response.status();
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "unable to read body".to_string());
            return Err(InvokerError::Execute(
                format!("OpenAI API error (HTTP {status}): {body_text}").into(),
            ));
        }

        let result: Value = response.json().await.map_err(|error| {
            InvokerError::indeterminate_execution(
                format!("Failed to parse response after provider dispatch: {error}"),
                json!({ "provider": "openai", "phase": "response_body" }),
            )
        })?;

        Ok(result)
    }

    async fn execute_stream_request(
        agent: &Prompty,
        messages: &[Message],
        request: Option<&ModelInvocationRequest>,
    ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>, InvokerError> {
        let api_type = agent
            .model
            .api_type
            .as_ref()
            .map(|t| t.as_str())
            .unwrap_or("chat");

        let (url, mut body) = match api_type {
            "chat" | "agent" => {
                let args = wire::build_chat_args(agent, messages);
                let url = build_url(agent, "/v1/chat/completions")?;
                (url, args)
            }
            "responses" => {
                let mut args = wire::build_responses_args(agent, messages);
                if let Some(response_id) = request.and_then(openai_response_id) {
                    args["previous_response_id"] = Value::String(response_id.to_string());
                }
                let url = build_url(agent, "/v1/responses")?;
                (url, args)
            }
            other => {
                return Err(InvokerError::Execute(
                    format!("Streaming not supported for apiType: {other}").into(),
                ));
            }
        };

        // Force stream: true
        if let Some(obj) = body.as_object_mut() {
            obj.insert("stream".into(), Value::Bool(true));
            if matches!(api_type, "chat" | "agent") {
                obj.insert(
                    "stream_options".into(),
                    serde_json::json!({ "include_usage": true }),
                );
            }
        }

        let api_key = get_api_key(agent)?;
        let client = &*HTTP_CLIENT;
        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(classify_transport_failure)?;

        if !response.status().is_success() {
            let status = response.status();
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "unable to read body".to_string());
            return Err(InvokerError::Execute(
                format!("OpenAI API error (HTTP {status}): {body_text}").into(),
            ));
        }

        let byte_stream = response.bytes_stream();
        Ok(Box::pin(SseParser::new(byte_stream)))
    }

    /// Build the request args without sending — useful for testing wire format.
    pub fn build_args(agent: &Prompty, messages: &[Message]) -> Result<Value, InvokerError> {
        let api_type = agent
            .model
            .api_type
            .as_ref()
            .map(|t| t.as_str())
            .unwrap_or("chat");
        Ok(match api_type {
            "chat" | "agent" => wire::build_chat_args(agent, messages),
            "embedding" => wire::build_embedding_args(agent, messages),
            "image" => wire::build_image_args(agent, messages),
            other => {
                return Err(InvokerError::Execute(
                    format!("Unsupported apiType: {other}").into(),
                ));
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn classify_transport_failure(error: reqwest::Error) -> InvokerError {
    let message = format!("HTTP request failed: {error}");
    if error.is_connect() || error.is_builder() {
        InvokerError::Execute(message.into())
    } else {
        InvokerError::indeterminate_execution(
            message,
            json!({ "provider": "openai", "phase": "request_dispatch" }),
        )
    }
}

fn openai_response_id(request: &ModelInvocationRequest) -> Option<&str> {
    request
        .context
        .context_state
        .delegated_state
        .iter()
        .find(|state| state.provider == "openai" && state.kind == "response")
        .map(|state| state.id.as_str())
        .filter(|id| !id.is_empty())
}

/// Resolve the effective connection — if `kind == "reference"`, look up the
/// named connection from the registry. Otherwise return the connection as-is.
fn resolve_connection(
    agent: &Prompty,
) -> Result<std::borrow::Cow<'_, serde_json::Value>, InvokerError> {
    let conn = &agent.model.connection;
    let kind = conn.get("kind").and_then(|k| k.as_str()).unwrap_or("");

    if kind == "reference" {
        let name = conn.get("name").and_then(|n| n.as_str()).ok_or_else(|| {
            InvokerError::Execute(
                "Reference connection missing 'name' field"
                    .to_string()
                    .into(),
            )
        })?;

        // Look up the named connection from the registry
        let resolved =
            prompty::connections::with_connection::<serde_json::Value, _>(name, |c| c.clone())
                .map_err(|e| InvokerError::Execute(e.into()))?;

        Ok(std::borrow::Cow::Owned(resolved))
    } else {
        Ok(std::borrow::Cow::Borrowed(conn))
    }
}

fn build_url(agent: &Prompty, path: &str) -> Result<String, InvokerError> {
    let conn = resolve_connection(agent)?;

    // 1. connection.endpoint from the agent
    // 2. OPENAI_BASE_URL env var (matches OpenAI SDK behavior)
    // 3. default https://api.openai.com
    let endpoint = conn
        .get("endpoint")
        .and_then(|e| e.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| {
            std::env::var("OPENAI_BASE_URL")
                .ok()
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "https://api.openai.com".to_string());

    let base = endpoint.trim_end_matches('/');

    // If base already includes /v1 (e.g. OPENAI_BASE_URL="https://proxy.example.com/openai/v1"),
    // strip the leading /v1 from the path to avoid duplication.
    let adjusted_path = if base.ends_with("/v1") || base.ends_with("/v1/") {
        path.strip_prefix("/v1").unwrap_or(path)
    } else {
        path
    };

    Ok(format!("{base}{adjusted_path}"))
}

fn get_api_key(agent: &Prompty) -> Result<String, InvokerError> {
    let conn = resolve_connection(agent)?;

    // Try connection.apiKey first
    if let Some(key) = conn
        .get("apiKey")
        .or(conn.get("api_key"))
        .and_then(|k| k.as_str())
    {
        if !key.is_empty() {
            return Ok(key.to_string());
        }
    }

    // Fall back to OPENAI_API_KEY env var
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    Err(InvokerError::Execute(
        "No API key found. Set OPENAI_API_KEY or configure model.connection.apiKey"
            .to_string()
            .into(),
    ))
}

// ---------------------------------------------------------------------------
// SSE stream parser — converts raw HTTP byte stream to JSON Value stream
// ---------------------------------------------------------------------------

use std::collections::VecDeque;
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use futures::Stream;

/// Parses Server-Sent Events (SSE) from a raw byte stream into JSON `Value` items.
///
/// Handles:
/// - `data: [DONE]` → terminates the stream
/// - `data: {...}` → yields parsed JSON
/// - Multi-line buffers (splits on `\n\n`)
struct SseParser {
    inner: Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>,
    buffer: String,
    pending: VecDeque<Value>,
    done: bool,
}

impl SseParser {
    fn new(inner: impl Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static) -> Self {
        Self {
            inner: Box::pin(inner),
            buffer: String::new(),
            pending: VecDeque::new(),
            done: false,
        }
    }

    fn parse_buffer(&mut self) {
        // SSE events are separated by double newlines
        while let Some(pos) = self.buffer.find("\n\n") {
            let event = self.buffer[..pos].to_string();
            self.buffer = self.buffer[pos + 2..].to_string();

            for line in event.lines() {
                if let Some(data) = line
                    .strip_prefix("data: ")
                    .or_else(|| line.strip_prefix("data:"))
                {
                    let data = data.trim();
                    if data == "[DONE]" {
                        self.done = true;
                        return;
                    }
                    match serde_json::from_str::<Value>(data) {
                        Ok(parsed) => self.pending.push_back(parsed),
                        Err(e) => {
                            // Surface SSE JSON parse errors as error events
                            // so consumers can detect malformed responses
                            self.pending.push_back(serde_json::json!({
                                "error": {
                                    "type": "sse_parse_error",
                                    "message": format!("Failed to parse SSE data: {e}"),
                                    "raw": data,
                                }
                            }));
                        }
                    }
                }
            }
        }
    }
}

impl Stream for SseParser {
    type Item = Value;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        loop {
            // Drain pending items first
            if let Some(item) = self.pending.pop_front() {
                return Poll::Ready(Some(item));
            }
            if self.done {
                return Poll::Ready(None);
            }

            // Pull more bytes from the inner stream
            match self.inner.as_mut().poll_next(cx) {
                Poll::Ready(Some(Ok(bytes))) => {
                    match std::str::from_utf8(&bytes) {
                        Ok(text) => self.buffer.push_str(text),
                        Err(e) => {
                            // Surface UTF-8 decode errors
                            self.pending.push_back(serde_json::json!({
                                "error": {
                                    "type": "sse_decode_error",
                                    "message": format!("Invalid UTF-8 in SSE stream: {e}"),
                                }
                            }));
                        }
                    }
                    self.parse_buffer();
                }
                Poll::Ready(Some(Err(e))) => {
                    // Surface transport errors instead of silently terminating
                    self.pending.push_back(serde_json::json!({
                        "error": {
                            "type": "sse_transport_error",
                            "message": format!("SSE stream error: {e}"),
                        }
                    }));
                    self.done = true;
                    // Drain pending (including error) before ending
                    if let Some(item) = self.pending.pop_front() {
                        return Poll::Ready(Some(item));
                    }
                    return Poll::Ready(None);
                }
                Poll::Ready(None) => {
                    // Final buffer flush
                    if !self.buffer.is_empty() {
                        self.buffer.push_str("\n\n");
                        self.parse_buffer();
                    }
                    if let Some(item) = self.pending.pop_front() {
                        return Poll::Ready(Some(item));
                    }
                    return Poll::Ready(None);
                }
                Poll::Pending => return Poll::Pending,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prompty::model::Prompty;
    use prompty::model::context::LoadContext;
    use serde_json::json;
    use serial_test::serial;

    fn make_agent(model_json: Value) -> Prompty {
        let mut data = json!({
            "name": "test",
            "kind": "prompt",
            "model": model_json,
        });
        data["instructions"] = json!("test");
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[tokio::test]
    async fn test_transport_timeout_after_dispatch_is_indeterminate() {
        use std::time::Duration;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
        });
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(10))
            .build()
            .unwrap();
        let error = client
            .post(format!("http://{address}"))
            .send()
            .await
            .expect_err("server must not send a response before the client timeout");

        assert!(matches!(
            classify_transport_failure(error),
            InvokerError::ExecuteIndeterminate { .. }
        ));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn test_connection_failure_remains_retryable() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let error = reqwest::Client::new()
            .post(format!("http://{address}"))
            .send()
            .await
            .expect_err("closed port must reject connection before dispatch");

        assert!(matches!(
            classify_transport_failure(error),
            InvokerError::Execute(_)
        ));
    }

    #[test]
    #[serial]
    fn test_build_url_default() {
        let agent = make_agent(json!({"id": "gpt-4"}));
        let url = build_url(&agent, "/v1/chat/completions").unwrap();
        assert_eq!(url, "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    #[serial]
    fn test_build_url_custom_endpoint() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://custom.openai.com/",
                "apiKey": "sk-test"
            }
        }));
        let url = build_url(&agent, "/v1/chat/completions").unwrap();
        assert_eq!(url, "https://custom.openai.com/v1/chat/completions");
    }

    #[test]
    #[serial]
    fn test_get_api_key_from_connection() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://api.openai.com",
                "apiKey": "sk-from-connection"
            }
        }));
        let key = get_api_key(&agent).unwrap();
        assert_eq!(key, "sk-from-connection");
    }

    #[test]
    #[serial]
    fn test_build_args_chat() {
        let agent = make_agent(json!({"id": "gpt-4", "apiType": "chat"}));
        let messages = vec![Message::with_text(prompty::Role::User, "Hello")];
        let args = OpenAIExecutor::build_args(&agent, &messages).unwrap();
        assert_eq!(args["model"], "gpt-4");
        assert!(args["messages"].is_array());
    }

    #[test]
    #[serial]
    fn test_build_args_embedding() {
        let agent = make_agent(json!({"id": "text-embedding-3-small", "apiType": "embedding"}));
        let messages = vec![Message::with_text(prompty::Role::User, "Hello world")];
        let args = OpenAIExecutor::build_args(&agent, &messages).unwrap();
        assert_eq!(args["model"], "text-embedding-3-small");
        assert!(args.get("input").is_some());
    }

    #[test]
    fn test_reads_openai_delegated_response_state() {
        let request = ModelInvocationRequest::load_from_value(
            &json!({
                "context": {
                    "contextState": {
                        "portability": "delegated",
                        "delegatedState": [{
                            "provider": "openai",
                            "kind": "response",
                            "id": "resp_123"
                        }]
                    }
                }
            }),
            &LoadContext::default(),
        );

        assert_eq!(openai_response_id(&request), Some("resp_123"));
    }

    #[tokio::test]
    #[serial]
    async fn test_sse_parser_basic() {
        use futures::StreamExt;

        let sse_data = b"data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n\
                         data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n\
                         data: [DONE]\n\n";

        let byte_stream = futures::stream::once(async {
            Ok::<bytes::Bytes, reqwest::Error>(bytes::Bytes::from(&sse_data[..]))
        });

        let parser = SseParser::new(byte_stream);
        let items: Vec<Value> = parser.collect().await;

        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["choices"][0]["delta"]["content"], "Hello");
        assert_eq!(items[1]["choices"][0]["delta"]["content"], " world");
    }

    #[tokio::test]
    #[serial]
    async fn test_sse_parser_multi_chunk() {
        use futures::StreamExt;

        // Simulate data arriving in two separate network chunks
        let byte_stream = futures::stream::iter(vec![
            Ok::<bytes::Bytes, reqwest::Error>(bytes::Bytes::from("data: {\"id\":1}\n")),
            Ok(bytes::Bytes::from("\ndata: {\"id\":2}\n\ndata: [DONE]\n\n")),
        ]);

        let parser = SseParser::new(byte_stream);
        let items: Vec<Value> = parser.collect().await;

        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["id"], 1);
        assert_eq!(items[1]["id"], 2);
    }

    #[test]
    fn test_responses_formatter_dispatches_to_responses_wire_contract() {
        let executor = OpenAIExecutor;
        let calls = vec![prompty::types::ToolCall {
            id: "call_1".to_string(),
            name: "lookup".to_string(),
            arguments: "{}".to_string(),
        }];

        let messages = executor.format_tool_messages(
            &json!({
                "object": "response",
                "output": [{
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "call_1",
                    "name": "lookup",
                    "arguments": "{}"
                }]
            }),
            &calls,
            &["result".to_string()],
            None,
        );

        assert!(
            messages[0]
                .metadata
                .get("responses_function_call")
                .is_some()
        );
        assert!(messages[0].metadata.get("tool_calls").is_none());
    }

    #[test]
    fn test_stream_responses_formatter_dispatches_to_responses_wire_contract() {
        let executor = OpenAIExecutor;
        let calls = vec![prompty::types::ToolCall {
            id: "call_stream".to_string(),
            name: "lookup".to_string(),
            arguments: "{}".to_string(),
        }];

        let messages = executor.format_stream_tool_messages(
            &[json!({
                "type": "response.output_item.done",
                "output_index": 0,
                "item": {
                    "type": "function_call",
                    "id": "fc_stream",
                    "call_id": "call_stream",
                    "name": "lookup",
                    "arguments": "{}",
                    "status": "completed"
                }
            })],
            &calls,
            &["result".to_string()],
            None,
        );

        assert_eq!(
            messages[0].metadata["responses_function_call"]["id"],
            "fc_stream"
        );
        assert!(messages[0].metadata.get("tool_calls").is_none());
    }

    // --- Reference connection resolution tests ---

    #[test]
    #[serial]
    fn test_resolve_connection_passthrough_key() {
        // Non-reference connections should pass through unchanged
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://api.openai.com",
                "apiKey": "sk-test"
            }
        }));
        let conn = resolve_connection(&agent).unwrap();
        assert_eq!(conn.get("kind").unwrap().as_str().unwrap(), "key");
        assert_eq!(conn.get("apiKey").unwrap().as_str().unwrap(), "sk-test");
    }

    #[test]
    #[serial]
    fn test_resolve_connection_reference_missing_name() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "reference"
                // missing "name" field
            }
        }));
        let result = resolve_connection(&agent);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("name"));
    }

    #[test]
    #[serial]
    fn test_resolve_connection_reference_not_registered() {
        prompty::connections::clear_connections();
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "reference",
                "name": "unregistered"
            }
        }));
        let result = resolve_connection(&agent);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not registered"));
    }

    #[test]
    #[serial]
    fn test_resolve_connection_reference_success() {
        prompty::connections::clear_connections();
        // Register a connection as a JSON Value
        prompty::connections::register_connection(
            "my-openai",
            json!({
                "kind": "key",
                "endpoint": "https://custom.openai.com",
                "apiKey": "sk-resolved"
            }),
        );

        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "reference",
                "name": "my-openai"
            }
        }));

        let conn = resolve_connection(&agent).unwrap();
        assert_eq!(
            conn.get("endpoint").unwrap().as_str().unwrap(),
            "https://custom.openai.com"
        );
        assert_eq!(conn.get("apiKey").unwrap().as_str().unwrap(), "sk-resolved");

        // Clean up
        prompty::connections::clear_connections();
    }

    #[test]
    #[serial]
    fn test_reference_connection_flows_to_build_url() {
        prompty::connections::clear_connections();
        prompty::connections::register_connection(
            "prod-openai",
            json!({
                "kind": "key",
                "endpoint": "https://prod.openai.proxy.com",
                "apiKey": "sk-prod"
            }),
        );

        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "reference",
                "name": "prod-openai"
            }
        }));

        let url = build_url(&agent, "/v1/chat/completions").unwrap();
        assert_eq!(url, "https://prod.openai.proxy.com/v1/chat/completions");

        let key = get_api_key(&agent).unwrap();
        assert_eq!(key, "sk-prod");

        prompty::connections::clear_connections();
    }
}
