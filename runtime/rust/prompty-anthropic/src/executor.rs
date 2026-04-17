//! Anthropic executor — sends requests to the Anthropic Messages API.
//!
//! Only supports `apiType: "chat"` — Anthropic doesn't have embedding or image APIs.
//! Auth uses `x-api-key` header and `anthropic-version` header.

use async_trait::async_trait;
use serde_json::Value;
use std::sync::LazyLock;

use prompty::interfaces::{Executor, InvokerError};
use prompty::model::Prompty;
use prompty::types::Message;

use crate::wire;

/// Shared HTTP client — reuses connection pool across requests.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// Anthropic executor implementing the `Executor` trait.
pub struct AnthropicExecutor;

#[async_trait]
impl Executor for AnthropicExecutor {
    async fn execute(&self, agent: &Prompty, messages: &[Message]) -> Result<Value, InvokerError> {
        let api_type = agent.model.api_type.as_ref().map(|t| t.as_str()).unwrap_or("chat");
        if api_type != "chat" && api_type != "agent" {
            return Err(InvokerError::Execute(
                format!("Anthropic only supports apiType 'chat', got: {api_type}").into(),
            ));
        }

        let body = wire::build_chat_args(agent, messages);
        let url = build_url(agent)?;
        let api_key = get_api_key(agent)?;

        let client = &*HTTP_CLIENT;
        let response = client
            .post(&url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", wire::ANTHROPIC_VERSION)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| InvokerError::Execute(format!("HTTP request failed: {e}").into()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "unable to read body".to_string());
            return Err(InvokerError::Execute(
                format!("Anthropic API error (HTTP {status}): {body_text}").into(),
            ));
        }

        let result: Value = response
            .json()
            .await
            .map_err(|e| InvokerError::Execute(format!("Failed to parse response: {e}").into()))?;

        Ok(result)
    }

    fn format_tool_messages(
        &self,
        raw_response: &Value,
        tool_calls: &[prompty::types::ToolCall],
        tool_results: &[String],
        _text_content: Option<&str>,
    ) -> Vec<Message> {
        wire::format_tool_messages(raw_response, tool_calls, tool_results)
    }

    async fn execute_stream(
        &self,
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>, InvokerError> {
        let api_type = agent.model.api_type.as_ref().map(|t| t.as_str()).unwrap_or("chat");
        if api_type != "chat" && api_type != "agent" {
            return Err(InvokerError::Execute(
                format!("Anthropic only supports apiType 'chat', got: {api_type}").into(),
            ));
        }

        let mut body = wire::build_chat_args(agent, messages);
        // Force stream: true
        if let Some(obj) = body.as_object_mut() {
            obj.insert("stream".into(), Value::Bool(true));
        }

        let url = build_url(agent)?;
        let api_key = get_api_key(agent)?;

        let client = &*HTTP_CLIENT;
        let response = client
            .post(&url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", wire::ANTHROPIC_VERSION)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| InvokerError::Execute(format!("HTTP request failed: {e}").into()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "unable to read body".to_string());
            return Err(InvokerError::Execute(
                format!("Anthropic API error (HTTP {status}): {body_text}").into(),
            ));
        }

        let byte_stream = response.bytes_stream();
        Ok(Box::pin(AnthropicSseParser::new(byte_stream)))
    }
}

impl AnthropicExecutor {
    /// Build the request args without sending — useful for testing wire format.
    pub fn build_args(agent: &Prompty, messages: &[Message]) -> Result<Value, InvokerError> {
        let api_type = agent.model.api_type.as_ref().map(|t| t.as_str()).unwrap_or("chat");
        if api_type != "chat" && api_type != "agent" {
            return Err(InvokerError::Execute(
                format!("Anthropic only supports apiType 'chat', got: {api_type}").into(),
            ));
        }
        Ok(wire::build_chat_args(agent, messages))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

        let resolved =
            prompty::connections::with_connection::<serde_json::Value, _>(name, |c| c.clone())
                .map_err(|e| InvokerError::Execute(e.into()))?;

        Ok(std::borrow::Cow::Owned(resolved))
    } else {
        Ok(std::borrow::Cow::Borrowed(conn))
    }
}

fn build_url(agent: &Prompty) -> Result<String, InvokerError> {
    let conn = resolve_connection(agent)?;
    let endpoint = conn
        .get("endpoint")
        .and_then(|e| e.as_str())
        .unwrap_or("https://api.anthropic.com");

    let base = endpoint.trim_end_matches('/');
    Ok(format!("{base}/v1/messages"))
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

    // Fall back to ANTHROPIC_API_KEY env var
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    Err(InvokerError::Execute(
        "No API key found. Set ANTHROPIC_API_KEY or configure model.connection.apiKey"
            .to_string()
            .into(),
    ))
}

// ---------------------------------------------------------------------------
// Anthropic SSE parser — converts raw HTTP byte stream to JSON events
// ---------------------------------------------------------------------------

use std::collections::VecDeque;
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use futures::Stream;

/// Parses Anthropic Server-Sent Events from a raw byte stream into JSON `Value` items.
///
/// Anthropic SSE events have `event:` and `data:` lines:
/// ```text
/// event: content_block_delta
/// data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}
/// ```
///
/// Each complete SSE event is parsed and yielded as a JSON `Value` with
/// an additional `"event"` field injected from the `event:` line.
struct AnthropicSseParser {
    inner: Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>,
    buffer: String,
    pending: VecDeque<Value>,
    done: bool,
}

impl AnthropicSseParser {
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
            let event_block = self.buffer[..pos].to_string();
            self.buffer = self.buffer[pos + 2..].to_string();

