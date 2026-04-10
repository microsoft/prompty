//! OpenAI processor — extracts results from OpenAI API responses.
//!
//! Handles chat completions, embeddings, image generation, and streaming responses.

use async_trait::async_trait;
use serde_json::Value;

use prompty::interfaces::{InvokerError, Processor};
use prompty::model::Prompty;
use prompty::types::ToolCall;

/// OpenAI processor implementing the `Processor` trait.
pub struct OpenAIProcessor;

#[async_trait]
impl Processor for OpenAIProcessor {
    async fn process(
        &self,
        agent: &Prompty,
        response: Value,
    ) -> Result<Value, InvokerError> {
        process_response(agent, &response)
    }

    fn process_stream(
        &self,
        inner: std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>,
    ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = prompty::types::StreamChunk> + Send>>, InvokerError> {
        Ok(process_stream(inner))
    }
}

/// Process an OpenAI API response, dispatching by response shape.
pub fn process_response(agent: &Prompty, response: &Value) -> Result<Value, InvokerError> {
    // Responses API — has "object" == "response"
    if response.get("object").and_then(Value::as_str) == Some("response") {
        return process_responses_api(agent, response);
    }

    // ChatCompletion — has "choices"
    if let Some(choices) = response.get("choices").and_then(Value::as_array) {
        return process_chat_completion(agent, choices);
    }

    // Embedding — has "data" and "object" == "list"
    if response.get("object").and_then(Value::as_str) == Some("list") {
        if let Some(data) = response.get("data").and_then(Value::as_array) {
            return process_embedding(data);
        }
    }

    // Image — has "data" array with url/b64_json
    if let Some(data) = response.get("data").and_then(Value::as_array) {
        if data.iter().any(|d| {
            d.get("url").is_some_and(|v| !v.is_null())
                || d.get("b64_json").is_some_and(|v| !v.is_null())
        }) {
            return process_image(data);
        }
    }

    // Unknown response shape — return as-is
    Ok(response.clone())
}

// ---------------------------------------------------------------------------
// Chat completion
// ---------------------------------------------------------------------------

fn process_chat_completion(agent: &Prompty, choices: &[Value]) -> Result<Value, InvokerError> {
    let first = choices
        .first()
        .ok_or_else(|| InvokerError::Process("Empty choices array".to_string().into()))?;

    let message = first
        .get("message")
        .ok_or_else(|| InvokerError::Process("Missing message in choice".to_string().into()))?;

    // Tool calls take priority
    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        if !tool_calls.is_empty() {
            let calls: Vec<Value> = tool_calls
                .iter()
                .map(|tc| {
                    let func = tc.get("function").unwrap_or(tc);
                    serde_json::json!({
                        "id": tc.get("id").and_then(Value::as_str).unwrap_or(""),
                        "name": func.get("name").and_then(Value::as_str).unwrap_or(""),
                        "arguments": func.get("arguments").and_then(Value::as_str).unwrap_or("{}"),
                    })
                })
                .collect();
            return Ok(Value::Array(calls));
        }
    }

    // Content
    let content = message.get("content");

    // Refusal
    if content.is_none() || content == Some(&Value::Null) {
        if let Some(refusal) = message.get("refusal").and_then(Value::as_str) {
            return Ok(Value::String(refusal.to_string()));
        }
    }

    let content_str = content
        .and_then(Value::as_str)
        .unwrap_or("");

    // Structured output: if agent has outputs, try to parse as JSON.
    // Falls back to raw string gracefully if parsing fails.
    if let Some(outputs) = agent.as_outputs() {
        if !outputs.is_empty() {
            if let Ok(parsed) = serde_json::from_str::<Value>(content_str) {
                return Ok(parsed);
            }
            // Fall through to return raw string
        }
    }

    Ok(Value::String(content_str.to_string()))
}

// ---------------------------------------------------------------------------
// Responses API (OpenAI new format)
// ---------------------------------------------------------------------------

