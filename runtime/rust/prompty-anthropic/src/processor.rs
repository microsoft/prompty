//! Anthropic processor — extracts results from Anthropic Messages API responses.
//!
//! Handles:
//! - Text responses: concatenates all `text` content blocks
//! - Tool use responses: extracts `tool_use` blocks into `ToolCall` structs
//! - Structured output: JSON-parses text when `outputs` is defined
//!
//! `tool_use` blocks take priority — if any exist, they're returned instead of text.

use async_trait::async_trait;
use serde_json::{Value, json};

use prompty::interfaces::{InvokerError, Processor};
use prompty::model::{
    InvocationContextPortability, InvocationContextState, ModelInvocationRequest,
    ModelInvocationResponse, ModelToolRequest, Prompty,
};
use prompty::types::{Message, Role, ToolCall};

/// Anthropic processor implementing the `Processor` trait.
pub struct AnthropicProcessor;

#[async_trait]
impl Processor for AnthropicProcessor {
    async fn process(&self, agent: &Prompty, response: Value) -> Result<Value, InvokerError> {
        process_response(agent, &response)
    }

    async fn process_with_context(
        &self,
        agent: &Prompty,
        response: Value,
        _request: &ModelInvocationRequest,
    ) -> Result<ModelInvocationResponse, InvokerError> {
        let output = process_response(agent, &response)?;
        let tool_requests = extract_tool_calls(&response)
            .into_iter()
            .map(|call| ModelToolRequest {
                id: call.id,
                name: call.name,
                arguments: serde_json::from_str(&call.arguments)
                    .ok()
                    .or(Some(Value::String(call.arguments))),
                metadata: Value::Null,
            })
            .collect::<Vec<_>>();
        // Anthropic Messages API has no continuation handle that can restore
        // the complete provider-visible context, so do not fabricate one.
        Ok(ModelInvocationResponse {
            output: tool_requests.is_empty().then_some(output),
            usage: None,
            assistant_messages: portable_assistant_messages(&response),
            tool_requests,
            next_context_state: Some(InvocationContextState {
                portability: InvocationContextPortability::Portable,
                delegated_state: Vec::new(),
            }),
            metadata: Value::Null,
        })
    }

    async fn process_raw_with_context(
        &self,
        agent: &Prompty,
        response: Value,
        request: &ModelInvocationRequest,
    ) -> Result<ModelInvocationResponse, InvokerError> {
        let mut mapped = self
            .process_with_context(agent, response.clone(), request)
            .await?;
        mapped.output = Some(response);
        mapped.tool_requests.clear();
        Ok(mapped)
    }

    fn process_stream(
        &self,
        inner: std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>,
    ) -> Result<
        std::pin::Pin<Box<dyn futures::Stream<Item = prompty::types::StreamChunk> + Send>>,
        InvokerError,
    > {
        Ok(Box::pin(AnthropicStreamProcessor::new(inner)))
    }
}

fn portable_assistant_messages(response: &Value) -> Vec<Message> {
    let content = response
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let text = content
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    let mut assistant = Message::with_text(Role::Assistant, text);
    if !content.is_empty() {
        assistant
            .metadata_mut()
            .insert("content".to_string(), Value::Array(content));
    }
    vec![assistant]
}