            let mut event_type = String::new();
            let mut data_lines = Vec::new();

            for line in event_block.lines() {
                if let Some(ev) = line
                    .strip_prefix("event: ")
                    .or_else(|| line.strip_prefix("event:"))
                {
                    event_type = ev.trim().to_string();
                } else if let Some(d) = line
                    .strip_prefix("data: ")
                    .or_else(|| line.strip_prefix("data:"))
                {
                    data_lines.push(d.trim().to_string());
                }
            }

            // Skip empty events
            if data_lines.is_empty() {
                continue;
            }

            let data_str = data_lines.join("\n");

            // message_stop terminates the stream
            if event_type == "message_stop" {
                self.done = true;
                return;
            }

            // Parse data as JSON
            match serde_json::from_str::<Value>(&data_str) {
                Ok(mut parsed) => {
                    // Inject the event type for downstream processing
                    if !event_type.is_empty() {
                        if let Some(obj) = parsed.as_object_mut() {
                            obj.insert("event".to_string(), Value::String(event_type));
                        }
                    }
                    self.pending.push_back(parsed);
                }
                Err(e) => {
                    self.pending.push_back(serde_json::json!({
                        "error": {
                            "type": "sse_parse_error",
                            "message": format!("Failed to parse Anthropic SSE data: {e}"),
                            "raw": data_str,
                        }
                    }));
                }
            }
        }
    }
}

impl Stream for AnthropicSseParser {
    type Item = Value;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        loop {
            if let Some(item) = self.pending.pop_front() {
                return Poll::Ready(Some(item));
            }
            if self.done {
                return Poll::Ready(None);
            }

            match self.inner.as_mut().poll_next(cx) {
                Poll::Ready(Some(Ok(bytes))) => {
                    match std::str::from_utf8(&bytes) {
                        Ok(text) => self.buffer.push_str(text),
                        Err(e) => {
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
                    self.pending.push_back(serde_json::json!({
                        "error": {
                            "type": "sse_transport_error",
                            "message": format!("SSE stream error: {e}"),
                        }
                    }));
                    self.done = true;
                    if let Some(item) = self.pending.pop_front() {
                        return Poll::Ready(Some(item));
                    }
                    return Poll::Ready(None);
                }
                Poll::Ready(None) => {
                    self.done = true;
                    return Poll::Ready(None);
                }
                Poll::Pending => {
                    return Poll::Pending;
                }
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

    #[test]
    #[serial]
    fn test_build_url_default() {
        let agent = make_agent(json!({"id": "claude-3", "provider": "anthropic"}));
        let url = build_url(&agent).unwrap();
        assert_eq!(url, "https://api.anthropic.com/v1/messages");
    }

    #[test]
    #[serial]
    fn test_build_url_custom_endpoint() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "connection": {
                "kind": "key",
                "endpoint": "https://custom.anthropic.com/",
                "apiKey": "test-key"
            }
        }));
        let url = build_url(&agent).unwrap();
        assert_eq!(url, "https://custom.anthropic.com/v1/messages");
    }

