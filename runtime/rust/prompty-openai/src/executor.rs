//! OpenAI executor — sends requests to the OpenAI Chat Completions API.
//!
//! Dispatches on `agent.model.apiType` to call the appropriate endpoint:
//! `chat`, `embedding`, or `image`.

use async_trait::async_trait;
use serde_json::Value;
use std::sync::LazyLock;

use prompty::interfaces::{Executor, InvokerError};
use prompty::model::Prompty;
use prompty::types::Message;

use crate::wire;

/// Shared HTTP client — reuses connection pool across requests.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// OpenAI executor implementing the `Executor` trait.
pub struct OpenAIExecutor;

#[async_trait]
impl Executor for OpenAIExecutor {
    async fn execute(
        &self,
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<Value, InvokerError> {
        let api_type = agent
            .model
            .api_type
            .as_deref()
            .unwrap_or("chat");

        let (url, body) = match api_type {
            "chat" | "agent" => {
                let args = wire::build_chat_args(agent, messages);
                let url = build_url(agent, "/v1/chat/completions")?;
                (url, args)
            }
            "responses" => {
                let args = wire::build_responses_args(agent, messages);
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
            .map_err(|e| InvokerError::Execute(format!("HTTP request failed: {e}").into()))?;

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

        let result: Value = response
            .json()
            .await
            .map_err(|e| InvokerError::Execute(format!("Failed to parse response: {e}").into()))?;

        Ok(result)
    }

    fn format_tool_messages(
        &self,
        _raw_response: &serde_json::Value,
        tool_calls: &[prompty::types::ToolCall],
        tool_results: &[String],
        _text_content: Option<&str>,
    ) -> Vec<Message> {
        wire::format_tool_messages(tool_calls, tool_results)
    }

    async fn execute_stream(
        &self,
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>, InvokerError> {
        let api_type = agent.model.api_type.as_deref().unwrap_or("chat");

        let (url, mut body) = match api_type {
            "chat" | "agent" => {
                let args = wire::build_chat_args(agent, messages);
                let url = build_url(agent, "/v1/chat/completions")?;
                (url, args)
            }
            "responses" => {
                let args = wire::build_responses_args(agent, messages);
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
            .map_err(|e| InvokerError::Execute(format!("HTTP request failed: {e}").into()))?;

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
}

impl OpenAIExecutor {
    /// Build the request args without sending — useful for testing wire format.
    pub fn build_args(
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<Value, InvokerError> {
        let api_type = agent.model.api_type.as_deref().unwrap_or("chat");
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

/// Resolve the effective connection — if `kind == "reference"`, look up the
/// named connection from the registry. Otherwise return the connection as-is.
fn resolve_connection(agent: &Prompty) -> Result<std::borrow::Cow<'_, serde_json::Value>, InvokerError> {
    let conn = &agent.model.connection;
    let kind = conn.get("kind").and_then(|k| k.as_str()).unwrap_or("");

    if kind == "reference" {
        let name = conn
            .get("name")
            .and_then(|n| n.as_str())
            .ok_or_else(|| {
                InvokerError::Execute(
                    "Reference connection missing 'name' field".to_string().into(),
                )
            })?;

        // Look up the named connection from the registry
        let resolved = prompty::connections::with_connection::<serde_json::Value, _>(name, |c| c.clone())
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
        .or_else(|| std::env::var("OPENAI_BASE_URL").ok().filter(|s| !s.is_empty()))
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
    if let Some(key) = conn.get("apiKey").or(conn.get("api_key")).and_then(|k| k.as_str()) {
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
                if let Some(data) = line.strip_prefix("data: ").or_else(|| line.strip_prefix("data:")) {
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
    fn test_build_url_default() {
        let agent = make_agent(json!({"id": "gpt-4"}));
        let url = build_url(&agent, "/v1/chat/completions").unwrap();
        assert_eq!(url, "https://api.openai.com/v1/chat/completions");
    }

    #[test]
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
    fn test_build_args_chat() {
        let agent = make_agent(json!({"id": "gpt-4", "apiType": "chat"}));
        let messages = vec![Message::text(prompty::Role::User, "Hello")];
        let args = OpenAIExecutor::build_args(&agent, &messages).unwrap();
        assert_eq!(args["model"], "gpt-4");
        assert!(args["messages"].is_array());
    }

    #[test]
    fn test_build_args_embedding() {
        let agent = make_agent(json!({"id": "text-embedding-3-small", "apiType": "embedding"}));
        let messages = vec![Message::text(prompty::Role::User, "Hello world")];
        let args = OpenAIExecutor::build_args(&agent, &messages).unwrap();
        assert_eq!(args["model"], "text-embedding-3-small");
        assert!(args.get("input").is_some());
    }

    #[tokio::test]
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
}