fn process_responses_api(agent: &Prompty, response: &Value) -> Result<Value, InvokerError> {
    // Check for tool calls in output items
    if let Some(output) = response.get("output").and_then(Value::as_array) {
        let tool_calls: Vec<Value> = output
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
            .map(|item| {
                serde_json::json!({
                    "id": item.get("call_id").and_then(Value::as_str).unwrap_or(""),
                    "name": item.get("name").and_then(Value::as_str).unwrap_or(""),
                    "arguments": item.get("arguments").and_then(Value::as_str).unwrap_or("{}"),
                })
            })
            .collect();

        if !tool_calls.is_empty() {
            return Ok(Value::Array(tool_calls));
        }
    }

    // Extract output_text (convenience field)
    let output_text = response
        .get("output_text")
        .and_then(Value::as_str)
        .unwrap_or("");

    // Structured output
    if let Some(outputs) = agent.as_outputs() {
        if !outputs.is_empty() {
            if let Ok(parsed) = serde_json::from_str::<Value>(output_text) {
                return Ok(parsed);
            }
        }
    }

    Ok(Value::String(output_text.to_string()))
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

fn process_embedding(data: &[Value]) -> Result<Value, InvokerError> {
    let vectors: Vec<Value> = data
        .iter()
        .filter_map(|d| d.get("embedding").cloned())
        .collect();

    if vectors.len() == 1 {
        Ok(vectors.into_iter().next().unwrap())
    } else {
        Ok(Value::Array(vectors))
    }
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

fn process_image(data: &[Value]) -> Result<Value, InvokerError> {
    let urls: Vec<Value> = data
        .iter()
        .map(|d| {
            // Prefer url, fall back to b64_json, skip nulls
            let url = d.get("url").filter(|v| !v.is_null());
            let b64 = d.get("b64_json").filter(|v| !v.is_null());
            url.or(b64).cloned().unwrap_or(Value::Null)
        })
        .collect();

    if urls.len() == 1 {
        Ok(urls.into_iter().next().unwrap())
    } else {
        Ok(Value::Array(urls))
    }
}

// ---------------------------------------------------------------------------
// Extract tool calls helper (used by pipeline)
// ---------------------------------------------------------------------------

/// Try to extract tool calls from a processed response value.
pub fn extract_tool_calls(response: &Value) -> Option<Vec<ToolCall>> {
    let arr = response.as_array()?;
    let calls: Vec<ToolCall> = arr
        .iter()
        .filter_map(|v| {
            let id = v.get("id")?.as_str()?.to_string();
            let name = v.get("name")?.as_str()?.to_string();
            let arguments = v.get("arguments")?.as_str()?.to_string();
            Some(ToolCall {
                id,
                name,
                arguments,
            })
        })
        .collect();
    if calls.is_empty() { None } else { Some(calls) }
}

// ---------------------------------------------------------------------------
// Streaming processor — yields StreamChunk from raw SSE chunks
// ---------------------------------------------------------------------------

use prompty::types::StreamChunk;

/// Process an OpenAI streaming response (SSE chunks) into a stream of `StreamChunk`s.
///
/// Handles three types of streaming deltas:
/// - `delta.content` — yields `StreamChunk::Text`
/// - `delta.tool_calls` — accumulates partial tool call chunks,
///   yields `StreamChunk::Tool` objects when the stream ends
/// - `delta.refusal` — yields an error as text
///
/// Matches TypeScript's `streamGenerator()` in `openai/processor.ts`.
pub fn process_stream(
    inner: impl futures::Stream<Item = Value> + Send + Unpin + 'static,
) -> std::pin::Pin<Box<dyn futures::Stream<Item = StreamChunk> + Send>> {
    Box::pin(OpenAIStreamProcessor::new(inner))
}

/// Stream adapter that processes OpenAI SSE chunks into StreamChunks.
struct OpenAIStreamProcessor {
    inner: std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>,
    /// Accumulated partial tool calls, keyed by index.
    tool_call_acc: std::collections::BTreeMap<usize, (String, String, String)>,
    /// Phase: Streaming (pulling from inner) or Yielding (emitting accumulated tool calls).
    phase: StreamPhase,
    /// Buffer for chunks to yield (content text from a single SSE event can only produce one).
    pending: std::collections::VecDeque<StreamChunk>,
}

enum StreamPhase {
    Streaming,
    /// Yielding accumulated tool calls, current index.
    YieldingTools(Vec<ToolCall>, usize),
    Done,
}

impl OpenAIStreamProcessor {
    fn new(inner: impl futures::Stream<Item = Value> + Send + Unpin + 'static) -> Self {
        Self {
            inner: Box::pin(inner),
            tool_call_acc: std::collections::BTreeMap::new(),
            phase: StreamPhase::Streaming,
            pending: std::collections::VecDeque::new(),
        }
    }
}

impl futures::Stream for OpenAIStreamProcessor {
    type Item = StreamChunk;

    fn poll_next(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        let this = self.get_mut();

        // Return any pending chunks first
        if let Some(chunk) = this.pending.pop_front() {
            return std::task::Poll::Ready(Some(chunk));
        }

        match &mut this.phase {
            StreamPhase::Streaming => {
                match this.inner.as_mut().poll_next(cx) {
                    std::task::Poll::Ready(Some(chunk)) => {
                        let delta = chunk
                            .get("choices")
                            .and_then(Value::as_array)
                            .and_then(|c| c.first())
                            .and_then(|c| c.get("delta"));

                        if let Some(delta) = delta {
                            // Content text
                            if let Some(content) = delta.get("content").and_then(Value::as_str) {
                                if !content.is_empty() {
                                    return std::task::Poll::Ready(Some(StreamChunk::Text(content.to_string())));
                                }
                            }

                            // Tool call deltas
                            if let Some(tc_deltas) = delta.get("tool_calls").and_then(Value::as_array) {
                                for tc_delta in tc_deltas {
                                    let idx = tc_delta.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                                    let entry = this.tool_call_acc.entry(idx).or_insert_with(|| {
                                        (String::new(), String::new(), String::new())
                                    });
                                    if let Some(id) = tc_delta.get("id").and_then(Value::as_str) {
                                        entry.0 = id.to_string();
                                    }
                                    if let Some(name) = tc_delta.pointer("/function/name").and_then(Value::as_str) {
                                        entry.1 = name.to_string();
                                    }
                                    if let Some(args) = tc_delta.pointer("/function/arguments").and_then(Value::as_str) {
                                        entry.2.push_str(args);
                                    }
                                }
                            }

                            // Refusal
                            if let Some(refusal) = delta.get("refusal").and_then(Value::as_str) {
                                return std::task::Poll::Ready(Some(
                                    StreamChunk::Text(format!("Model refused: {refusal}")),
                                ));
                            }
                        }

                        // No content from this SSE event, wake and re-poll
                        cx.waker().wake_by_ref();
                        std::task::Poll::Pending
                    }
                    std::task::Poll::Ready(None) => {
                        // Inner stream exhausted — yield accumulated tool calls
                        let tools: Vec<ToolCall> = this.tool_call_acc
                            .values()
                            .map(|(id, name, args)| ToolCall {
                                id: id.clone(),
                                name: name.clone(),
                                arguments: args.clone(),
                            })
                            .collect();

                        if tools.is_empty() {
                            this.phase = StreamPhase::Done;
                            std::task::Poll::Ready(None)
                        } else {
                            let first = tools[0].clone();
                            this.phase = StreamPhase::YieldingTools(tools, 1);
                            std::task::Poll::Ready(Some(StreamChunk::Tool(first)))
                        }
                    }
                    std::task::Poll::Pending => std::task::Poll::Pending,
                }
            }
            StreamPhase::YieldingTools(tools, idx) => {
                if *idx < tools.len() {
                    let tc = tools[*idx].clone();
                    *idx += 1;
                    std::task::Poll::Ready(Some(StreamChunk::Tool(tc)))
                } else {
                    this.phase = StreamPhase::Done;
                    std::task::Poll::Ready(None)
                }
            }
            StreamPhase::Done => std::task::Poll::Ready(None),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use prompty::model::context::LoadContext;
    use serde_json::json;

    fn make_agent(outputs_json: Value) -> Prompty {
        let mut data = json!({
            "name": "test",
            "kind": "prompt",
            "model": {"id": "gpt-4"},
            "instructions": "test",
        });
        if !outputs_json.is_null() {
            data["outputs"] = outputs_json;
        }
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[test]
    fn test_process_chat_content() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Hello!"
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!("Hello!"));
    }

    #[test]
    fn test_process_chat_tool_calls() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": "{\"city\":\"SF\"}"
                        }
                    }]
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        let calls = result.as_array().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["name"], "get_weather");
        assert_eq!(calls[0]["id"], "call_1");
    }

    #[test]
    fn test_process_chat_refusal() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "refusal": "I can't do that"
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!("I can't do that"));
    }

    #[test]
    fn test_process_structured_output() {
        let agent = make_agent(json!([
            {"name": "answer", "kind": "string", "required": true}
        ]));
        let response = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "{\"answer\": \"42\"}"
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result["answer"], "42");
    }

    #[test]
    fn test_process_embedding_single() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "object": "list",
            "data": [{
                "object": "embedding",
                "embedding": [0.1, 0.2, 0.3]
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!([0.1, 0.2, 0.3]));
    }

    #[test]
    fn test_process_embedding_multiple() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "object": "list",
            "data": [
                {"object": "embedding", "embedding": [0.1, 0.2]},
                {"object": "embedding", "embedding": [0.3, 0.4]}
            ]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!([[0.1, 0.2], [0.3, 0.4]]));
    }

    #[test]
    fn test_process_image_single() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "data": [{"url": "https://example.com/image.png"}]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!("https://example.com/image.png"));
    }

    #[test]
    fn test_process_image_multiple() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "data": [
                {"url": "https://a.png"},
                {"url": "https://b.png"}
            ]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!(["https://a.png", "https://b.png"]));
    }

    #[test]
    fn test_extract_tool_calls() {
        let val = json!([
            {"id": "c1", "name": "fn1", "arguments": "{}"},
            {"id": "c2", "name": "fn2", "arguments": "{\"x\":1}"}
        ]);
        let calls = extract_tool_calls(&val).unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "fn1");
        assert_eq!(calls[1].name, "fn2");
    }

    #[test]
    fn test_extract_tool_calls_not_tool_response() {
        assert!(extract_tool_calls(&json!("Hello")).is_none());
        assert!(extract_tool_calls(&json!(42)).is_none());
    }

    // -----------------------------------------------------------------------
    // Edge cases: empty choices, missing message, malformed tool calls
    // -----------------------------------------------------------------------

    #[test]
    fn test_empty_choices_error() {
        let agent = Prompty::default();
        let response = json!({
            "choices": []
        });
        let err = process_response(&agent, &response).unwrap_err();
        assert!(err.to_string().contains("Empty choices"));
    }

    #[test]
    fn test_missing_message_error() {
        let agent = Prompty::default();
        let response = json!({
            "choices": [{"finish_reason": "stop"}]
        });
        let err = process_response(&agent, &response).unwrap_err();
        assert!(err.to_string().contains("Missing message"));
    }

    #[test]
    fn test_tool_calls_with_missing_fields() {
        let agent = Prompty::default();
        // Tool calls where some entries are malformed
        let response = json!({
            "choices": [{
                "message": {
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "function": {"name": "test", "arguments": "{}"}
                        },
                        {
                            // Missing function block — should still extract with empty defaults
                            "id": "call_2"
                        }
                    ]
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["name"], "test");
        // Malformed entry should have empty defaults
        assert_eq!(arr[1]["name"], "");
    }

    #[test]
    fn test_null_content_no_refusal() {
        let agent = Prompty::default();
        let response = json!({
            "choices": [{
                "message": {
                    "content": null
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn test_unknown_response_shape_passthrough() {
        let agent = Prompty::default();
        let response = json!({
            "unexpected": "format",
            "custom": 42
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, response);
    }

    #[test]
    fn test_extract_tool_calls_empty_array() {
        // Empty array should return None
        assert!(extract_tool_calls(&json!([])).is_none());
    }

    #[test]
    fn test_extract_tool_calls_array_with_non_tool_objects() {
        // Array of objects without proper tool call fields
        let val = json!([{"foo": "bar"}, {"baz": 42}]);
        assert!(extract_tool_calls(&val).is_none());
    }

    #[test]
    fn test_structured_output_invalid_json_falls_back() {
        // Agent with outputs, but content is not valid JSON — falls back to raw string
        let data = serde_json::json!({
            "kind": "prompt",
            "name": "structured",
            "model": "gpt-4",
            "outputs": [{"name": "result", "kind": "object"}],
            "instructions": "Return JSON"
        });
        let agent = Prompty::load_from_value(&data, &LoadContext::default());
        let response = json!({
            "choices": [{
                "message": {
                    "content": "this is not json"
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, "this is not json");
    }

    #[test]
    fn test_embedding_multiple_vectors() {
        let agent = Prompty::default();
        let response = json!({
            "object": "list",
            "data": [
                {"embedding": [0.1, 0.2]},
                {"embedding": [0.3, 0.4]}
            ]
        });
        let result = process_response(&agent, &response).unwrap();
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
    }

    #[test]
    fn test_image_multiple_urls() {
        let agent = Prompty::default();
        let response = json!({
            "data": [
                {"url": "https://a.com/1.png"},
                {"url": "https://a.com/2.png"}
            ]
        });
        let result = process_response(&agent, &response).unwrap();
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
    }

    // -----------------------------------------------------------------------
    // Streaming processor tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_stream_text_content() {
        use futures::StreamExt;
        let chunks = vec![
            json!({"choices": [{"delta": {"content": "Hello"}}]}),
            json!({"choices": [{"delta": {"content": " world"}}]}),
            json!({"choices": [{"delta": {}}]}),  // empty delta
        ];
        let inner = futures::stream::iter(chunks);
        let mut stream = process_stream(inner);
        let mut texts = Vec::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                StreamChunk::Text(t) => texts.push(t),
                StreamChunk::Tool(_) => panic!("unexpected tool call"),
            }
        }
        assert_eq!(texts.join(""), "Hello world");
    }

    #[tokio::test]
    async fn test_stream_tool_calls() {
        use futures::StreamExt;
        let chunks = vec![
            json!({"choices": [{"delta": {"tool_calls": [
                {"index": 0, "id": "call_1", "function": {"name": "get_weather", "arguments": "{\"ci"}}
            ]}}]}),
            json!({"choices": [{"delta": {"tool_calls": [
                {"index": 0, "function": {"arguments": "ty\":\"SF\"}"}}
            ]}}]}),
        ];
        let inner = futures::stream::iter(chunks);
        let mut stream = process_stream(inner);
        let mut tools = Vec::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                StreamChunk::Text(_) => {}
                StreamChunk::Tool(tc) => tools.push(tc),
            }
        }
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].id, "call_1");
        assert_eq!(tools[0].name, "get_weather");
        assert_eq!(tools[0].arguments, "{\"city\":\"SF\"}");
    }

    #[tokio::test]
    async fn test_stream_refusal() {
        use futures::StreamExt;
        let chunks = vec![
            json!({"choices": [{"delta": {"refusal": "I cannot help with that"}}]}),
        ];
        let inner = futures::stream::iter(chunks);
        let mut stream = process_stream(inner);
        let mut texts = Vec::new();
        while let Some(chunk) = stream.next().await {
            if let StreamChunk::Text(t) = chunk {
                texts.push(t);
            }
        }
        assert_eq!(texts.len(), 1);
        assert!(texts[0].contains("refused"));
    }

    #[tokio::test]
    async fn test_stream_with_consume() {
        use prompty::types::consume_stream_chunks;
        let chunks = vec![
            json!({"choices": [{"delta": {"content": "Hello"}}]}),
            json!({"choices": [{"delta": {"content": " "}}]}),
            json!({"choices": [{"delta": {"content": "world"}}]}),
        ];
        let inner = futures::stream::iter(chunks);
        let stream = process_stream(inner);
        let (tool_calls, content) = consume_stream_chunks(stream, None).await;
        assert!(tool_calls.is_empty());
        assert_eq!(content, "Hello world");
    }

    #[tokio::test]
    async fn test_stream_mixed_content_then_tools() {
        use futures::StreamExt;
        // Some providers may send content then tool calls
        let chunks = vec![
            json!({"choices": [{"delta": {"content": "Let me check..."}}]}),
            json!({"choices": [{"delta": {"tool_calls": [
                {"index": 0, "id": "c1", "function": {"name": "search", "arguments": "{}"}}
            ]}}]}),
        ];
        let inner = futures::stream::iter(chunks);
        let mut stream = process_stream(inner);
        let mut texts = Vec::new();
        let mut tools = Vec::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                StreamChunk::Text(t) => texts.push(t),
                StreamChunk::Tool(tc) => tools.push(tc),
            }
        }
        assert_eq!(texts.join(""), "Let me check...");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "search");
    }
}