/// Process an Anthropic Messages API response.
///
/// This is the shared logic used by both the `AnthropicProcessor` trait impl
/// and can be called directly for testing.
pub fn process_response(agent: &Prompty, response: &Value) -> Result<Value, InvokerError> {
    let content = response
        .get("content")
        .and_then(|c| c.as_array())
        .ok_or_else(|| {
            InvokerError::Process(
                "Invalid Anthropic response: missing 'content' array"
                    .to_string()
                    .into(),
            )
        })?;

    // Extract tool_use blocks
    let tool_calls: Vec<ToolCall> = content
        .iter()
        .filter(|block| block.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
        .map(|block| ToolCall {
            id: block
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            name: block
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            arguments: block
                .get("input")
                .map(|v| serde_json::to_string(v).unwrap_or_default())
                .unwrap_or_default(),
        })
        .collect();

    // If there are tool calls, return them (tool calls take priority over text)
    if !tool_calls.is_empty() {
        let calls_json: Vec<Value> = tool_calls
            .iter()
            .map(|tc| {
                json!({
                    "id": tc.id,
                    "name": tc.name,
                    "arguments": tc.arguments,
                })
            })
            .collect();
        return Ok(Value::Array(calls_json));
    }

    // Extract and concatenate text blocks
    let text: String = content
        .iter()
        .filter(|block| block.get("type").and_then(|t| t.as_str()) == Some("text"))
        .filter_map(|block| block.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("");

    // Check for structured output
    let has_outputs = agent.as_outputs().map(|o| !o.is_empty()).unwrap_or(false);

    if has_outputs {
        // Per spec §8.1: try JSON parse, fall back to raw string on failure
        if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
            return Ok(parsed);
        }
    }

    Ok(Value::String(text))
}

/// Extract tool calls from an Anthropic response (for agent loop).
pub fn extract_tool_calls(response: &Value) -> Vec<ToolCall> {
    let content = match response.get("content").and_then(|c| c.as_array()) {
        Some(c) => c,
        None => return Vec::new(),
    };

    content
        .iter()
        .filter(|block| block.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
        .map(|block| ToolCall {
            id: block
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            name: block
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            arguments: block
                .get("input")
                .map(|v| serde_json::to_string(v).unwrap_or_default())
                .unwrap_or_default(),
        })
        .collect()
}

// ===========================================================================
// Streaming processor
// ===========================================================================

use std::collections::BTreeMap;
use std::pin::Pin;
use std::task::{Context, Poll};

use prompty::types::{StreamChunk, Usage};

/// Anthropic stream processor — converts SSE JSON events into `StreamChunk` items.
///
/// Handles:
/// - `content_block_delta` with `delta.type == "text_delta"` → `StreamChunk::Text`
/// - `content_block_start` with `content_block.type == "tool_use"` → accumulates tool call
/// - `content_block_delta` with `delta.type == "input_json_delta"` → appends to tool args
/// - On stream end, yields accumulated tool calls as `StreamChunk::Tool`
/// - On stream end, yields one cumulative `StreamChunk::Usage` after tool calls
struct AnthropicStreamProcessor {
    inner: Pin<Box<dyn futures::Stream<Item = Value> + Send>>,
    tool_call_acc: BTreeMap<usize, (String, String, String)>, // index → (id, name, arguments)
    pending: std::collections::VecDeque<StreamChunk>,
    phase: AnthropicStreamPhase,
    usage: Usage,
    has_usage: bool,
}

enum AnthropicStreamPhase {
    Streaming,
    YieldingTools(Vec<ToolCall>, usize),
    YieldingUsage(Usage),
    Done,
}

impl AnthropicStreamProcessor {
    fn new(inner: impl futures::Stream<Item = Value> + Send + Unpin + 'static) -> Self {
        Self {
            inner: Box::pin(inner),
            tool_call_acc: BTreeMap::new(),
            pending: std::collections::VecDeque::new(),
            phase: AnthropicStreamPhase::Streaming,
            usage: Usage::default(),
            has_usage: false,
        }
    }
}

impl futures::Stream for AnthropicStreamProcessor {
    type Item = StreamChunk;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();

        // Drain pending chunks first
        if let Some(chunk) = this.pending.pop_front() {
            return Poll::Ready(Some(chunk));
        }

        match &mut this.phase {
            AnthropicStreamPhase::Streaming => {
                match this.inner.as_mut().poll_next(cx) {
                    Poll::Ready(Some(event)) => {
                        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");

                        match event_type {
                            "message_start" => {
                                if let Some(usage) = event.pointer("/message/usage") {
                                    this.usage.input_tokens = usage
                                        .get("input_tokens")
                                        .and_then(Value::as_u64)
                                        .unwrap_or(0);
                                    this.has_usage = true;
                                }
                                cx.waker().wake_by_ref();
                                Poll::Pending
                            }
                            "message_delta" => {
                                if let Some(usage) = event.get("usage") {
                                    this.usage.output_tokens = usage
                                        .get("output_tokens")
                                        .and_then(Value::as_u64)
                                        .unwrap_or(0);
                                    this.has_usage = true;
                                }
                                cx.waker().wake_by_ref();
                                Poll::Pending
                            }
                            "content_block_delta" => {
                                if let Some(delta) = event.get("delta") {
                                    let delta_type =
                                        delta.get("type").and_then(Value::as_str).unwrap_or("");
                                    match delta_type {
                                        "text_delta" => {
                                            if let Some(text) =
                                                delta.get("text").and_then(Value::as_str)
                                            {
                                                if !text.is_empty() {
                                                    return Poll::Ready(Some(StreamChunk::Text(
                                                        text.to_string(),
                                                    )));
                                                }
                                            }
                                        }
                                        "input_json_delta" => {
                                            // Accumulate partial JSON for tool arguments
                                            let idx = event
                                                .get("index")
                                                .and_then(Value::as_u64)
                                                .unwrap_or(0)
                                                as usize;
                                            if let Some(partial) =
                                                delta.get("partial_json").and_then(Value::as_str)
                                            {
                                                if let Some(acc) = this.tool_call_acc.get_mut(&idx)
                                                {
                                                    acc.2.push_str(partial);
                                                }
                                            }
                                        }
                                        "thinking_delta" => {
                                            // Per spec §13.1: emit Thinking events for reasoning/chain-of-thought
                                            if let Some(thinking) =
                                                delta.get("thinking").and_then(Value::as_str)
                                            {
                                                if !thinking.is_empty() {
                                                    return Poll::Ready(Some(
                                                        StreamChunk::Thinking(thinking.to_string()),
                                                    ));
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                // Wake to continue polling
                                cx.waker().wake_by_ref();
                                Poll::Pending
                            }
                            "content_block_start" => {
                                // Accumulate tool use blocks
                                if let Some(block) = event.get("content_block") {
                                    if block.get("type").and_then(Value::as_str) == Some("tool_use")
                                    {
                                        let idx =
                                            event.get("index").and_then(Value::as_u64).unwrap_or(0)
                                                as usize;
                                        let id = block
                                            .get("id")
                                            .and_then(Value::as_str)
                                            .unwrap_or("")
                                            .to_string();
                                        let name = block
                                            .get("name")
                                            .and_then(Value::as_str)
                                            .unwrap_or("")
                                            .to_string();
                                        this.tool_call_acc.insert(idx, (id, name, String::new()));
                                    }
                                }
                                cx.waker().wake_by_ref();
                                Poll::Pending
                            }
                            _ => {
                                // Skip other event types (message_start, message_delta, etc.)
                                cx.waker().wake_by_ref();
                                Poll::Pending
                            }
                        }
                    }
                    Poll::Ready(None) => {
                        // Stream ended — yield accumulated tool calls
                        if !this.tool_call_acc.is_empty() {
                            let tools: Vec<ToolCall> = this
                                .tool_call_acc
                                .iter()
                                .map(|(_idx, (id, name, args))| ToolCall {
                                    id: id.clone(),
                                    name: name.clone(),
                                    arguments: args.clone(),
                                })
                                .collect();
                            this.phase = AnthropicStreamPhase::YieldingTools(tools, 0);
                            cx.waker().wake_by_ref();
                            Poll::Pending
                        } else {
                            this.finish_with_usage(cx)
                        }
                    }
                    Poll::Pending => Poll::Pending,
                }
            }
            AnthropicStreamPhase::YieldingTools(tools, idx) => {
                if *idx < tools.len() {
                    let tc = tools[*idx].clone();
                    *idx += 1;
                    Poll::Ready(Some(StreamChunk::Tool(tc)))
                } else {
                    this.finish_with_usage(cx)
                }
            }
            AnthropicStreamPhase::YieldingUsage(usage) => {
                let usage = *usage;
                this.phase = AnthropicStreamPhase::Done;
                Poll::Ready(Some(StreamChunk::Usage(usage)))
            }
            AnthropicStreamPhase::Done => Poll::Ready(None),
        }
    }
}

impl AnthropicStreamProcessor {
    fn finish_with_usage(&mut self, cx: &Context<'_>) -> Poll<Option<StreamChunk>> {
        if self.has_usage {
            self.usage.total_tokens = self.usage.input_tokens + self.usage.output_tokens;
            self.phase = AnthropicStreamPhase::YieldingUsage(self.usage);
            cx.waker().wake_by_ref();
            Poll::Pending
        } else {
            self.phase = AnthropicStreamPhase::Done;
            Poll::Ready(None)
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use prompty::model::context::LoadContext;
    use serde_json::json;

    fn make_agent() -> Prompty {
        let data = json!({
            "name": "test",
            "kind": "prompt",
            "model": {"id": "claude-3", "provider": "anthropic"},
            "instructions": "test"
        });
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    fn make_agent_with_outputs() -> Prompty {
        let data = json!({
            "name": "test",
            "kind": "prompt",
            "model": {"id": "claude-3", "provider": "anthropic"},
            "instructions": "test",
            "outputs": [
                {"name": "city", "kind": "string"},
                {"name": "temp", "kind": "integer"}
            ]
        });
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[tokio::test]
    async fn test_stream_emits_terminal_usage() {
        use futures::StreamExt;

        let chunks = vec![
            json!({"type": "message_start", "message": {"usage": {"input_tokens": 10}}}),
            json!({"type": "message_delta", "usage": {"output_tokens": 5}}),
            json!({"type": "message_stop"}),
        ];
        let mut stream = AnthropicStreamProcessor::new(futures::stream::iter(chunks));
        let mut usage = None;
        while let Some(chunk) = stream.next().await {
            if let StreamChunk::Usage(value) = chunk {
                usage = Some(value);
            }
        }

        assert_eq!(
            usage,
            Some(Usage {
                input_tokens: 10,
                output_tokens: 5,
                total_tokens: 15,
            })
        );
    }

    #[tokio::test]
    async fn test_process_text_response() {
        let agent = make_agent();
        let response = json!({
            "id": "msg_01",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-20250514",
            "content": [{"type": "text", "text": "Hello!"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 3}
        });

        let result = AnthropicProcessor.process(&agent, response).await.unwrap();
        assert_eq!(result, "Hello!");
    }

    #[tokio::test]
    async fn test_context_response_is_portable_without_native_continuation() {
        let agent = make_agent();
        let response = json!({
            "id": "msg_01",
            "type": "message",
            "content": [
                {"type": "text", "text": "Hello!"},
                {"type": "tool_use", "id": "toolu_1", "name": "weather", "input": {"city": "Paris"}}
            ]
        });

        let result = AnthropicProcessor
            .process_with_context(
                &agent,
                response,
                &ModelInvocationRequest::load_from_value(&json!({}), &LoadContext::default()),
            )
            .await
            .unwrap();

        let state = result.next_context_state.expect("context state");
        assert_eq!(state.portability, InvocationContextPortability::Portable);
        assert!(state.delegated_state.is_empty());
        assert_eq!(result.assistant_messages.len(), 1);
        assert_eq!(result.assistant_messages[0].text_content(), "Hello!");
        assert_eq!(
            result.assistant_messages[0].metadata["content"][1]["type"],
            "tool_use"
        );
    }

    #[tokio::test]
    async fn test_process_tool_use_response() {
        let agent = make_agent();
        let response = json!({
            "id": "msg_02",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-20250514",
            "content": [{
                "type": "tool_use",
                "id": "toolu_1",
                "name": "get_weather",
                "input": {"city": "Paris"}
            }],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 25, "output_tokens": 20}
        });

        let result = AnthropicProcessor.process(&agent, response).await.unwrap();
        let calls = result.as_array().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["id"], "toolu_1");
        assert_eq!(calls[0]["name"], "get_weather");
        assert_eq!(calls[0]["arguments"], r#"{"city":"Paris"}"#);
    }

    #[tokio::test]
    async fn test_process_multiple_text_blocks() {
        let agent = make_agent();
        let response = json!({
            "id": "msg_03",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-20250514",
            "content": [
                {"type": "text", "text": "Here is the answer:"},
                {"type": "text", "text": " The weather in Paris is sunny."}
            ],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 15, "output_tokens": 12}
        });

        let result = AnthropicProcessor.process(&agent, response).await.unwrap();
        assert_eq!(result, "Here is the answer: The weather in Paris is sunny.");
    }

    #[tokio::test]
    async fn test_process_structured_output() {
        let agent = make_agent_with_outputs();
        let response = json!({
            "id": "msg-struct",
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": "{\"city\": \"Paris\", \"temp\": 22}"}],
            "model": "claude-sonnet-4-20250514",
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 20, "output_tokens": 10}
        });

        let result = AnthropicProcessor.process(&agent, response).await.unwrap();
        // Should be parsed JSON (plain data, not StructuredResult wrapper)
        assert_eq!(result["city"], "Paris");
        assert_eq!(result["temp"], 22);
    }

    #[test]
    fn test_extract_tool_calls() {
        let response = json!({
            "content": [
                {"type": "text", "text": "Let me check..."},
                {"type": "tool_use", "id": "toolu_1", "name": "get_weather", "input": {"city": "Paris"}},
                {"type": "tool_use", "id": "toolu_2", "name": "get_time", "input": {"city": "Paris"}}
            ]
        });
        let calls = extract_tool_calls(&response);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "get_weather");
        assert_eq!(calls[1].name, "get_time");
    }

    #[test]
    fn test_extract_tool_calls_no_tools() {
        let response = json!({
            "content": [{"type": "text", "text": "Hello!"}]
        });
        let calls = extract_tool_calls(&response);
        assert!(calls.is_empty());
    }

    #[tokio::test]
    async fn test_tool_use_priority_over_text() {
        let agent = make_agent();
        let response = json!({
            "id": "msg_mixed",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-20250514",
            "content": [
                {"type": "text", "text": "Let me help you..."},
                {"type": "tool_use", "id": "toolu_1", "name": "search", "input": {"q": "rust"}}
            ],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 30, "output_tokens": 25}
        });

        let result = AnthropicProcessor.process(&agent, response).await.unwrap();
        // Tool calls take priority
        assert!(result.is_array());
        assert_eq!(result.as_array().unwrap()[0]["name"], "search");
    }
}