    #[test]
    #[serial]
    fn test_get_api_key_from_connection() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "connection": {
                "kind": "key",
                "apiKey": "sk-from-connection"
            }
        }));
        let key = get_api_key(&agent).unwrap();
        assert_eq!(key, "sk-from-connection");
    }

    #[test]
    #[serial]
    fn test_build_args_chat() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "apiType": "chat"
        }));
        let messages = vec![Message::text(prompty::Role::User, "Hello")];
        let args = AnthropicExecutor::build_args(&agent, &messages).unwrap();
        assert_eq!(args["model"], "claude-3");
        assert!(args["messages"].is_array());
        assert_eq!(args["max_tokens"], 4096);
    }

    #[test]
    #[serial]
    fn test_build_args_rejects_embedding() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "apiType": "embedding"
        }));
        let messages = vec![Message::text(prompty::Role::User, "Hello")];
        let result = AnthropicExecutor::build_args(&agent, &messages);
        assert!(result.is_err());
    }

    // --- Reference connection resolution tests ---

    #[test]
    #[serial]
    fn test_resolve_connection_passthrough() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "connection": {
                "kind": "key",
                "apiKey": "sk-test"
            }
        }));
        let conn = resolve_connection(&agent).unwrap();
        assert_eq!(conn.get("apiKey").unwrap().as_str().unwrap(), "sk-test");
    }

    #[test]
    #[serial]
    fn test_resolve_connection_reference_missing_name() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "connection": { "kind": "reference" }
        }));
        let result = resolve_connection(&agent);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("name"));
    }

    #[test]
    #[serial]
    fn test_resolve_connection_reference_success() {
        prompty::connections::clear_connections();
        prompty::connections::register_connection(
            "anthropic-prod",
            json!({
                "kind": "key",
                "endpoint": "https://custom.anthropic.com",
                "apiKey": "sk-resolved"
            }),
        );

        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "connection": { "kind": "reference", "name": "anthropic-prod" }
        }));

        let conn = resolve_connection(&agent).unwrap();
        assert_eq!(conn.get("apiKey").unwrap().as_str().unwrap(), "sk-resolved");
        assert_eq!(
            conn.get("endpoint").unwrap().as_str().unwrap(),
            "https://custom.anthropic.com"
        );

        prompty::connections::clear_connections();
    }

    #[test]
    #[serial]
    fn test_reference_connection_flows_to_api_key() {
        prompty::connections::clear_connections();
        prompty::connections::register_connection(
            "anthropic-ref",
            json!({
                "kind": "key",
                "apiKey": "sk-via-reference"
            }),
        );

        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "connection": { "kind": "reference", "name": "anthropic-ref" }
        }));

        let key = get_api_key(&agent).unwrap();
        assert_eq!(key, "sk-via-reference");

        prompty::connections::clear_connections();
    }

    #[test]
    #[serial]
    fn test_reference_connection_flows_to_build_url() {
        prompty::connections::clear_connections();
        prompty::connections::register_connection(
            "anthropic-custom",
            json!({
                "kind": "key",
                "endpoint": "https://proxy.anthropic.com",
                "apiKey": "sk-proxy"
            }),
        );

        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "connection": { "kind": "reference", "name": "anthropic-custom" }
        }));

        let url = build_url(&agent).unwrap();
        assert_eq!(url, "https://proxy.anthropic.com/v1/messages");

        prompty::connections::clear_connections();
    }
}
